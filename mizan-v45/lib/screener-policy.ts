/** Selection/presentation only. forecasts() remains the sole prediction engine. */
import {HORIZONS} from './forecast-horizons';
import {mergeSharaSummaries} from './screener-shara';
export type ScreenerMarket='sa'|'us'|'both';
export type ScreenerRequest={market:ScreenerMarket;horizonSessions:number;resultCount?:number;scanLimit?:number;limit?:number;symbols?:string[];expectedVersion?:string};
export type ScreenerCandidate={
 symbol:string;name:string;exchange:string;market:'sa'|'us';currency:string;
 price:number|null;predictedPrice:number|null;direction:string;expectedChangePct:number|null;
 range:[number,number]|null;confidence:string;dataQuality:string;coverage:number;sample:number;
 independent:number;riskLevel:string;available:boolean;reasons:string[];basis:string[];risks:string[];
 invalidation:string[];priceTime:string;retrievedAt:string;source:string;
 forecastId?:string;forecastIssuedAt?:string;estimatedEndAt?:string|null;calendarVerified?:boolean;
};
export type ScreenerFailure={symbol:string;reason:string};
export type ScreenerResult={market:ScreenerMarket;horizonSessions:number;horizonName:string;
 scanned:number;analyzed:number;eligible:number;failed:number;excluded:number;
 requestedResultCount:number;returned:number;missingCount:number;
 candidates:ScreenerCandidate[];failures:ScreenerFailure[];exclusionCounts:Record<string,number>;
 durationMs:number;generatedAt:string;modelVersion:string;rankingPolicy:string;scope:string;
 shara?:import('./screener-shara').SharaScreenerSummary;
 /** @deprecated read-only: archives written before the rename (VOSA -> SHARA) carry the summary under this key; never written. */
 vosa?:import('./screener-shara').SharaScreenerSummary};
