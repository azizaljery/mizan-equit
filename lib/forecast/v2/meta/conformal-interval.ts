/**
 * فاصل تنبؤ معاير عبر Regime-Conditional Adaptive Split Conformal Prediction.
 *
 * الفجوة التي يسدّها هذا الملف: المحرك ينتج توقعاً نقطياً + ثقة عددية فقط.
 * لا يوجد أي منتج لفاصل [low, high] في كل شجرة lib/forecast/v2 — حقل
 * GatedSignal.range في types.ts معرَّف لكن بلا مُنتِج. هذا الملف يبنيه.
 *
 * الفكرة (Vovk's split conformal, بنسخة adaptive + regime-conditional):
 * 1) نطبّع كل خطأ تاريخي بمقياس محلي مشتق من الثقة: score = |خطأ| / (1-ثقة).
 *    هذا يجعل نفس مقدار الخطأ "أسوأ" إحصائياً عندما كانت الثقة عالية،
 *    فيتّسع الفاصل تلقائياً في الحالات الصعبة ويضيق في الحالات الواثقة —
 *    بلا نموذج ثانٍ منفصل يتنبأ بصعوبة التنبؤ.
 * 2) نفصل العتبات حسب النظام (Regime) المكتشَف عبر HMM: فاصل السوق الهادئ
 *    المتجه يجب ألا يتسع بحجم فاصل السوق المضطرب العشوائي.
 * 3) الربع/quantile المستخدم هو ⌈(n+1)(1-α)⌉ وليس النسبة المئوية الخام —
 *    هذا التصحيح تحديداً هو ما يمنح ضمان التغطية للعيّنة المحدودة
 *    (finite-sample coverage guarantee)؛ أخذ النسبة المئوية العادية بدلاً
 *    منه (خطأ شائع) يعطي تغطية أقل قليلاً من المطلوب دوماً.
 * 4) عند نقص عيّنة نظام معيّن، نتراجع صراحة إلى العتبة المجمَّعة عبر كل
 *    الأنظمة بدل فاصل غير مستقر مبني على عشرات نقاط.
 *
 * تحذير أمانة إحصائية: الضمان النظري لـ conformal prediction يفترض
 * exchangeability بين عيّنة المعايرة ونقطة الاستدلال. التكييف بالنظام يقارب
 * هذا الافتراض محلياً (خطأ عام 2020 غير مطابق لخطأ عام 2024 لكن كلاهما
 * "calm_trend" أقرب تبادلاً لبعضهما) — لا يحقّقه بشكل مطلق. هذا تقريب
 * عملي موثَّق، لا ادعاء بضمان مطلق.
 */

import type { Regime } from '../types';

const REGIME_KEYS: Regime[] = ['calm_trend', 'calm_chop', 'wild_trend', 'wild_chop'];

/** الحد الأدنى لمقياس التطبيع — يمنع الانفجار العددي عند ثقة قريبة من 1. */
const MIN_SCALE = 0.05;

/** سجل نتيجة فعلية واحدة، كما ينتجها استدعاء متأخر لـ runEnsemble بعد معرفة العائد الحقيقي. */
export type OutcomeRecord = {
  regime: Regime;
  expectedReturn: number;
  actualReturn: number;
  /** ثقة المجموعة confidence، أو confidence بعد المعايرة الـ isotonic إن توفرت — الأفضلية للمعايَرة. */
  confidence: number;
};

export type ConformalCurve = {
  byRegime: Partial<Record<Regime, number[]>>; // نقاط nonconformity مرتّبة تصاعدياً لكل نظام
  pooled: number[]; // نفس النقاط مجمَّعة عبر كل الأنظمة، مرتّبة
  fittedAt: string;
  sampleSize: number;
};

