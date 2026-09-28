/** Batch adapter over the production forecast evaluator and existing backtest_runs. */
import {configuredReader} from '../source-status';
import {readSettings} from '../site-settings';
import {fetchCompany,validSymbol,type MarketReport} from '../market-data';
import {evaluateForecast} from '../forecast-journal';
import {EVALUATION_POLICY} from '../forecast-metrics';
import {HORIZONS} from '../research-model';
import {DEFAULT_COSTS,BacktestInputError,type BacktestConfig,type BacktestRunResult,type CostModel,type HorizonResult,type Observation} from './types';

export function backtestDate(value:unknown):string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new BacktestInputError('تاريخ غير صالح؛ استخدم YYYY-MM-DD.');
  return value;
}
export function parseBacktestConfig(value:unknown):BacktestConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BacktestInputError('إعداد الاختبار غير صالح.');
  const b=value as Record<string,unknown>,allowed=['runId','symbols','startDate','endDate','horizons','costs','minSessions','model'];
  if (Object.keys(b).some(k=>!allowed.includes(k))) throw new BacktestInputError('حقل غير معروف في إعداد الاختبار.');
  const startDate=backtestDate(b.startDate),endDate=backtestDate(b.endDate);
  if (startDate>endDate || endDate>=new Date().toISOString().slice(0,10) || Date.parse(endDate)-Date.parse(startDate)>5*366*864e5) throw new BacktestInputError('اختر فترة مكتملة لا تتجاوز خمس سنوات.');
  if (!Array.isArray(b.symbols) || !b.symbols.length || b.symbols.length>3 || b.symbols.some(s=>typeof s!=='string'||s!==s.trim().toUpperCase()||!validSymbol(s)||!(/^[A-Z][A-Z0-9-]*$/.test(s)||/^\d{4}\.SR$/.test(s))) || new Set(b.symbols).size!==b.symbols.length) throw new BacktestInputError('اختر 1–3 رموز أمريكية أو سعودية صحيحة وغير مكررة.');
  const horizons=b.horizons ?? [5,21,63,126,252];
  if (!Array.isArray(horizons)||!horizons.length||horizons.length>6||horizons.some(h=>!HORIZONS.some(v=>v.sessions===h))||new Set(horizons).size!==horizons.length) throw new BacktestInputError('آفاق غير صالحة أو مكررة.');
  const runId=b.runId ?? crypto.randomUUID();
  if (typeof runId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(runId)) throw new BacktestInputError('runId غير صالح.');
  const c=b.costs ?? DEFAULT_COSTS;
  if (!c||typeof c!=='object'||Array.isArray(c)) throw new BacktestInputError('نموذج تكاليف غير صالح.');
  const costs=c as CostModel;
  if (Object.keys(c).some(k=>!['commissionBps','slippageBps','doubleSided'].includes(k))||[costs.commissionBps,costs.slippageBps].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1000)||typeof costs.doubleSided!=='boolean') throw new BacktestInputError('الرسوم والانزلاق بين 0 و1000 نقطة أساس؛ doubleSided قيمة منطقية.');
  const minSessions=b.minSessions ?? 200;
  if (typeof minSessions!=='number'||!Number.isInteger(minSessions)||minSessions<2||minSessions>1500) throw new BacktestInputError('minSessions عدد صحيح بين 2 و1500.');
  if (b.model!==undefined&&(typeof b.model!=='string'||!b.model.length||b.model.length>120)) throw new BacktestInputError('إصدار النموذج غير صالح.');
  return {runId,symbols:[...b.symbols],startDate,endDate,horizons:[...horizons].sort((a,b)=>a-b),costs:{commissionBps:costs.commissionBps,slippageBps:costs.slippageBps,doubleSided:costs.doubleSided},minSessions,...(b.model?{model:b.model as string}:{})};
}
function stats(values:number[]) {
  if (!values.length) return {mean:null,std:null,sharpe:null};
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const std=values.length>1?Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1)):null;
  return {mean,std,sharpe:std!==null&&std>0?mean/std:null};
}
function costReturn(from:number,to:number,c:CostModel):number|null {
  if (![from,to].every(v=>Number.isFinite(v)&&v>0)) return null;
  const entry=(1+c.commissionBps/10000)*(1+c.slippageBps/10000);
  const exit=c.doubleSided?(1-c.commissionBps/10000)*(1-c.slippageBps/10000):1;
  return to/from*exit/entry-1;
}
export function summarizeBacktest(rows:Observation[],horizons:number[]):HorizonResult[] {
  return horizons.map(horizon=>{
    const all=rows.filter(r=>r.horizon===horizon),complete=all.filter(r=>r.state==='complete');
    const directions=complete.filter(r=>r.directionCorrect!==null),ranges=complete.filter(r=>r.rangeHit!==null),points=complete.filter(r=>r.absoluteError!==null);
    const maeByCurrency:Record<string,{count:number;mae:number}>={};
    for (const currency of new Set(points.map(r=>r.currency))) { const selected=points.filter(r=>r.currency===currency);maeByCurrency[currency]={count:selected.length,mae:selected.reduce((s,r)=>s+r.absoluteError!,0)/selected.length}; }
    const returns=complete.flatMap(r=>r.netAssetReturn===null?[]:[r.netAssetReturn]),paired=complete.filter(r=>r.netAssetReturn!==null&&r.netBenchmarkReturn!==null);
    const a=stats(returns),b=stats(paired.map(r=>r.netBenchmarkReturn!)),relative=complete.flatMap(r=>r.relativeErrorPct===null?[]:[r.relativeErrorPct]);
    return {horizon,total:all.length,completed:complete.length,excluded:all.filter(r=>r.state==='excluded').length,pending:all.filter(r=>r.state==='pending').length,
      directionCount:directions.length,directionAccuracy:directions.length?directions.filter(r=>r.directionCorrect).length/directions.length:null,
      rangeCount:ranges.length,rangeHitRate:ranges.length?ranges.filter(r=>r.rangeHit).length/ranges.length:null,
      pointCount:points.length,maeByCurrency,meanRelativeErrorPct:relative.length?relative.reduce((a,b)=>a+b,0)/relative.length:null,
      returnCount:returns.length,meanReturn:a.mean,stdReturn:a.std,sharpe:a.sharpe,benchmarkCount:paired.length,benchmarkSharpe:b.sharpe,
      alpha:paired.length?paired.reduce((s,r)=>s+r.netAssetReturn!-r.netBenchmarkReturn!,0)/paired.length:null};
  });
}
function validSeries(report:MarketReport) {
  for (const prices of [report.prices,report.context?.market?.prices??[]]) {
    if (prices.some((p,i)=>!Number.isFinite(p.close)||p.close<=0||backtestDate(p.date)!==p.date||(i>0&&prices[i-1].date>=p.date))) throw Error('سلسلة الأسعار غير مرتبة أو مكررة أو غير صالحة.');
  }
}
export async function runBacktest(db:any,input:BacktestConfig):Promise<BacktestRunResult> {
  const config=parseBacktestConfig(input),key=JSON.stringify(config),kind='mizan-issued-forecast-audit-v1';
  const existing=await db.prepare('SELECT data FROM backtest_runs WHERE id=?').bind(config.runId).first();
  if (existing) { const saved=JSON.parse(existing.data);if(saved.kind!==kind||JSON.stringify(saved.config)!==key)throw new BacktestInputError('runId مستخدم لإعداد مختلف؛ اختر معرفًا جديدًا.');return {...saved,reused:true}; }
  const startedAt=new Date().toISOString(),settings=await readSettings(db);
  for (const symbol of config.symbols) if (!settings.enabledMarkets.includes(symbol.endsWith('.SR')?'sa':'us')) throw new BacktestInputError('سوق الرمز متوقف من إعدادات ميزان.');
  const read=await configuredReader(db,settings),observations:Observation[]=[],symbols:BacktestRunResult['symbols']=[],symbolsFailed:BacktestRunResult['symbolsFailed']=[];
  const asOf=new Date(Date.parse(config.endDate)+864e5).toISOString().slice(0,10);
  for (const symbol of config.symbols) {
    const attemptStart=read.sourceAttempts?.length??0;
    const detail:BacktestRunResult['symbols'][number]={symbol,recordsScanned:0,currency:null,source:null,benchmark:null,checks:[],attempts:[],trace:null};symbols.push(detail);
    try {
      // Full production report, source policy, identity checks and market calendar.
      const report=await fetchCompany(symbol,read,true,asOf);validSeries(report);
      detail.currency=report.currency;detail.source=report.priceSource;detail.benchmark=report.context?.market?.symbol??null;detail.checks=report.checks;detail.trace=report.sourceLayer??null;
      if (report.currency!==(symbol.endsWith('.SR')?'SAR':'USD')) throw Error('عملة السلسلة لا تطابق هوية السوق.');
      if (report.prices.length<config.minSessions) throw Error(`جلسات المصدر أقل من الحد: ${report.prices.length}/${config.minSessions}.`);
      const modelClause=config.model?' AND model=?':'',args=[symbol,config.startDate+'T00:00:00',asOf+'T00:00:00',...(config.model?[config.model]:[])];
      const count=await db.prepare('SELECT COUNT(*) AS n FROM forecast_records WHERE symbol=? AND created_at>=? AND created_at<?'+modelClause).bind(...args).first();
      if (Number(count.n)>500) throw Error('أكثر من 500 سجل للرمز؛ قسّم فترة الاختبار.');
      const symbolRows:Observation[]=[],ends=new Map<string,string>();
      for (let offset=0;offset<Number(count.n);offset+=50) {
        const page=await db.prepare('SELECT id,symbol,model,horizon,available,created_at,CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data ELSE NULL END AS data FROM forecast_records WHERE symbol=? AND created_at>=? AND created_at<?'+modelClause+' ORDER BY created_at,id LIMIT 50 OFFSET ?').bind(...args,offset).all();
        for (const row of page.results??[]) {
          detail.recordsScanned++;if (!config.horizons.includes(row.horizon)) continue;
          const item:Observation={id:row.id,symbol,model:row.model,horizon:row.horizon,currency:report.currency,state:'excluded',reason:null,anchorDate:null,actualDate:null,directionCorrect:null,rangeHit:null,absoluteError:null,relativeErrorPct:null,netAssetReturn:null,netBenchmarkReturn:null};symbolRows.push(item);
          let f:any;try {f=JSON.parse(row.data);}catch {f=null;}
          if (!f||typeof f!=='object'||Array.isArray(f)) {item.reason='سجل تالف أو أكبر من حد القراءة.';continue;}
          if (!row.available) {item.reason='لم يصدر توقع متاح.';continue;}
          if (f.recordClass!=='prospective-public'||f.evaluationPolicy!==EVALUATION_POLICY) {item.reason='لا تتوفر صفة إصدار استباقي عام وسياسة قياس موثقة.';continue;}
          try {item.anchorDate=backtestDate(f.anchorDate);}catch {item.reason='تاريخ مرجعي غير صالح.';continue;}
          const issued=Date.parse(row.created_at),anchor=Date.parse(item.anchorDate+'T00:00:00Z');
          // Weekend issuance is valid until the first following market session.
          const nextSession=report.context?.market?.prices.find(p=>p.date>item.anchorDate!)?.date??asOf;
          if (!Number.isFinite(issued)||issued<anchor||issued>=Date.parse(nextSession+'T00:00:00Z')||f.createdAt!==row.created_at||f.model!==row.model||f.currency!==report.currency) {item.reason='وقت الإصدار أو النموذج أو العملة غير متطابق مع الأصل.';continue;}
          if (typeof f.price!=='number'||!Number.isFinite(f.price)||f.price<=0||!Array.isArray(f.range)||f.range.length!==2||!f.range.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0)||f.range[0]>f.range[1]) {item.reason='سعر أو نطاق أصلي غير صالح.';continue;}
          if (item.anchorDate<config.startDate||item.anchorDate>config.endDate) {item.reason='التاريخ المرجعي خارج النافذة.';continue;}
          const outcome=evaluateForecast(row,report);
          if (!outcome) {item.state='pending';item.reason='لم تكتمل بيانات النهاية ومرجع جلساتها داخل النافذة، أو السجل غير مؤهل للقياس.';continue;}
          if (outcome.state!=='complete') {item.reason=outcome.reason??'استبعده مقيّم ميزان.';continue;}
          item.actualDate=outcome.actualDate!;
          if (item.actualDate>config.endDate) {item.state='pending';item.reason='النهاية بعد حد النافذة.';continue;}
          const group=row.model+'|'+row.horizon;
          if (item.anchorDate<=(ends.get(group)??'')) {item.reason='نافذة متداخلة مع توقع أسبق للرمز والنموذج والأفق.';continue;}
          ends.set(group,item.actualDate);item.state='complete';item.directionCorrect=outcome.directionCorrect??null;item.rangeHit=outcome.rangeHit??null;
          item.absoluteError=outcome.metrics?.absoluteError??null;item.relativeErrorPct=outcome.metrics?.relativeErrorPct??null;
          const start=report.prices.find(p=>p.date===item.anchorDate),finish=report.prices.find(p=>p.date===item.actualDate);
          if (start&&finish) item.netAssetReturn=costReturn(start.close,finish.close,config.costs);
          const benchmark=report.context?.market;
          const b0=benchmark?.prices.find(p=>p.date===item.anchorDate),b1=benchmark?.prices.find(p=>p.date===item.actualDate);
          // Apply the same commission/slippage model to the benchmark. This is conservative and may slightly understate reported alpha.
          if (b0&&b1) item.netBenchmarkReturn=costReturn(b0.close,b1.close,config.costs);
        }
      }
      observations.push(...symbolRows);
    } catch (error) {symbolsFailed.push({symbol,reason:error instanceof Error&&/[\u0600-\u06ff]/.test(error.message)?error.message.slice(0,240):'فشل جلب البيانات أو قراءة السجل.'});}
    finally {detail.attempts=read.sourceAttempts?.slice(attemptStart)??[];}
  }
  const result:BacktestRunResult={kind,runId:config.runId,startedAt,completedAt:new Date().toISOString(),config,
    byHorizon:summarizeBacktest(observations,config.horizons),observations,symbols,symbolsFailed,symbolsSucceeded:config.symbols.length-symbolsFailed.length,persisted:true,reused:false,
    limitations:[
      'تقييم للتوقعات المحفوظة قبل نتائجها باستخدام مقيّم ميزان الحالي؛ لا يولد توقعات تاريخية ولا يدرب نموذجًا جديدًا.',
      'العوائد وصف لشراء الأصل من إغلاق يوم الإصدار بعد تكاليف افتراضية؛ ليست ربح توصية أو استراتيجية اتجاهية منفذة.',
      'Sharpe نسبة متوسط العوائد إلى انحرافها العيني، غير سنوية؛ التجميع ليس محفظة أو دليل استقلال بين الأسهم.',
      'alpha متوسط فرق العائد للأزواج ذات تاريخي بداية ونهاية متطابقين؛ ليس Jensen alpha أو عائدًا كليًا مع التوزيعات.',
      'MAE مفصول بحسب العملة؛ مقامات الاتجاه والنطاق والسعر مستقلة. النوافذ المتداخلة للسهم والنموذج والأفق تستبعد.',
      'الأسعار الحالية قد يعيد المزود تعديلها؛ حارس أساس السلسلة والتجزئة في المقيّم قائم. بيانات Yahoo المالية غير المؤرخة لا تدخل القياس.',
      'وجود سجل مصنف استباقيًا لا يعادل أرشيف PIT خارجيًا غير قابل للتعديل. لا يُعتمد الاختبار وحده لإثبات دقة ميزان.',
      'لا يكتب هذا المسار في forecast_records أو forecast_outcomes أو research_state؛ يحفظ تقريره في backtest_runs القائم.'
    ]};
  const data=JSON.stringify(result);if(new TextEncoder().encode(data).byteLength>1000000)throw Error('تقرير الاختبار أكبر من الحد؛ قسّم الفترة.');
  // One atomic, immutable insert. A retry returns the original report; no swallowed writes.
  await db.prepare('INSERT INTO backtest_runs(id,symbol,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(config.runId,config.symbols.length===1?config.symbols[0]:'*',result.completedAt,data).run();
  const stored=await db.prepare('SELECT data FROM backtest_runs WHERE id=?').bind(config.runId).first();
  if (!stored) throw Error('تعذر التأكد من حفظ تقرير الاختبار.');
  const saved=JSON.parse(stored.data);if(saved.kind!==kind||JSON.stringify(saved.config)!==key)throw new BacktestInputError('تعارض runId مع تقرير آخر.');
  return {...saved,reused:stored.data!==data};
}
export {runChampionshipBacktest,parseChampionshipRequest} from './championship';
export type {ChampionshipBacktestResult} from './championship';
