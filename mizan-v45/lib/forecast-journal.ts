import {DEFAULT_SETTINGS,type SiteSettings} from './site-settings';
import {forecasts,MODEL_VERSION} from './research-model';
import type {MarketReport} from './market-data';
import {DECISION_VERSION,decisionBaseline,compareDecisionBaselines,publicBaselineEligible} from './decision-room';
import {forecastMetrics,EVALUATION_POLICY} from './forecast-metrics';
import {fingerprint} from './evidence-ledger';
import {calibrateForecastRange,evaluateConformalRange,loadConformalHistory,type RangeComparison} from './forecast-conformal';
// Candidate filter only. Actual maturity is decided from market sessions below.
export const MATURITY_PREDICATE = 'julianday(?) - julianday(f.created_at) >= f.horizon * 7.0/5';
export function researchMarket(report:MarketReport){return report.company.symbol.endsWith('.SR')?'sa':/nasdaq|nyse|amex|arca|bats|^NMS$|^NGM$|^NCM$|^NYQ$|^PCX$|^ASE$|^BTS$/i.test(report.company.exchange)?'us':'other';}
export type Outcome={state:'complete'|'excluded';actualDate?:string;actualPrice?:number;actualDirection?:string|null;directionCorrect?:boolean|null;priceErrorPct?:number|null;rangeHit?:boolean|null;source:string;reason?:string;metrics?:ReturnType<typeof forecastMetrics>;evaluationPolicy?:string;rangeComparison?:RangeComparison|null};
export function evaluateForecast(record:any,report:MarketReport):Outcome|null{
 if(!record.available)return null;let data:any;try{data=typeof record.data==='string'?JSON.parse(record.data):record.data;}catch{return null;}if(!data||typeof data!=='object')return null;
 // A truncated/invalid old record must not invalidate other records of the symbol.
 if(!Number.isInteger(record.horizon)||record.horizon<1||typeof data.anchorDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.anchorDate)||!Number.isFinite(Date.parse(data.anchorDate+'T00:00:00Z'))||new Date(data.anchorDate+'T00:00:00Z').toISOString().slice(0,10)!==data.anchorDate||!report.prices.length||report.prices[0].date>data.anchorDate)return null;
 if(record.symbol&&record.symbol!==report.company.symbol)return {state:'excluded',source:report.priceSource,reason:'هوية بيانات النتيجة تختلف عن الأصل المحفوظ.'};
 if(data.currency&&data.currency!==report.currency)return {state:'excluded',source:report.priceSource,reason:'عملة النتيجة تختلف عن عملة التوقع.'};
 const basis=data.seriesBasis;if(basis?.anchorClose){const anchor=report.prices.find(p=>p.date===basis.anchorDate);if(!anchor)return null;if(basis.adjustment&&basis.adjustment!==report.priceAdjustment||Math.abs(anchor.close-basis.anchorClose)>Math.max(.000001,Math.abs(basis.anchorClose)*.0001))return {state:'excluded',source:report.priceSource,reason:'تغير أساس السلسلة أو سعرها التاريخي المرجعي؛ يلزم التحقق من تعديلات المزود قبل القياس.'};}
 const future=report.prices.filter(p=>p.date>data.anchorDate);
 const marketDates=report.context?.market?.prices.filter(p=>p.date>data.anchorDate).map(p=>p.date);
 if(data.evaluationPolicy===EVALUATION_POLICY&&(!marketDates||marketDates.length<record.horizon))return null;
 if(marketDates&&marketDates.length<record.horizon||!marketDates&&future.length<record.horizon)return null;
 const actual=marketDates?report.prices.find(p=>p.date===marketDates[record.horizon-1]):future[record.horizon-1];
 if(!actual||actual.date>=report.asOf)return null;
 const actions=report.corporateActions||[];if(actions.some(a=>a.kind==='split'&&a.date>data.anchorDate&&a.date<=actual.date))return {state:'excluded',source:report.priceSource,reason:'حدثت تجزئة/تجميع أسهم خلال الفترة؛ تُستبعد من النسبة حتى تُراجع وحدات السعر، مع إبقاء السجل.'};
 if(!data.price||!Array.isArray(data.range)||!data.range.every(Number.isFinite))return null;
 const metrics=forecastMetrics({reference:data.price,predicted:data.predictedPrice,actual:actual.close,range:data.range,direction:data.direction,neutralThresholdPct:data.neutralThresholdPct??1});
 const rangeComparison=evaluateConformalRange(data,actual.close);
 return {state:'complete',actualDate:actual.date,actualPrice:actual.close,actualDirection:metrics.actualDirection,directionCorrect:metrics.directionCorrect,priceErrorPct:metrics.relativeErrorPct,rangeHit:metrics.endRangeHit,source:report.priceSource,metrics,evaluationPolicy:EVALUATION_POLICY,...(rangeComparison?{rangeComparison}:{})};
}
export async function recordAnalysis(db:any,report:MarketReport,settings:SiteSettings=DEFAULT_SETTINGS,accountKey:string|null=null){
 const projection=forecasts(report,report.liveQuote||null,Date.now(),settings),createdAt=new Date().toISOString(),id=crypto.randomUUID();
 const market=researchMarket(report);
 const priorResult=await db.prepare("SELECT f.symbol,f.horizon,f.market,f.model,f.created_at,json_extract(f.data,'$.direction') AS forecast_direction,o.data FROM forecast_records f JOIN forecast_outcomes o ON o.id=f.id WHERE f.model=? AND f.market=? AND json_extract(f.data,'$.recordClass')='prospective-public' ORDER BY f.created_at DESC LIMIT 10000").bind(projection.version,market).all();
 const prior=(priorResult.results||[]).map((r:any)=>({...r,outcome:JSON.parse(r.data),forecastDirection:r.forecast_direction}));
 const rangeHistory=publicBaselineEligible(report)?await loadConformalHistory(db,report.company.symbol,market,projection.version,createdAt):{records:[],truncatedHorizons:new Set<number>(),readError:false};
 const baseline=publicBaselineEligible(report)?decisionBaseline({...report,forecast:projection},createdAt):null;
 if(baseline){
  try{
   const last=await db.prepare("SELECT data FROM analysis_snapshots WHERE symbol=? AND json_extract(data,'$.decisionBaseline.version')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(report.company.symbol,DECISION_VERSION).first();
   report.changes=last?compareDecisionBaselines(JSON.parse(last.data).decisionBaseline,baseline,report.corporateActions):{state:'first',reason:'هذا أول تحليل محفوظ يدعم المقارنة. ستظهر الفروق عند إعادة تحليل السهم.'};
  }catch{report.changes={state:'unavailable',reason:'تعذر قراءة التحليل السابق؛ التحليل الحالي مستمر دون مقارنة.'};}
 }else report.changes={state:'private',reason:'التحليل يتضمن ملفًا خاصًا أو بيانات تاريخية؛ لا يدخل في المقارنة العامة للتحاليل الحالية.'};
 const snapshot={...report,accountKey:publicBaselineEligible(report)?null:accountKey,recordClass:publicBaselineEligible(report)?'prospective-public':report.mode==='historical'?'historical':'private-input',decisionBaseline:baseline};delete (snapshot as any).forecast;delete (snapshot as any).changes;
 const previous=await db.prepare("SELECT id FROM analysis_snapshots WHERE symbol=? AND (json_extract(data,'$.recordClass')='prospective-public' OR json_extract(data,'$.accountKey')=?) ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(report.company.symbol,accountKey).first();
 const rows=projection.rows.map(row=>{const completedAnchor=report.prices.filter(p=>p.date<row.window.anchorDate).at(-1);const calibrated=calibration(prior,row.sessions,market,projection.version,createdAt,row.direction);return {id:crypto.randomUUID(),...row,anchorDate:row.window.anchorDate,createdAt,model:projection.version,currency:report.currency,unit:'share',assetType:report.company.instrument||'EQUITY',priceTime:projection.priceTime,source:report.priceSource,seriesBasis:{adjustment:report.priceAdjustment||null,anchorDate:completedAnchor?.date??null,anchorClose:completedAnchor?.close??null,definition:'آخر شمعة مكتملة قبل يوم الإصدار؛ شمعة الإصدار لا تستخدم للتحقق من إعادة ضبط السلسلة'},settingsUsed:projection.settingsUsed,evidenceId:report.research?.recorded?report.research.id:null,accountKey:publicBaselineEligible(report)?null:accountKey,previousSnapshotId:previous?.id||null,recordClass:publicBaselineEligible(report)?'prospective-public':report.mode==='historical'?'historical':'private-input',probability:calibrated.probabilities,historicalAccuracy:calibrated.accuracy,calibration:calibrated,confidence:row.confidence,evidenceQuality:row.confidence,calibrationStatus:calibrated.confidence};});
 const calibratedRows=rows.map(row=>({...row,rangeCalibration:calibrateForecastRange(row,rangeHistory.records,{
  symbol:report.company.symbol,market,currency:report.currency,model:projection.version,horizon:row.sessions,
  asOf:createdAt,recordClass:row.recordClass,adjustment:report.priceAdjustment||null
 },{historyTruncated:rangeHistory.truncatedHorizons.has(row.sessions),readError:rangeHistory.readError})}));
 await db.batch([db.prepare('INSERT INTO analysis_snapshots (id,symbol,created_at,data) VALUES (?,?,?,?)').bind(id,report.company.symbol,createdAt,JSON.stringify(snapshot)),...calibratedRows.map(row=>db.prepare('INSERT INTO forecast_records (id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(row.id,id,report.company.symbol,createdAt,row.sessions,projection.version,market,report.company.sector||'غير متحقق',row.confidence,row.available?1:0,JSON.stringify(row)))]);
 // Resolve only already-issued predictions, never regenerate old predictions with today's information.
 try{await resolveForecasts(db,report)}catch{report.warnings.push('حُفظ التوقع، لكن تعذرت مقارنة بعض النتائج المستحقة؛ ستُعاد المحاولة عند التحديث.');}
 return {...projection,createdAt,rows:calibratedRows,snapshotId:id,recorded:true};
}
export function performanceStats(rows:any[],sinceDays:number|null=null,now=Date.now()){
 const all=rows.filter(r=>sinceDays===null||now-Date.parse(r.created_at)<=sinceDays*864e5);
 const completed=all.filter(r=>r.outcome?.state==='complete'&&(!r.recordClass||r.recordClass==='prospective-public'));
 // One issued forecast per stock/model/horizon/date. Further overlapping holdings are de-clustered below.
 const groups=new Map<string,any[]>();for(const r of completed){const k=`${r.symbol}|${r.model}|${r.horizon}`;const g=groups.get(k);if(g)g.push(r);else groups.set(k,[r]);}
 const independent:any[]=[];for(const group of groups.values()){let end='';for(const r of group.sort((a,b)=>a.created_at.localeCompare(b.created_at))){if(r.created_at.slice(0,10)>end){independent.push(r);end=r.outcome.actualDate}}}
 const summarize=(r:any[])=>{const directions=r.filter(x=>typeof x.outcome.directionCorrect==='boolean'),ranges=r.filter(x=>typeof x.outcome.rangeHit==='boolean'),errors=r.filter(x=>typeof x.outcome.priceErrorPct==='number'&&Number.isFinite(x.outcome.priceErrorPct)),baseline=errors.filter(x=>Number.isFinite(x.outcome.metrics?.baselineErrorPct)),movement=r.filter(x=>Number.isFinite(x.outcome.metrics?.movementErrorPp));return {count:r.length,directionCorrectCount:directions.filter(x=>x.outcome.directionCorrect).length,directionCount:directions.length,directionAccuracy:directions.length?directions.filter(x=>x.outcome.directionCorrect).length/directions.length*100:null,pointCount:errors.length,meanPriceError:errors.length?errors.reduce((s,x)=>s+x.outcome.priceErrorPct,0)/errors.length:null,pairedCount:baseline.length,pairedMeanPriceError:baseline.length?baseline.reduce((s,x)=>s+x.outcome.priceErrorPct,0)/baseline.length:null,meanBaselineError:baseline.length?baseline.reduce((s,x)=>s+x.outcome.metrics.baselineErrorPct,0)/baseline.length:null,meanMovementError:movement.length?movement.reduce((s,x)=>s+x.outcome.metrics.movementErrorPp,0)/movement.length:null,rangeCount:ranges.length,rangeCoverage:ranges.length?ranges.filter(x=>x.outcome.rangeHit).length/ranges.length*100:null};};
 const breakdown=(key:string)=>Object.entries(Object.groupBy(independent,r=>String(r[key]))).map(([name,v])=>({name,...summarize(v||[])}));
 const byHorizon=breakdown('horizon'),bySector=breakdown('sector');
 const leaders=(values:ReturnType<typeof breakdown>)=>{const qualified=values.filter(v=>v.count>=30&&v.name!=='غير متحقق').sort((a,b)=>b.directionAccuracy!-a.directionAccuracy!);return qualified.length>=2?{best:qualified[0],worst:qualified.at(-1)!}:null;};
 return {leaders:{horizon:leaders(byHorizon),sector:leaders(bySector)},total:all.length,issued:all.filter(r=>r.available).length,abstained:all.filter(r=>!r.available).length,completed:completed.length,excludedFromPublic:all.filter(r=>r.recordClass&&r.recordClass!=='prospective-public').length,excluded:all.filter(r=>r.outcome?.state==='excluded').length,independent:independent.length,...summarize(independent),byHorizon,byMarket:breakdown('market'),bySector,byConfidence:breakdown('confidence'),byModel:breakdown('model'),note:'الدقة من نتائج ناضجة مسجلة قبل حدوثها، مع استبعاد النوافذ المتداخلة للسهم والنموذج والمدة نفسيهما من النسبة. لا يثبت ذلك استقلال الأسهم عن حركة السوق. حد الحياد محفوظ لكل توقع؛ السجلات القديمة تستخدم حدها السابق ±1%. الأفضل والأضعف وصف للنتائج المرصودة وليس وعدًا بالتفوق القادم.'};
}
export function calibration(records:any[],horizon:number,market:string,model:string,now:string,direction?:string){
 const candidates=records.filter(r=>r.horizon===horizon&&r.market===market&&r.model===model&&r.created_at<now&&r.outcome?.state==='complete'&&r.outcome.actualDate<now.slice(0,10));
 const bySymbol=new Map<string,any[]>();for(const r of candidates){const g=bySymbol.get(r.symbol);if(g)g.push(r);else bySymbol.set(r.symbol,[r]);}
 const sample:any[]=[];for(const group of bySymbol.values()){let end='';for(const r of group.sort((a,b)=>a.created_at.localeCompare(b.created_at))){if(r.created_at.slice(0,10)>end){sample.push(r);end=r.outcome.actualDate}}}
 const n=sample.length;if(n<30)return {confidence:'غير معايرة',probabilities:null,accuracy:n?sample.filter(r=>r.outcome.directionCorrect).length/n*100:null,sample:n,advantage:false,trainedThrough:now};
 const p=sample.filter(r=>r.outcome.directionCorrect).length/n,z=1.96,lower=(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n);
 const matched=sample.filter(r=>r.forecastDirection===direction);const probabilities=matched.length>=30?Object.fromEntries(['صاعد','محايد','هابط'].map(d=>[d,(matched.filter(r=>r.outcome.actualDirection===d).length+1)/(matched.length+3)*100])):null;
 const proportions=Object.fromEntries(['صاعد','محايد','هابط'].map(d=>[d,sample.filter(r=>r.outcome.actualDirection===d).length/n]));const baseline=Math.max(...Object.values(proportions));const advantage=lower>baseline;
 return {confidence:advantage&&n>=100?'متوسط':'منخفض',probabilities,accuracy:p*100,sample:n,advantage,lower95:lower*100,majorityBaseline:baseline*100,trainedThrough:now};
}
export async function saveEvaluationRevision(db:any,forecastId:string,outcome:Outcome,reason='تقييم بيانات نهاية المدة'){
 const lease=crypto.randomUUID(),lock='evaluation:'+forecastId;const claimed=await db.prepare('INSERT INTO research_locks(id,token,until_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until_ms=excluded.until_ms WHERE until_ms<? RETURNING token').bind(lock,lease,Date.now()+30000,Date.now()).first();if(!claimed)return false;try{
 const hash=await fingerprint(JSON.stringify(outcome)),latest=await db.prepare('SELECT data,fingerprint FROM evaluation_revisions WHERE forecast_id=? ORDER BY revision DESC LIMIT 1').bind(forecastId).first();if(latest?.fingerprint===hash)return false;
 const old=await db.prepare('SELECT * FROM forecast_outcomes WHERE id=?').bind(forecastId).first(),at=new Date().toISOString(),statements=[];
 if(old&&!latest)statements.push(db.prepare('INSERT INTO evaluation_revisions(id,forecast_id,revision,created_at,fingerprint,data) SELECT ?,?,0,?,?,? WHERE NOT EXISTS(SELECT 1 FROM evaluation_revisions WHERE forecast_id=?)').bind(crypto.randomUUID(),forecastId,old.evaluated_at,'legacy',JSON.stringify({outcome:JSON.parse(old.data),reason:'النتيجة السابقة قبل تحديث طريقة القياس؛ محفوظة كما كانت.'}),forecastId));
 const revisionId=crypto.randomUUID();
 // D1 batch is transactional. Recheck fingerprint INSIDE SQL, not just before it:
 // two workers whose leases overlap cannot append an identical latest revision.
 statements.push(db.prepare('INSERT INTO evaluation_revisions(id,forecast_id,revision,created_at,fingerprint,data) SELECT ?,?,COALESCE(MAX(revision),0)+1,?,?,? FROM evaluation_revisions WHERE forecast_id=? HAVING (SELECT fingerprint FROM evaluation_revisions WHERE forecast_id=? ORDER BY revision DESC LIMIT 1) IS NOT ?').bind(revisionId,forecastId,at,hash,JSON.stringify({outcome,reason}),forecastId,forecastId,hash));
 statements.push(db.prepare('INSERT INTO forecast_outcomes(id,evaluated_at,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM evaluation_revisions WHERE id=?) ON CONFLICT(id) DO UPDATE SET evaluated_at=excluded.evaluated_at,data=excluded.data').bind(forecastId,at,JSON.stringify(outcome),revisionId));
 const result=await db.batch(statements),write=result.at(-1);return Number(write?.meta?.changes??write?.changes??0)>0;
 }finally{try{await db.prepare('DELETE FROM research_locks WHERE id=? AND token=?').bind(lock,lease).run();}catch{/* A committed evaluation must not be reported as unwritten on lease cleanup failure. */}}
}
export class ForecastResolutionError extends Error {
 constructor(public evaluationsSaved:number){super('forecast-resolution-failed');}
}
export async function resolveForecasts(db:any,report:MarketReport){const pending=await db.prepare(`SELECT f.* FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id WHERE f.symbol=? AND f.available=1 AND o.id IS NULL AND ${MATURITY_PREDICATE} ORDER BY f.created_at LIMIT 15`).bind(report.company.symbol,report.asOf).all();let count=0;try{for(const record of pending.results||[]){const outcome=evaluateForecast(record,report);if(outcome&&await saveEvaluationRevision(db,record.id,outcome))count++;}}catch{throw new ForecastResolutionError(count);}return count;}
