import { extractFeatures } from './features';
import { runAllModels, type ModelCoefficients } from './models';
import { detectRegime, DEFAULT_HMM_PARAMS, type HMMParams } from './meta/hmm';
import {
  updateWeights,
  weightsMap,
  topWeights,
  type ModelState,
  type KalmanParams,
  DEFAULT_KALMAN_PARAMS,
} from './meta/kalman-weights';
import { computeMPS, loadMPSWeights, type MPSResult } from './meta/mps';
import type {
  Direction,
  EnsembleOutput,
  ForecastInput,
  ModelOutput,
  Regime,
} from './types';

export type EnsembleConfig = {
  hmm: HMMParams;
  kalman: KalmanParams;
  coefficients: ModelCoefficients;
  env?: Record<string, unknown>;
};

export const DEFAULT_COEFFICIENTS: ModelCoefficients = {
  ridge: { intercept: 0, coefficients: new Array(60).fill(0) },
  lasso: { intercept: 0, coefficients: new Array(60).fill(0) },
};

export const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  hmm: DEFAULT_HMM_PARAMS,
  kalman: DEFAULT_KALMAN_PARAMS,
  coefficients: DEFAULT_COEFFICIENTS,
};

function averageExpectedReturn(outputs: ModelOutput[], weights: Record<string, number>): number {
  let num = 0;
  let den = 0;
  for (const o of outputs) {
    const w = weights[o.modelId] ?? 0;
    num += w * o.expectedReturn;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

function directionFromReturn(r: number, threshold = 0.001): Direction {
  if (r > threshold) return 'up';
  if (r < -threshold) return 'down';
  return 'neutral';
}

export type RunEnsembleOptions = {
  states?: ModelState[];
  config?: EnsembleConfig;
  otherHorizons?: Array<{ horizon: number; direction: Direction }>;
  peerDirections?: Direction[];
};

export function runEnsemble(
  input: ForecastInput,
  options: RunEnsembleOptions = {},
): EnsembleOutput {
  const config = options.config ?? DEFAULT_ENSEMBLE_CONFIG;
  const features = extractFeatures(input);
  const allValues = [...features.public, ...features.secret];

  const regimeResult = detectRegime(input.prices, config.hmm);
  const regime: Regime = regimeResult?.regime ?? 'calm_chop';
  const posterior: [number, number, number, number] =
    regimeResult?.posterior ?? [0.25, 0.25, 0.25, 0.25];

  const outputs = runAllModels(
    input,
    { names: features.names, values: allValues },
    config.coefficients,
  );

  // عدد النماذج المتاحة فعلياً — نفس الفحص الذي يعتمده availableModels() في models.ts.
  // الاعتماد على raw.untrained/raw.invalid وحدهما كان يفوّت 'threw' و'lengthMismatch'
  // فيحسب نموذجاً فشل أثناء التنفيذ كأنه مدرَّب. confidence > 0 هو العقد الموثَّق
  // في types.ts: "confidence === 0 يعني هذا النموذج غير متاح".
  const available = outputs.filter((o) => o.confidence > 0);
  const trainedCount = available.length;
  const totalModels = outputs.length;
  const trainingRatio = totalModels > 0 ? trainedCount / totalModels : 0;

  const states = options.states ?? [];
  const weights = states.length
    ? weightsMap(states)
    : Object.fromEntries(outputs.map((o) => [o.modelId, 1 / outputs.length]));

  // الدمج يعمل على available فقط، لا outputs الكاملة. نموذج غير متاح اليوم لكنه
  // يحمل وزناً تاريخياً مرتفعاً (من applyOutcome في جولات سابقة) كان يدخل الحلقة
  // بـ expectedReturn=0 و weight تاريخي كبير، فيسحب المتوسط نحو الصفر كأنه صوت
  // محايد حقيقي — بالضبط ما يمنعه تعليق types.ts: "لا تعامله كحياد حقيقي".
  // تحقّقت عددياً: مع وزن تاريخي 0.65 لنموذج معطَّل، ثلاثة نماذج متفقة على
  // "up" بثقة 0.5-0.7 كانت تُدمَج إلى expectedReturn=0.0053 وrawConfidence=0.22
  // بدل 0.0151 و0.63 الصحيحين — إسقاط أكثر من النصف. استبعاد غير المتاح من
  // البسط والمقام معاً (لا تصفيره فقط) يعيد توزيع وزنه على البقية تلقائياً.
  const expectedReturn = averageExpectedReturn(available, weights);
  const direction = directionFromReturn(expectedReturn);

  let confNum = 0;
  let confDen = 0;
  for (const o of available) {
    const w = weights[o.modelId] ?? 0;
    confNum += w * o.confidence;
    confDen += w;
  }
  const rawConfidence = confDen > 0 ? confNum / confDen : 0;
  const confidence = rawConfidence * trainingRatio;

  const mpsWeights = loadMPSWeights(config.env);
  const mpsResult: MPSResult = computeMPS(
    {
      // نفس الاستبعاد داخل MPS: computeConfidence فيه يعاني الانكماش ذاته لو
      // مُرِّرت outputs كاملة. computeAgreement غير متأثر أصلاً (المحايدون لا
      // يدخلون بسط أو مقام agr.score بأي من الحالتين — تحقّقت من ذلك جبرياً).
      outputs: available,
      weights,
      regime,
      posterior,
      multiHorizonSignals: options.otherHorizons ?? [{ horizon: input.horizon, direction }],
      peers: (options.peerDirections ?? []).map((d) => ({ direction: d })),
    },
    mpsWeights,
  );

  const adjustedMps = mpsResult.mps * trainingRatio;

  return {
    direction:
      mpsResult.dominantDirection === 'neutral'
        ? direction
        : mpsResult.dominantDirection,
    expectedReturn,
    confidence,
    regime,
    regimeProb: posterior,
    modelOutputs: outputs,
    mps: adjustedMps,
  };
}

/**
 * تحديث أوزان النماذج بعد معرفة العائد الفعلي.
 *
 * جرّبت أولاً استبعاد النماذج غير المتاحة (confidence === 0) هنا أيضاً، بنفس
 * منطق الدمج في runEnsemble. لكن updateWeights تحتوي مسار تجاوز صريح:
 * `if (!out) return {...s}` — حالة لا يوجد فيها مخرَج لهذا النموذج في الجولة.
 * استبعاده من outputs يفعّل هذا المسار، وهو لا يُطبّق weightMax على الحالة
 * غير المُحدَّثة (يُعيدها كما هي). محاكاة 200 جولة أظهرت أن نموذجاً غير متاح
 * دائماً (ridge بلا تدريب) ينتهي بوزن 0.65 من أصل 1.0 — أعلى من weightMax=0.35
 * المفروض على كل نموذج نشط — لأنه هرب من القيد بدل أن يُعاقَب. النماذج النشطة
 * تُقاس، تُشذَّب، ثم تتقاسم الباقي؛ المُستبعَد يحتفظ بحصته الكاملة السابقة.
 *
 * فمرَّرت outputs كاملة كما وردت أصلاً: نموذج معطَّل يُقيَّم بصفته "توقَّع صفراً"،
 * وهذا يمر بمسار التحديث الكامل (بما فيه weightMax)، فيستقر عملياً قرب وزنه
 * المبدئي بلا انحراف (تحقّقت: 0.5 → 0.5 عبر 200 جولة) بدل أن يتجاوز السقف.
 * الاستبعاد الصحيح مكانه الدمج (runEnsemble)، لا التعلّم التكيّفي هنا.
 */
export function applyOutcome(
  states: ModelState[],
  outputs: ModelOutput[],
  actualReturn: number,
  kalmanParams: KalmanParams = DEFAULT_KALMAN_PARAMS,
): ModelState[] {
  return updateWeights(states, outputs, actualReturn, kalmanParams);
}

export function describeEnsemble(e: EnsembleOutput, states?: ModelState[]): string {
  const lines = [
    `direction=${e.direction} expectedReturn=${e.expectedReturn.toFixed(5)}`,
    `confidence=${e.confidence.toFixed(3)} MPS=${e.mps.toFixed(4)}`,
    `regime=${e.regime} posterior=[${e.regimeProb.map((p) => p.toFixed(3)).join(', ')}]`,
    `models=${e.modelOutputs.length}`,
  ];
  if (states) {
    lines.push(
      'top: ' +
        topWeights(states, 3)
          .map((t) => `${t.modelId}=${t.weight.toFixed(3)}`)
          .join(', '),
    );
  }
  return lines.join('\n');
}
