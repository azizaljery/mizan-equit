/**
 * البوابة الانتقائية — المُنتِج المفقود لـ types.ts::GatedSignal.
 *
 * الفكرة الأصلية لميزان: "يصمت غالباً ويتكلم نادراً وبثقة عالية".
 * في المستودع اليوم كل شيء يعبر إلى المستخدم — لا توجد أي طبقة قرار
 * تحوّل EnsembleOutput الخام إلى قرار "ننشر / نمتنع". هذا الملف يبنيها.
 *
 * سبع بوابات رفض تسبق أي إصدار إشارة. أي فشل واحد يحبس الإشارة
 * (issued=false) مع سبب مكتوب — لا "ثقة منخفضة" ضبابية بل حقيقة يمكن
 * تدقيقها. ما يجعل هذا صادقاً وليس مسرحاً:
 *
 *  1) العتبات θ_low و θ_high تُحمَّل من env (MIZAN_GATE_THRESHOLDS) — قابلة
 *     للمعايرة على بيانات فعلية، لا مبرمَجة بالحدس. الافتراض الآمن حين
 *     يغيب env: عتبات محافظة (0.75/0.90) لا تصدر إشارة إلا في الحالات
 *     الاستثنائية.
 *
 *  2) نحكم على MPS بحد ويلسون الأدنى (Wilson lower bound) لا بالرقم
 *     الخام، حين تتوفر عيّنة معايرة كافية. الفرق: 17/20 نجاح تاريخي
 *     تعطي MPS خام ~0.85 لكن WLB(17,20)=0.634، أي أن اليقين الإحصائي
 *     يقول "على الأقل 63.4%" لا 85%. هذا يعاقب العينات الصغيرة تلقائياً
 *     دون قاعدة يدوية "لا تصدر قبل 100 عيّنة" — الرياضيات نفسها تفعل ذلك.
 *
 *  3) نظام wild_chop (اضطراب عشوائي) بوابة رفض قاطعة حتى مع MPS مرتفع.
 *     السبب: تدريب النماذج يفترض قابلية توقع محلية، والحالة wild_chop
 *     هي حرفياً حالة "لا قابلية توقع" — إصدار إشارة فيها يعني أنك تثق
 *     بنموذج مبني على افتراض ينفيه النظام الحالي صراحةً.
 *
 *  4) الحركة المتوقعة يجب أن تتجاوز تكلفة التنفيذ (spread + commission +
 *     slippage) بهامش أمان × 1.5. إشارة صحيحة لكن أصغر من كلفتها ليست
 *     إشارة — هي نزيف. هذا ما يميّز نظاماً منضبطاً عن نظام يزعم أنه دقيق.
 *
 * ما هذا الملف ليس: ليس ادعاءً بأن كل إشارة تصدر ستنجح. حتى بعد كل هذه
 * البوابات هناك خطأ. الادعاء هو: الحالات التي تنجو من هذه الشروط
 * السبعة هي الحالات التي يجب أن نراهن عليها؛ ما دونها نصمت.
 */

import type {
  Direction,
  EnsembleOutput,
  GatedSignal,
  GateThresholds,
} from '../types';
import { wilsonLowerBound } from '../training/calibrate-confidence';
import type { ModelState } from './kalman-weights';

/** عتبات افتراضية محافظة — رفض غالبية الإشارات حين لا توجد معايرة env. */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  high: 0.9, // ≥ high → إشارة قوية
  low: 0.75, // < low → رفض؛ بينهما → لا إصدار (ثقة رمادية)
};

/** أقل اتفاق بين النماذج قبل قبول اتجاه. أقل من ذلك = ضجيج، لا رأي. */
const MIN_AGREEMENT = 0.6;

/** كلفة تنفيذ افتراضية للسوق السعودي: 15 نقطة أساس ذهاباً وإياباً. */
const DEFAULT_ROUND_TRIP_COST = 0.0015;

/** معامل أمان فوق كلفة التنفيذ. حركة صافية بلا هامش = نزيف تراكمي. */
const COST_SAFETY_MULTIPLIER = 1.5;

/** أقل عيّنة معايرة قبل استخدام Wilson؛ دونها نحكم بـ MPS الخام مع تحذير. */
const MIN_CALIBRATION_SAMPLES = 30;

/**
 * يحمّل عتبات البوابة من env — نفس نمط MIZAN_MPS_WEIGHTS.
 * أي عتبة مشوَّهة أو خارج المجال [0,1] أو high ≤ low = رفض صريح والعودة
 * للافتراضي المحافظ. الفشل الصامت هنا خطر: عتبة 0.05 مكسورة تحوّل النظام
 * من "يصمت نادراً" إلى "ينبح دائماً".
 */
