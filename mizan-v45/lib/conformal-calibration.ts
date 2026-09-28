/**
 * Experimental conformal-style range calibration for the existing forecast model.
 *
 * This layer never creates a direction, point forecast, or trading signal. It only
 * checks whether the existing historical range is too narrow and widens it from
 * past horizon returns when a minimum calibration sample exists. Because market
 * returns are dependent and overlapping, the result is empirical calibration,
 * not a formal future-coverage guarantee.
 */
import type { Price } from './analysis';

/** Remains off until empirical coverage is reviewed on Saudi and US holdout data. */
export const CONFORMAL_RANGE_CALIBRATION_ENABLED = false;

export type RangeCalibration = {
  status: 'calibrated' | 'insufficient' | 'invalid';
  range: [number, number] | null;
  sample: number;
  targetCoverage: number;
  empiricalCoverage: number | null;
  quantileLogError: number | null;
  reason: string | null;
};

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function calibrateForecastRange(input: {
  prices: Pick<Price, 'close'>[];
  sessions: number;
  center: number;
  range: [number, number];
  targetCoverage?: number;
  minCalibrationSamples?: number;
}): RangeCalibration {
  const targetCoverage = input.targetCoverage ?? 0.9;
  const minimum = input.minCalibrationSamples ?? 60;
  const { prices, sessions, center, range } = input;
  if (!Number.isInteger(sessions) || sessions < 1 || !finitePositive(center)
    || !Array.isArray(range) || range.length !== 2 || !range.every(finitePositive) || range[0] > range[1]
    || !(targetCoverage > 0 && targetCoverage < 1)) {
    return { status: 'invalid', range: null, sample: 0, targetCoverage, empiricalCoverage: null, quantileLogError: null, reason: 'مدخلات معايرة النطاق غير صالحة.' };
  }

  const closes = prices.map(p => p.close).filter(finitePositive);
  const returns: number[] = [];
  for (let i = sessions; i < closes.length; i++) {
    const value = Math.log(closes[i] / closes[i - sessions]);
    if (Number.isFinite(value)) returns.push(value);
  }
  if (returns.length < minimum) {
    return { status: 'insufficient', range: [range[0], range[1]], sample: returns.length, targetCoverage, empiricalCoverage: null, quantileLogError: null, reason: `عينة المعايرة غير كافية (${returns.length}/${minimum}).` };
  }

  const centerReturn = quantile(returns, 0.5);
  if (centerReturn === null) {
    return { status: 'invalid', range: null, sample: returns.length, targetCoverage, empiricalCoverage: null, quantileLogError: null, reason: 'تعذر حساب مركز عوائد المعايرة.' };
  }
  const errors = returns.map(value => Math.abs(value - centerReturn));
  const q = quantile(errors, targetCoverage);
  if (q === null || !Number.isFinite(q)) {
    return { status: 'invalid', range: null, sample: returns.length, targetCoverage, empiricalCoverage: null, quantileLogError: null, reason: 'تعذر حساب مئين خطأ المعايرة.' };
  }

  const empiricalCoverage = errors.filter(value => value <= q).length / errors.length;
  const baseLow = Math.max(0, Math.log(center / range[0]));
  const baseHigh = Math.max(0, Math.log(range[1] / center));
  const low = center * Math.exp(-Math.max(baseLow, q));
  const high = center * Math.exp(Math.max(baseHigh, q));
  if (!finitePositive(low) || !finitePositive(high) || low > high) {
    return { status: 'invalid', range: null, sample: returns.length, targetCoverage, empiricalCoverage, quantileLogError: q, reason: 'نتيجة المعايرة خرجت عن نطاق سعري صالح.' };
  }
  return {
    status: 'calibrated',
    range: [Number(low.toFixed(2)), Number(high.toFixed(2))],
    sample: returns.length,
    targetCoverage,
    empiricalCoverage,
    quantileLogError: q,
    reason: 'نطاق تجريبي موسع من خطأ عوائد تاريخية؛ لا يمثل احتمال تحقق مستقبليًا.',
  };
}
