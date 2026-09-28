/**
 * النماذج الثمانية — كل نموذج مستقل.
 * server-only.
 *
 * اتفاق مشترك: confidence === 0 يعني "غير متاح، استبعدني من الدمج".
 */

import type { Direction, ForecastInput, ModelOutput, PriceBar } from './types';

// ═══════════════════════════════════════════════════════════════
// أدوات داخلية
// ═══════════════════════════════════════════════════════════════

const closes = (b: PriceBar[]) => b.map((x) => x.close);
const volumes = (b: PriceBar[]) => b.map((x) => x.volume);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const returns = (s: number[]) => {
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) r.push(s[i] / s[i - 1] - 1);
  return r;
};
const sma = (s: number[], w: number) => (s.length >= w ? mean(s.slice(-w)) : null);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const dirOf = (r: number, threshold = 0.0005): Direction =>
  r > threshold ? 'up' : r < -threshold ? 'down' : 'neutral';

/** المخرج القياسي لحالة "غير متاح". */
const unavailable = (modelId: string, why: string): ModelOutput => ({
  modelId,
  direction: 'neutral',
  expectedReturn: 0,
  confidence: 0,
  // قيم عددية لا منطقية: طبقة الدمج تفحص raw.untrained !== 1، و true تفشل هذا الفحص.
  raw: { unavailable: 1, [why]: 1 },
});

// ═══════════════════════════════════════════════════════════════
// N1 — Momentum متعدد الآفاق
// ═══════════════════════════════════════════════════════════════

export function n1Momentum(input: ForecastInput): ModelOutput {
  const cs = closes(input.prices);
  const last = cs[cs.length - 1] ?? 0;
  const r5 = cs.length > 5 ? last / cs[cs.length - 6] - 1 : 0;
  const r21 = cs.length > 21 ? last / cs[cs.length - 22] - 1 : 0;
  const r63 = cs.length > 63 ? last / cs[cs.length - 64] - 1 : 0;

  const blend = r5 * 0.5 + r21 * 0.3 + r63 * 0.2;

  const agreement =
    (Math.sign(r5) === Math.sign(r21) ? 1 : 0) +
    (Math.sign(r21) === Math.sign(r63) ? 1 : 0);
  const confidence = clamp(0.4 + agreement * 0.15 + Math.abs(blend) * 5, 0, 0.9);

  return {
    modelId: 'n1_momentum',
    direction: dirOf(blend),
    expectedReturn: blend,
    confidence,
    raw: { r5, r21, r63, blend },
  };
}

// ═══════════════════════════════════════════════════════════════
// N2 — Mean-Reversion
// ═══════════════════════════════════════════════════════════════

export function n2MeanRevert(input: ForecastInput): ModelOutput {
  const cs = closes(input.prices);
  const last = cs[cs.length - 1] ?? 0;
  const s21 = sma(cs, 21);
  const s63 = sma(cs, 63);
  if (!s21 || !s63 || last <= 0) return unavailable('n2_meanrevert', 'insufficientHistory');

  const dev21 = last / s21 - 1;
  const dev63 = last / s63 - 1;
  const z21 = dev21 / Math.max(0.005, std(returns(cs).slice(-21)));
  const z63 = dev63 / Math.max(0.005, std(returns(cs).slice(-63)));

  const signal = -(z21 * 0.6 + z63 * 0.4) * 0.005;
  const confidence = clamp(
    Math.abs(z21) + Math.abs(z63) > 3 ? 0.75 : 0.4 + Math.abs(z21) * 0.1,
    0,
    0.85,
  );

  return {
    modelId: 'n2_meanrevert',
    direction: dirOf(signal),
    expectedReturn: signal,
    confidence,
    raw: { z21, z63, signal },
  };
}

// ═══════════════════════════════════════════════════════════════
// N3 — GARCH(1,1) + ARIMA(1,0,0)
// ═══════════════════════════════════════════════════════════════

