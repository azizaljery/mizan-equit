import type { ModelOutput } from '../types';

export type ModelState = {
  modelId: string;
  weight: number;
  errorVar: number;
  mae: number;
  updates: number;
};

export type KalmanParams = {
  Q: number;
  R_base: number;
  lr: number;
  weightMin: number;
  weightMax: number;
};

export const DEFAULT_KALMAN_PARAMS: KalmanParams = {
  Q: 1e-4,
  R_base: 1e-3,
  lr: 0.15,
  weightMin: 0.02,
  weightMax: 0.35,
};

export const DEFAULT_MODEL_IDS = [
  'n1_momentum',
  'n2_meanrevert',
  'n3_garch',
  'n4_kalman',
  'n5_ridge',
  'n6_lasso',
  'n7_peer',
  'n8_volprice',
] as const;

export function initialState(modelIds = [...DEFAULT_MODEL_IDS]): ModelState[] {
  const w = 1 / modelIds.length;
  return modelIds.map((id) => ({
    modelId: id,
    weight: w,
    errorVar: 1e-3,
    mae: 0,
    updates: 0,
  }));
}

export function updateWeights(
  states: ModelState[],
  outputs: ModelOutput[],
  actualReturn: number,
  params: KalmanParams = DEFAULT_KALMAN_PARAMS,
): ModelState[] {
  const next: ModelState[] = states.map((s) => {
    const out = outputs.find((o) => o.modelId === s.modelId);
    if (!out) return { ...s };
    const err = out.expectedReturn - actualReturn;
    const absErr = Math.abs(err);
    const errorVar = (1 - params.lr) * s.errorVar + params.lr * err * err + params.Q;
    const newUpdates = s.updates + 1;
    const mae = (s.mae * s.updates + absErr) / newUpdates;
    const K = errorVar / (errorVar + params.R_base);
    const scale = Math.max(0.005, mae + 1e-4);
    const quality = 1 / (1 + Math.exp(absErr / scale - 1));
    const weight = s.weight + K * (quality - s.weight);
    const clamped = Math.min(params.weightMax, Math.max(params.weightMin, weight));
    return {
      modelId: s.modelId,
      weight: clamped,
      errorVar,
      mae,
      updates: newUpdates,
    };
  });
  const sum = next.reduce((acc, s) => acc + s.weight, 0) || 1;
  return next.map((s) => ({ ...s, weight: s.weight / sum }));
}

export function weightsMap(states: ModelState[]): Record<string, number> {
  return Object.fromEntries(states.map((s) => [s.modelId, s.weight]));
}

export function topWeights(
  states: ModelState[],
  n = 3,
): Array<{ modelId: string; weight: number }> {
  return [...states]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map((s) => ({ modelId: s.modelId, weight: s.weight }));
}

export function describeState(s: ModelState): string {
  return `${s.modelId}: w=${s.weight.toFixed(3)} mae=${s.mae.toFixed(4)} n=${s.updates}`;
}
