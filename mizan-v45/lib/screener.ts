import {forecasts,forecastModelVersion,HORIZONS} from './research-model';
import {fetchCompany,fetchLiveQuote} from './market-data';
import {configuredReader} from './source-status';
import {readSettings,type SiteSettings} from './site-settings';
import {eligibleSaudiCompanies} from './saudi-directory';
import {eligibleUSCompanies} from './us-directory';
import {assertCurrentInstrument} from './listing-lifecycle';
import type {ScreenerEvidence} from './screener-snapshot';
import {evaluateScreenerShara,type SharaScreenerSummary} from './screener-shara';
import {validateScreenerRequest,selectScreenerSymbols,selectScreenerCandidates,candidateExclusion,
 SCREENER_BATCH_SIZE,SCREENER_RANKING,SCREENER_SCOPE,
 type ScreenerRequest,type ScreenerResult,type ScreenerCandidate,type ScreenerFailure} from './screener-policy';
export type {ScreenerRequest,ScreenerResult,ScreenerCandidate,ScreenerFailure,ScreenerMarket} from './screener-policy';
// Source fan-out for some US symbols is heavy; keep each tiny batch sequential to avoid Worker/provider bursts.
const CONCURRENCY=1;
export type ScreenerPlan={market:ScreenerRequest['market'];horizonSessions:number;horizonName:string;
 resultCount:number;scanLimit:number;symbols:string[];batchSize:number;modelVersion:string;
 universeCount:{sa:number;us:number};selectedCount:{sa:number;us:number};scope:string;generatedAt:string};
