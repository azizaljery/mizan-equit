/**
 * تطبيق معايرة Isotonic في وقت الاستدلال.
 *
 * `training/calibrate-confidence.ts` مبني كاملاً (PAVA + reliability + Wilson)
 * لكنه غير مربوط بأي مسار تشغيل — الثقة الخام لكل نموذج تصل إلى ensemble
 * كما هي. المشكلة: كل نموذج يبني ثقته بمقياس مختلف تماماً (N1: 0-0.9
 * منسوبة إلى agreement + |blend|; N4: منسوبة إلى σ/dailySigma; N5:
 * tanh(|y|·50)…). مقارنة نموذج بثقة 0.7 بآخر بثقة 0.7 بلا معايرة يخلط
 * لغتين مختلفتين — رقمان متطابقان لا يعنيان الشيء نفسه.
 *
 * هذا الملف يضع الطبقة الرقيقة التي تحوّل ModelOutput.confidence من قيمة
 * موصوفة داخلياً إلى احتمال دقة تجريبي موحَّد قابل للمقارنة عرضياً.
 *
 * لا يُدرَّب أي شيء هنا — التدريب في calibrate-confidence.ts::fitCalibration
 * offline. هذا الملف يستقبل CalibrationCurve[] جاهزة ويطبّقها.
 */

import type { ModelOutput } from '../types';
import {
  applyCalibration,
  DEFAULT_MIN_SAMPLE,
  type CalibrationCurve,
} from '../training/calibrate-confidence';

export type CalibrationBundle = {
  /** خريطة modelId → منحنى معايرة. النماذج بلا منحنى تمر بثقتها الخام. */
  curves: Record<string, CalibrationCurve>;
  /** حد أدنى للعيّنة قبل الوثوق بمنحنى (افتراضي 100 من DEFAULT_MIN_SAMPLE). */
  minSample?: number;
};

/**
 * يطبّق المعايرة على مصفوفة ModelOutput ويعيد نسخة جديدة بثقة معدَّلة.
 * ما يبقى بلا تغيير: modelId, direction, expectedReturn, raw. اليقين الوحيد
 * الذي يتحرك هو confidence — بمعامل مأخوذ من الخط المتقطع على PAVA.
 *
 * نموذج بلا منحنى معايرة أو بعيّنة أصغر من الحد الأدنى يمرّ كما هو، لا
 * يُحوَّل قسراً إلى 0.5 كما يفعل applyCalibration وحده — لأن ذلك يحكم
 * على نموذج غير معاير بالحياد التام، وقد يكون الأصح إبقاؤه بثقته الخام
 * حتى يجمع سجل معايرة. القرار هنا: إذا لا منحنى → passthrough مع
 * تسجيل الحالة في raw.calibration_status.
 *
 * confidence === 0 (نموذج غير متاح) لا يمر بالمعايرة أبداً — يبقى صفراً
 * ليحترم عقد types.ts: "confidence === 0 يعني غير متاح، لا حياد معاير".
 */
export function applyCalibrationToOutputs(
  outputs: ModelOutput[],
  bundle: CalibrationBundle | undefined,
): ModelOutput[] {
  if (!bundle || Object.keys(bundle.curves).length === 0) {
    return outputs.map((o) => ({
      ...o,
      raw: { ...o.raw, calibration_status: 1 as const }, // 1 = no_bundle
    }));
  }
  const minSample = bundle.minSample ?? DEFAULT_MIN_SAMPLE;

  return outputs.map((o) => {
    // نحترم عقد "غير متاح"؛ لا نعاير صفراً.
    if (o.confidence === 0) {
      return { ...o, raw: { ...o.raw, calibration_status: 2 as const } }; // 2 = unavailable
    }

    const curve = bundle.curves[o.modelId];
    if (!curve || curve.points.length === 0) {
      return { ...o, raw: { ...o.raw, calibration_status: 3 as const } }; // 3 = no_curve
    }
    if (curve.sampleSize < minSample) {
      // العينة أصغر من العتبة: نمرر الخام مع علامة، لا نحوّل لـ 0.5.
      return {
        ...o,
        raw: { ...o.raw, calibration_status: 4 as const, calibration_sample: curve.sampleSize },
      };
    }

    const calibrated = applyCalibration(curve, o.confidence, minSample);
    return {
      ...o,
      confidence: calibrated,
      raw: {
        ...o.raw,
        calibration_status: 5 as const, // 5 = applied
        confidence_raw: o.confidence,
      },
    };
  });
}

/**
 * ملخّص تشخيصي لعملية المعايرة على دفعة outputs — كم نموذجاً عوير فعلاً،
 * كم مرّ بلا معايرة، ولماذا. مفيد للوحة المراقبة الصامتة.
 */
export function summarizeCalibration(outputs: ModelOutput[]): {
  applied: number;
  passthrough: number;
  unavailable: number;
  reasons: Record<string, number>;
} {
  const statusLabel: Record<number, string> = {
    1: 'no_bundle',
    2: 'unavailable',
    3: 'no_curve',
    4: 'small_sample',
    5: 'applied',
  };
  const reasons: Record<string, number> = {};
  let applied = 0;
  let passthrough = 0;
  let unavailable = 0;

  for (const o of outputs) {
    const status = (o.raw.calibration_status as number) ?? 0;
    const label = statusLabel[status] ?? 'unknown';
    reasons[label] = (reasons[label] ?? 0) + 1;
    if (status === 5) applied++;
    else if (status === 2) unavailable++;
    else passthrough++;
  }
  return { applied, passthrough, unavailable, reasons };
}
