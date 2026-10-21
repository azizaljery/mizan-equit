// Research-only, pure functions. No imports from, or writes to, the live service.
export const VERSION = 'mizan-bridge/0.1.0';
const fail = message => { throw new Error(message); };
const finite = (x, name) => Number.isFinite(x) ? x : fail(`invalid ${name}`);
const positive = (x, name) => finite(x, name) > 0 ? x : fail(`nonpositive ${name}`);
const time = (x, name) => { const n = Date.parse(x); return Number.isFinite(n) && /(?:Z|[+-]\d\d:\d\d)$/.test(x) ? n : fail(`invalid ${name}`); };
const available = (record, asOf) => { if (!record || time(record.availableAt, 'availableAt') > asOf) fail('future or missing availability'); return record.value; };
// Names owned by the bridge; snapshot.context may not reuse them (would shadow base features).
export const RESERVED_FEATURES = Object.freeze(['earlyError', 'baselineRemainingLogReturn', 'kalmanMean', 'kalmanVariance']);
const KALMAN_FEATURES = ['kalmanMean', 'kalmanVariance'];
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
  for (const [key, value] of Object.entries(snapshot.context ?? {})) { if (RESERVED_FEATURES.includes(key)) fail(`reserved context name: ${key}`); context[key] = finite(available(value, asOf), key); }
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
  let state = {mean:initial.mean, variance:initial.variance}, last = -Infinity, lastAvailableAt = null;
  const seen = new Set(), cutoff = time(asOf, 'asOf');
  for (const event of events) {
    const t = time(event.availableAt, 'availableAt');
    if (t > cutoff || t < last || seen.has(event.id)) fail('future, unordered or duplicate kalman event');
    if (time(event.targetAt, 'targetAt') > t) fail('immature kalman event');
    const step = kalmanStep(state, event.error, config); state = {mean:step.mean, variance:step.variance}; last = t; lastAvailableAt = event.availableAt; seen.add(event.id);
  }
  return {...state, observations:seen.size, lastAvailableAt};
}
// Single feature definition for fitting, replay and prediction. Kalman features exist only when a
// state (as known at the row's issue time) is supplied; absence is never replaced by 0.
export function bridgeFeatures(inputs, kalmanState = null) {
  const features = { earlyError: inputs.earlyError, baselineRemainingLogReturn: inputs.baselineRemainingLogReturn };
  if (kalmanState != null) {
    features.kalmanMean = finite(kalmanState.mean, 'kalmanMean');
    if (!(finite(kalmanState.variance, 'kalmanVariance') >= 0)) fail('invalid kalmanVariance');
    features.kalmanVariance = kalmanState.variance;
  }
  for (const [key, value] of Object.entries(inputs.context ?? {})) { if (RESERVED_FEATURES.includes(key)) fail(`reserved context name: ${key}`); features[key] = value; }
  return features;
}
export function predictCorrection(inputs, artifact, kalmanState) {
  if (artifact?.schemaVersion !== 1 || artifact?.featureNames?.length !== artifact?.weights?.length) fail('invalid artifact');
  if (artifact.market !== inputs.market || artifact.horizon !== 21) fail('artifact scope mismatch');
  const trace = { targetAt:inputs.targetAt, asOf:inputs.asOf, baseForecastId:inputs.baseForecastId, artifactVersion:artifact.version };
  if (kalmanState?.lastAvailableAt != null && time(kalmanState.lastAvailableAt, 'kalman lastAvailableAt') >= time(inputs.asOf, 'asOf')) fail('kalman state not known at issue time');
  const features = bridgeFeatures(inputs, kalmanState);
  for (const name of artifact.featureNames) if (!Number.isFinite(features[name])) return {status:'abstained', reason:KALMAN_FEATURES.includes(name) ? 'missing_kalman_state' : 'missing_feature', feature:name, ...trace};
  let correction = finite(artifact.intercept, 'intercept');
  for (let i = 0; i < artifact.weights.length; i++) correction += finite(artifact.weights[i], 'weight') * features[artifact.featureNames[i]];
  if (!Number.isFinite(correction) || Math.abs(correction) > (artifact.maxAbsCorrection ?? 0.5)) return {status:'abstained', reason:'correction_out_of_bounds', ...trace};
  const remainingLogReturn = inputs.baselineRemainingLogReturn + correction;
  const pointPrice = inputs.currentPrice * Math.exp(remainingLogReturn);
  if (!Number.isFinite(pointPrice) || pointPrice <= 0) return {status:'abstained', reason:'invalid_point_price', ...trace};
  return {status:'corrected', pointPrice, pointType:'exp_predicted_log_return', remainingLogReturn, correction, probabilityUp:null, ...trace, symbol:inputs.symbol, market:inputs.market, currency:inputs.currency, priceBasis:inputs.priceBasis};
}
// Single monitor implementation lives in monitor.mjs; recordMaturedOutcome is kept as an alias.
export { newMonitor, observeMonitor, observeMonitor as recordMaturedOutcome } from './monitor.mjs';
// Research primitive, NOT a production gate. For buy/add, policy.minDataQuality (a number in (0,1])
// is required, and facts.dataQuality must be a finite number in [0,1] that is >= it. Missing, zero,
// NaN or non-numeric quality is ineligible. A missing threshold yields 'unknown', never 'eligible'.
export function assessEligibility(policy, facts, action='buy') {
  const reasons=[];
  if (!['buy','add','reduce','exit'].includes(action)) fail('invalid action');
  const entry = ['buy','add'].includes(action), min = policy.minDataQuality;
  if (min != null && !(Number.isFinite(min) && min > 0 && min <= 1)) fail('invalid minDataQuality');
  if (policy.allowedMarkets && !policy.allowedMarkets.includes(facts.market)) reasons.push('market_not_allowed');
  if (entry) {
    if (facts.shariaCompliant === false && policy.requireSharia) reasons.push('sharia_policy');
    if (facts.liquidity != null && policy.minLiquidity != null && facts.liquidity < policy.minLiquidity) reasons.push('low_liquidity');
    const q = facts.dataQuality;
    if (!(typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= 1)) reasons.push('data_quality_missing_or_invalid');
    else if (min != null && q < min) reasons.push('low_data_quality');
  }
  if (reasons.length) return {status:'ineligible', reasons, action};
  if (entry && min == null) return {status:'unknown', reasons:['missing_data_quality_threshold'], action};
  if (entry && ((policy.requireSharia && facts.shariaCompliant == null) || (policy.minLiquidity != null && facts.liquidity == null))) return {status:'unknown', reasons:['missing_facts'], action};
  return {status:'eligible', reasons:[], action};
}
export function assessRisk(prediction, exposure) {
  if (!exposure || !(exposure.capital > 0) || exposure.positionValue == null || !prediction?.targetAt) return {status:'unavailable', reason:'missing_exposure_or_horizon'};
  const concentration = finite(exposure.positionValue, 'positionValue') / exposure.capital;
  if (concentration < 0) fail('negative exposure');
  return {status:'partial', asOf:prediction.asOf, targetAt:prediction.targetAt, concentration, unit:'fraction_of_capital', missing:['loss_distribution','liquidity','execution_costs']};
}
// Central identity/authority check; returns the first failing reason code, or null.
// context: {asOf (decision time), approval:{status:'approved',modelVersion,expiresAt?}, eligibility:{status}}.
export function candidateMismatch(base, candidate, monitor, context = {}) {
  if (candidate?.status !== 'corrected') return 'candidate_not_corrected';
  if (monitor?.status !== 'normal') return 'monitor_not_normal';
  if (candidate.baseForecastId !== base.id) return 'base_forecast_mismatch';
  for (const f of ['symbol','market','currency','priceBasis']) if (!base[f] || candidate[f] !== base[f]) return `${f.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}_mismatch`;
  if (!candidate.targetAt || time(candidate.targetAt, 'targetAt') !== time(base.targetAt, 'targetAt')) return 'target_mismatch';
  if (!candidate.artifactVersion || monitor.modelVersion !== candidate.artifactVersion) return 'model_version_mismatch';
  if (context.asOf == null) return 'missing_decision_time';
  const now = time(context.asOf, 'asOf');
  if (time(candidate.asOf, 'candidate asOf') > now) return 'candidate_from_future';
  if (now >= time(base.targetAt, 'targetAt') || (candidate.validUntil != null && now >= time(candidate.validUntil, 'validUntil'))) return 'candidate_expired';
  const a = context.approval;
  if (a?.status !== 'approved' || a.modelVersion !== candidate.artifactVersion) return 'not_approved';
  if (a.expiresAt != null && now >= time(a.expiresAt, 'approval expiresAt')) return 'approval_expired';
  if (context.eligibility?.status !== 'eligible') return 'not_eligible';
  return null;
}
export function selectEffectiveForecast(base, candidate, monitor, mode='OFF', context = {}) {
  if (!['OFF','REPLAY','SHADOW','ASSIST','ACTIVE'].includes(mode)) fail('invalid mode');
  const reason = mode !== 'ACTIVE' ? 'mode_not_active' : candidateMismatch(base, candidate, monitor, context);
  if (reason) return {effective:base, route:'fallback', reason, shadow:candidate ?? null};
  return {effective:candidate, route:'corrected', reason:null, shadow:candidate};
}
