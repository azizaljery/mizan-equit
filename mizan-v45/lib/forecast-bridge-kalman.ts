/**
 * Mizan forecast bridge + scalar Kalman state (research-only).
 *
 * This module is deliberately isolated from the live forecast/decision path.
 * It preserves the original forecast and returns an abstention unless a
 * caller supplies a frozen, versioned bridge artifact and explicitly opts in.
 */
export const BRIDGE_KALMAN_VERSION = 'mizan-bridge-kalman-v0.1';
export const BRIDGE_KALMAN_ENABLED = false;

export type BridgeStatus = 'candidate' | 'abstained' | 'invalid';

export type ForecastPair = {
  horizon5Price: number;
  horizon21Price: number;
  issuedAt: string;
  target5At: string;
  target21At: string;
  modelVersion: string;
};

export type BridgeInputs = {
  symbol: string;
  market: 'sa' | 'us';
  asOf: string;
  observedThrough: string;
  remainingSessions: 16;
  earlyErrorLog: number;
  baselineRemainingLogReturn: number;
  currentPriceAtUpdate: number;
};

export type KalmanConfig = {
  transition: number;
  processVariance: number;
  observationVariance: number;
};

export type KalmanState = {
  mean: number;
  variance: number;
  observations: number;
  version: string;
};

export type BridgeArtifact = {
  version: string;
  trainedThrough: string;
  coefficients: {
    intercept: number;
    earlyError: number;
    kalmanBias: number;
    baselineRemaining: number;
  };
};

export type BridgePrediction = {
  status: BridgeStatus;
  version: string;
  correctionLogReturn: number | null;
  correctedPrice: number | null;
  stateMean: number | null;
  stateVariance: number | null;
  reason: string | null;
};

const finitePositive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function createKalmanState(
  mean = 0,
  variance = 1,
  version = BRIDGE_KALMAN_VERSION,
): KalmanState {
  if (!finite(mean) || !finite(variance) || variance < 0) {
    throw new Error('invalid-kalman-state');
  }
  return { mean, variance, observations: 0, version };
}

/**
 * Filter one newly matured, non-overlapping error observation.
 * This is the filtered state at the observation time; it never smooths future
 * observations backwards.
 */
export function updateKalman(
  previous: KalmanState,
  observation: number,
  config: KalmanConfig,
): KalmanState {
  if (!finite(observation)
    || !finite(config.transition)
    || !finite(config.processVariance)
    || !finite(config.observationVariance)
    || config.processVariance < 0
    || config.observationVariance <= 0) {
    throw new Error('invalid-kalman-observation');
  }
  const predictedMean = config.transition * previous.mean;
  const predictedVariance =
    config.transition ** 2 * previous.variance + config.processVariance;
  const gain = predictedVariance / (predictedVariance + config.observationVariance);
  return {
    mean: predictedMean + gain * (observation - predictedMean),
    variance: Math.max(0, (1 - gain) * predictedVariance),
    observations: previous.observations + 1,
    version: previous.version,
  };
}

export function buildBridgeInputs(args: {
  symbol: string;
  market: 'sa' | 'us';
  asOf: string;
  observedThrough: string;
  currentPriceAtUpdate: number;
  actualPriceAt5: number;
  original: ForecastPair;
}): BridgeInputs {
  const { original } = args;
  if (!args.symbol.trim() || !validIso(args.asOf) || !validIso(args.observedThrough)
    || !finitePositive(args.currentPriceAtUpdate)
    || !finitePositive(args.actualPriceAt5)
    || !finitePositive(original.horizon5Price)
    || !finitePositive(original.horizon21Price)
    || !validIso(original.issuedAt)
    || !validIso(original.target5At)
    || !validIso(original.target21At)
    || original.target5At > args.observedThrough
    || args.asOf > args.observedThrough) {
    throw new Error('invalid-bridge-inputs');
  }
  return {
    symbol: args.symbol,
    market: args.market,
    asOf: args.asOf,
    observedThrough: args.observedThrough,
    remainingSessions: 16,
    earlyErrorLog: Math.log(args.actualPriceAt5 / original.horizon5Price),
    baselineRemainingLogReturn: Math.log(original.horizon21Price / original.horizon5Price),
    currentPriceAtUpdate: args.currentPriceAtUpdate,
  };
}

export function predictCorrection(
  inputs: BridgeInputs,
  state: KalmanState,
  artifact: BridgeArtifact | null,
): BridgePrediction {
  if (!artifact) {
    return {
      status: 'abstained', version: BRIDGE_KALMAN_VERSION,
      correctionLogReturn: null, correctedPrice: null,
      stateMean: state.mean, stateVariance: state.variance,
      reason: 'لا توجد نسخة جسر مجمدة؛ يبقى التوقع الأصلي مرجعًا.',
    };
  }
  const c = artifact.coefficients;
  if (!artifact.version || !validIso(artifact.trainedThrough)
    || ![c.intercept, c.earlyError, c.kalmanBias, c.baselineRemaining].every(finite)) {
    return {
      status: 'invalid', version: BRIDGE_KALMAN_VERSION,
      correctionLogReturn: null, correctedPrice: null,
      stateMean: null, stateVariance: null, reason: 'نسخة الجسر أو معاملاته غير صالحة.',
    };
  }
  const correction =
    c.intercept
    + c.earlyError * inputs.earlyErrorLog
    + c.kalmanBias * state.mean
    + c.baselineRemaining * inputs.baselineRemainingLogReturn;
  if (!finite(correction)) {
    return {
      status: 'invalid', version: artifact.version,
      correctionLogReturn: null, correctedPrice: null,
      stateMean: state.mean, stateVariance: state.variance,
      reason: 'تصحيح غير منتهٍ.',
    };
  }
  return {
    status: 'candidate',
    version: artifact.version,
    correctionLogReturn: correction,
    correctedPrice: Number((inputs.currentPriceAtUpdate * Math.exp(
      inputs.baselineRemainingLogReturn + correction,
    )).toFixed(8)),
    stateMean: state.mean,
    stateVariance: state.variance,
    reason: 'مرشح بحثي؛ لا يمثل احتمالًا أو ضمانًا مستقبليًا.',
  };
}

/** Never mutates the original forecast; caller decides whether to display candidate. */
export function selectEffectiveForecast(
  originalPrice: number,
  prediction: BridgePrediction,
  enabled = BRIDGE_KALMAN_ENABLED,
): { price: number; path: 'original' | 'bridge-shadow' } {
  if (!finitePositive(originalPrice)) throw new Error('invalid-original-forecast');
  if (enabled && prediction.status === 'candidate' && finitePositive(prediction.correctedPrice)) {
    return { price: prediction.correctedPrice, path: 'bridge-shadow' };
  }
  return { price: originalPrice, path: 'original' };
}
