import { extractFeatures } from '../features';
import { trainHMMFromCorpus } from './baum-welch';
import { trainRidge, predictRidge, toRawSpace as ridgeToRaw } from './ridge';
import { trainLasso, predictLasso, toRawSpace as lassoToRaw } from './lasso';
import { DEFAULT_HMM_PARAMS } from '../meta/hmm';
import type {
  TrainingCorpus,
  TrainingArtifact,
  TrainingConfig,
} from './types';
import { DEFAULT_TRAINING_CONFIG } from './types';
import type { ForecastInput } from '../types';

function sampleToInput(sample: TrainingCorpus['samples'][number]): ForecastInput {
  return {
    symbol: sample.symbol,
    market: sample.market,
    prices: sample.history,
    context: {
      benchmark: sample.benchmark,
      peers: sample.peers,
    },
    asOf: sample.asOf,
    horizon: sample.horizon,
  };
}

export type TrainResult = {
  artifact: TrainingArtifact;
  report: string;
};

export function trainAll(
  corpus: TrainingCorpus,
  config: TrainingConfig = DEFAULT_TRAINING_CONFIG,
): TrainResult {
  const started = Date.now();
  const log: string[] = [];
  log.push(`عدد العينات: ${corpus.samples.length}`);

  log.push('\n[HMM] تدريب Baum-Welch...');
  const allPrices = corpus.samples.map((s) => s.history);
  const hmmResult = trainHMMFromCorpus(allPrices, DEFAULT_HMM_PARAMS, {
    maxIter: config.hmmMaxIter,
    tolerance: config.hmmTolerance,
  });
  log.push(`  تكرارات: ${hmmResult.iterations}`);
  log.push(`  converged: ${hmmResult.converged}`);
  log.push(`  logLikelihood: ${hmmResult.logLikelihood.toFixed(2)}`);

  log.push('\n[Features] استخراج...');
  const X: number[][] = [];
  const y: number[] = [];
  let featureNames: string[] = [];
  let extractionFailures = 0;

  for (const sample of corpus.samples) {
    try {
      const input = sampleToInput(sample);
      const f = extractFeatures(input);
      const values = [...f.public, ...f.secret];
      if (values.length === 0) {
        extractionFailures++;
        continue;
      }
      if (featureNames.length === 0) featureNames = f.names;
      if (f.names.length !== featureNames.length) {
        extractionFailures++;
        continue;
      }
      X.push(values);
      y.push(sample.actualReturn);
    } catch {
      extractionFailures++;
    }
  }

  log.push(`  صفوف صالحة: ${X.length}`);
  log.push(`  فشل استخراج: ${extractionFailures}`);
  log.push(`  ميزات: ${featureNames.length}`);

  if (X.length < 100) {
    throw new Error(`عينات غير كافية للتدريب (${X.length} < 100).`);
  }

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < X[i].length; j++) {
      if (!Number.isFinite(X[i][j])) {
        X[i][j] = 0;
      }
    }
  }

  log.push('\n[Ridge] تدريب...');
  const ridge = trainRidge(X, y, config.ridgeLambda);
  log.push(`  RMSE: ${ridge.trainRMSE.toFixed(5)}`);
  log.push(`  MAE: ${ridge.trainMAE.toFixed(5)}`);
  log.push(`  R²: ${ridge.r2.toFixed(4)}`);
  log.push(`  معاملات نشطة: ${ridge.activeFeatures}/${featureNames.length}`);

  log.push('\n[Lasso] تدريب...');
  const lasso = trainLasso(X, y, config.lassoLambda, config.lassoMaxIter);
  log.push(`  RMSE: ${lasso.trainRMSE.toFixed(5)}`);
  log.push(`  MAE: ${lasso.trainMAE.toFixed(5)}`);
  log.push(`  R²: ${lasso.r2.toFixed(4)}`);
  log.push(`  معاملات نشطة: ${lasso.activeFeatures}/${featureNames.length}`);
  log.push(`  مصفّرة: ${lasso.zeroedCoefficients ?? 0}`);

  log.push('\n[Predictions] حساب على بيانات التدريب...');
  const predictions: TrainingArtifact['predictions'] = [];

  for (let i = 0; i < X.length; i++) {
    // التقييم هنا يستخدم predictRidge/predictLasso (فضاء النموذج الطبيعي)
    // عمداً، لا المعاملات الخام أدناه — النتيجتان متطابقتان رياضياً
    // (تحقّقت: فرق ≤ 2e-18)، لكن هذا يبقي التقييم مستقلاً عن تحويل
    // toRawSpace فلا يُخفي عنه أي خطأ لو انزاح لاحقاً.
    let sum = 0;
    let count = 0;
    try {
      sum += predictRidge(ridge, X[i]);
      count++;
    } catch {}
    try {
      sum += predictLasso(lasso, X[i]);
      count++;
    } catch {}
    if (count > 0) {
      predictions.push({
        asOf: corpus.samples[i].asOf,
        symbol: corpus.samples[i].symbol,
        predicted: sum / count,
        actual: y[i],
      });
    }
  }

  log.push(`  توقعات: ${predictions.length}`);

  // تحويل إلى فضاء الميزات الخام قبل الكتابة إلى الأرتيفاكت — إلزامي.
  // models.ts::linearModel() (وقت الاستدلال) يضرب المعاملات في الميزات
  // الخام مباشرة بلا أي تطبيع أو مركزة؛ TrainedLinearModel/ModelCoefficients
  // لا يحملان standardizer أصلاً. لولا هذا التحويل لأنتج n5_ridge/n6_lasso
  // بعد أول تدريب حقيقي إشارات أكبر بمئات المرات من الصحيح، وأحياناً بعكس
  // الاتجاه — أسوأ من البقاء بـconfidence=0 (انظر توثيق toRawSpace في
  // ridge.ts/lasso.ts للتحقق العددي الكامل).
  const ridgeRaw = ridgeToRaw(ridge);
  const lassoRaw = lassoToRaw(lasso);

  const artifact: TrainingArtifact = {
    version: '2.1.0',
    trainedAt: new Date().toISOString(),
    horizon: corpus.horizon,
    hmm: {
      params: hmmResult.params,
      logLikelihood: hmmResult.logLikelihood,
      iterations: hmmResult.iterations,
      converged: hmmResult.converged,
    },
    // featureNames على كل نموذج، لا على الأرتيفاكت وحده: params-loader.ts
    // يرفض أي ridge/lasso بلا featureNames خاصة به مطابقة لطول coefficients.
    ridge: {
      intercept: ridgeRaw.intercept,
      coefficients: ridgeRaw.coefficients,
      featureNames,
      trainRMSE: ridge.trainRMSE,
      trainMAE: ridge.trainMAE,
      r2: ridge.r2,
      activeFeatures: ridge.activeFeatures,
    },
    lasso: {
      intercept: lassoRaw.intercept,
      coefficients: lassoRaw.coefficients,
      featureNames,
      trainRMSE: lasso.trainRMSE,
      trainMAE: lasso.trainMAE,
      r2: lasso.r2,
      activeFeatures: lasso.activeFeatures,
      zeroedCoefficients: lasso.zeroedCoefficients,
    },
    featureNames,
    predictions,
  };

  const durationMs = Date.now() - started;
  log.push(`\nالمدة: ${(durationMs / 1000).toFixed(2)} ثانية`);

  return { artifact, report: log.join('\n') };
}
