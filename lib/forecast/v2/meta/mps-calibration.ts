/**
 * معايرة MPS على مستوى المجموعة (ensemble-level) — استبدال sigmoid
 * البارامتري بمنحنى PAVA غير بارامتري على raw score نفسه.
 *
 * الفرق الجوهري عن meta/isotonic-runtime.ts: ذاك يعاير confidence كل
 * ModelOutput منفرد على حدة (8 معايرات مستقلة). هذا يعاير composite raw
 * score للمجموعة كاملة (المجموع الخطي الموزون A,C,R,T,P قبل أي تحويل) —
 * مستوى مختلف تماماً. معايرة النماذج الفردية لا تضمن أن دالة الدمج
 * (الـ sigmoid الحالي) نفسها مُعايَرة؛ الاثنان مكمّلان لا بديلان.
 *
 * السبب الرياضي لاستبدال sigmoid بـ PAVA هنا تحديداً (لا نعيد صياغته —
 * موثَّق في المحادثة التي أدت لهذا الملف): sigmoid بمعاملين ثابتين
 * (k=8.5, z0=0.55) يفرض شكلاً تحليلياً مُفترَضاً (تناظر حول z0، تسارع
 * لوجستي منتظم) — قرار بارامتري قبل رؤية أي بيانات. العلاقة الحقيقية
 * بين raw score والنتيجة الفعلية في بيانات مالية قد تكون درجية
 * (Step Function): مسطحة عند مستويات متوسطة، ثم قفزة حادة. PAVA لا
 * يفرض شكلاً — الشرط الرياضي الوحيد فيه هو الرتابة (raw أعلى ⇒
 * احتمال فعلي لا يقل).
 *
 * لا كود PAVA جديد هنا: fitCalibration/applyCalibration في
 * training/calibrate-confidence.ts عامّان بالفعل (يعملان على أي زوج
 * (رقم في [0,1], صحيح/خطأ))، فقط نعيد تسميتهما لمستوى الاستخدام
 * الصحيح كي لا يخلط مستدعٍ بين معايرة نموذج ومعايرة مجموعة.
 */

import type { Regime } from '../types';
import {
  fitCalibration,
  applyCalibration,
  type CalibrationCurve,
  type CalibrationRecord,
} from '../training/calibrate-confidence';

export type { CalibrationCurve };

/**
 * الحد الأدنى الافتراضي لمعايرة MPS تحديداً — أعلى من
 * calibrate-confidence.ts::DEFAULT_MIN_SAMPLE (100) عمداً.
 *
 * تحقّقت تجريبياً (محاكاة PAVA ضد sigmoid على علاقة لوجستية معروفة،
 * seeded/محجوزة الاختبار): عند 600 عيّنة تدريب PAVA أسوأ من sigmoid
 * بمعامل ~2.3× (خطأ موثوقية 0.0435 مقابل 0.0193) — تكلفة تباين حقيقية
 * لغياب الافتراض البارامتري. عند 2000 عيّنة يتقارب PAVA ويتجاوز sigmoid
 * (0.0181 مقابل 0.0193) ويستقر هناك حتى 30,000. الحد 100 الافتراضي في
 * calibrate-confidence.ts معقول لمعايرة نموذج فردي (نطاق أضيق، إشارة
 * أعلى)؛ لمعايرة raw score المُجمَّع (5 مكوّنات مدمجة، تباين أعلى)
 * يحتاج MIN_MPS_SAMPLE أعلى ليتفوق فعلياً بدل أن يخمّن بثقة زائفة.
 */
export const MIN_MPS_SAMPLE = 2000;

export type MpsOutcomeRecord = {
  /** MPSResult.raw كما حُسب لحظة الإصدار — قبل أي تحويل sigmoid أو isotonic. */
  raw: number;
  /** هل تحقق الاتجاه المتوقع فعلياً بعد مرور الأفق الزمني؟ PIT-safe إلزامي. */
  correct: boolean;
  /** اختياري: يتيح لاحقاً معايرة منفصلة لكل نظام (Mondrian)، غير مُفعَّل هنا. */
  regime?: Regime;
};

/**
 * يبني منحنى PAVA من سجل نتائج تاريخي على raw score المُجمَّع.
 * records يجب أن تُجمَع بعد معرفة النتيجة الفعلية فقط (لا PIT مزيف).
 */
export function fitMpsCalibration(records: MpsOutcomeRecord[]): CalibrationCurve {
  const asCalibrationRecords: CalibrationRecord[] = records.map((r) => ({
    confidence: r.raw,
    correct: r.correct,
  }));
  return fitCalibration(asCalibrationRecords, 'ensemble_mps_raw');
}

/**
 * يطبّق منحنى PAVA على raw score واحد لحظة الاستدلال. عيّنة أصغر من
 * minSample ترجع null صراحةً — يقرر المستدعي (mps.ts) هل يسقط لـ sigmoid
 * كافتراضي آمن، لا أن تتحول القيمة صامتة إلى 0.5 داخل هذا الملف.
 */
export function applyMpsCalibration(
  curve: CalibrationCurve | undefined,
  raw: number,
  minSample = MIN_MPS_SAMPLE,
): number | null {
  if (!curve || curve.sampleSize < minSample) return null;
  return applyCalibration(curve, raw, minSample);
}
