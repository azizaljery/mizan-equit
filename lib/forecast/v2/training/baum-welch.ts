import type { HMMParams } from '../meta/hmm';
import { computeObservations } from '../meta/hmm';
import type { PriceBar } from '../types';

const N_STATES = 4;
const N_FEATURES = 2;

// ═══════════════════════════════════════════════════════════════
// استخراج الملاحظات — من meta/hmm.ts، لا نسخة محلية.
// ═══════════════════════════════════════════════════════════════

/** إعادة تصدير باسم مألوف لهذا الملف؛ الجسم الحقيقي في meta/hmm.ts وحده. */
export const extractObservations = computeObservations;

// ═══════════════════════════════════════════════════════════════
// أدوات رياضية
// ═══════════════════════════════════════════════════════════════

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  if (!Number.isFinite(m)) return -Infinity;
  let s = 0;
  for (const x of xs) s += Math.exp(x - m);
  return m + Math.log(s);
}

function logGaussian(x: number, mu: number, sigma: number): number {
  if (sigma < 1e-6) sigma = 1e-6;
  const d = x - mu;
  return -0.5 * Math.log(2 * Math.PI) - Math.log(sigma) - (d * d) / (2 * sigma * sigma);
}

function logEmission(obs: [number, number], state: number, params: HMMParams): number {
  return (
    logGaussian(obs[0], params.mean[state][0], params.std[state][0]) +
    logGaussian(obs[1], params.mean[state][1], params.std[state][1])
  );
}

// ═══════════════════════════════════════════════════════════════
// Forward-Backward Scaled (للتدريب)
// ═══════════════════════════════════════════════════════════════

type FBScaled = {
  alpha: number[][];
  beta: number[][];
  scale: number[];
  gamma: number[][];
  xi: number[][][];
  logLikelihood: number;
};

function forwardBackwardScaled(
  observations: Array<[number, number]>,
  params: HMMParams,
  computeXi: boolean,
): FBScaled {
  const T = observations.length;
  const N = N_STATES;

  const alpha: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
  const beta: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
  const scale: number[] = new Array(T).fill(0);

  for (let i = 0; i < N; i++) {
    alpha[0][i] = params.pi[i] * Math.exp(logEmission(observations[0], i, params));
  }
  scale[0] = alpha[0].reduce((a, b) => a + b, 0) || 1e-300;
  for (let i = 0; i < N; i++) alpha[0][i] /= scale[0];

  for (let t = 1; t < T; t++) {
    for (let j = 0; j < N; j++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += alpha[t - 1][i] * params.A[i][j];
      }
      alpha[t][j] = sum * Math.exp(logEmission(observations[t], j, params));
    }
    scale[t] = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
    for (let j = 0; j < N; j++) alpha[t][j] /= scale[t];
  }

  for (let i = 0; i < N; i++) beta[T - 1][i] = 1 / scale[T - 1];

  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < N; j++) {
        sum +=
          params.A[i][j] *
          Math.exp(logEmission(observations[t + 1], j, params)) *
          beta[t + 1][j];
      }
      beta[t][i] = sum / scale[t];
    }
  }

  const gamma: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      gamma[t][i] = alpha[t][i] * beta[t][i];
      sum += gamma[t][i];
    }
    if (sum > 0) for (let i = 0; i < N; i++) gamma[t][i] /= sum;
  }

  let xi: number[][][] = [];
  if (computeXi && T > 1) {
    xi = Array.from({ length: T - 1 }, () =>
      Array.from({ length: N }, () => new Array(N).fill(0)),
    );
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const v =
            alpha[t][i] *
            params.A[i][j] *
            Math.exp(logEmission(observations[t + 1], j, params)) *
            beta[t + 1][j];
          xi[t][i][j] = v;
          denom += v;
        }
      }
      if (denom > 0) {
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) xi[t][i][j] /= denom;
        }
      }
    }
  }

  const logLikelihood = scale.reduce((acc, s) => acc + Math.log(s), 0);

  return { alpha, beta, scale, gamma, xi, logLikelihood };
}

