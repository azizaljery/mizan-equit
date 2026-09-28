import type { HMMParams } from './meta/hmm';
import type { ModelCoefficients, TrainedLinearModel } from './types';
import { DEFAULT_HMM_PARAMS } from './meta/hmm';

/**
 * TrainedLinearModel + إحصاءات تدريب تشخيصية.
 *
 * يمتد من TrainedLinearModel (types.ts) بدل تعريف بنية مستقلة: هذا الملف
 * كان يستورد `./training/types` وهو غير موجود في المستودع، ويعرّف شكلاً
 * موازياً بلا featureNames — فيُسقِط تحقق ترتيب الميزات في assertFeatureOrder
 * (models.ts) بصمت لأن `expected` يصير undefined. الامتداد هنا يبقي
 * featureNames، فتبقى الحماية قائمة، وتظل النتيجة قابلة للتمرير مباشرة إلى
 * ModelCoefficients.ridge / .lasso دون تحويل.
 */
export type TrainedLinearWithStats = TrainedLinearModel & {
  trainRMSE: number;
  trainMAE: number;
  r2: number;
  activeFeatures: number;
  zeroedCoefficients?: number;
};

export type LoadedArtifact = {
  hmm: HMMParams;
  ridge: TrainedLinearWithStats;
  lasso: TrainedLinearWithStats;
  source: 'trained' | 'default';
  trainedAt: string | null;
};

const DEFAULT_RIDGE: TrainedLinearWithStats = {
  intercept: 0,
  coefficients: new Array(60).fill(0),
  trainRMSE: 0,
  trainMAE: 0,
  r2: 0,
  activeFeatures: 0,
};

const DEFAULT_LASSO: TrainedLinearWithStats = {
  intercept: 0,
  coefficients: new Array(60).fill(0),
  trainRMSE: 0,
  trainMAE: 0,
  r2: 0,
  activeFeatures: 0,
  zeroedCoefficients: 60,
};

const DEFAULT_ARTIFACT: LoadedArtifact = {
  hmm: DEFAULT_HMM_PARAMS,
  ridge: DEFAULT_RIDGE,
  lasso: DEFAULT_LASSO,
  source: 'default',
  trainedAt: null,
};

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null;
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * يبني نموذجاً خطياً من JSON خام، ويرفضه (يرجع null) إن نقصت أي حماية:
 * الأطوال، أو ترتيب الميزات (featureNames) الذي يحمي من انزياح صامت لو
 * تغيّر features.ts بعد التدريب. رفض صريح أفضل من قبول جزئي بلا حماية.
 */
function parseLinearModel(v: unknown, label: string): TrainedLinearWithStats | null {
  if (!isRecord(v)) return null;
  if (!isNumberArray(v.coefficients)) return null;
  if (!isStringArray(v.featureNames) || v.featureNames.length !== v.coefficients.length) {
    console.warn(
      `[params-loader] ${label}: featureNames مفقود أو غير مطابق للطول — رفض المُصنَّف بدل قبوله بلا حماية.`,
    );
    return null;
  }
  const intercept = typeof v.intercept === 'number' ? v.intercept : Number(v.intercept);
  if (!Number.isFinite(intercept)) return null;
  return {
    intercept,
    coefficients: v.coefficients,
    featureNames: v.featureNames,
    trainRMSE: typeof v.trainRMSE === 'number' ? v.trainRMSE : 0,
    trainMAE: typeof v.trainMAE === 'number' ? v.trainMAE : 0,
    r2: typeof v.r2 === 'number' ? v.r2 : 0,
    activeFeatures: typeof v.activeFeatures === 'number' ? v.activeFeatures : 0,
    zeroedCoefficients: typeof v.zeroedCoefficients === 'number' ? v.zeroedCoefficients : undefined,
  };
}

function isHMMParams(v: unknown): v is HMMParams {
  if (!isRecord(v)) return false;
  return Array.isArray(v.pi) && v.pi.length === 4 && Array.isArray(v.A) && Array.isArray(v.mean) && Array.isArray(v.std);
}

/** تحميل مصنَّف الوزن من Workers env، أو الافتراضي الآمن (كل شيء غير مدرَّب) إن غاب أو فسد. */
export function loadArtifact(env?: Record<string, unknown>): LoadedArtifact {
  const source = env?.MIZAN_FORECAST_ARTIFACT;
  if (source == null) return DEFAULT_ARTIFACT;

  try {
    const raw: unknown = typeof source === 'string' ? JSON.parse(source) : source;
    if (!isRecord(raw)) return DEFAULT_ARTIFACT;

    const hmmParams = isRecord(raw.hmm) ? raw.hmm.params : undefined;
    const hmm = isHMMParams(hmmParams) ? hmmParams : null;
    const ridge = parseLinearModel(raw.ridge, 'ridge');
    const lasso = parseLinearModel(raw.lasso, 'lasso');

    if (!hmm || !ridge || !lasso) return DEFAULT_ARTIFACT;

    return {
      hmm,
      ridge,
      lasso,
      source: 'trained',
      trainedAt: typeof raw.trainedAt === 'string' ? raw.trainedAt : null,
    };
  } catch {
    return DEFAULT_ARTIFACT;
  }
}

/** يستخرج {ridge, lasso} بشكل ModelCoefficients جاهز لتمريره إلى EnsembleConfig. */
export function toModelCoefficients(artifact: LoadedArtifact): ModelCoefficients {
  return { ridge: artifact.ridge, lasso: artifact.lasso };
}
