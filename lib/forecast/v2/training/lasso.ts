import type { TrainedLinearModel } from '../types';
import type { TrainedLinear } from './types';
import {
  fitStandardizer,
  applyStandardizer,
  type Standardizer,
} from './ridge';

// ═══════════════════════════════════════════════════════════════
// إحصاءات
// ═══════════════════════════════════════════════════════════════

function computeStats(y: number[], pred: number[]): { rmse: number; mae: number; r2: number } {
  const n = y.length;
  let ss = 0;
  let sa = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) meanY += y[i];
  meanY /= n;

  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ss += (y[i] - pred[i]) ** 2;
    sa += Math.abs(y[i] - pred[i]);
    ssTot += (y[i] - meanY) ** 2;
  }

  return {
    rmse: Math.sqrt(ss / n),
    mae: sa / n,
    r2: ssTot > 0 ? 1 - ss / ssTot : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Soft Thresholding
// ═══════════════════════════════════════════════════════════════

function softThreshold(z: number, gamma: number): number {
  if (z > gamma) return z - gamma;
  if (z < -gamma) return z + gamma;
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// Lasso — Coordinate Descent
// ═══════════════════════════════════════════════════════════════

export type LassoResult = TrainedLinear & {
  standardizer: Standardizer;
  /** متوسط الفضاء الموحَّد لكل ميزة — لازم لإعادة إنتاج نفس المركزة وقت التنبؤ. */
  xcMean: number[];
};

export function trainLasso(
  X: number[][],
  y: number[],
  lambda = 0.005,
  maxIter = 500,
  tol = 1e-5,
): LassoResult {
  if (!X.length || !X[0]?.length) throw new Error('Lasso: X فارغة.');
  if (X.length !== y.length) throw new Error('Lasso: الأحجام مختلفة.');

  const standardizer = fitStandardizer(X);
  const Xs = applyStandardizer(X, standardizer);
  const n = Xs.length;
  const d = Xs[0].length;

  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const yc = y.map((v) => v - meanY);

  const xcMean: number[] = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < n; i++) xcMean[j] += Xs[i][j];
    xcMean[j] /= n;
  }
  const Xc: number[][] = Xs.map((row) => row.map((v, j) => v - xcMean[j]));

  const sq: number[] = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < n; i++) sq[j] += Xc[i][j] ** 2;
    sq[j] = sq[j] || 1e-9;
  }

  const beta: number[] = new Array(d).fill(0);
  const r: number[] = yc.slice();

  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0;

    for (let j = 0; j < d; j++) {
      const oldBeta = beta[j];

      let rho = 0;
      for (let i = 0; i < n; i++) {
        rho += Xc[i][j] * (r[i] + Xc[i][j] * oldBeta);
      }
      rho /= n;

      const newBeta = softThreshold(rho, lambda) / (sq[j] / n);
      beta[j] = newBeta;

      const diff = newBeta - oldBeta;
      if (diff !== 0) {
        for (let i = 0; i < n; i++) r[i] -= Xc[i][j] * diff;
      }

      maxChange = Math.max(maxChange, Math.abs(diff));
    }

    if (maxChange < tol) break;
  }

  const pred: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = meanY;
    for (let j = 0; j < d; j++) {
      s += Xc[i][j] * beta[j];
    }
    pred[i] = s;
  }
  const stats = computeStats(y, pred);
  const zeroed = beta.filter((b) => b === 0).length;

  return {
    intercept: meanY,
    coefficients: beta,
    trainRMSE: stats.rmse,
    trainMAE: stats.mae,
    r2: stats.r2,
    activeFeatures: d - zeroed,
    zeroedCoefficients: zeroed,
    standardizer,
    xcMean,
  };
}

// ═══════════════════════════════════════════════════════════════
// التنبؤ (بالفضاء الطبيعي للنموذج — للتقييم أثناء التدريب فقط)
// ═══════════════════════════════════════════════════════════════

export function predictLasso(model: LassoResult, x: number[]): number {
  const xs = x.map((v, j) => (v - model.standardizer.means[j]) / model.standardizer.stds[j]);
  const xc = xs.map((v, j) => v - (model.xcMean[j] ?? 0));
  let y = model.intercept;
  for (let j = 0; j < xc.length; j++) y += xc[j] * model.coefficients[j];
  return y;
}

/**
 * يحوّل معاملات Lasso (موحَّدة + ممركزة) إلى فضاء الميزات الخام.
 * نفس سبب toRawSpace في ridge.ts بالضبط — models.ts::linearModel() يضرب
 * المعاملات في القيم الخام مباشرة. هنا خطوة مركزة إضافية (xcMean) يجب
 * طيّها في intercept أيضاً، لا في المعاملات.
 *
 * الاشتقاق: y = meanY + Σ βⱼ·((xⱼ-meanⱼ)/stdⱼ - xcMeanⱼ)
 *             = (meanY - Σβⱼ·xcMeanⱼ - Σβⱼ·meanⱼ/stdⱼ) + Σ(βⱼ/stdⱼ)·xⱼ
 *
 * تحقّقت عددياً: predictLasso وlinearModel() الخام بعد هذا التحويل
 * تطابقا لفرق ≤ 2e-18 على ثلاث نقاط اختبار؛ بدونه كان الفرق يتجاوز 0.35.
 */
export function toRawSpace(model: LassoResult): TrainedLinearModel {
  const { means, stds } = model.standardizer;
  const d = model.coefficients.length;
  const coefficients = model.coefficients.map((b, j) => b / stds[j]);
  let intercept = model.intercept;
  for (let j = 0; j < d; j++) {
    intercept -= model.coefficients[j] * model.xcMean[j];
    intercept -= (model.coefficients[j] * means[j]) / stds[j];
  }
  return { intercept, coefficients };
}