// ═══════════════════════════════════════════════════════════════
// M-Step
// ═══════════════════════════════════════════════════════════════

function mStep(
  observations: Array<[number, number]>,
  gamma: number[][],
  xi: number[][][],
  oldParams: HMMParams,
): HMMParams {
  const T = observations.length;
  const N = N_STATES;

  const pi = gamma[0].slice() as [number, number, number, number];

  const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    let denom = 0;
    for (let t = 0; t < T - 1; t++) {
      denom += gamma[t][i];
      for (let j = 0; j < N; j++) {
        A[i][j] += xi[t][i][j];
      }
    }
    if (denom > 0) {
      for (let j = 0; j < N; j++) A[i][j] /= denom;
    } else {
      for (let j = 0; j < N; j++) A[i][j] = oldParams.A[i][j];
    }
  }

  const mean: number[][] = Array.from({ length: N }, () => new Array(N_FEATURES).fill(0));
  const std: number[][] = Array.from({ length: N }, () => new Array(N_FEATURES).fill(0));

  for (let i = 0; i < N; i++) {
    let denom = 0;
    for (let t = 0; t < T; t++) denom += gamma[t][i];

    if (denom < 1e-9) {
      for (let k = 0; k < N_FEATURES; k++) {
        mean[i][k] = oldParams.mean[i][k];
        std[i][k] = oldParams.std[i][k];
      }
      continue;
    }

    for (let k = 0; k < N_FEATURES; k++) {
      let mu = 0;
      for (let t = 0; t < T; t++) mu += gamma[t][i] * observations[t][k];
      mu /= denom;
      mean[i][k] = mu;

      let v = 0;
      for (let t = 0; t < T; t++) {
        v += gamma[t][i] * (observations[t][k] - mu) ** 2;
      }
      v /= denom;
      std[i][k] = Math.max(1e-6, Math.sqrt(v));
    }
  }

  return {
    pi,
    A: A as HMMParams['A'],
    mean: mean as HMMParams['mean'],
    std: std as HMMParams['std'],
  };
}

// ═══════════════════════════════════════════════════════════════
// Baum-Welch Main
// ═══════════════════════════════════════════════════════════════

export type BaumWelchOptions = {
  maxIter?: number;
  tolerance?: number;
};

export function trainHMM(
  observations: Array<[number, number]>,
  initial: HMMParams,
  options: BaumWelchOptions = {},
): {
  params: HMMParams;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
} {
  const maxIter = options.maxIter ?? 100;
  const tol = options.tolerance ?? 1e-4;

  let params = initial;
  let prevLL = -Infinity;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const { gamma, xi, logLikelihood } = forwardBackwardScaled(observations, params, true);

    if (Number.isFinite(logLikelihood)) {
      const delta = logLikelihood - prevLL;
      if (iter > 0 && Math.abs(delta) < tol * Math.abs(prevLL || 1)) {
        converged = true;
        params = mStep(observations, gamma, xi, params);
        break;
      }
      prevLL = logLikelihood;
    }

    params = mStep(observations, gamma, xi, params);
  }

  const final = forwardBackwardScaled(observations, params, false);

  return {
    params,
    logLikelihood: final.logLikelihood,
    iterations,
    converged,
  };
}

// ═══════════════════════════════════════════════════════════════
// Corpus-level
// ═══════════════════════════════════════════════════════════════

export function trainHMMFromCorpus(
  corpusPrices: PriceBar[][],
  initial: HMMParams,
  options: BaumWelchOptions = {},
): {
  params: HMMParams;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
} {
  const allObs: Array<[number, number]> = [];
  for (const prices of corpusPrices) {
    const obs = extractObservations(prices);
    allObs.push(...obs);
  }

  if (allObs.length < 100) {
    return {
      params: initial,
      logLikelihood: -Infinity,
      iterations: 0,
      converged: false,
    };
  }

  return trainHMM(allObs, initial, options);
}