// Keep each Worker request below source/D1 resource pressure; full scans progress through more small immutable batches.
export const SCREENER_BATCH_SIZE=2;
export const SCREENER_MAX_SCAN=200;
export const SCREENER_RANKING='data-quality / confidence / factor-coverage / historical-windows / expected-change';
export const SCREENER_SCOPE='bounded-directory-sample';
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function validateScreenerRequest(input:any){
 if(!input||typeof input!=='object'||Array.isArray(input)||!['sa','us','both'].includes(input.market))throw new Error('السوق غير مدعوم.');
 const horizon=HORIZONS.find(h=>h.sessions===input.horizonSessions);
 if(!horizon)throw new Error('الأفق الزمني غير مدعوم.');
 const resultCount=input.resultCount??5,scanLimit=input.scanLimit??input.limit??200;
 if(!Number.isInteger(resultCount)||resultCount<5||resultCount>10)throw new Error('عدد النتائج يجب أن يكون عددًا صحيحًا من 5 إلى 10.');
 if(!Number.isInteger(scanLimit)||scanLimit<5||scanLimit>SCREENER_MAX_SCAN)throw new Error('عدد الأسهم المفحوصة يجب أن يكون من 5 إلى 200.');
 if(input.expectedVersion!==undefined&&(typeof input.expectedVersion!=='string'||input.expectedVersion.length>100))throw new Error('نسخة النموذج المطلوبة غير صالحة.');
 let symbols:string[]|undefined;
 if(input.symbols!==undefined){
  if(!Array.isArray(input.symbols)||!input.symbols.length||input.symbols.length>SCREENER_MAX_SCAN)throw new Error('قائمة الرموز غير صالحة أو تتجاوز 200 رمز.');
  symbols=[...new Set<string>(input.symbols.map((s:unknown)=>{
   if(typeof s!=='string')throw new Error('رمز التداول يجب أن يكون نصًا.');
   let symbol=s.trim().toUpperCase();
   if((input.market==='sa'||input.market==='both')&&/^\d{4,5}(\.SR)?$/.test(symbol))symbol=symbol.replace(/\.SR$/,'')+'.SR';
   if(input.market==='sa'&&!/^\d{4,5}\.SR$/.test(symbol)||input.market==='us'&&symbol.endsWith('.SR')||!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol))throw new Error('رمز غير صالح للسوق المختار.');
   return symbol;
  }))];
 }
 return {market:input.market as ScreenerMarket,horizonSessions:horizon.sessions,horizonName:horizon.name,resultCount,scanLimit,symbols,expectedVersion:input.expectedVersion as string|undefined};
}
export function selectScreenerSymbols(sa:string[],us:string[],market:ScreenerMarket,limit:number){
 const output:string[]=[];const seen=new Set<string>();
 const add=(s:string|undefined)=>{if(s&&!seen.has(s)&&output.length<limit){seen.add(s);output.push(s);}};
 if(market==='both'){for(let i=0;i<Math.max(sa.length,us.length)&&output.length<limit;i++){add(sa[i]);add(us[i]);}}
 else for(const s of market==='sa'?sa:us)add(s);
 return output;
}
export function validScreenerRange(value:unknown):value is [number,number]{return Array.isArray(value)&&value.length===2&&value.every(finite)&&value[0]>0&&value[1]>value[0];}
export function candidateExclusion(c:ScreenerCandidate):string|null{
 if(!c.available)return 'model_unavailable';
 if(c.direction!=='صاعد')return 'not_rising';
 if(!['متوسط','مرتفع'].includes(c.confidence))return 'low_or_unknown_confidence';
 if(!validScreenerRange(c.range))return 'invalid_range';
 if(!finite(c.price)||c.price<=0||!finite(c.predictedPrice)||c.predictedPrice<=c.price||!finite(c.expectedChangePct)||c.expectedChangePct<=0)return 'invalid_positive_target';
 if(c.predictedPrice<c.range[0]||c.predictedPrice>c.range[1])return 'target_outside_range';
 const actual=100*(c.predictedPrice/c.price-1);
 if(Math.abs(actual-c.expectedChangePct)>Math.max(.00001,Math.abs(actual)*.000001))return 'inconsistent_target';
 if(!c.priceTime||!Number.isFinite(Date.parse(c.priceTime))||!['SAR','USD'].includes(c.currency))return 'missing_price_provenance';
 return null;
}
const confidenceRank:Record<string,number>={مرتفع:3,متوسط:2,منخفض:1};
const qualityRank:Record<string,number>={ممتازة:4,جيدة:3,متوسطة:2,ضعيفة:1,'غير صالحة':0};
export function compareScreenerCandidates(a:ScreenerCandidate,b:ScreenerCandidate){return (qualityRank[b.dataQuality]||0)-(qualityRank[a.dataQuality]||0)||(confidenceRank[b.confidence]||0)-(confidenceRank[a.confidence]||0)||b.coverage-a.coverage||b.independent-a.independent||(b.expectedChangePct??-Infinity)-(a.expectedChangePct??-Infinity)||a.symbol.localeCompare(b.symbol,'en');}
export function selectScreenerCandidates(rows:ScreenerCandidate[],count:number,market?:ScreenerMarket){
 if(!Number.isInteger(count)||count<5||count>10)throw new Error('invalid-result-count');
 const distinct=new Map<string,ScreenerCandidate>();
 for(const row of rows)if(!candidateExclusion(row)&&!distinct.has(row.symbol))distinct.set(row.symbol,row);
 const qualified=[...distinct.values()].sort(compareScreenerCandidates);
 const candidates=market==='both'?['sa','us'].flatMap(m=>qualified.filter(c=>c.market===m).slice(0,count)):qualified.slice(0,count);
 return {eligible:qualified.length,candidates};
}
export function mergeScreenerResults(a:ScreenerResult|null,b:ScreenerResult):ScreenerResult{
 if(!a)return b;
 const sa=a.shara??a.vosa,sb=b.shara??b.vosa;
 if(a.modelVersion!==b.modelVersion||a.market!==b.market||a.horizonSessions!==b.horizonSessions||a.requestedResultCount!==b.requestedResultCount)throw new Error('تغير إعداد المسح؛ لا يمكن جمع نتائج غير متجانسة.');
 const candidates=selectScreenerCandidates([...a.candidates,...b.candidates],a.requestedResultCount,a.market).candidates;
 const exclusionCounts={...a.exclusionCounts};for(const [k,n]of Object.entries(b.exclusionCounts))exclusionCounts[k]=(exclusionCounts[k]||0)+n;
 return {...b,scanned:a.scanned+b.scanned,analyzed:a.analyzed+b.analyzed,eligible:a.eligible+b.eligible,
  failed:a.failed+b.failed,excluded:a.excluded+b.excluded,returned:candidates.length,
  missingCount:Math.max(0,a.requestedResultCount*(a.market==='both'?2:1)-candidates.length),candidates,
  failures:[...a.failures,...b.failures].slice(0,200),exclusionCounts,durationMs:a.durationMs+b.durationMs,
  ...(sa||sb?{shara:mergeSharaSummaries(sa,sb)}:{}),vosa:undefined};
}
