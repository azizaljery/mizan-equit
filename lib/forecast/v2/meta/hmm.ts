import type { PriceBar, Regime } from '../types';

export type HMMParams = {
  pi: [number, number, number, number];
  A: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ];
  mean: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  std: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
};

export type HMMResult = {
  regime: Regime;
  posterior: [number, number, number, number];
  viterbiState: number;
  logLikelihood: number;
};

export const DEFAULT_HMM_PARAMS: HMMParams = {
  pi: [0.25, 0.25, 0.25, 0.25],
  A: [
    [0.92, 0.05, 0.02, 0.01],
    [0.06, 0.89, 0.01, 0.04],
    [0.03, 0.01, 0.9, 0.06],
    [0.01, 0.04, 0.07, 0.88],
  ],
  mean: [
    [0.012, 0.008],
    [0.0, 0.008],
    [0.018, 0.028],
    [0.0, 0.028],
  ],
  std: [
    [0.015, 0.002],
    [0.015, 0.002],
    [0.045, 0.008],
    [0.045, 0.008],
  ],
};

function logGaussian(x: number, mu: number, sigmaIn: number): number {
  const sigma = sigmaIn <= 0 ? 1e-6 : sigmaIn;
  const d = x - mu;
  return -0.5 * Math.log(2 * Math.PI) - Math.log(sigma) - (d * d) / (2 * sigma * sigma);
}

function logEmission(obs: [number, number], state: number, params: HMMParams): number {
  return (
    logGaussian(obs[0], params.mean[state][0], params.std[state][0]) +
    logGaussian(obs[1], params.mean[state][1], params.std[state][1])
  );
}

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  if (!Number.isFinite(m)) return -Infinity;
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}

export function forwardBackward(
  observations: Array<[number, number]>,
  params: HMMParams,
): { posterior: [number, number, number, number]; logLikelihood: number } {
  const T = observations.length;
  const N = 4;
  const alpha: number[][] = Array.from({ length: T }, () => new Array(N).fill(-Infinity));
  const beta: number[][] = Array.from({ length: T }, () => new Array(N).fill(-Infinity));

  for (let i = 0; i < N; i++) {
    alpha[0][i] = Math.log(params.pi[i] || 1e-12) + logEmission(observations[0], i, params);
  }
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      const terms: number[] = [];
      for (let i = 0; i < N; i++) {
        terms.push(alpha[t - 1][i] + Math.log(params.A[i][j] || 1e-12));
      }
      alpha[t][j] = logSumExp(terms) + logEmission(observations[t], j, params);
    }
  }
  for (let i = 0; i < N; i++) beta[T - 1][i] = 0;
  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < N; i++) {
      const terms: number[] = [];
      for (let j = 0; j < N; j++) {
        terms.push(
          Math.log(params.A[i][j] || 1e-12) +
            logEmission(observations[t + 1], j, params) +
            beta[t + 1][j],
        );
      }
      beta[t][i] = logSumExp(terms);
    }
  }
  const logLikelihood = logSumExp(alpha[T - 1]);
  const logPost: number[] = [];
  for (let i = 0; i < N; i++) {
    logPost.push(alpha[T - 1][i] + beta[T - 1][i] - logLikelihood);
  }
  const post = logPost.map((x) => Math.exp(x));
  const sum = post.reduce((a, b) => a + b, 0);
  const normalized = post.map((x) => x / (sum || 1)) as [number, number, number, number];
  return { posterior: normalized, logLikelihood };
}

export function viterbi(observations: Array<[number, number]>, params: HMMParams): number[] {
  const T = observations.length;
  const N = 4;
  const delta: number[][] = Array.from({ length: T }, () => new Array(N).fill(-Infinity));
  const psi: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    delta[0][i] = Math.log(params.pi[i] || 1e-12) + logEmission(observations[0], i, params);
  }
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      let best = -Infinity;
      let bestI = 0;
      for (let i = 0; i < N; i++) {
        const v = delta[t - 1][i] + Math.log(params.A[i][j] || 1e-12);
        if (v > best) {
          best = v;
          bestI = i;
        }
      }
      delta[t][j] = best + logEmission(observations[t], j, params);
      psi[t][j] = bestI;
    }
  }
  let bestLast = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < N; i++) {
    if (delta[T - 1][i] > bestVal) {
      bestVal = delta[T - 1][i];
      bestLast = i;
    }
  }
  const path = new Array(T).fill(0);
  path[T - 1] = bestLast;
  for (let t = T - 2; t >= 0; t--) {
    path[t] = psi[t + 1][path[t + 1]];
  }
  return path;
}

/**
 * مُصدَّرة عمداً: training/baum-welch.ts يحتاج نفس دالة الملاحظات بالضبط.
 * كانت مكرَّرة يدوياً هناك — نفس نمط "الكود المزدوج" الذي كشفناه في Kalman
 * (verify-kalman.mjs مقابل models.ts). تدريب واستدلال بصيغتي ملاحظات
 * مختلفتين يُنتج HMM متوافقاً مع بيانات لا يراها أبداً وقت التشغيل.
 */
export function computeObservations(prices: PriceBar[]): Array<[number, number]> {
  const obs: Array<[number, number]> = [];
  for (let t = 20; t < prices.length; t++) {
    const r5 = prices[t - 5] && prices[t - 5].close ? prices[t].close / prices[t - 5].close - 1 : 0;
    const rets: number[] = [];
    for (let i = t - 19; i <= t; i++) {
      if (prices[i - 1] && prices[i - 1].close) {
        rets.push(prices[i].close / prices[i - 1].close - 1);
      }
    }
    const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const v =
      rets.length > 1
        ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1))
        : 0;
    obs.push([r5, v]);
  }
  return obs;
}

const STATE_TO_REGIME: Regime[] = ['calm_trend', 'calm_chop', 'wild_trend', 'wild_chop'];

export function detectRegime(
  prices: PriceBar[],
  params: HMMParams = DEFAULT_HMM_PARAMS,
): HMMResult | null {
  if (prices.length < 30) return null;
  const observations = computeObservations(prices);
  if (observations.length < 5) return null;
  const { posterior, logLikelihood } = forwardBackward(observations, params);
  const path = viterbi(observations, params);
  const viterbiState = path[path.length - 1];
  let bestState = 0;
  let bestProb = posterior[0];
  for (let i = 1; i < 4; i++) {
    if (posterior[i] > bestProb) {
      bestProb = posterior[i];
      bestState = i;
    }
  }
  return {
    regime: STATE_TO_REGIME[bestState],
    posterior,
    viterbiState,
    logLikelihood,
  };
}

export function regimeLabel(regime: Regime): string {
  switch (regime) {
    case 'calm_trend':
      return 'هدوء اتجاهي';
    case 'calm_chop':
      return 'هدوء عشوائي';
    case 'wild_trend':
      return 'اضطراب اتجاهي';
    case 'wild_chop':
      return 'اضطراب عشوائي';
  }
}

export function regimeStateIndex(regime: Regime): number {
  return STATE_TO_REGIME.indexOf(regime);
}
