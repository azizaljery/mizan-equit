import type { PriceBar, TrainedLinearModel } from '../types';
import type { HMMParams } from '../meta/hmm';

export type TrainingSample = {
  symbol: string;
  market: 'sa' | 'us';
  asOf: string;
  history: PriceBar[];
  benchmark: PriceBar[];
  peers: PriceBar[][];
  actualReturn: number;
  benchmarkReturn: number;
  horizon: number;
};

export type TrainingCorpus = {
  generatedAt: string;
  symbols: string[];
  horizon: number;
  samples: TrainingSample[];
};

export type TrainedHMM = {
  params: HMMParams;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
};

/**
 * TrainedLinearModel (types.ts) + إحصاءات تدريب تشخيصية.
 *
 * يمتد من TrainedLinearModel بدل تعريف بنية مستقلة رابعة لنفس المفهوم —
 * الشكل الأصلي هنا كان بلا featureNames، وهذا بالضبط ما كسر params-loader.ts
 * سابقاً (assertFeatureOrder في models.ts يتجاوز فحصه بصمت إن غاب
 * featureNames). الامتداد يبقيها، فيبقى الأرتيفاكت الذي ينتجه offline-trainer
 * قابلاً للتحميل عبر loadArtifact() دون تعديل هناك.
 */
export type TrainedLinear = TrainedLinearModel & {
  trainRMSE: number;
  trainMAE: number;
  r2: number;
  activeFeatures: number;
  zeroedCoefficients?: number;
};

export type TrainingArtifact = {
  version: string;
  trainedAt: string;
  horizon: number;
  hmm: TrainedHMM;
  ridge: TrainedLinear;
  lasso: TrainedLinear;
  /** أسماء الميزات على مستوى الأرتيفاكت — للعرض والتشخيص فقط. ridge/lasso يحملان نسختيهما الخاصتين (قد تتطابقان عملياً لأنهما دُرِّبا على نفس X، لكن loadArtifact يتحقق من نسخة كل نموذج على حدة، لا من هذا الحقل). */
  featureNames: string[];
  predictions: Array<{
    asOf: string;
    symbol: string;
    predicted: number;
    actual: number;
  }>;
};

export type TrainingConfig = {
  horizon: number;
  ridgeLambda: number;
  lassoLambda: number;
  lassoMaxIter: number;
  hmmMaxIter: number;
  hmmTolerance: number;
};

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  horizon: 21,
  ridgeLambda: 1.0,
  lassoLambda: 0.005,
  lassoMaxIter: 500,
  hmmMaxIter: 100,
  hmmTolerance: 1e-4,
};