export function n3Garch(input: ForecastInput): ModelOutput {
  const cs = closes(input.prices);
  const rets = returns(cs);
  if (rets.length < 30) return unavailable('n3_garch', 'insufficientHistory');

  // معاملات GARCH عامة غير مُقدَّرة لكل سهم؛ تقريب لا تقدير MLE.
  const omega = 1e-6;
  const alpha = 0.09;
  const beta = 0.89;
  let variance = std(rets) ** 2;
  for (const r of rets.slice(-100)) {
    variance = omega + alpha * r * r + beta * variance;
  }
  const forecastVol = Math.sqrt(variance);

  const m = mean(rets.slice(-60));
  const centered = rets.slice(-60).map((r) => r - m);
  const lagCov = mean(centered.slice(1).map((r, i) => r * centered[i]));
  const varRet = std(centered) ** 2;
  const phi = varRet > 0 ? clamp(lagCov / varRet, -0.5, 0.5) : 0;

  const lastR = rets[rets.length - 1];
  const signal = m + phi * (lastR - m);

  // التذبذب المرتفع يخفض الثقة. عتبة يدوية مؤقتة حتى تُفعَّل المعايرة.
  const baseConfidence = clamp(0.3 + Math.abs(phi) * 0.5, 0, 0.7);
  const volPenalty = clamp(1 - forecastVol / 0.05, 0.3, 1);

  return {
    modelId: 'n3_garch',
    direction: dirOf(signal, 0.001),
    expectedReturn: signal,
    confidence: baseConfidence * volPenalty,
    raw: { forecastVol, phi, m, volPenalty },
  };
}

// ═══════════════════════════════════════════════════════════════
// N4 — Kalman Filter (سعر + سرعة)
// ═══════════════════════════════════════════════════════════════

export function n4Kalman(input: ForecastInput): ModelOutput {
  const cs = closes(input.prices);
  if (cs.length < 20) return unavailable('n4_kalman', 'insufficientHistory');

  let x0 = cs[0];
  let x1 = 0;
  let P00 = 1;
  let P01 = 0;
  let P11 = 1;

  const Q = 1e-4;
  const decay = 0.999;
  const R_eff = Math.max(std(returns(cs)) ** 2 * cs[cs.length - 1] ** 2, 1e-6);

  for (let i = 1; i < cs.length; i++) {
    // Predict: F = [[1, 1], [0, decay]]  →  P ← F·P·Fᵀ + Q
    const px0 = x0 + x1;
    const px1 = x1 * decay;

    const pP00 = P00 + 2 * P01 + P11 + Q;
    const pP01 = decay * (P01 + P11);
    const pP11 = decay * decay * P11 + Q;

    // Update: H = [1, 0]
    const S = pP00 + R_eff;
    const K0 = pP00 / S;
    const K1 = pP01 / S;

    const innovation = cs[i] - px0;
    x0 = px0 + K0 * innovation;
    x1 = px1 + K1 * innovation;

    // Joseph: P ← (I−KH)·P·(I−KH)ᵀ + K·R·Kᵀ، مع I−KH = [[1−K0, 0], [−K1, 1]].
    // بكسب كالمان الأمثل يساوي هذا (I−KH)·P جبرياً — تحقّقت عددياً: الفرق ≤ 3e−17.
    // نعتمده لأنه وحده يبقى موجب التحديد تحت خطأ التقريب، فلا يُنتج تبايناً سالباً.
    const oneMinusK0 = 1 - K0;
    P00 = Math.max(oneMinusK0 * oneMinusK0 * pP00 + K0 * K0 * R_eff, 1e-9);
    P01 = oneMinusK0 * (pP01 - K1 * pP00) + K0 * K1 * R_eff;
    P11 = Math.max(pP11 - 2 * K1 * pP01 + K1 * K1 * pP00 + K1 * K1 * R_eff, 1e-9);
  }

  const lastPrice = cs[cs.length - 1];
  const signal = lastPrice > 0 ? (x0 + x1) / lastPrice - 1 : 0;

  // عدم اليقين بمقياس العائد: انحراف الحالة نسبةً للسعر، مقارناً بتذبذب السهم.
  // النسبة الخام P00/(P00+R) تبقى ضئيلة دائماً لأن R بمقياس السعر المربّع،
  // فتُنتج ثقة ثابتة عند السقف بلا أي معلومة.
  const stateSigmaRel = lastPrice > 0 ? Math.sqrt(P00) / lastPrice : 1;
  const dailySigma = Math.max(std(returns(cs)), 1e-6);
  const uncertainty = clamp(stateSigmaRel / dailySigma, 0, 1);
  const confidence = clamp(0.85 * (1 - uncertainty), 0, 0.85);

  return {
    modelId: 'n4_kalman',
    direction: dirOf(signal, 0.0005),
    expectedReturn: signal,
    confidence,
    raw: { velocity: x1, stateVar: P00, stateSigmaRel, dailySigma },
  };
}