async function prepare(db:any,input:ScreenerRequest){
 const req=validateScreenerRequest(input);
 if(!db)throw new Error('قاعدة بيانات ميزان غير مرتبطة بالخدمة الحالية.');
 const settings=await readSettings(db);
 const markets=req.market==='both'?['sa','us']:[req.market];
 if(markets.some(m=>!settings.enabledMarkets.includes(m)))throw new Error('أحد الأسواق المختارة متوقف من إعدادات الإدارة.');
 if(settings.periods[req.horizonSessions]?.enabled===false)throw new Error('الأفق المختار متوقف من إعدادات الإدارة.');
 const modelVersion=forecastModelVersion(settings);
 if(req.expectedVersion&&req.expectedVersion!==modelVersion)throw new Error('تغيرت إعدادات النموذج أثناء المسح؛ أعد المسح بدل خلط نسختين.');
 return {req,settings,modelVersion};
}
function universe(market:ScreenerRequest['market']){
 return {sa:market==='us'?[]:eligibleSaudiCompanies('current').map(c=>c.symbol),
  us:market==='sa'?[]:eligibleUSCompanies().map(c=>c.symbol)};
}
export async function planScreener(db:any,input:ScreenerRequest):Promise<ScreenerPlan>{
 const {req,modelVersion}=await prepare(db,input),all=universe(req.market);
 const symbols=req.symbols?req.symbols.slice(0,req.scanLimit):selectScreenerSymbols(all.sa,all.us,req.market,req.scanLimit);
 return {market:req.market,horizonSessions:req.horizonSessions,horizonName:req.horizonName,
  resultCount:req.resultCount,scanLimit:req.scanLimit,symbols,batchSize:1,modelVersion,
  universeCount:{sa:all.sa.length,us:all.us.length},selectedCount:{sa:symbols.filter(s=>s.endsWith('.SR')).length,us:symbols.filter(s=>!s.endsWith('.SR')).length},
  scope:SCREENER_SCOPE,generatedAt:new Date().toISOString()};
}
const numberOrNull=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const strings=(v:unknown,n=6)=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,n):[];
type Outcome={ok:true;candidate:ScreenerCandidate;report:ScreenerEvidence['report'];projection:ScreenerEvidence['projection']}|{ok:false;failure:ScreenerFailure};
async function analyzeSymbol(symbol:string,req:ReturnType<typeof validateScreenerRequest>,read:Awaited<ReturnType<typeof configuredReader>>,settings:SiteSettings):Promise<Outcome>{
 try{
  assertCurrentInstrument(symbol);
  const report=await fetchCompany(symbol,read,false);
  const market=symbol.endsWith('.SR')?'sa':'us';
  if(report.company.symbol!==symbol||report.currency!==(market==='sa'?'SAR':'USD'))throw new Error('هوية الشركة أو العملة لا تطابق السوق المطلوب.');
  if(!report.prices||report.prices.length<20)throw new Error('السلسلة السعرية أقل من الحد الأدنى للتحليل.');
  let quote=report.liveQuote||null;
  if(req.horizonSessions===1&&(!quote||Date.now()-Date.parse(quote.quoteTime)>60000)){
   try{quote=await fetchLiveQuote(symbol,read);}catch{/* No synthetic live price; canonical confidence will fall. */}
  }
  const horizon=HORIZONS.find(h=>h.sessions===req.horizonSessions)!;
  const result=forecasts(report,quote,Date.now(),settings,[horizon]);
  const row=result.rows.find(r=>r.sessions===req.horizonSessions);
  if(!row)throw new Error('لم يُنتج النموذج الأفق المطلوب.');
  const r=row as any;
  const candidate:ScreenerCandidate={symbol,name:report.company.name||symbol,exchange:report.company.exchange||'',market,currency:report.currency,
   price:numberOrNull(r.price),predictedPrice:numberOrNull(r.predictedPrice),direction:String(r.direction||'غير متاح'),
   expectedChangePct:numberOrNull(r.expectedChangePct),range:Array.isArray(r.range)&&r.range.length===2?r.range as [number,number]:null,
   confidence:String(r.confidence||'غير متاحة'),dataQuality:String(r.dataQuality||result.dataQuality||'غير متاحة'),
   coverage:numberOrNull(r.coverage)??0,sample:numberOrNull(r.sample)??0,independent:numberOrNull(r.independent)??0,
   riskLevel:String(r.riskLevel||'غير متاح'),available:r.available===true,
   reasons:strings(r.reasons),basis:strings(r.basis),risks:strings(r.risks),invalidation:strings(r.invalidation),
   priceTime:result.priceTime||'',retrievedAt:report.retrievedAt,source:report.priceSource};
  return {ok:true,candidate,report,projection:result};
 }catch(e){return {ok:false,failure:{symbol,reason:e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message.slice(0,300):'تعذر تحليل السهم من المصادر المتاحة.'}};}
}
async function runBatched<T,R>(items:T[],worker:(item:T)=>Promise<R>):Promise<R[]>{
 const results=new Array<R>(items.length);let next=0;
 async function consume(){while(true){const index=next++;if(index>=items.length)return;results[index]=await worker(items[index]);}}
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},consume));return results;
}
export async function runScreener(db:any,input:ScreenerRequest,capture?:(evidence:ScreenerEvidence[],result:ScreenerResult)=>Promise<void>):Promise<ScreenerResult>{
 const started=Date.now(),{req,settings,modelVersion}=await prepare(db,input),all=req.symbols?null:universe(req.market);
 const symbols=req.symbols?req.symbols.slice(0,req.scanLimit):selectScreenerSymbols(all!.sa,all!.us,req.market,req.scanLimit);
 const read=await configuredReader(db,settings);
 const outcomes=await runBatched(symbols,s=>analyzeSymbol(s,req,read,settings));
 const rows=outcomes.flatMap(o=>o.ok?[o.candidate]:[]),failures=outcomes.flatMap(o=>o.ok?[]:[o.failure]);
 const exclusionCounts:Record<string,number>={};for(const c of rows){const reason=candidateExclusion(c);if(reason)exclusionCounts[reason]=(exclusionCounts[reason]||0)+1;}
 // SHARA gate layer: parity + provisional market gates. Shadow by default (removed is empty); a SHARA failure never blocks screening.
 let shara:SharaScreenerSummary|undefined,sharaRemoved=new Set<string>();
 try{const v=await evaluateScreenerShara(outcomes.flatMap(o=>o.ok?[{candidate:o.candidate,report:o.report}]:[]));shara=v.summary;sharaRemoved=v.removed;}catch{/* shadow layer must not affect the scan */}
 if(sharaRemoved.size)exclusionCounts.shara_market_gate=rows.filter(c=>sharaRemoved.has(c.symbol)&&!candidateExclusion(c)).length;
 const {candidates,eligible}=selectScreenerCandidates(sharaRemoved.size?rows.filter(c=>!sharaRemoved.has(c.symbol)):rows,req.resultCount,req.market);
 const result:ScreenerResult={market:req.market,horizonSessions:req.horizonSessions,horizonName:req.horizonName,
  scanned:symbols.length,analyzed:rows.length,eligible,failed:failures.length,excluded:rows.length-eligible,
  requestedResultCount:req.resultCount,returned:candidates.length,missingCount:req.resultCount*(req.market==='both'?2:1)-candidates.length,
  candidates,failures,exclusionCounts,durationMs:Date.now()-started,generatedAt:new Date().toISOString(),modelVersion,
  rankingPolicy:SCREENER_RANKING,scope:SCREENER_SCOPE,...(shara?{shara}:{})};
 if(capture){
  const included=new Set(candidates.map(c=>c.symbol));
  const evidence=outcomes.flatMap(o=>o.ok&&included.has(o.candidate.symbol)?[{candidate:o.candidate,report:o.report,projection:o.projection}]:[]);
  await capture(evidence,result);
 }
 return result;
}
