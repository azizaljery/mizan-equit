import {EVALUATION_POLICY} from './forecast-metrics';

/**
 * A prospective shadow interval around the existing point forecast.
 * No new direction model, trade gate, Gaussian quantile or promised coverage.
 * Prices and the volatility scale are the values saved at forecast issuance.
 */
export const CONFORMAL_POLICY = 'mizan-conformal-end-price-v1';
export const CONFORMAL_TARGET = .90;
export const CONFORMAL_MIN_SAMPLE = 30;
const MAX_SAMPLE = 250;
const QUERY_PER_HORIZON = 500;
const positive = (v:unknown):v is number => typeof v==='number'&&Number.isFinite(v)&&v>0;
const object = (v:any):any => {
  try { const x=typeof v==='string'?JSON.parse(v):v;return x&&typeof x==='object'&&!Array.isArray(x)?x:null; }
  catch { return null; }
};
const date = (v:unknown):v is string => typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const instant = (v:unknown):v is string => typeof v==='string'&&date(v.slice(0,10))&&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v));
const interval = (v:any):v is [number,number] => Array.isArray(v)&&v.length===2&&positive(v[0])&&positive(v[1])&&v[0]<=v[1];

export type ConformalContext = {
  symbol:string;market:string;currency:string;model:string;horizon:number;asOf:string;
  recordClass:string;adjustment:string|null;
};
export type RangeComparison = {
  policy:string;targetCoverage:number;candidateHit:boolean;baselineHit:boolean;
  candidateWidthPct:number;baselineWidthPct:number;candidateIntervalScorePct:number;baselineIntervalScorePct:number;
};
type ObservedComparison = {
  sample:number;candidateCoveragePct:number|null;baselineCoveragePct:number|null;
  candidateMeanWidthPct:number|null;baselineMeanWidthPct:number|null;
  candidateMeanIntervalScorePct:number|null;baselineMeanIntervalScorePct:number|null;
};
export type ConformalResult = {
  policy:string;mode:'shadow';status:'collecting'|'shadow'|'unavailable';reason:string;
  targetCoverage:number;guaranteedCoverage:false;sample:number;minimumSample:number;
  scope:'same-symbol-market-currency-model-horizon';scaleDefinition:'reference-price-times-saved-log-volatility';
  scale:number|null;quantile:number|null;rank:number|null;range:[number,number]|null;
  baselineRange:[number,number]|null;widthPct:number|null;calibratedAt:string;
  calibrationIds:string[];calibrationThrough:string|null;historyTruncated:boolean;
  observed:ObservedComparison;
};

/** Exact finite-sample rank, with no interpolation or clamp to the last score. */
export function conformalQuantile(scores:readonly number[],target=CONFORMAL_TARGET) {
  if(!Number.isFinite(target)||target<=0||target>=1||scores.some(s=>!Number.isFinite(s)||s<0))return null;
  const rank=Math.ceil((scores.length+1)*target);
  if(!scores.length||rank>scores.length)return null;
  return {rank,value:[...scores].sort((a,b)=>a-b)[rank-1]};
}

/** First-order conversion of the canonical horizon log-return scale into price units. */
export function savedPriceScale(forecast:any):number|null {
  const sigma=forecast?.rangeCheck?.horizonVolatility;
  if(!positive(forecast?.price)||!positive(sigma))return null;
  const scale=forecast.price*sigma/100;
  return positive(scale)?scale:null;
}

function scoreInterval(bounds:[number,number],actual:number,reference:number,target:number) {
  const [lo,hi]=bounds;
  return 100*((hi-lo)+2/(1-target)*(Math.max(0,lo-actual)+Math.max(0,actual-hi)))/reference;
}

/** Evaluates only the interval originally saved, never today's recalibration. */
export function evaluateConformalRange(forecast:any,actual:number):RangeComparison|null {
  const c=forecast?.rangeCalibration;
  if(c?.policy!==CONFORMAL_POLICY||c.mode!=='shadow'||c.status!=='shadow'||
    c.targetCoverage!==CONFORMAL_TARGET||c.sample<CONFORMAL_MIN_SAMPLE||!instant(c.calibratedAt)||
    c.calibratedAt!==forecast.createdAt||!instant(c.calibrationThrough)||Date.parse(c.calibrationThrough)>=Date.parse(c.calibratedAt)||
    !interval(c.range)||!interval(forecast.range)||!positive(actual)||!positive(forecast.price))return null;
  const result={policy:CONFORMAL_POLICY,targetCoverage:CONFORMAL_TARGET,
    candidateHit:actual>=c.range[0]&&actual<=c.range[1],baselineHit:actual>=forecast.range[0]&&actual<=forecast.range[1],
    candidateWidthPct:100*(c.range[1]-c.range[0])/forecast.price,baselineWidthPct:100*(forecast.range[1]-forecast.range[0])/forecast.price,
    candidateIntervalScorePct:scoreInterval(c.range,actual,forecast.price,CONFORMAL_TARGET),
    baselineIntervalScorePct:scoreInterval(forecast.range,actual,forecast.price,CONFORMAL_TARGET)};
  return Object.values(result).some(v=>typeof v==='number'&&!Number.isFinite(v))?null:result;
}