// ═══════════════════════════════════════════════════════════════
// N5 / N6 — نماذج خطية بمعاملات مُدرَّبة خارجياً
// ═══════════════════════════════════════════════════════════════

function assertFeatureOrder(
  modelId: string,
  actual: string[],
  expected: string[] | undefined,
): void {
  if (!expected) return;
  if (expected.length !== actual.length) {
    throw new Error(
      `${modelId}: عدد الميزات ${actual.length} لا يطابق المعاملات المدرَّبة ${expected.length}.`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) {
      throw new Error(
        `${modelId}: انزياح الميزة ${i} — متوقع "${expected[i]}"، وُجد "${actual[i]}".`,
      );
    }
  }
}

function linearModel(
  modelId: string,
  features: { names: string[]; values: number[] },
  coefficients: number[],
  intercept: number,
  confFloor: number,
  confScale: number,
  expectedNames?: string[],
): ModelOutput {
  if (features.values.length !== coefficients.length) {
    return unavailable(modelId, 'lengthMismatch');
  }
  // معاملات صفرية = لم يجرِ تدريب بعد. لا نُصدر حياداً بثقة موهومة.
  if (intercept === 0 && coefficients.every((c) => c === 0)) {
    return unavailable(modelId, 'untrained');
  }

  assertFeatureOrder(modelId, features.names, expectedNames);

  let y = intercept;
  for (let i = 0; i < features.values.length; i++) {
    y += features.values[i] * coefficients[i];
  }

  return {
    modelId,
    direction: dirOf(y),
    expectedReturn: y,
    confidence: clamp(confFloor + Math.tanh(Math.abs(y) * confScale) * 0.5, 0, confFloor + 0.55),
    raw: { y },
  };
}

export function n5Ridge(
  features: { names: string[]; values: number[] },
  coefficients: number[],
  intercept: number,
  expectedNames?: string[],
): ModelOutput {
  return linearModel('n5_ridge', features, coefficients, intercept, 0.3, 50, expectedNames);
}

export function n6Lasso(
  features: { names: string[]; values: number[] },
  coefficients: number[],
  intercept: number,
  expectedNames?: string[],
): ModelOutput {
  return linearModel('n6_lasso', features, coefficients, intercept, 0.25, 40, expectedNames);
}

// ═══════════════════════════════════════════════════════════════
// N7 — Peer-Relative
// ═══════════════════════════════════════════════════════════════

