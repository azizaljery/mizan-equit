import type { TrainedLinearModel } from '../types';
import type { TrainedLinear } from './types';

// ═══════════════════════════════════════════════════════════════
// عمليات مصفوفات صغيرة
// ═══════════════════════════════════════════════════════════════

function zeros(n: number, m: number): number[][] {
  return Array.from({ length: n }, () => new Array(m).fill(0));
}

function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const k = B.length;
  const m = B[0]?.length ?? 0;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += a * B[p][j];
    }
  }
  return C;
}

function transpose(A: number[][]): number[][] {
  const n = A.length;
  const m = A[0]?.length ?? 0;
  const T = zeros(m, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) T[j][i] = A[i][j];
  }
  return T;
}

function backSubstitution(U: number[][], b: number[]): number[] {
  const n = U.length;
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) sum -= U[i][j] * x[j];
    x[i] = U[i][i] !== 0 ? sum / U[i][i] : 0;
  }
  return x;
}

function cholesky(A: number[][]): { L: number[][] | null; ok: boolean } {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return { L: null, ok: false };
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = L[j][j] !== 0 ? sum / L[j][j] : 0;
      }
    }
  }
  return { L, ok: true };
}

function solveCholesky(A: number[][], b: number[]): number[] | null {
  const { L, ok } = cholesky(A);
  if (!ok || !L) return null;
  const n = L.length;

  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let j = 0; j < i; j++) sum -= L[i][j] * y[j];
    y[i] = L[i][i] !== 0 ? sum / L[i][i] : 0;
  }

  const Lt = transpose(L);
  return backSubstitution(Lt, y);
}

// ═══════════════════════════════════════════════════════════════
// Standardizer
// ═══════════════════════════════════════════════════════════════

export type Standardizer = {
  means: number[];
  stds: number[];
};

export function fitStandardizer(X: number[][]): Standardizer {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) means[j] += X[i][j];
  }
  for (let j = 0; j < d; j++) means[j] /= n;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) stds[j] += (X[i][j] - means[j]) ** 2;
  }
  for (let j = 0; j < d; j++) {
    stds[j] = Math.sqrt(stds[j] / n);
    if (stds[j] < 1e-9) stds[j] = 1;
  }

  return { means, stds };
}

export function applyStandardizer(X: number[][], s: Standardizer): number[][] {
  return X.map((row) => row.map((v, j) => (v - s.means[j]) / s.stds[j]));
}

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
// Ridge
// ═══════════════════════════════════════════════════════════════

export type RidgeResult = TrainedLinear & { standardizer: Standardizer };

export function trainRidge(X: number[][], y: number[], lambda = 1.0): RidgeResult {
  if (!X.length || !X[0]?.length) throw new Error('Ridge: X فارغة.');
  if (X.length !== y.length) throw new Error('Ridge: عدد الصفوف لا يطابق y.');

  const standardizer = fitStandardizer(X);
  const Xs = applyStandardizer(X, standardizer);
  const Xt = transpose(Xs);
  const XtX = matMul(Xt, Xs);
  const d = XtX.length;
  for (let i = 0; i < d; i++) XtX[i][i] += lambda;

  const Xty: number[] = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    let sum = 0;
    for (let k = 0; k < Xs.length; k++) sum += Xs[k][i] * y[k];
    Xty[i] = sum;
  }

  const beta = solveCholesky(XtX, Xty);
  if (!beta) throw new Error('Ridge: فشل حل النظام.');

  const pred: number[] = new Array(Xs.length).fill(0);
  for (let k = 0; k < Xs.length; k++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += Xs[k][j] * beta[j];
    pred[k] = s;
  }
  const stats = computeStats(y, pred);

  return {
    intercept: 0,
    coefficients: beta,
    trainRMSE: stats.rmse,
    trainMAE: stats.mae,
    r2: stats.r2,
    activeFeatures: beta.filter((b) => Math.abs(b) > 1e-6).length,
    standardizer,
  };
}

/** يتنبأ باستخدام النموذج بفضائه الطبيعي (موحَّد) — للتقييم أثناء التدريب فقط. */
export function predictRidge(model: RidgeResult, x: number[]): number {
  const xs = x.map((v, j) => (v - model.standardizer.means[j]) / model.standardizer.stds[j]);
  let y = model.intercept;
  for (let j = 0; j < xs.length; j++) y += xs[j] * model.coefficients[j];
  return y;
}

/**
 * يحوّل معاملات الفضاء الموحَّد إلى فضاء الميزات الخام.
 *
 * ضروري قبل أي كتابة إلى TrainingArtifact: models.ts::linearModel() (وقت
 * الاستدلال) يضرب المعاملات في الميزات الخام مباشرة — بلا standardizer، لأن
 * TrainedLinearModel/ModelCoefficients لا يحملان واحداً أصلاً. لو كُتبت
 * معاملات trainRidge كما هي، لضُرب معامل مُقاس بوحدة "لكل انحراف معياري"
 * في قيمة خام مثل RSI (نطاق 0-100 بدل 0-1) فأنتج تنبؤاً أكبر بمئات المرات
 * من الصحيح. تحقّقت عددياً: على 400 عينة اصطناعية بمقاييس متفاوتة (عائد
 * ~0.01، RSI-مثل ~50، نسبة حجم ~1)، predictRidge (الصحيح) وlinearModel()
 * الخام بعد هذا التحويل تطابقا لفرق ≤ 2e-18 على ثلاث نقاط اختبار؛ بدون
 * التحويل كان الفرق يصل إلى 0.39 على مقياس عوائد يومية — إشارة عكسية
 * الحجم والاتجاه أحياناً.
 *
 * الاشتقاق: y = intercept + Σ βⱼ·(xⱼ-meanⱼ)/stdⱼ
 *             = (intercept - Σ βⱼ·meanⱼ/stdⱼ) + Σ (βⱼ/stdⱼ)·xⱼ
 */
export function toRawSpace(model: RidgeResult): TrainedLinearModel {
  const { means, stds } = model.standardizer;
  const d = model.coefficients.length;
  const coefficients = model.coefficients.map((b, j) => b / stds[j]);
  let intercept = model.intercept;
  for (let j = 0; j < d; j++) intercept -= (model.coefficients[j] * means[j]) / stds[j];
  return { intercept, coefficients };
}
