'use strict';
// Research-only helpers. Reuse the project's existing units and quantiles.
const F = require('./fcst-lib.cjs');
const finite = Number.isFinite;
function date(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      !finite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s) throw Error('Invalid ISO date');
  return s;
}
function validRow(r) {
  if (!r || typeof r.sym !== 'string' || !r.sym || !['sa','us'].includes(r.market) ||
      !F.HORIZONS.includes(r.h) || !finite(r.y) || !finite(r.sig) || r.sig <= 0) throw Error('Invalid replay record');
  date(r.date); date(r.labelDate);
  if (r.labelDate <= r.date) throw Error('Label must follow origin');
  return r;
}
// Label is usable only strictly before the forecast origin (conservative date-only convention).
function calibrationWindow(records, {asOf, market, h, cutoff = F.DEV_CUTOFF}) {
  date(asOf); date(cutoff);
  if (asOf > cutoff || !['sa','us'].includes(market) || !F.HORIZONS.includes(h)) throw Error('Invalid scope / sealed boundary');
  const seen = new Set();
  return records.map(validRow).filter(r => {
    const key = JSON.stringify([r.sym,r.h,r.date]);
    if (seen.has(key)) throw Error('Duplicate origin');
    seen.add(key);
    return r.market === market && r.h === h && r.date < asOf && r.labelDate < asOf && r.labelDate <= cutoff;
  });
}
// F1 zero-centre prototype only: no F3 model, no approval, no coverage guarantee.
function empiricalZeroCentre(records, scope, {minRows, minDates, alpha}) {
  if (!Number.isInteger(minRows) || minRows < 1 || !Number.isInteger(minDates) || minDates < 1 ||
      !finite(alpha) || alpha <= 0 || alpha >= 1) throw Error('Explicit calibration policy required');
  const rows = calibrationWindow(records, scope);
  const dates = new Set(rows.map(r => r.date)).size;
  if (rows.length < minRows || dates < minDates) return {status:'INSUFFICIENT_CALIBRATION', nRows:rows.length, nDates:dates};
  const z = rows.map(r => r.y / F.scale(r.sig,r.h));
  return {status:'RESEARCH_ONLY', centre:0, qLo:F.quantile(z,alpha/2), qHi:F.quantile(z,1-alpha/2),
    alpha, nRows:rows.length, nDates:dates, effectiveN:null,
    note:'Pooled empirical quantiles; date count is not effective sample size; no conformal guarantee.'};
}
// Use a common reference scale for both models; never normalise by each candidate's own wider scale.
function scoreInterval({y,lo,hi,sig,h,alpha}) {
  if (![y,lo,hi,sig,alpha].every(finite) || sig <= 0 || lo > hi ||
      !F.HORIZONS.includes(h) || alpha <= 0 || alpha >= 1) throw Error('Invalid interval');
  return {covered:y >= lo && y <= hi, width:(hi-lo)/F.scale(sig,h),
    winkler:F.intervalScore(y,lo,hi,sig,h,alpha)};
}
function powerGate({sigmaD, effectiveN, referenceLoss, targetRelative, multiplier}) {
  if (![sigmaD,effectiveN,referenceLoss,targetRelative,multiplier].every(finite) ||
      sigmaD < 0 || effectiveN <= 0 || referenceLoss <= 0 || targetRelative <= 0 || multiplier <= 0) return {status:'UNKNOWN',mdeRelative:null};
  // multiplier must be justified for alpha, power and multiplicity in the approved design.
  const mdeRelative = multiplier*sigmaD/(Math.sqrt(effectiveN)*referenceLoss);
  return {status:mdeRelative <= targetRelative ? 'POWER_SCREEN_PASSED' : 'UNDERPOWERED',mdeRelative,
    note:'Planning approximation only; not a model acceptance decision.'};
}
function pairedDateLoss(records) {
  const seen = new Set();
  for (const r of records) {
    date(r.date);
    if (typeof r.sym !== 'string' || !r.sym || ![r.candidate,r.reference].every(finite)) throw Error('Invalid pair');
    const key = JSON.stringify([r.sym,r.date]);
    if (seen.has(key)) throw Error('Duplicate pair');
    seen.add(key);
  }
  const out = F.perDateMeans(records, r => r.candidate-r.reference);
  return {...out, nRecords:records.length, nDates:out.dates.length,
    meanDifference:out.values.length ? out.values.reduce((a,b)=>a+b,0)/out.values.length : null};
}
module.exports = {calibrationWindow,empiricalZeroCentre,scoreInterval,powerGate,pairedDateLoss};
