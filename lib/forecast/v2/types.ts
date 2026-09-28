/**
 * أنواع Mizan Precision Engine v2.
 * server-only. لا يُستورد من الواجهة.
 */

export type Direction = 'up' | 'down' | 'neutral';
export type Regime = 'calm_trend' | 'calm_chop' | 'wild_trend' | 'wild_chop';

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketContext = {
  benchmark: PriceBar[];
  sector?: PriceBar[];
  peers?: PriceBar[][];
  vixLevel?: number;
  marketBreadth?: number;
  /**
   * تقويم الإفصاحات — مدخل PEAD.
   * PIT: nextAnnouncement معلوم مسبقاً (تقويم منشور)، و lastSurprise معلوم لحظة الإعلان.
   * غياب الحقل يعني "لا مصدر" ويُترجَم إلى s9 = 0 صراحةً، لا إلى تخمين.
   */
  earnings?: {
    /** YYYY-MM-DD */
    lastAnnouncement?: string;
    /** (actual − expected) / |expected| */
    lastSurprise?: number;
    /** YYYY-MM-DD */
    nextAnnouncement?: string;
  };
};

export type ForecastInput = {
  symbol: string;
  market: 'sa' | 'us';
  prices: PriceBar[];
  context: MarketContext;
  asOf: string;
  horizon: number;
};

/**
 * confidence === 0 يعني "هذا النموذج غير متاح في هذه الجولة".
 * على طبقة الدمج أن تستبعده من إعادة توزيع الأوزان، لا أن تعامله كحياد حقيقي.
 */
export type ModelOutput = {
  modelId: string;
  direction: Direction;
  expectedReturn: number;
  confidence: number;
  raw: Record<string, number | boolean>;
};

export type FeatureVector = {
  names: string[];
  public: number[];
  secret: number[];
};

export type EnsembleOutput = {
  direction: Direction;
  expectedReturn: number;
  confidence: number;
  regime: Regime;
  regimeProb: [number, number, number, number];
  modelOutputs: ModelOutput[];
  mps: number;
  /**
   * فاصل تنبؤ معاير (conformal) — موجود فقط إذا مُرِّر conformalCurve إلى
   * runEnsemble ووُجدت بيانات معايرة كافية. غيابه يعني عدم توفر معايرة،
   * لا صفراً أو حياداً. راجع meta/conformal-interval.ts.
   */
  range?: { low: number; high: number; coverage: number };
};

export type GatedSignal = {
  issued: boolean;
  reason: string;
  direction?: Direction;
  expectedReturn?: number;
  confidence?: number;
  range?: { low: number; high: number };
  regime?: Regime;
  evidence?: {
    agreeingModels: number;
    totalModels: number;
    topContributors: Array<{ modelId: string; weight: number }>;
  };
};

export type MPSWeights = {
  agreement: number;
  confidence: number;
  regimeFit: number;
  timeConsistency: number;
  peerConfirmation: number;
};

export type GateThresholds = {
  high: number;
  low: number;
};

export type ModelWeights = Record<string, number>;

/** featureNames إلزامية عملياً: تمنع انزياح المعاملات عند تعديل features.ts. */
export type TrainedLinearModel = {
  intercept: number;
  coefficients: number[];
  featureNames?: string[];
};

export type ModelCoefficients = {
  ridge: TrainedLinearModel;
  lasso: TrainedLinearModel;
};
