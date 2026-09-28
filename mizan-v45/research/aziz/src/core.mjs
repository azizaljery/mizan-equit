// Research-only, pure functions. No imports from, or writes to, the live service.
export const VERSION = 'mizan-bridge/0.1.0';
const fail = message => { throw new Error(message); };
const finite = (x, name) => Number.isFinite(x) ? x : fail(`invalid ${name}`);
const positive = (x, name) => finite(x, name) > 0 ? x : fail(`nonpositive ${name}`);
const time = (x, name) => { const n = Date.parse(x); return Number.isFinite(n) && /(?:Z|[+-]\d\d:\d\d)$/.test(x) ? n : fail(`invalid ${name}`); };
const available = (record, asOf) => { if (!record || time(record.availableAt, 'availableAt') > asOf) fail('future or missing availability'); return record.value; };
export function buildBridgeInputs(snapshot, base) {
  if (snapshot.schemaVersion !== 1 || base.schemaVersion !== 1) fail('schema mismatch');
  if (snapshot.symbol !== base.symbol || snapshot.market !== base.market || snapshot.currency !== base.currency || !['SA','US'].includes(base.market)) fail('identity mismatch');
  const issued = time(base.issuedAt, 'issuedAt'), asOf = time(snapshot.asOf, 'asOf'), target = time(base.targetAt, 'targetAt');
  if (!(issued < asOf && asOf < target)) fail('invalid timeline');
  if (time(snapshot.observedThrough, 'observedThrough') > asOf) fail('observation after asOf');
  if (snapshot.priceBasis !== base.priceBasis || !snapshot.priceBasis) fail('price basis mismatch');
  if (base.shortHorizon !== 5 || base.longHorizon !== 21 || snapshot.elapsedSessions !== 5 || snapshot.remainingSessions !== 16) fail('horizon mismatch');
  const p = positive(available(snapshot.currentPrice, asOf), 'currentPrice');
  const short = positive(base.shortPrice, 'shortPrice'), long = positive(base.longPrice, 'longPrice');
  if (time(base.shortTargetAt, 'shortTargetAt') !== time(snapshot.observedThrough, 'observedThrough')) fail('short target mismatch');
  const context = {};
  for (const [key, value] of Object.entries(snapshot.context ?? {})) context[key] = finite(available(value, asOf), key);
  return Object.freeze({ schemaVersion: 1, baseForecastId: base.id, symbol: base.symbol, market: base.market, currency: base.currency, asOf: snapshot.asOf, targetAt: base.targetAt, priceBasis: base.priceBasis, currentPrice: p, earlyError: Math.log(p / short), baselineRemainingLogReturn: Math.log(long / short), baselinePointPrice: p * long / short, context: Object.freeze(context) });
}
export function kalmanStep(state, observation, config) {
  if (!state || !config) fail('missing kalman state or config');
  const { persistence, processVariance, observationVariance } = config;
  for (const [name, value] of Object.entries({persistence, processVariance, observationVariance})) finite(value, name);
  if (!(persistence >= -1 && persistence <= 1 && processVariance >= 0 && observationVariance > 0)) fail('invalid kalman config');
  finite(observation, 'observation');
  const variance = finite(state.variance, 'variance');
  if (variance < 0) fail('invalid variance');
  const priorMean = finite(persistence * finite(state.mean, 'mean'), 'priorMean');
  const priorVariance = finite(persistence ** 2 * variance + processVariance, 'priorVariance');
  const gain = priorVariance / (priorVariance + observationVariance);
  return { mean: finite(priorMean + gain * (observation - priorMean), 'posteriorMean'), variance: finite(Math.max(0, (1 - gain) * priorVariance), 'posteriorVariance'), innovation: finite(observation - priorMean, 'innovation') };
}
export function replayKalman(events, asOf, config, initial = {mean:0, variance:1}) {
  let state = {...initial}, last = -Infinity;
  const seen = new Set(), cutoff = time(asOf, 'asOf');
  for (const event of events) {
    const t = time(event.availableAt, 'availableAt');
    if (t > cutoff || t < last || seen.has(event.id)) fail('future, unordered or duplicate kalman event');
    if (time(event.targetAt, 'targetAt') > t) fail('immature kalman event');
    state = kalmanStep(state, event.error, config); last = t; seen.add(event.id);
  }
  return state;
}
export function predictCorrection(inputs, artifact, kalmanState) {
  if (artifact?.schemaVersion !== 1 || artifact?.featureNames?.length !== artifact?.weights?.length) fail('invalid artifact');
  if (artifact.market !== inputs.market || artifact.horizon !== 21) fail('artifact scope mismatch');
  const features = { earlyError: inputs.earlyError, baselineRemainingLogReturn: inputs.baselineRemainingLogReturn, kalmanMean: kalmanState?.mean, kalmanVariance: kalmanState?.variance, ...inputs.context };
  let correction = finite(artifact.intercept, 'intercept');
  for (let i = 0; i < artifact.weights.length; i++) correction += finite(artifact.weights[i], 'weight') * finite(features[artifact.featureNames[i]], artifact.featureNames[i]);
  if (!Number.isFinite(correction) || Math.abs(correction) > (artifact.maxAbsCorrection ?? 0.5)) return {status:'abstained', reason:'correction_out_of_bounds'};
  const remainingLogReturn = inputs.baselineRemainingLogReturn + correction;
  const pointPrice = inputs.currentPrice * Math.exp(remainingLogReturn);
  if (!Number.isFinite(pointPrice) || pointPrice <= 0) return {status:'abstained', reason:'invalid_point_price'};
  return {status:'corrected', pointPrice, pointType:'exp_predicted_log_return', remainingLogReturn, correction, probabilityUp:null, targetAt:inputs.targetAt, asOf:inputs.asOf, baseForecastId:inputs.baseForecastId, artifactVersion:artifact.version};
}
export function recordMaturedOutcome(state, outcome) {
  const t = time(outcome.availableAt, 'availableAt');
  if (time(outcome.targetAt, 'targetAt') > t || time(outcome.observedAt, 'observedAt') > t) fail('immature outcome');
  if (state.seenIds.includes(outcome.id)) return {state, applied:false};
  if (state.lastAvailableAt && t < time(state.lastAvailableAt, 'lastAvailableAt')) fail('out of order outcome');
  if (state.modelVersion !== outcome.modelVersion) fail('model version mismatch');
  const next = {...state, seenIds:[...state.seenIds, outcome.id], lastAvailableAt:outcome.availableAt};
  if (outcome.probabilityUp != null) {
    const p = finite(outcome.probabilityUp, 'probabilityUp'), y = outcome.actualUp;
    if (p < 0 || p > 1 || ![0,1].includes(y)) fail('invalid probabilistic outcome');
    const e = y - p, k = positive(state.k, 'k'), h = positive(state.h, 'h');
    next.plus = Math.max(0, state.plus + e - k);
    next.minus = Math.max(0, state.minus - e - k);
    next.status = Math.max(next.plus, next.minus) >= h ? 'suspended' : state.status;
    next.brierSum = (state.brierSum ?? 0) + (y-p)**2;
    next.brierCount = (state.brierCount ?? 0) + 1;
  }
  return {state:next, applied:true};
}
export function assessEligibility(policy, facts, action='buy') {
  const reasons=[];
  if (!['buy','add','reduce','exit'].includes(action)) fail('invalid action');
  if (policy.allowedMarkets && !policy.allowedMarkets.includes(facts.market)) reasons.push('market_not_allowed');
  if (['buy','add'].includes(action)) {
    if (facts.shariaCompliant === false && policy.requireSharia) reasons.push('sharia_policy');
    if (facts.liquidity != null && policy.minLiquidity != null && facts.liquidity < policy.minLiquidity) reasons.push('low_liquidity');
  }
  if (reasons.length) return {status:'ineligible', reasons, action};
  if (['buy','add'].includes(action) && ((policy.requireSharia && facts.shariaCompliant == null) || (policy.minLiquidity != null && facts.liquidity == null) || facts.dataQuality == null)) return {status:'unknown', reasons:['missing_facts'], action};
  return {status:'eligible', reasons:[], action};
}
export function assessRisk(prediction, exposure) {
  if (!exposure || !(exposure.capital > 0) || exposure.positionValue == null || !prediction?.targetAt) return {status:'unavailable', reason:'missing_exposure_or_horizon'};
  const concentration = finite(exposure.positionValue, 'positionValue') / exposure.capital;
  if (concentration < 0) fail('negative exposure');
  return {status:'partial', asOf:prediction.asOf, targetAt:prediction.targetAt, concentration, unit:'fraction_of_capital', missing:['loss_distribution','liquidity','execution_costs']};
}
export function selectEffectiveForecast(base, candidate, monitor, mode='OFF') {
  if (!['OFF','REPLAY','SHADOW','ASSIST','ACTIVE'].includes(mode)) fail('invalid mode');
  if (mode !== 'ACTIVE' || monitor?.status !== 'normal' || candidate?.status !== 'corrected' || candidate.baseForecastId !== base.id || candidate.targetAt !== base.targetAt) return {effective:base, route:'fallback', shadow:candidate ?? null};
  return {effective:candidate, route:'corrected', shadow:candidate};
}