export function loadGateThresholds(env?: Record<string, unknown>): GateThresholds {
  if (!env?.MIZAN_GATE_THRESHOLDS) return DEFAULT_GATE_THRESHOLDS;
  try {
    const raw =
      typeof env.MIZAN_GATE_THRESHOLDS === 'string'
        ? JSON.parse(env.MIZAN_GATE_THRESHOLDS as string)
        : env.MIZAN_GATE_THRESHOLDS;
    const t = raw as Partial<GateThresholds>;
    if (
      typeof t.high === 'number' &&
      typeof t.low === 'number' &&
      Number.isFinite(t.high) &&
      Number.isFinite(t.low) &&
      t.high > t.low &&
      t.high <= 1 &&
      t.low >= 0
    ) {
      return { high: t.high, low: t.low };
    }
  } catch {
    // عتبات مشوَّهة = عودة للافتراضي، لا كسر لدفعة التنبؤ كاملة.
  }
  return DEFAULT_GATE_THRESHOLDS;
}

export type GateInput = {
  ensemble: EnsembleOutput;
  /** أوزان النماذج الحالية لبناء evidence.topContributors؛ اختياري. */
  states?: ModelState[];
  /**
   * (نجاحات، مجموع) لبوابة على وقعتها التاريخية إن وُجدت. مصدر مقترح:
   * سجلّ توقعات هذا النظام (regime) عند مستويات ثقة مماثلة (bin).
   * غيابها لا يوقف البوابة — تسقط إلى MPS الخام مع سبب موثَّق.
   */
  historicalTrack?: { successes: number; total: number };
  /** كلفة تنفيذ للسوق الحالي (round-trip). يُفضَّل أن تكون واقعية حسب السهم. */
  executionCost?: number;
  /** عتبات معايَرة (env). في غيابها → DEFAULT_GATE_THRESHOLDS. */
  thresholds?: GateThresholds;
};

/**
 * حساب MPS المعدَّل إحصائياً: عند توفر عيّنة كافية نستخدم Wilson كسقف
 * إحصائي أدنى، وإلا الرقم الخام. هذا هو الرقم الذي تقارنه البوابة بالعتبات.
 */
function statisticallyAdjustedMps(
  rawMps: number,
  track?: { successes: number; total: number },
): { adjusted: number; source: 'wilson' | 'raw' } {
  if (track && track.total >= MIN_CALIBRATION_SAMPLES) {
    return { adjusted: wilsonLowerBound(track.successes, track.total), source: 'wilson' };
  }
  return { adjusted: rawMps, source: 'raw' };
}

/**
 * قياس اتفاق النماذج على الاتجاه المسيطر — يعتمد فقط على النماذج المتاحة
 * (confidence > 0) لأن أصوات المحايدين/غير المتاحين لا تعني اتفاقاً ولا
 * خلافاً. تعقّبت هذا: outputs الكامل يُدخِل modelOutputs المستبعدة كحياد
 * فيخفض النسبة بشكل مضلِّل، بينما ما نقيسه فعلاً هو "ممن رأى، كم يتفق".
 */
function directionalAgreement(ensemble: EnsembleOutput): {
  agreeing: number;
  total: number;
  ratio: number;
} {
  const available = ensemble.modelOutputs.filter((o) => o.confidence > 0);
  const total = available.length;
  if (total === 0) return { agreeing: 0, total: 0, ratio: 0 };
  const dir = ensemble.direction;
  const agreeing = available.filter((o) => o.direction === dir).length;
  return { agreeing, total, ratio: total > 0 ? agreeing / total : 0 };
}

/**
 * البوابة الرئيسية. ترجع GatedSignal حيث:
 *   issued=true  → اجتاز كل الشروط + MPS_adj ≥ high
 *   issued=false → أي شرط فشل، أو high > MPS_adj ≥ low (منطقة رمادية).
 *
 * لا تُطلَق استثناءات: كل رفض إشارة صريح بسبب مكتوب. اضطراب المدخلات
 * (regime غير معروف، modelOutputs فارغة، …) يجب أن يصمت البوابة، لا يعطلها.
 */
