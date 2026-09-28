// Pure research mathematics. Callers must enforce point-in-time availability,
// identity, price basis and chronological ordering before supplying observations.
const EPSILON = 1e-12;
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`invalid ${name}`);
  return value;
};
const positive = (value, name) => {
  finite(value, name);
  if (!(value > 0)) throw Error(`nonpositive ${name}`);
  return value;
};
const vector = (values, size, name) => {
  if (!Array.isArray(values) || values.length !== size) throw Error(`invalid ${name} dimension`);
  // Array iteration helpers skip holes; an absent entry is not an observed zero.
  for (let i = 0; i < size; i++) finite(values[i], `${name}[${i}]`);
  return values;
};
const mean = values => finite(values.reduce((sum, value) => sum + value / values.length, 0), 'mean');
const dot = (a, b) => finite(a.reduce((sum, value, i) => sum + value * b[i], 0), 'dot product');

// Hyndman-Fan type 7, equivalent to linear interpolation at (n - 1) p.
function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position), fraction = position - left;
  if (fraction === 0) return sorted[left];
  return finite((1 - fraction) * sorted[left] + fraction * sorted[left + 1], 'quantile');
}

/** Solve least squares using column-pivoted Householder QR, without forming X'X. */
function solveLeastSquares(matrix, response) {
  const a = matrix.map(row => [...row]), b = [...response];
  const rows = a.length, columns = a[0].length;
  const permutation = Array.from({length: columns}, (_, i) => i);
  let leadingNorm = null;
  for (let k = 0; k < columns; k++) {
    let pivot = k, largestNorm = -1;
    for (let j = k; j < columns; j++) {
      let norm = 0;
      for (let i = k; i < rows; i++) norm = Math.hypot(norm, a[i][j]);
      finite(norm, 'QR column norm');
      if (norm > largestNorm) { largestNorm = norm; pivot = j; }
    }
    if (leadingNorm === null) leadingNorm = largestNorm;
    if (!(largestNorm > Number.EPSILON * Math.max(rows, columns) * leadingNorm)) {
      throw Error('numerically singular ridge system');
    }
    if (pivot !== k) {
      for (const row of a) [row[k], row[pivot]] = [row[pivot], row[k]];
      [permutation[k], permutation[pivot]] = [permutation[pivot], permutation[k]];
    }
    const sign = a[k][k] >= 0 ? 1 : -1;
    const reflector = [];
    for (let i = k; i < rows; i++) reflector.push(a[i][k] / largestNorm);
    reflector[0] += sign;
    const factor = 2 / dot(reflector, reflector);
    for (let j = k + 1; j < columns; j++) {
      let projection = 0;
      for (let i = k; i < rows; i++) projection += reflector[i - k] * a[i][j];
      projection = finite(projection * factor, 'QR projection');
      for (let i = k; i < rows; i++) {
        a[i][j] = finite(a[i][j] - projection * reflector[i - k], 'QR entry');
      }
    }
    let projection = 0;
    for (let i = k; i < rows; i++) projection += reflector[i - k] * b[i];
    projection = finite(projection * factor, 'QR response projection');
    for (let i = k; i < rows; i++) b[i] = finite(b[i] - projection * reflector[i - k], 'QR response');
    a[k][k] = -sign * largestNorm;
    for (let i = k + 1; i < rows; i++) a[i][k] = 0;
  }
  const permuted = Array(columns).fill(0);
  for (let i = columns - 1; i >= 0; i--) {
    let remainder = b[i];
    for (let j = i + 1; j < columns; j++) remainder -= a[i][j] * permuted[j];
    permuted[i] = finite(remainder / a[i][i], 'ridge coefficient');
  }
  const coefficients = Array(columns).fill(0);
  permutation.forEach((original, i) => { coefficients[original] = permuted[i]; });
  return coefficients;
}

/**
 * Minimize sum_i (y_i - intercept - z_i' beta)^2 + lambda ||beta||^2.
 * z uses training-only medians and IQRs; the intercept is not penalized.
 * No fitting occurs at prediction time. A zero training IQR uses scale 1.
 */
