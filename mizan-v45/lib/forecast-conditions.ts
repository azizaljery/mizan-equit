import {finite, ageDays} from './analysis';
import type {Fact, MarketReport} from './market-data';
import {RegimeEngine, type RegimeState} from './regime-engine';
import {resolveFinancialSources} from './source-resolution';

export interface ForecastConditions {
  version: 'fcf-regime-volume-1';
  calibrated: false;
  pricesValid: boolean;
  regime: RegimeState;
  relativeVolume: number | null;
  cashFlow: {
    freeCashFlow: number | null;
    yieldPercent: number | null;
    marketCap: number | null;
    periodEnd: string | null;
    qualitySignal: number | null;
    sources: {key: string; source: string; date: string; publishedAt: string}[];
    reason: string;
  };
  notes: string[];
}

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date+'T00:00:00Z'))
  && new Date(date+'T00:00:00Z').toISOString().slice(0,10) === date;
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const validPublication = (date: string) => validDate(date.slice(0,10))
  && /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date)
  && Number.isFinite(Date.parse(date));

/** Evidence at the report's cutoff. No market-cap, CapEx, Brier or win-rate defaults. */
export function forecastConditions(report: MarketReport, now = Date.now()): ForecastConditions {
  const cutoff = Math.min(Date.parse(report.asOf+'T23:59:59.999Z'), now);
  const pricesValid = validDate(report.asOf) && Number.isFinite(cutoff) && report.prices.every((p,i) =>
    finite(p.close) && p.close > 0 && validDate(p.date) && p.date <= report.asOf
    && Date.parse(p.date+'T00:00:00Z') <= cutoff && (!i || report.prices[i-1].date < p.date));
  const closes = pricesValid ? report.prices.map(p=>p.close) : [];
  const regime = closes.length >= 60 ? RegimeEngine.detect(closes) : {
    ...RegimeEngine.detect([]), reason: 'لم تتوفر 60 جلسة صالحة لتطبيق شروط حالة السوق.'
  };
  const volumes = pricesValid ? report.prices.slice(-21).map(p=>p.volume) : [];
  const validVolumes = volumes.length===21 && volumes.every(v=>finite(v)&&v>=0);
  const average = validVolumes ? volumes.slice(0,20).reduce((s,v)=>s+v/20,0) : 0;
  const volumeRatio = average>0 ? volumes[20]/average : null;
  const relativeVolume = finite(volumeRatio) ? volumeRatio : null;

  // Source resolution retains authority/unit/conflict rules. Unknown publication time
  // cannot supply a new financial influence, even if other report factors remain usable.
  const facts = resolveFinancialSources(report).facts.filter(f => {
    if (!f.publishedAt || !validPublication(f.publishedAt) || !f.source.startsWith('https://')) return false;
    const published = Date.parse(f.publishedAt);
    return finite(published) && published>=Date.parse(f.date+'T00:00:00Z') && published<=cutoff;
  });
  const annual = facts.filter(f=>f.period==='annual' && f.currency===report.currency
    && ageDays(report.asOf,f.date)<=550);
  const periodEnd = annual.filter(f=>['operatingCashFlow','freeCashFlow'].includes(f.key))
    .map(f=>f.date).sort().at(-1) ?? null;
  const get = (key:string) => annual.find(f=>f.key===key&&f.date===periodEnd);
  const cfo=get('operatingCashFlow'), capex=get('capex'), direct=get('freeCashFlow');
  const computed = cfo && capex ? cfo.value-Math.abs(capex.value) : null;
  const conflict = finite(computed) && direct && Math.abs(computed-direct.value)>Math.max(1,Math.abs(computed)*.005);
  const candidateFcf = conflict ? null : computed ?? direct?.value ?? null;
  const freeCashFlow = finite(candidateFcf) ? candidateFcf : null;
  // Quality of cash retained after investment, not an expected equity return.
  const qualitySignal = freeCashFlow!==null && cfo && cfo.value>0 ? clamp(freeCashFlow/cfo.value) : null;
  const shareFacts = facts.filter(f=>f.key==='shares'&&f.period!=='trailing'&&f.value>0
    && ageDays(report.asOf,f.date)<=210).sort((a,b)=>b.date.localeCompare(a.date));
  const shares = shareFacts[0];
  const splitAfterShares = shares && report.corporateActions?.some(c=>c.kind==='split'&&c.date>shares.date&&c.date<=report.asOf);
  const close = closes.at(-1);
  const rawCap = shares && !splitAfterShares && close ? shares.value*close : null;
  const marketCap = finite(rawCap) && rawCap>0 ? rawCap : null;
  const rawYield = freeCashFlow!==null && marketCap!==null ? freeCashFlow/marketCap*100 : null;
  const yieldPercent = finite(rawYield) ? rawYield : null;
  const used: Fact[] = freeCashFlow===null ? [] : computed!==null ? [cfo!,capex!] : [direct!];
  if(yieldPercent!==null && shares)used.push(shares);
  const reason = conflict ? 'استُبعد التدفق الحر: اختلاف بين المبلغ المباشر والناتج من التدفق التشغيلي والإنفاق لنفس الفترة.'
    : freeCashFlow===null ? 'التدفق الحر غير متحقق؛ يلزم مبلغ مباشر أو تدفق تشغيلي وإنفاق رأسمالي لنفس السنة والعملة، بمصدر وتاريخ نشر معروفين.'
    : yieldPercent===null ? 'التدفق الحر متاح؛ عائده غير مقدّر لغياب عدد أسهم حديث صالح لبناء قيمة سوقية موثقة.'
    : 'عائد التدفق الحر نسبة وصفية من آخر سنة مالية؛ ليس عائد السهم المتوقع أو تكلفة رأس المال.';
  const notes = [
    regime.available ? 'حالة السوق وصفية؛ ليست احتمالًا معايرًا أو دليلًا قاطعًا على الانكسار الهيكلي.' : regime.reason,
    relativeVolume===null ? 'الحجم النسبي غير متحقق؛ يلزم حجم الجلسة و20 جلسة سابقة صالحة.'
      : `الحجم النسبي ${relativeVolume.toFixed(2)}× مقارنة بمتوسط 20 جلسة سابقة.`,
    reason,
    'لا تُستنتج احتمالات صعود أو درجة ثقة رقمية من نسبة فوز أو Brier افتراضيين.'
  ];
  return {version:'fcf-regime-volume-1',calibrated:false,pricesValid,regime,relativeVolume,
    cashFlow:{freeCashFlow,yieldPercent,marketCap,periodEnd,qualitySignal,
      sources:used.map(f=>({key:f.key,source:f.source,date:f.date,publishedAt:f.publishedAt!})),reason},notes};
}

/** Requested abstention/low-volume policy, applied inside the existing six-horizon model. */
export function horizonCondition(conditions: ForecastConditions, sessions: number) {
  const shock = conditions.regime.available && (conditions.regime.currentRegime==='VOLATILITY_SHOCK'
    || conditions.regime.structuralBreakDetected);
  return {
    abstain: shock && sessions<=21,
    abstainReason: shock && sessions<=21 ? 'امتناع مشروط: رُصد نمط صدمة في التذبذب؛ لا يصدر نطاق قصير المدى حتى مراجعة الحالة.' : null,
    positiveTiltMultiplier: conditions.relativeVolume!==null && conditions.relativeVolume<1.1 ? .6 : 1,
    shock,
  };
}
