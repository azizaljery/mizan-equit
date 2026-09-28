// Research features only. This is a level-2 path signature, not Sig-GSPHAR.
// No training, market reads, state updates, or production forecast routing.
export const PATH_SIGNATURE_VERSION = 'aziz-path-signature/1';
export const PATH_SIGNATURE_FEATURE_NAMES = Object.freeze([
  'sigLogReturn', 'sigLogVolume', 'sigTimeReturnArea',
  'sigTimeVolumeArea', 'sigReturnVolumeArea',
]);

const finite = (value, name) => {
  if (!Number.isFinite(value)) throw Error(`invalid ${name}`);
  return value;
};
const timestamp = (value, name) => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw Error(`timestamp with timezone required: ${name}`);
  }
  return finite(Date.parse(value), name);
};
const freezeMatrix = matrix => Object.freeze(matrix.map(row => Object.freeze(row)));

/**
 * Exact truncated signature of the piecewise-linear interpolation of points.
 * For each increment d, Chen concatenation gives
 *   S2(new) = S2(old) + S1(old) tensor d + d tensor d / 2.
 * areas[i][j] = (S2[i][j] - S2[j][i]) / 2 are the level-2
 * log-signature coefficients in the tensor coordinates (signed Levy areas).
 * Reference: Chevyrev & Kormilitzin, https://arxiv.org/abs/1603.03788.
 */
export function signatureLevel2(points) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(points[0])
    || points[0].length < 1) throw Error('at least two vector points required');
  const dimension = points[0].length;
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== dimension) throw Error('point dimension mismatch');
    point.forEach(value => finite(value, 'path coordinate'));
  }
  const level1 = Array(dimension).fill(0);
  const level2 = Array.from({length: dimension}, () => Array(dimension).fill(0));
  for (let k = 1; k < points.length; k++) {
    const delta = points[k].map((value, j) => finite(value - points[k - 1][j], 'path increment'));
    // Update the second level before changing the first level.
    for (let i = 0; i < dimension; i++) {
      for (let j = 0; j < dimension; j++) {
        level2[i][j] = finite(level2[i][j] + level1[i] * delta[j]
          + delta[i] * delta[j] / 2, 'signature level 2');
      }
    }
    for (let j = 0; j < dimension; j++) level1[j] = finite(level1[j] + delta[j], 'signature level 1');
  }
  const areas = level2.map((row, i) => row.map((value, j) => finite((value - level2[j][i]) / 2, 'signature area')));
  return Object.freeze({level1: Object.freeze(level1), level2: freezeMatrix(level2), areas: freezeMatrix(areas)});
}

/**
 * Build five unscaled, causal path features from lookback + 1 completed bars.
 * Each bar must carry market, symbol, priceBasis, observedAt, availableAt,
 * close > 0 and volume >= 0. Availability is evidence supplied by the caller;
 * this function cannot verify provider publication times or corporate actions.
 *
 * Path coordinates: [session fraction, log(close / initial close),
 * log(1 + volume) - log(1 + initial volume)]. log1p permits zero volume;
 * volume units must therefore stay consistent. Price units cancel exactly.
 * No future interpolation, imputation, standardization or learned graph is used.
 * Fit any feature scaler exclusively on the training portion of each fold.
 */
export function buildPathSignatureFeatures({bars, asOf, lookback = 20,
  market, symbol, priceBasis} = {}) {
  const cutoff = timestamp(asOf, 'asOf');
  if (!Array.isArray(bars)) throw Error('bars required');
  if (!Number.isInteger(lookback) || lookback < 2) throw Error('lookback must be at least two sessions');
  if (!['SA', 'US'].includes(market) || typeof symbol !== 'string' || !symbol.trim()
    || typeof priceBasis !== 'string' || !priceBasis.trim()) throw Error('path scope required');

  const known = [];
  for (const bar of bars) {
    const available = timestamp(bar?.availableAt, 'bar.availableAt');
    // Do not inspect values of records that were not available at the cutoff.
    if (available > cutoff) continue;
    const observed = timestamp(bar?.observedAt, 'bar.observedAt');
    if (observed > available) throw Error('bar observation after availability');
    if (bar.market !== market || bar.symbol !== symbol || bar.priceBasis !== priceBasis) {
      throw Error('bar scope or price basis mismatch');
    }
    known.push({bar, available, observed});
  }
  known.sort((a, b) => a.observed - b.observed);
  for (let i = 1; i < known.length; i++) {
    if (known[i].observed === known[i - 1].observed) throw Error('duplicate observed bar; resolve data vintages first');
  }
  const scope = {version: PATH_SIGNATURE_VERSION, market, symbol, priceBasis, asOf, lookback};
  if (known.length < lookback + 1) {
    return Object.freeze({...scope, status: 'insufficient_history',
      sampleCount: known.length, requiredBars: lookback + 1,
      features: null, featureRecords: null});
  }

  const selected = known.slice(-(lookback + 1));
  for (const {bar} of selected) {
    if (finite(bar.close, 'bar.close') <= 0) throw Error('bar.close must be positive');
    if (finite(bar.volume, 'bar.volume') < 0) throw Error('bar.volume must be nonnegative');
  }
  const startLogPrice = Math.log(selected[0].bar.close);
  const startLogVolume = Math.log1p(selected[0].bar.volume);
  const path = selected.map(({bar}, index) => [index / lookback,
    Math.log(bar.close) - startLogPrice, Math.log1p(bar.volume) - startLogVolume]);
  const signature = signatureLevel2(path);
  const features = Object.freeze({
    sigLogReturn: signature.level1[1],
    sigLogVolume: signature.level1[2],
    sigTimeReturnArea: signature.areas[0][1],
    sigTimeVolumeArea: signature.areas[0][2],
    sigReturnVolumeArea: signature.areas[1][2],
  });
  const availableAt = new Date(Math.max(...selected.map(row => row.available))).toISOString();
  const featureRecords = Object.freeze(Object.fromEntries(PATH_SIGNATURE_FEATURE_NAMES
    .map(name => [name, Object.freeze({value: features[name], availableAt})])));
  return Object.freeze({...scope, status: 'available', sampleCount: selected.length,
    availableAt, observedThrough: selected.at(-1).bar.observedAt,
    windowStartAt: selected[0].bar.observedAt, features, featureRecords});
}