export function fitRobustRidge(rows, {lambda = 1} = {}) {
  positive(lambda, 'lambda');
  if (!Array.isArray(rows) || rows.length === 0) throw Error('training rows required');
  const dimensions = rows[0]?.x?.length;
  if (!Number.isInteger(dimensions) || dimensions < 1) throw Error('features required');
  for (let i = 0; i < rows.length; i++) {
    vector(rows[i]?.x, dimensions, `row ${i} features`);
    finite(rows[i]?.y, `row ${i} target`);
  }
  const medians = [], scales = [];
  for (let j = 0; j < dimensions; j++) {
    const sorted = rows.map(row => row.x[j]).sort((a, b) => a - b);
    medians.push(quantile(sorted, 0.5));
    const iqr = finite(quantile(sorted, 0.75) - quantile(sorted, 0.25), 'IQR');
    scales.push(iqr === 0 ? 1 : positive(iqr, 'IQR'));
  }
  const transformed = rows.map(row => row.x.map((value, j) => finite((value - medians[j]) / scales[j], 'scaled feature')));
  const featureMeans = Array.from({length: dimensions}, (_, j) => mean(transformed.map(row => row[j])));
  const targetMean = mean(rows.map(row => row.y));
  const matrix = transformed.map(row => row.map((value, j) => finite(value - featureMeans[j], 'centered feature')));
  const response = rows.map(row => finite(row.y - targetMean, 'centered target'));
  const penalty = Math.sqrt(lambda);
  for (let j = 0; j < dimensions; j++) {
    const row = Array(dimensions).fill(0);
    row[j] = penalty;
    matrix.push(row);
    response.push(0);
  }
  const coefficients = solveLeastSquares(matrix, response);
  const intercept = finite(targetMean - dot(coefficients, featureMeans), 'intercept');
  return Object.freeze({
    kind: 'robust-ridge/v1', dimensions, sampleCount: rows.length, lambda,
    medians: Object.freeze(medians), scales: Object.freeze(scales),
    coefficients: Object.freeze(coefficients), intercept,
  });
}

export function predictRobustRidge(model, x) {
  const dimensions = model?.dimensions;
  if (model?.kind !== 'robust-ridge/v1' || !Number.isInteger(dimensions) || dimensions < 1) throw Error('invalid ridge model');
  vector(x, dimensions, 'prediction features');
  vector(model.medians, dimensions, 'model medians');
  vector(model.scales, dimensions, 'model scales').forEach(value => positive(value, 'model scale'));
  vector(model.coefficients, dimensions, 'model coefficients');
  finite(model.intercept, 'model intercept');
  const z = x.map((value, j) => finite((value - model.medians[j]) / model.scales[j], 'scaled prediction feature'));
  return finite(model.intercept + dot(z, model.coefficients), 'prediction');
}

function squaredLogReturns(closes) {
  if (!Array.isArray(closes) || closes.length < 2) throw Error('at least two closes required');
  for (let i = 0; i < closes.length; i++) positive(closes[i], `close ${i}`);
  const squares = [];
  for (let i = 1; i < closes.length; i++) {
    // Log differences avoid overflow/underflow in a ratio of valid prices.
    const logReturn = Math.log(closes[i]) - Math.log(closes[i - 1]);
    squares.push(finite(logReturn * logReturn, 'squared log return'));
  }
  return squares;
}

/**
 * Log-HAR inputs based on squared daily close-to-close returns.
 * This is a noisy volatility proxy, not intraday realized variance. Timestamp,
 * market and price-adjustment validation belongs to the point-in-time caller.
 */
export function harFeatures(bars) {
  if (!Array.isArray(bars) || bars.length < 23) throw Error('HAR requires at least 23 closes');
  // Validate every supplied close, even when only the last 23 enter this window.
  const closes = Array.from({length: bars.length}, (_, i) => positive(bars[i]?.close, `bar ${i} close`));
  const squares = squaredLogReturns(closes.slice(-23));
  return [1, 5, 22].map(window => Math.log(EPSILON + mean(squares.slice(-window))));
}

/** Sum of h squared one-session returns from h + 1 prices, not squared h-return. */
export function squaredReturnSum(closes) {
  return finite(squaredLogReturns(closes).reduce((sum, value) => sum + value, 0), 'squared return sum');
}