function observed(rows:any[]):ObservedComparison {
  const pairs=rows.map(r=>evaluateConformalRange(r.forecast,r.outcome.actualPrice)).filter((r):r is RangeComparison=>r!==null);
  const mean=(key:'candidateWidthPct'|'baselineWidthPct'|'candidateIntervalScorePct'|'baselineIntervalScorePct')=>
    pairs.length?pairs.reduce((s,p)=>s+p[key],0)/pairs.length:null;
  return {sample:pairs.length,candidateCoveragePct:pairs.length?100*pairs.filter(p=>p.candidateHit).length/pairs.length:null,
    baselineCoveragePct:pairs.length?100*pairs.filter(p=>p.baselineHit).length/pairs.length:null,
    candidateMeanWidthPct:mean('candidateWidthPct'),baselineMeanWidthPct:mean('baselineWidthPct'),
    candidateMeanIntervalScorePct:mean('candidateIntervalScorePct'),baselineMeanIntervalScorePct:mean('baselineIntervalScorePct')};
}

/** Select only completed, known-at-cutoff observations with compatible saved units. */
function eligibleHistory(records:any[],ctx:ConformalContext) {
  if(!instant(ctx.asOf))return [];
  const cutoff=Date.parse(ctx.asOf),cutoffDate=ctx.asOf.slice(0,10),candidates:any[]=[];
  for(const r of records){
    const f=object(r.forecast??r.forecast_data),o=object(r.outcome??r.outcome_data);
    if(!f||!o||typeof r.id!=='string'||!r.id||r.symbol!==ctx.symbol||r.market!==ctx.market||
      r.model!==ctx.model||r.horizon!==ctx.horizon||![true,1].includes(r.available)||
      f.recordClass!=='prospective-public'||f.currency!==ctx.currency||f.model!==ctx.model||f.sessions!==ctx.horizon||
      f.evaluationPolicy!==EVALUATION_POLICY||o.evaluationPolicy!==EVALUATION_POLICY||f.rangeMeaning!=='end_close_estimate'||
      !instant(r.created_at)||!instant(r.evaluated_at)||!date(f.anchorDate)||!date(o.actualDate)||
      Date.parse(r.created_at)>=cutoff||Date.parse(r.evaluated_at)>=cutoff||Date.parse(r.evaluated_at)<Date.parse(r.created_at)||
      o.state!=='complete'||o.actualDate<=f.anchorDate||o.actualDate>=cutoffDate||
      r.created_at.slice(0,10)>o.actualDate||r.created_at.slice(0,10)<f.anchorDate||
      r.evaluated_at.slice(0,10)<=o.actualDate||f.seriesBasis?.adjustment!==ctx.adjustment||
      !positive(f.predictedPrice)||!positive(o.actualPrice)||!interval(f.range))continue;
    const scale=savedPriceScale(f);
    if(scale===null)continue;
    const score=Math.abs(o.actualPrice-f.predictedPrice)/scale;
    if(!Number.isFinite(score))continue;
    candidates.push({...r,forecast:f,outcome:o,score});
  }
  // Deterministic, oldest-first non-overlapping issue windows; repeated clicks cannot inflate n.
  candidates.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
  const seen=new Set<string>(),sample:any[]=[];let end='';
  for(const r of candidates){
    if(seen.has(r.id))continue;seen.add(r.id);
    if(r.forecast.anchorDate<=end)continue;
    sample.push(r);end=r.outcome.actualDate;
  }
  return sample.slice(-MAX_SAMPLE);
}