export type PredictionInterval = {
  low: number;
  high: number;
  /** مستوى التغطية المستهدف، أي 1-α. */
  coverage: number;
  regime: Regime;
  regimeSampleSize: number;
  /** true لو تعذّر بناء عتبة خاصة بالنظام فتراجعنا إلى العتبة المجمَّعة. */
  usedFallback: boolean;
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function nonconformityScore(actual: number, expected: number, confidence: number): number {
  const scale = Math.max(MIN_SCALE, 1 - clamp(confidence, 0, 0.999));
  return Math.abs(actual - expected) / scale;
}

/**
 * الربع المطابِق (conformal quantile) بترتيب ⌈(n+1)(1-α)⌉ — لا النسبة المئوية الخام.
 * يرجع null صراحة لو كانت العيّنة صغيرة جداً بحيث لا يمكن ضمان التغطية عند هذا α،
 * بدل إرجاع قيمة متفائلة زائفة.
 */
export function conformalQuantile(sortedScores: number[], alpha: number): number | null {
  const n = sortedScores.length;
  if (n === 0) return null;
  const rank = Math.ceil((n + 1) * (1 - alpha));
  if (rank > n) return null;
  return sortedScores[rank - 1];
}

/** يبني منحنى المعايرة من سجل نتائج تاريخي. records يجب أن تكون PIT-safe (نتائج معروفة فقط قبل نقطة الاستدلال). */
export function fitConformalCurve(records: OutcomeRecord[]): ConformalCurve {
  const byRegime: Partial<Record<Regime, number[]>> = {};
  const pooled: number[] = [];

  for (const r of records) {
    if (!Number.isFinite(r.actualReturn) || !Number.isFinite(r.expectedReturn)) continue;
    const score = nonconformityScore(r.actualReturn, r.expectedReturn, r.confidence);
    if (!Number.isFinite(score)) continue;
    pooled.push(score);
    (byRegime[r.regime] ??= []).push(score);
  }

  pooled.sort((a, b) => a - b);
  for (const k of REGIME_KEYS) byRegime[k]?.sort((a, b) => a - b);

  return { byRegime, pooled, fittedAt: new Date().toISOString(), sampleSize: records.length };
}

/**
 * يحسب فاصل تنبؤ معاير حول توقّع نقطي واحد.
 * يرجع null صراحة (لا فاصلاً وهمياً) عند نقص بيانات المعايرة كلياً.
 */
export function computePredictionInterval(
  expectedReturn: number,
  confidence: number,
  regime: Regime,
  curve: ConformalCurve,
  alpha = 0.1,
  minRegimeSamples = 30,
): PredictionInterval | null {
  const regimeScores = curve.byRegime[regime] ?? [];
  let usedFallback = false;
  let sampleSize = regimeScores.length;
  let q = sampleSize >= minRegimeSamples ? conformalQuantile(regimeScores, alpha) : null;

  if (q === null) {
    usedFallback = true;
    sampleSize = curve.pooled.length;
    q = conformalQuantile(curve.pooled, alpha);
  }
  if (q === null) return null;

  const scale = Math.max(MIN_SCALE, 1 - clamp(confidence, 0, 0.999));
  const halfWidth = q * scale;

  return {
    low: expectedReturn - halfWidth,
    high: expectedReturn + halfWidth,
    coverage: 1 - alpha,
    regime,
    regimeSampleSize: sampleSize,
    usedFallback,
  };
}

/**
 * تحقّق تجريبي من التغطية الفعلية على عيّنة محجوزة — نفس روح verify-kalman.py:
 * لا نثق بضمان نظري بلا قياس فعلي على بيانات لم تُستخدم في بناء المنحنى.
 * استخدم دوماً records مختلفة عن تلك التي بُني منها curve (تقسيم زمني، لا عشوائي).
 */
export function evaluateCoverage(
  holdout: OutcomeRecord[],
  curve: ConformalCurve,
  alpha = 0.1,
  minRegimeSamples = 30,
): { targetCoverage: number; empiricalCoverage: number; n: number; avgWidth: number } {
  let covered = 0;
  let widthSum = 0;
  let n = 0;

  for (const r of holdout) {
    const interval = computePredictionInterval(
      r.expectedReturn,
      r.confidence,
      r.regime,
      curve,
      alpha,
      minRegimeSamples,
    );
    if (!interval) continue;
    n++;
    widthSum += interval.high - interval.low;
    if (r.actualReturn >= interval.low && r.actualReturn <= interval.high) covered++;
  }

  return {
    targetCoverage: 1 - alpha,
    empiricalCoverage: n > 0 ? covered / n : 0,
    n,
    avgWidth: n > 0 ? widthSum / n : 0,
  };
}

export function describeInterval(interval: PredictionInterval | null): string {
  if (!interval) return 'range=unavailable (insufficient calibration data)';
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  return (
    `range=[${pct(interval.low)}, ${pct(interval.high)}] ` +
    `coverage=${(interval.coverage * 100).toFixed(0)}% ` +
    `regime=${interval.regime} n=${interval.regimeSampleSize}` +
    (interval.usedFallback ? ' (pooled fallback)' : '')
  );
}
