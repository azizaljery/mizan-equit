/**
 * معايرة الثقة — Isotonic Regression (PAVA).
 *
 * تُبنى المنحنيات خارج وقت التشغيل من توقعات سابقة ونتائجها الفعلية،
 * ثم تُطبَّق وقت الاستنتاج. بدونها لا معنى لمقارنة confidence بين نموذجين
 * لأن كل نموذج يبني ثقته بصيغة ومدى مختلفين.
 */

export type ReliabilityBin = {
  binStart: number;
  binEnd: number;
  avgConfidence: number;
  empiricalAccuracy: number;
  count: number;
};

export type CalibrationCurve = {
  modelId: string;
  points: Array<{ x: number; y: number }>;
  sampleSize: number;
  /** متى بُني هذا المنحنى — لمعرفة عمر المعايرة دون تخمين. */
  fittedAt: string;
};

export type CalibrationRecord = {
  confidence: number;
  correct: boolean;
};

/** الحد الأدنى للعينة قبل الوثوق بمنحنى. دونه نرجع لحياد صريح. */
export const DEFAULT_MIN_SAMPLE = 100;

/**
 * Pool Adjacent Violators — يفرض رتابة غير تناقصية على الدقة مقابل الثقة.
 */
export function fitCalibration(
  records: CalibrationRecord[],
  modelId: string,
): CalibrationCurve {
  const usable = records.filter(
    (r) => Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1,
  );
  if (usable.length === 0) {
    return { modelId, points: [], sampleSize: 0, fittedAt: new Date().toISOString() };
  }

  const sorted = [...usable].sort((a, b) => a.confidence - b.confidence);
  const n = sorted.length;

  // مكدّس كتل: كل كتلة (مجموع الأوزان، القيمة، أعلى ثقة داخلها).
  // المكدّس يتجنّب الخانات الميتة التي تنتج قسمة على صفر.
  const blocks: Array<{ weight: number; value: number; maxX: number }> = [];

  for (const record of sorted) {
    blocks.push({ weight: 1, value: record.correct ? 1 : 0, maxX: record.confidence });
    // ادمج ما دامت الرتابة منتهَكة مع الكتلة السابقة.
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      const weight = left.weight + right.weight;
      blocks.push({
        weight,
        value: (left.value * left.weight + right.value * right.weight) / weight,
        maxX: right.maxX,
      });
    }
  }

  const points = blocks.map((b) => ({ x: b.maxX, y: b.value }));

  return { modelId, points, sampleSize: n, fittedAt: new Date().toISOString() };
}

/**
 * يطبّق المنحنى على ثقة خام.
 * عينة أصغر من الحد الأدنى ترجع 0.5 — حياد صريح بدل ثقة مبنية على ضجيج.
 */
export function applyCalibration(
  curve: CalibrationCurve | undefined,
  raw: number,
  minSample = DEFAULT_MIN_SAMPLE,
): number {
  if (!curve || curve.points.length === 0) return 0.5;
  if (curve.sampleSize < minSample) return 0.5;

  const p = curve.points;
  if (raw <= p[0].x) return p[0].y;
  if (raw >= p[p.length - 1].x) return p[p.length - 1].y;

  for (let i = 0; i < p.length - 1; i++) {
    if (raw >= p[i].x && raw <= p[i + 1].x) {
      const span = p[i + 1].x - p[i].x;
      if (span === 0) return p[i + 1].y;
      const t = (raw - p[i].x) / span;
      return p[i].y + t * (p[i + 1].y - p[i].y);
    }
  }
  return raw;
}

/**
 * مخطط الموثوقية — للتدقيق البشري قبل اعتماد أي نموذج في المجموعة.
 * الدقة الفعلية داخل كل شريحة يجب أن تطابق متوسط الثقة المعلنة.
 */
export function reliabilityDiagram(
  records: CalibrationRecord[],
  bins = 10,
): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const start = b / bins;
    const end = (b + 1) / bins;
    const inBin = records.filter(
      (r) => r.confidence >= start && (b === bins - 1 ? r.confidence <= end : r.confidence < end),
    );
    out.push({
      binStart: start,
      binEnd: end,
      avgConfidence: inBin.length ? inBin.reduce((s, r) => s + r.confidence, 0) / inBin.length : 0,
      empiricalAccuracy: inBin.length ? inBin.filter((r) => r.correct).length / inBin.length : 0,
      count: inBin.length,
    });
  }
  return out;
}

/** الحد الأدنى لويلسون — يمنع الادعاء بدقة مبنية على عينة صغيرة. */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / denom);
}