export function calibrateForecastRange(forecast:any,records:any[],ctx:ConformalContext,
  options:{historyTruncated?:boolean;readError?:boolean}={}):ConformalResult {
  const sample=eligibleHistory(records,ctx),scale=savedPriceScale(forecast);
  const result:ConformalResult={policy:CONFORMAL_POLICY,mode:'shadow',status:'collecting',
    reason:'تجميع نتائج مكتملة لمعايرة نطاق مستقل لهذه المدة؛ لا نسبة تحقق مفترضة.',
    targetCoverage:CONFORMAL_TARGET,guaranteedCoverage:false,sample:sample.length,minimumSample:CONFORMAL_MIN_SAMPLE,
    scope:'same-symbol-market-currency-model-horizon',scaleDefinition:'reference-price-times-saved-log-volatility',
    scale,quantile:null,rank:null,range:null,baselineRange:interval(forecast?.range)?[forecast.range[0],forecast.range[1]]:null,
    widthPct:null,calibratedAt:ctx.asOf,calibrationIds:sample.map(r=>r.id),
    calibrationThrough:sample.length?sample.reduce((a,r)=>a>r.evaluated_at?a:r.evaluated_at,''):null,
    historyTruncated:!!options.historyTruncated,observed:observed(sample)};
  const unavailable=(reason:string):ConformalResult=>({...result,status:'unavailable',reason});
  if(options.readError)return unavailable('تعذر قراءة سجل المعايرة؛ أعد المحاولة عند التحليل التالي.');
  if(!instant(ctx.asOf)||!ctx.symbol||!ctx.currency||!['sa','us'].includes(ctx.market)||
    ![1,5,21,63,126,252].includes(ctx.horizon)||ctx.recordClass!=='prospective-public'||
    !ctx.model.startsWith('mizan-scenarios-7-'))return unavailable('هذه اللقطة أو نسخة النموذج غير مؤهلة لمعايرة السجل الحي.');
  if(!forecast?.available||!positive(forecast.predictedPrice)||!interval(forecast.range)||scale===null||
    forecast.sessions!==ctx.horizon||forecast.evaluationPolicy!==EVALUATION_POLICY||forecast.rangeMeaning!=='end_close_estimate')
    return unavailable('لا يتوفر توقع مركزي أو مقياس تذبذب صالح لهذه المدة.');
  if(sample.length<CONFORMAL_MIN_SAMPLE)return result;
  const q=conformalQuantile(sample.map(r=>r.score));
  if(!q)return unavailable('العينة لا تسمح بمئين مطابق محدود؛ لم يُستخدم معامل بديل.');
  const halfWidth=q.value*scale,range:[number,number]=[forecast.predictedPrice-halfWidth,forecast.predictedPrice+halfWidth];
  // Do not silently clip negative prices or shrink a wide band: both change the calibrated set.
  if(!interval(range)||!Number.isFinite(halfWidth)||halfWidth<=0)return unavailable('النطاق المعاير غير صالح للأسعار؛ يلزم مراجعة الأخطاء والتذبذب دون قص الحدود.');
  const widthPct=100*(range[1]-range[0])/forecast.price;
  if(!Number.isFinite(widthPct))return unavailable('تعذر حساب عرض نطاق محدود.');
  return {...result,status:'shadow',reason:'نطاق تجريبي محفوظ للمقارنة؛ التغطية المستهدفة لا تضمن كل توقع أو حالة سوق.',
    quantile:q.value,rank:q.rank,range,widthPct};
}

/** Compact read from the existing journal; no new forecast tables or historical rewrites. */
export async function loadConformalHistory(db:any,symbol:string,market:string,model:string,asOf:string) {
  try {
    const result=await db.prepare(`WITH ranked AS (
      SELECT f.*,o.evaluated_at,o.data AS outcome_data,
        ROW_NUMBER() OVER (PARTITION BY f.horizon ORDER BY f.created_at DESC,f.id) AS rn
      FROM forecast_records f JOIN forecast_outcomes o ON o.id=f.id
      WHERE f.symbol=? AND f.market=? AND f.model=? AND f.available=1
        AND f.created_at<? AND o.evaluated_at<? AND json_valid(f.data) AND json_valid(o.data)
    ) SELECT id,symbol,horizon,market,model,available,created_at,evaluated_at,outcome_data,
      json_object('recordClass',json_extract(data,'$.recordClass'),'currency',json_extract(data,'$.currency'),
        'model',json_extract(data,'$.model'),'sessions',json_extract(data,'$.sessions'),
        'price',json_extract(data,'$.price'),'predictedPrice',json_extract(data,'$.predictedPrice'),
        'anchorDate',json_extract(data,'$.anchorDate'),'createdAt',json_extract(data,'$.createdAt'),'range',json_extract(data,'$.range'),
        'rangeCheck',json_extract(data,'$.rangeCheck'),'rangeMeaning',json_extract(data,'$.rangeMeaning'),
        'evaluationPolicy',json_extract(data,'$.evaluationPolicy'),'seriesBasis',json_extract(data,'$.seriesBasis'),
        'rangeCalibration',json_extract(data,'$.rangeCalibration')) AS forecast_data,
      rn FROM ranked WHERE rn<=? ORDER BY created_at,id`).bind(symbol,market,model,asOf,asOf,QUERY_PER_HORIZON+1).all();
    const rows=result.results||[];
    return {records:rows.filter((r:any)=>r.rn<=QUERY_PER_HORIZON),truncatedHorizons:new Set<number>(rows.filter((r:any)=>r.rn>QUERY_PER_HORIZON).map((r:any)=>r.horizon)),readError:false};
  } catch {
    return {records:[],truncatedHorizons:new Set<number>(),readError:true};
  }
}