export function n7Peer(input: ForecastInput): ModelOutput {
  if (!input.context.peers?.length) return unavailable('n7_peer', 'noPeers');

  const cs = closes(input.prices);
  const last = cs[cs.length - 1];
  const myR = cs.length > 21 ? last / cs[cs.length - 22] - 1 : 0;

  const peerR: number[] = [];
  for (const p of input.context.peers) {
    const pc = closes(p);
    if (pc.length > 21) peerR.push(pc[pc.length - 1] / pc[pc.length - 22] - 1);
  }
  if (!peerR.length) return unavailable('n7_peer', 'noUsablePeerHistory');

  const peerMean = mean(peerR);
  const peerStd = std(peerR);
  const divergence = myR - peerMean;

  // تخلّف عن النظراء بفارق كبير → ترجيح تصحيح صعودي.
  const signal = peerStd > 0 ? (-divergence / Math.max(peerStd, 0.01)) * 0.003 : 0;
  const confidence = clamp(
    0.3 + Math.min(1, Math.abs(divergence) / Math.max(peerStd, 0.005)) * 0.4,
    0,
    0.75,
  );

  return {
    modelId: 'n7_peer',
    direction: dirOf(signal),
    expectedReturn: signal,
    confidence,
    raw: { divergence, peerMean, peerStd },
  };
}

// ═══════════════════════════════════════════════════════════════
// N8 — Volume-Price Divergence
// ═══════════════════════════════════════════════════════════════

export function n8VolumePrice(input: ForecastInput): ModelOutput {
  const cs = closes(input.prices);
  const vs = volumes(input.prices);
  if (cs.length < 20 || vs.length < 20) return unavailable('n8_volprice', 'insufficientHistory');

  const rets = returns(cs);
  const volRets = returns(vs);
  const r20 = rets.slice(-20);
  const v20 = volRets.slice(-20);

  const mr = mean(r20);
  const mv = mean(v20);
  let num = 0;
  let dr = 0;
  let dv = 0;
  for (let i = 0; i < r20.length; i++) {
    num += (r20[i] - mr) * (v20[i] - mv);
    dr += (r20[i] - mr) ** 2;
    dv += (v20[i] - mv) ** 2;
  }
  const corr = dr > 0 && dv > 0 ? num / Math.sqrt(dr * dv) : 0;

  const recentR = rets.slice(-5).reduce((a, b) => a + b, 0);

  // signal بمقياس العائد نفسه — لا يُقاس الاتجاه على مقياس ويُبلَّغ العائد على آخر.
  const signal = recentR * 0.5 + (corr - 0.3) * recentR * 0.5;
  const confidence = clamp(0.3 + Math.abs(corr) * 0.3 + Math.abs(recentR) * 3, 0, 0.8);

  return {
    modelId: 'n8_volprice',
    direction: dirOf(signal),
    expectedReturn: signal,
    confidence,
    raw: { corr, recentR },
  };
}

// ═══════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════

export type ModelCoefficients = {
  ridge: { intercept: number; coefficients: number[]; featureNames?: string[] };
  lasso: { intercept: number; coefficients: number[]; featureNames?: string[] };
};

/** فشل نموذج واحد لا يُسقط البقية؛ يُستبعد وحده بـconfidence = 0. */
function guard(modelId: string, run: () => ModelOutput): ModelOutput {
  try {
    return run();
  } catch {
    return unavailable(modelId, 'threw');
  }
}

export function runAllModels(
  input: ForecastInput,
  features: { names: string[]; values: number[] },
  coefficients: ModelCoefficients,
): ModelOutput[] {
  return [
    guard('n1_momentum', () => n1Momentum(input)),
    guard('n2_meanrevert', () => n2MeanRevert(input)),
    guard('n3_garch', () => n3Garch(input)),
    guard('n4_kalman', () => n4Kalman(input)),
    guard('n5_ridge', () =>
      n5Ridge(features, coefficients.ridge.coefficients, coefficients.ridge.intercept, coefficients.ridge.featureNames),
    ),
    guard('n6_lasso', () =>
      n6Lasso(features, coefficients.lasso.coefficients, coefficients.lasso.intercept, coefficients.lasso.featureNames),
    ),
    guard('n7_peer', () => n7Peer(input)),
    guard('n8_volprice', () => n8VolumePrice(input)),
  ];
}

/** النماذج المتاحة فقط. على طبقة الدمج استخدام هذه، لا القائمة الكاملة. */
export function availableModels(outputs: ModelOutput[]): ModelOutput[] {
  return outputs.filter((o) => o.confidence > 0);
}