export function evaluateGate(input: GateInput): GatedSignal {
  const { ensemble, states, historicalTrack, thresholds } = input;
  const T = thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const cost = input.executionCost ?? DEFAULT_ROUND_TRIP_COST;

  // 1) بيانات صالحة — أي فراغ في outputs يعني فشل عميق سابق.
  if (!ensemble.modelOutputs || ensemble.modelOutputs.length === 0) {
    return { issued: false, reason: 'no_model_outputs' };
  }

  const availableCount = ensemble.modelOutputs.filter((o) => o.confidence > 0).length;
  if (availableCount === 0) {
    return { issued: false, reason: 'no_trained_models_available' };
  }

  // 2) اتجاه غير حيادي.
  if (ensemble.direction === 'neutral') {
    return { issued: false, reason: 'neutral_direction' };
  }

  // 3) النظام السوقي معادٍ للتنبؤ.
  //    posterior[3] هو احتمال wild_chop. حتى لو Viterbi أعطى تسمية أخرى،
  //    احتمال wild_chop ≥ 0.5 يعني أن ~نصف الكتلة الاحتمالية في حالة
  //    تُبطِل النماذج — تحفّظاً لا نصدر.
  if (ensemble.regime === 'wild_chop' || ensemble.regimeProb[3] >= 0.5) {
    return { issued: false, reason: 'hostile_regime_wild_chop' };
  }

  // 4) الاتفاق بين النماذج.
  const agreement = directionalAgreement(ensemble);
  if (agreement.ratio < MIN_AGREEMENT) {
    return {
      issued: false,
      reason: `low_agreement_${agreement.agreeing}_of_${agreement.total}`,
    };
  }

  // 5) الحركة أكبر من الكلفة.
  const minReturn = cost * COST_SAFETY_MULTIPLIER;
  if (Math.abs(ensemble.expectedReturn) < minReturn) {
    return {
      issued: false,
      reason: `move_below_cost_${(minReturn * 10000).toFixed(0)}bps_needed`,
    };
  }

  // 6) MPS معدَّل إحصائياً ≥ العتبة العليا. المنطقة الرمادية بين
  //    low و high تعني "نعم، وضع مقبول، لكنه ليس استثنائياً" — لا ننشر.
  const { adjusted, source } = statisticallyAdjustedMps(ensemble.mps, historicalTrack);
  if (adjusted < T.low) {
    return { issued: false, reason: `mps_below_low_${adjusted.toFixed(3)}_${source}` };
  }
  if (adjusted < T.high) {
    return { issued: false, reason: `mps_in_gray_zone_${adjusted.toFixed(3)}_${source}` };
  }

  // 7) اجتاز الكل: بناء الإشارة.
  //    range يأتي من EnsembleOutput.range إن وُجد (منتَج conformal-interval).
  //    غيابه يعني لم يُمرَّر منحنى conformal — الإشارة تصدر لكن بلا نطاق.
  const evidence = buildEvidence(ensemble, states, agreement);

  const signal: GatedSignal = {
    issued: true,
    reason: `passed_all_gates_mps_${adjusted.toFixed(3)}_${source}`,
    direction: ensemble.direction as Direction,
    expectedReturn: ensemble.expectedReturn,
    confidence: adjusted,
    regime: ensemble.regime,
    evidence,
  };
  if (ensemble.range) signal.range = { low: ensemble.range.low, high: ensemble.range.high };
  return signal;
}

function buildEvidence(
  ensemble: EnsembleOutput,
  states: ModelState[] | undefined,
  agreement: { agreeing: number; total: number },
): NonNullable<GatedSignal['evidence']> {
  const topContributors = states
    ? [...states]
        .filter((s) =>
          ensemble.modelOutputs.some(
            (o) => o.modelId === s.modelId && o.confidence > 0 && o.direction === ensemble.direction,
          ),
        )
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((s) => ({ modelId: s.modelId, weight: s.weight }))
    : [];

  return {
    agreeingModels: agreement.agreeing,
    totalModels: agreement.total,
    topContributors,
  };
}

/** ملخص نصي للبوابة — يوازي describeEnsemble للتشخيص. */
export function describeGate(signal: GatedSignal): string {
  if (!signal.issued) return `GATE: HELD (${signal.reason})`;
  const parts = [
    `GATE: ISSUED direction=${signal.direction}`,
    `expectedReturn=${signal.expectedReturn?.toFixed(5)}`,
    `confidence=${signal.confidence?.toFixed(3)}`,
    `regime=${signal.regime}`,
    `evidence=${signal.evidence?.agreeingModels}/${signal.evidence?.totalModels}`,
  ];
  if (signal.range) parts.push(`range=[${signal.range.low.toFixed(4)},${signal.range.high.toFixed(4)}]`);
  return parts.join(' | ');
}
