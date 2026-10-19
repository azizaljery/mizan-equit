import {parseExistingResponse,observeResult,type SourceObservation,type CompanySourceTrace} from './sources/bridge';
import type {ParsedFinancials} from './sources/parsers/types';
import type {FetchAttempt} from './sources/types';
import {finite,parseNumber,parsePrices,today,type Price} from './analysis';
import saudiDirectory from './data/saudi-directory.json';
import {parseLiveQuote,type LiveQuote} from './live-quote';
import {parseSECFacts,parseSECFilings,readSECConcepts,isOversizeError,secConceptURL} from './sec-data';
import {discoverSECDocuments,discoverSECEventDocuments,readSECInlineDocument} from './sec-documents';
import {validateMarketIdentity} from './market-identity';
import {resolveCikDetailed} from './sources/cik';

export type Company={symbol:string;name:string;nameEn?:string;exchange:string;sector:string;industry:string;isin?:string;marketType?:string;instrument?:string;source:string;directoryDate?:string;listedSymbol?:string;analysisAvailable?:boolean};
export type Fact={key:string;value:number;date:string;period:'annual'|'quarterly'|'trailing';currency:string;source:string;publishedAt?:string;unit?:'base'|'thousand'|'million';lineage?:string;accession?:string;retrievedAt?:string};
export type News={title:string;url:string;date:string;kind:'announcement'|'news'|'event';contentRead?:boolean;retrievedAt?:string;lineage?:string;contextExcerpt?:string;impact?:string};
export type SourceCheck={name:string;url:string;state:'ok'|'partial'|'missing';detail:string};
export type Official={facts:Fact[];bid:number|null;ask:number|null;shares:number|null;marketCap:number|null;pe:number|null;sector:string;activity:string;news:News[];events:News[];source:string;auditor:string;quoteDate:string|null};
export type Benchmark={symbol:string;name:string;prices:Price[];source:string};
export type MarketReport={sourceLayer?:CompanySourceTrace;research?:import('./evidence-ledger').ResearchTrace;priceCoverage?:string;priceAdjustment?:string;priceSourceId?:string;changes?:import('./decision-room').DecisionChanges;forecast?:(ReturnType<typeof import('./research-model').forecasts>&{recorded?:boolean;snapshotId?:string;createdAt?:string});corporateActions?:{kind:'split'|'dividend';date:string;detail:string}[];context?:{market:Benchmark|null;sector:Benchmark|null};regulatory?:{facts:Fact[];news:News[];source:string}|null;liveQuote?:LiveQuote|null;company:Company;asOf:string;retrievedAt:string;prices:Price[];priceSource:string;quoteTime:string|null;currency:string;facts:Fact[];official:Official|null;news:News[];peers:{company:Company;pe:number|null;pb?:number|null;ps?:number|null;source:string}[];checks:SourceCheck[];warnings:string[];mode:'current'|'historical';historicalNote?:string};
export const SAUDI_DIRECTORY='https://www.saudiexchange.sa/tadawul.eportal.theme.helper/ThemeSearchUtilityServlet';
export const saudiURL=(symbol:string)=>'https://www.saudiexchange.sa/wps/portal/saudiexchange/hidden/company-profile-main/%21ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTR3NDIw8LAz83d2MXA0C3SydAl1c3Q0NvE30I4EKzBEKDMKcTQzMDPxN3H19LAzdTU31w8syU8v1wwkpK8hOMgUA-oskdg%21%21/?companySymbol='+encodeURIComponent(symbol.replace('.SR',''));
export const quoteURL=(symbol:string)=>`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;
export const statementURL=(symbol:string)=>quoteURL(symbol)+'financials/';
export const USER_AGENT='Mizan equity research https://mizan-equity.aljeryabod.chatgpt.site';
const cache=new Map<string,{expires:number;data:unknown;bytes:number}>();
const inflight=new Map<string,Promise<unknown>>();
// Only application-built, allowlisted URLs reach this function. No user-provided URLs.
export async function upstream(url:string,json=true,ttl=300000,purpose?:'quote',transport?:{beforeRequest?:()=>Promise<void>;onResponse?:(r:Response)=>Promise<void>;userAgent?:string;fetcher?:typeof fetch}):Promise<any>{
 const host=new URL(url).hostname;
 if(!['query1.finance.yahoo.com','www.saudiexchange.sa','www.sec.gov','data.sec.gov'].includes(host))throw new Error('مصدر غير مسموح.');
 const key=(json?'j:':'t:')+url,hit=cache.get(key);if(hit&&hit.expires>Date.now())return hit.data;
 if(inflight.has(key))return inflight.get(key);
 const work=(async()=>{await transport?.beforeRequest?.();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),purpose==='quote'?4000:host.endsWith('sec.gov')?10000:18000);
  try{const response=await (transport?.fetcher||fetch)(url,{headers:{'User-Agent':transport?.userAgent||USER_AGENT,'Accept':json?'application/json':'text/html'},signal:controller.signal,redirect:'manual'});
   await transport?.onResponse?.(response);
   if(!response.ok)throw new Error(`تعذر الوصول إلى المصدر (${response.status}).`);
   if(Number(response.headers.get('content-length'))>7000000)throw new Error('استجابة المصدر أكبر من الحد.');
   const reader=response.body?.getReader();if(!reader)throw new Error('استجابة فارغة.');let size=0;const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>7000000){await reader.cancel();throw new Error('استجابة المصدر أكبر من الحد.')}chunks.push(value)}
   const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length}const raw=new TextDecoder().decode(all);let data:any;try{data=json?JSON.parse(raw):raw}catch{throw Error('استجاب المصدر بمحتوى غير قابل للقراءة؛ لم نستخدمه كبيانات مالية.');}
   // Budget serialized bytes as well as entry count for the 128 MB Worker runtime.
   while(cache.size&&(cache.size>=16||[...cache.values()].reduce((n,v)=>n+v.bytes,0)+size>6000000))cache.delete(cache.keys().next().value!);
   if(size<=6000000)cache.set(key,{expires:Date.now()+ttl,data,bytes:size});return data;
  }catch(e){console.warn('Mizan data source failed',{source:host,reason:e instanceof Error?e.message.slice(0,180):'unknown'});throw e}finally{clearTimeout(timer)}
 })();inflight.set(key,work);try{return await work}finally{inflight.delete(key)}
}
export function normalizeQuery(value:string){return value.normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065fـ]/g,'').trim().toLowerCase()}
export function validSymbol(symbol:string){return /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol)}
export async function fetchLiveQuote(symbol:string,read:typeof upstream=upstream){
 if(!validSymbol(symbol))throw new Error('رمز غير صالح.');
 return parseLiveQuote(await read(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`,true,0,'quote'),symbol);
}
export function parseIntradayChart(data:any,symbol:string,interval:string){
 const result=data?.chart?.result?.[0];
 validateMarketIdentity(result?.meta,symbol);
 if(result?.meta?.symbol!==symbol||!['EQUITY','ETF'].includes(result?.meta?.instrumentType)||!(result?.meta?.dataGranularity===interval||(interval==='60m'&&result?.meta?.dataGranularity==='1h')))throw new Error('لم تصل شموع مطابقة للشركة والفاصل المطلوب.');
 const quote=result.indicators?.quote?.[0],seen=new Set<number>();const prices:Price[]=[];
 for(const [i,t] of (result.timestamp||[]).entries()){
  if(!finite(t)||t*1000>Date.now()||seen.has(t))continue;
  const p={date:new Date(t*1000).toISOString(),open:quote?.open?.[i],high:quote?.high?.[i],low:quote?.low?.[i],close:quote?.close?.[i],volume:quote?.volume?.[i]};
  if(![p.open,p.high,p.low,p.close,p.volume].every(finite)||p.open<=0||p.close<=0||p.volume<0||p.low<=0||p.high<Math.max(p.open,p.close)||p.low>Math.min(p.open,p.close))continue;
  seen.add(t);prices.push(p);
 }
 prices.sort((a,b)=>a.date.localeCompare(b.date));if(!prices.length)throw new Error('لا تتوفر شموع صالحة للفاصل المطلوب.');
 return {prices,timeZone:result.meta.exchangeTimezoneName||'UTC',interval,source:quoteURL(symbol),retrievedAt:new Date().toISOString()};
}
export async function fetchIntradayChart(symbol:string,interval:string,read:typeof upstream=upstream){
 if(!validSymbol(symbol)||!['1m','5m','60m'].includes(interval))throw new Error('رمز أو فاصل زمني غير صالح.');
 const range=interval==='1m'?'5d':interval==='5m'?'1mo':'3mo';
 const data=await read(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`,true,0);
 return parseIntradayChart(data,symbol,interval);
}
export function searchSaudi(rows:any[],query:string,limit=8):Company[]{
 const q=normalizeQuery(query).replace(/\.sr\b/g,'').replace(/[،,:()]/g,' ').replace(/\s+-\s+/g,' ').replace(/\s+/g,' ').trim();
 const tokens=q.split(' ').filter(Boolean),codes=tokens.filter(t=>/^\d{4,5}$/.test(t));
 const nameTokens=tokens.filter(t=>!/^\d{4,5}$/.test(t)&&!['شركة','شركه','سهم','رمز'].includes(t));
 return rows.filter(r=>/^\d{4,5}$/.test(String(r.symbol))&&['M','S'].includes(r.market_type)).map(r=>{
  const names=[r.symbol,r.companyNameAR,r.companyNameEN,r.tradingNameAr,r.tradingNameEn].map(x=>normalizeQuery(String(x||'')));
  const combined=codes.length===1&&String(r.symbol)===codes[0]&&nameTokens.every(t=>names.some(n=>n.includes(t)));
  const rank=codes.length?(combined?4:0):names.some(x=>x===q)?3:names.some(x=>x.startsWith(q))?2:names.some(x=>x.includes(q))?1:0;
  return {rank,company:{symbol:r.symbol+'.SR',name:r.companyNameAR||r.companyNameEN,nameEn:r.companyNameEN,exchange:r.market_type==='M'?'تداول السعودية':'نمو — السعودية',sector:'',industry:'',isin:r.isin,marketType:r.market_type,source:SAUDI_DIRECTORY}};
 }).filter(x=>x.rank>0).sort((a,b)=>b.rank-a.rank).slice(0,limit).map(x=>x.company);
}
export async function searchCompanies(input:string,market='auto',read:typeof upstream=upstream):Promise<Company[]>{
 if(!input.trim()||input.length>80)throw new Error('اكتب اسم الشركة أو رمزًا لا يتجاوز 80 حرفًا.');
 if(market==='us'){const {searchUSDirectory}=await import('./us-directory');return searchUSDirectory(input).companies}
 const arabicAliases:Record<string,string>={'ابل':'Apple','تسلا':'Tesla','انفيديا':'NVIDIA','نفيديا':'NVIDIA','مايكروسوفت':'Microsoft','امازون':'Amazon','الفابت':'Alphabet','جوجل':'Google'};
 if(market==='us')input=arabicAliases[normalizeQuery(input)]||input;
 const q=normalizeQuery(input),isSaudi=market==='sa'||(market!=='us'&&(/[\u0600-\u06ff]/.test(q)||/^\d{4,5}(\.sr)?$/.test(q)));
 const lookups=await Promise.allSettled([
  market==='us'?Promise.resolve([]):searchSaudiDirectory(q,read),
  isSaudi?Promise.resolve([]):read(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(input.trim())}&quotesCount=8&newsCount=0`).then(d=>(d.quotes||[]).filter((x:any)=>['EQUITY','ETF'].includes(x.quoteType)&&validSymbol(x.symbol)&&(market!=='us'||['NYQ','NMS','NGM','NCM','ASE','PCX','BTS','PNK','OTC','OQB','OQX'].includes(x.exchange))).map((x:any)=>({symbol:x.symbol,name:x.longname||x.shortname,exchange:x.exchDisp||x.exchange,sector:x.sector||'',industry:x.industry||'',instrument:x.quoteType,source:quoteURL(x.symbol)})))
 ]);
 const companies=lookups.flatMap(r=>r.status==='fulfilled'?r.value:[]);const unique=[...new Map(companies.map(c=>[c.symbol,c])).values()] as Company[];
 if(!unique.length&&((isSaudi&&lookups[0].status==='rejected')||(!isSaudi&&lookups[1].status==='rejected')))throw new Error('تعذر الاتصال بمصدر البحث الآن. لا يعني هذا أن الشركة غير موجودة؛ أعد المحاولة لاحقًا.');
 if(!unique.length&&lookups.every(r=>r.status==='rejected'||!r.value.length))throw new Error('لم نتمكن من التعرف على الشركة. جرّب رمزها مع السوق مثل 4190 أو AAPL أو 7203.T؛ قد يكون المصدر غير متاح مؤقتًا.');
 return unique.slice(0,8);
}
async function searchSaudiDirectory(query:string,read:typeof upstream=upstream):Promise<Company[]>{
 try{const rows=await read(SAUDI_DIRECTORY,true,3600000);if(!Array.isArray(rows)||!rows.length)throw new Error('دليل الشركات غير مكتمل.');return searchSaudi(rows,query)}
 catch(error){
  // Previously retrieved public company identities only; never substitute old prices or financials.
  const matches=searchSaudi(saudiDirectory.rows,query).map(c=>({...c,directoryDate:saudiDirectory.retrievedAt}));
  if(matches.length)return matches;
  throw error;
 }
}
export const FUNDAMENTALS:Record<string,string>={receivables:'Receivables',inventory:'Inventory',normalizedIncome:'NormalizedIncome',taxExpense:'TaxProvision',pretaxIncome:'PretaxIncome',revenue:'TotalRevenue',netIncome:'NetIncome',operatingIncome:'OperatingIncome',grossProfit:'GrossProfit',ebitda:'EBITDA',equity:'StockholdersEquity',assets:'TotalAssets',liabilities:'TotalLiabilitiesNetMinorityInterest',debt:'TotalDebt',cash:'CashAndCashEquivalents',currentAssets:'CurrentAssets',currentLiabilities:'CurrentLiabilities',interestExpense:'InterestExpense',operatingCashFlow:'OperatingCashFlow',capex:'CapitalExpenditure',freeCashFlow:'FreeCashFlow',dividends:'CashDividendsPaid',shares:'OrdinarySharesNumber',minorityInterest:'MinorityInterest',preferredStock:'PreferredStockEquity'};
export function parseFundamentals(data:any,symbol:string,asOf:string):Fact[]{
 const out:Fact[]=[];
 for(const row of data?.timeseries?.result||[]){const type=row.meta?.type?.[0]||'',period=type.startsWith('annual')?'annual':type.startsWith('quarterly')?'quarterly':type.startsWith('trailing')?'trailing':null;if(!period)continue;
  const identity=row.meta?.symbol;
  if(!(Array.isArray(identity)?identity.length===1&&identity[0]===symbol:identity===symbol))throw Error('رمز الشركة في القوائم المالية غير مطابق أو غير متحقق؛ لم نستخدم هذه القوائم.');
  const metric=type.replace(/^(annual|quarterly|trailing)/,''),key=Object.keys(FUNDAMENTALS).find(k=>FUNDAMENTALS[k]===metric);if(!key)continue;
  for(const x of row[type]||[]){const value=x.reportedValue?.raw;if(!finite(value)||!/^\d{4}-\d{2}-\d{2}$/.test(x.asOfDate)||x.asOfDate>asOf)continue;
   // A 12M record is never mistaken for a single quarter.
   if(period==='quarterly'&&x.periodType!=='3M')continue;
   out.push({key,value:['capex','dividends','interestExpense'].includes(key)?Math.abs(value):value,date:x.asOfDate,period,currency:x.currencyCode||'',source:statementURL(symbol)});
  }
 }return out;
}
function validHistoricalDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const ms=Date.parse(value+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function publicationDate(value:unknown):string|null{
 if(validHistoricalDate(value))return value;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)||!validHistoricalDate(value.slice(0,10)))return null;
 const ms=Date.parse(value);if(!Number.isFinite(ms))return null;
 // Use the later local/UTC date; never move publication to an earlier day.
 const utc=new Date(ms).toISOString().slice(0,10);return utc>value.slice(0,10)?utc:value.slice(0,10);
}
export type PitOptions={bufferDays:number|null};
type ExclusionReason='missing-publication'|'invalid-publication'|'invalid-period-end'|'publication-before-period-end'|'publication-not-yet-known'|'period-end-after-asof'|'invalid-value';
export type PitResult={known:Fact[];warnings:string[];approximatedCount:number;excludedCount:number;totalInput:number;exclusions:Record<ExclusionReason,number>};
export function factsKnownAsOf(facts:Fact[],asOf:string,options:PitOptions={bufferDays:null}):PitResult{
 if(!validHistoricalDate(asOf))throw new Error('asOf يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD.');
 if(!options||options.bufferDays!==null&&(!Number.isSafeInteger(options.bufferDays)||options.bufferDays<0))throw new Error('bufferDays يجب أن يكون null أو عدداً صحيحاً غير سالب.');
 const known:Fact[]=[],exclusions:Record<ExclusionReason,number>={'missing-publication':0,'invalid-publication':0,'invalid-period-end':0,'publication-before-period-end':0,'publication-not-yet-known':0,'period-end-after-asof':0,'invalid-value':0};
 let approximatedCount=0;
 for(const f of facts){
  if(!finite(f.value)){exclusions['invalid-value']++;continue;}
  if(!validHistoricalDate(f.date)){exclusions['invalid-period-end']++;continue;}
  if(f.date>asOf){exclusions['period-end-after-asof']++;continue;}
  const pub=publicationDate(f.publishedAt);
  if(pub===null){
   const missing=f.publishedAt===undefined||f.publishedAt===null||f.publishedAt==='';
   // Opt-in estimates apply only to absent dates, never to corrupt publication metadata.
   if(missing&&options.bufferDays!==null){
    const buffered=Date.parse(f.date+'T00:00:00Z')+options.bufferDays*86400000;
    if(Number.isFinite(buffered)&&buffered<Date.parse(asOf+'T00:00:00Z')){known.push(f);approximatedCount++;continue;}
   }
   exclusions[missing?'missing-publication':'invalid-publication']++;continue;
  }
  if(pub<f.date){exclusions['publication-before-period-end']++;continue;}
  // A publication on the signal day is not known under the daily cutoff policy.
  if(pub>=asOf){exclusions['publication-not-yet-known']++;continue;}
  known.push(f);
 }
 const labels:Record<ExclusionReason,string>={'missing-publication':'بلا تاريخ نشر مقبول','invalid-publication':'بتاريخ نشر غير صالح','invalid-period-end':'بنهاية فترة غير صالحة','publication-before-period-end':'بنشر يسبق نهاية الفترة','publication-not-yet-known':`منشور في ${asOf} أو بعده`,'period-end-after-asof':`بنهاية فترة بعد ${asOf}`,'invalid-value':'بقيمة رقمية غير صالحة'};
 const excludedCount=facts.length-known.length,warnings:string[]=[];
 if(excludedCount)warnings.push(`استُبعد ${excludedCount} من ${facts.length} بنداً: ${(Object.keys(exclusions) as ExclusionReason[]).filter(k=>exclusions[k]).map(k=>`${exclusions[k]} ${labels[k]}`).join('، ')}.`);
 if(approximatedCount)warnings.push(`أُدرج ${approximatedCount} بنداً بتقدير ${options.bufferDays} يوماً بعد نهاية الفترة؛ ليس تاريخ نشر موثقاً ولا اختباراً صارماً لنقطة الزمن.`);
 return {known,warnings,approximatedCount,excludedCount,totalInput:facts.length,exclusions};
}
function factsPublishedBefore(facts:Fact[],asOf:string){return factsKnownAsOf(facts,asOf).known;}
export function dailyChartURL(symbol:string,asOf:string,historical:boolean,range:'5y'|'5d'|'2y'|'1y',events=false){
 const base=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d`;
 if(!historical)return `${base}&range=${range}${events?'&events=splits%2Cdiv':''}`;
 const end=Date.parse(asOf+'T00:00:00Z'),start=new Date(end);
 if(range==='5d')start.setUTCDate(start.getUTCDate()-10);
 else{const month=start.getUTCMonth();start.setUTCFullYear(start.getUTCFullYear()-(range==='5y'?5:range==='1y'?1:2));if(start.getUTCMonth()!==month)start.setUTCDate(0);}
 return `${base}&period1=${Math.floor(start.getTime()/1000)}&period2=${Math.floor(end/1000)+86400}${events?'&events=splits%2Cdiv':''}`;
}
function chartInWindow(data:any,asOf:string,historical:boolean,range:'5y'|'5d'|'2y',allowIndex=false){
 const chart=parseChart(data,asOf,allowIndex);if(!historical)return chart;
 const from=Number(new URL(dailyChartURL(chart.meta.symbol,asOf,true,range)).searchParams.get('period1'));
 const start=new Date(from*1000).toISOString().slice(0,10);
 return {...chart,prices:chart.prices.filter((p:Price)=>p.date>=start),corporateActions:chart.corporateActions.filter(a=>validHistoricalDate(a.date)&&a.date>=start&&a.date<=asOf)};
}
function historicalOfficial(official:Official,asOf:string):Official{
 return {...official,facts:factsPublishedBefore(official.facts,asOf),bid:null,ask:null,shares:null,marketCap:null,pe:null,quoteDate:null,sector:'',activity:'',auditor:'',news:official.news.filter(n=>validHistoricalDate(n.date)&&n.date<asOf),events:[]};
}
export function fundamentalsURL(symbol:string,asOf:string){const types=['annual','quarterly','trailing'].flatMap(p=>Object.values(FUNDAMENTALS).map(k=>p+k));
 return `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types.join(',')}&period1=${Math.floor(Date.parse(asOf)/1000)-6*366*86400}&period2=${Math.floor(Date.parse(asOf)/1000)+86400}`;
}
async function getFundamentals(symbol:string,asOf:string,read:typeof upstream=upstream,historical=false,observations?:SourceObservation[]){
 const url=fundamentalsURL(symbol,asOf);
 const data=await read(url),legacy=parseFundamentals(data,symbol,asOf);
 let facts=legacy;
 if(!historical&&observations){
  const sourced=parseExistingResponse<ParsedFinancials>('yahoo','financials',data,url,{expectedSymbol:symbol,asOf});
  const fallbackUsed=!legacy.length&&sourced.result.state==='ok';
  observations.push(observeResult('financials',sourced,fallbackUsed));
  if(fallbackUsed&&sourced.result.state==='ok')facts=sourced.result.value.lines.map(l=>({key:l.key,value:l.value,date:l.periodEnd,
   period:l.period==='ttm'?'trailing':l.period,currency:l.unit,source:statementURL(symbol)}));
 }
 return historical?factsPublishedBefore(facts,asOf):facts;
}
export function parseChart(data:any,asOf:string,allowIndex=false){const r=data?.chart?.result?.[0];if(!r||!(allowIndex?['EQUITY','ETF','INDEX']:['EQUITY','ETF']).includes(r.meta?.instrumentType))throw new Error('لم تتوفر سلسلة أسعار لسهم أو صندوق مدرج بهذا الرمز.');
 validateMarketIdentity(r.meta,r.meta.symbol,allowIndex);
 const q=r.indicators?.quote?.[0];if(!q)throw new Error('لم تتوفر أسعار يومية.');
 const rows=(r.timestamp||[]).flatMap((s:number,i:number)=>{if(!finite(s)||s<=0||s*1000>Date.now()+5000)throw Error('تاريخ جلسة غير صالح أو في المستقبل.');const date=new Date((s+(r.meta.gmtoffset||0))*1000).toISOString().slice(0,10);const p={date,open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]};return date<=asOf&&[p.open,p.high,p.low,p.close,p.volume].every(finite)&&p.open>0&&p.close>0&&p.volume>=0?[p]:[]});
 const prices=rows.length?parsePrices('date,open,high,low,close,volume\n'+rows.map((p:Price)=>[p.date,p.open,p.high,p.low,p.close,p.volume].join(',')).join('\n')):[];
 const corporateActions:{kind:'split'|'dividend';date:string;detail:string}[]=[];for(const [key,kind] of [['splits','split'],['dividends','dividend']] as const){for(const action of Object.values(r.events?.[key]||{}) as any[]){if(finite(action.date))corporateActions.push({kind,date:new Date(action.date*1000).toISOString().slice(0,10),detail:kind==='split'?String(action.splitRatio||''):String(action.amount??'')});}}return {prices,meta:r.meta,corporateActions};
}
function entities(s:string){return s.replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,d)=>Number(d)<0x110000?String.fromCodePoint(Number(d)):'');}
export function htmlText(s:string){return entities(s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()}
const officialKeys:Record<string,string>={'Total Assets':'assets','Total Liabilities':'liabilities','Total Shareholders Equity (after deducting the minority equity)':'equity','Total Shareholders Equity (After Deducting Minority Equity)':'equity','Total Revenue (Sales/Operating)':'revenue','Net Profit (Loss) Attributable to Shareholders of the Issuer':'netIncome','Net Cash From Operating Activities':'operatingCashFlow','Cash and Cash Equivalents, End of the Period':'cash'};
export function verifySaudiProfileIdentity(html:string,symbol:string){
 const plain=htmlText(html),code=symbol.replace('.SR',''),known=saudiDirectory.rows.find(c=>c.symbol===code),labels=[...plain.matchAll(/(?:Trading Symbol|Company Symbol|Symbol Code|رمز التداول|رمز الشركة)\s*[:：–-]?\s*(\d{4,5})\b/gi)].map(m=>m[1]),isins=[...plain.matchAll(/(?:ISIN(?: Code)?|الرمز الدولي)\s*[:：–-]?\s*(SA[A-Z0-9]{10})\b/gi)].map(m=>m[1]);
 if(labels.length&&labels.some(v=>v!==code)||isins.length&&known?.isin&&isins.some(v=>v!==known.isin))throw Error('هوية محتوى صفحة تداول تخص شركة أخرى؛ لم تُنسب قوائمها إلى الرمز المطلوب.');
 if(labels.includes(code)||known?.isin&&isins.includes(known.isin))return true;
 throw Error('لم تصل خانة رمز أو ISIN يمكن التحقق منها في محتوى صفحة تداول؛ تستمر الأسعار والبيانات الأخرى المستقلة.');
}
export function parseSaudiProfile(html:string,symbol:string,asOf:string,verifyIdentity=false):Official{
 if(verifyIdentity)verifySaudiProfileIdentity(html,symbol);
 const source=saudiURL(symbol),plain=htmlText(html),facts:Fact[]=[];
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>[...m[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r=>[...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>htmlText(c[1]))));
 let index=0;
 for(const rows of tables){const header=rows.find(r=>r[0]==='Balance Sheet'&&r.some(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)));if(!header)continue;index++;if(index>2)break;
  const dates=header.slice(1),update=rows.find(r=>r[0]==='Last Update Date'),units=rows.find(r=>r[0]==='All Figures in');
  if(!units)continue;
  for(const row of rows){let key=officialKeys[row[0]];if(!key&&/^Total\s+(?:Shareholders.?\s+Equity|Stockholders.?\s+Equity|Equity)\b/i.test(row[0]))key='equity';if(!key)continue;
   row.slice(1).forEach((v,i)=>{const value=parseNumber(v),date=dates[i],unit=units[i+1]?.toLowerCase(),scale=unit==='thousands'?1000:unit==='millions'?1000000:unit==='units'?1:null;
    if(value===null||!date||date>asOf||scale===null||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    facts.push({key,value:value*scale,date,period:index===1?'annual':'quarterly',currency:'SAR',source,publishedAt:update?.[i+1]});
   });
  }
 }
 const pick=(pattern:RegExp)=>{const m=plain.match(pattern);return m?parseNumber(m[1]):null};
 const news:News[]=[];
 for(const m of html.matchAll(/<h2\b[^>]*onclick="[^"]*(\/wps\/portal\/saudiexchange\/newsandreports\/issuer-news\/issuer-announcements\/issuer-announcements-details\/\?[^'"]+)['"][^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/li>/g)){
  const date=htmlText(m[3]).match(/\b(\d{2})\/(\d{2})\/(20\d{2})\s+(\d{2}:\d{2}:\d{2})/),iso=date?`${date[3]}-${date[2]}-${date[1]}`:'';
  if(iso&&iso<=asOf)news.push({title:htmlText(m[2]),url:'https://www.saudiexchange.sa'+entities(m[1]),date:iso,kind:'announcement'});
 }
 const events:News[]=[];const dividendTable=tables.find(t=>t.some(r=>r[0]==='Announced Date'&&r.includes('Eligibility Date')));
 for(const row of dividendTable||[]){const toISO=(v:string)=>{const m=v?.match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:''};const announced=toISO(row[0]);if(!announced||announced>asOf)continue;
  for(const [i,title] of [[1,'استحقاق توزيع'],[2,'صرف توزيع']] as const){const date=toISO(row[i]);if(date>=asOf)events.push({title:`${title} — ${row[4]||''}`,date,url:source,kind:'event'})}
 }
 return {facts,bid:pick(/Best Bid Price ([\d,.]+)/),ask:pick(/Best Offer Price ([\d,.]+)/),shares:pick(/Total Issued Shares ([\d,.]+)/),marketCap:(()=>{const x=pick(/Total Market Cap \(SAR MN\) ([\d,.]+)/);return x===null?null:x*1e6})(),pe:pick(/P\/E Ratio ([\d,.]+)/),sector:plain.match(/(?:Main Market|Parallel Market) ([A-Za-z &–-]+) Shares Type/)?.[1]||'',activity:plain.match(/Company overview (.*?) Company History/)?.[1]||'',news:news.slice(0,10),events,source,auditor:plain.match(/External Auditors \[([^\]]+)\]/)?.[1]||'',quoteDate:null};
}
const peerGroups=[['4190.SR','4003.SR','4008.SR'],['2222.SR','XOM','CVX'],['AAPL','DELL','HPQ'],['MSFT','ORCL','CRM'],['GOOGL','GOOG','META']];
async function getPeers(company:Company,asOf:string,read:typeof upstream=upstream,historical=false){const group=peerGroups.find(g=>g.includes(company.symbol));if(!group)return [];
 const results=await Promise.allSettled(group.filter(s=>s!==company.symbol&&!(s==='GOOG'&&company.symbol==='GOOGL')&&!(s==='GOOGL'&&company.symbol==='GOOG')).map(async symbol=>{
  const [chart,facts]=await Promise.all([read(dailyChartURL(symbol,asOf,historical,'5d')),getFundamentals(symbol,asOf,read,historical)]);const q=chartInWindow(chart,asOf,historical,'5d');validateMarketIdentity(q.meta,symbol);const price=q.prices.at(-1)?.close;
  const income=facts.filter(f=>f.key==='netIncome'&&f.period==='trailing').sort((a,b)=>b.date.localeCompare(a.date))[0],shares=facts.filter(f=>f.key==='shares'&&f.period!=='trailing').sort((a,b)=>b.date.localeCompare(a.date))[0];
  const sameCurrency=income&&income.currency===q.meta.currency;
  const fresh=(date:string|undefined,days:number)=>!!date&&date<=asOf&&Date.parse(asOf)-Date.parse(date)<=days*864e5;
  const equity=latestFact(facts,'equity'),revenue=latestFact(facts,'revenue');const marketCap=price&&shares&&fresh(shares.date,210)&&fresh(q.prices.at(-1)?.date,3)?price*shares.value:null;
  return {pb:marketCap&&equity&&fresh(equity.date,550)&&equity.value>0&&equity.currency===q.meta.currency?marketCap/equity.value:null,ps:marketCap&&revenue&&fresh(revenue.date,550)&&revenue.value>0&&revenue.currency===q.meta.currency?marketCap/revenue.value:null,company:{symbol,name:q.meta.longName||symbol,exchange:q.meta.fullExchangeName,sector:'',industry:'',source:quoteURL(symbol)},pe:marketCap&&income&&income.value>0&&sameCurrency&&fresh(income.date,210)?marketCap/income.value:null,source:statementURL(symbol)};
 }));return results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
}
export function latestFact(facts:Fact[],key:string,period:Fact['period']='annual',date?:string){return facts.filter(f=>f.key===key&&f.period===period&&(date===undefined||f.date===date)).sort((a,b)=>b.date.localeCompare(a.date))[0]}
export async function getRegulatory(symbol:string,asOf:string,read:typeof upstream=upstream,observations?:SourceObservation[]){
 const resolved=await resolveCikDetailed(symbol,read);
 if(!resolved.ok)throw Error(resolved.reason);
 const {cik}=resolved;
 const results:PromiseSettledResult<any>[]=await Promise.allSettled([read(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,true,3600000),read(`https://data.sec.gov/submissions/CIK${cik}.json`,true,300000)]);
 // Large issuers' companyfacts exceed the read cap; read only the needed tags from the official companyconcept endpoint.
 let conceptNote='';
 if(results[0].status==='rejected'&&isOversizeError(results[0].reason)){
  try{const merged=await readSECConcepts(cik,read);results[0]={status:'fulfilled',value:merged};conceptNote=`ملف companyfacts الكامل أكبر من حد ذاكرة الخادم؛ قُرئت ${Object.keys(merged._mizanConceptUrls).length} بنود من واجهة SEC الرسمية companyconcept (بند لكل طلب)${merged._mizanMissingConcepts.length?'، وبنود غير مفصح عنها لهذه الشركة: '+merged._mizanMissingConcepts.join('، '):''}.`;}
  catch(e){results[0]={status:'rejected',reason:Error('ملف companyfacts أكبر من الحد، وتعذرت قراءة البنود من companyconcept: '+(e instanceof Error?e.message:'تعذر الجلب.'))};}
 }
 if(observations){
  for(const [i,type] of ['financials','filings'].entries()){
   const result=results[i],dataType=type as 'financials'|'filings';
   const url=i===0?(conceptNote?secConceptURL(cik,'Assets'):`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`):`https://data.sec.gov/submissions/CIK${cik}.json`;
   if(result.status==='fulfilled')observations.push(observeResult(dataType,parseExistingResponse('sec',dataType,result.value,url,{expectedSymbol:symbol,expectedCik:cik,asOf})));
   else observations.push({dataType,state:'failed',provenance:null,quality:{grade:'invalid',score:0,reasons:['تعذر الاتصال بالمصدر.']},reason:result.reason instanceof Error?result.reason.message:'تعذر الاتصال.',fallbackUsed:false});
  }
 }
 const facts=results[0].status==='fulfilled'?parseSECFacts(results[0].value,cik,asOf):[],news=results[1].status==='fulfilled'?parseSECFilings(results[1].value,cik,asOf):[];
 const documents:SourceCheck[]=conceptNote?[{name:'بنود SEC المنظمة — companyconcept',url:secConceptURL(cik,'Assets'),state:'ok',detail:conceptNote}]:[];
 if(results[1].status==='fulfilled')await Promise.all(discoverSECDocuments(results[1].value,cik,asOf).map(async doc=>{
  try{const html=await read(doc.url,false,86400000),extracted=readSECInlineDocument(html,doc,asOf);facts.push(...extracted);documents.push({name:`التقرير الأصلي SEC ${doc.form}`,url:doc.url,state:extracted.length?'ok':'partial',detail:`نُشر ${doc.publishedAt}؛ الفترة ${doc.period}؛ قُرئ المستند الأصلي واستُخرج ${extracted.length} بندًا مطابقًا. وقت الجلب ${new Date().toISOString()}. لا يُعد المستند وواجهة SEC مصدرين مستقلين.`});}
  catch(e){documents.push({name:`التقرير الأصلي SEC ${doc.form}`,url:doc.url,state:'missing',detail:'تعذر جلب أو قراءة المستند الأصلي. '+(e instanceof Error?e.message:'لم يصل سبب مفصل.')+' استمرت قراءة البنود الأخرى المتاحة.'});}
 }));
 for(const [i,result] of results.entries())if(result.status==='rejected')documents.push({name:i===0?'بنود SEC المنظمة':'اكتشاف تقارير SEC',url:i===0?`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`:`https://data.sec.gov/submissions/CIK${cik}.json`,state:'missing',detail:result.reason instanceof Error?result.reason.message:'تعذر الجلب.'});
 return {facts,news,documents,registrantName:results[1].status==='fulfilled'?String(results[1].value.name||''):'',eventDocuments:results[1].status==='fulfilled'?discoverSECEventDocuments(results[1].value,cik,asOf):[],filings:results[1].status==='fulfilled'?discoverSECDocuments(results[1].value,cik,asOf):[],source:`https://www.sec.gov/edgar/browse/?CIK=${cik}`};
}
const sectorProxies:Record<string,string>={'Technology':'XLK','Communication Services':'XLC','Consumer Cyclical':'XLY','Consumer Defensive':'XLP','Energy':'XLE','Financial Services':'XLF','Healthcare':'XLV','Industrials':'XLI','Basic Materials':'XLB','Real Estate':'XLRE','Utilities':'XLU'};
async function getContext(company:Company,asOf:string,read:typeof upstream=upstream,historical=false){
 const sa=company.symbol.endsWith('.SR'),us=['NASDAQ','NYSE','NMS','NGM','NCM','NYQ','ASE','PCX','BTS'].some(x=>company.exchange.toUpperCase().includes(x));
 const symbols:[string,string][]=sa?[['^TASI.SR','تاسي']]:us?[['SPY','SPY — مرجع الأسهم الأمريكية الكبيرة']]:[];
 if(us&&sectorProxies[company.sector])symbols.push([sectorProxies[company.sector],`${company.sector} — صندوق قطاعي أمريكي`]);
 const r=await Promise.allSettled(symbols.map(async ([symbol,name])=>{const d=await read(dailyChartURL(symbol,asOf,historical,'2y'),true,300000);const p=chartInWindow(d,asOf,historical,'2y',true);if(p.meta.symbol!==symbol)throw Error('مرجع غير مطابق.');if(historical&&p.prices.length<2)throw Error('لا توجد جلسات كافية للمرجع عند تاريخ القطع.');return {symbol,name,prices:p.prices,source:historical?(d._mizanSource||quoteURL(symbol)):quoteURL(symbol)}}));
 let market=r[0]?.status==='fulfilled'?r[0].value:null;
 // Yahoo currently returns a single point for ^TASI.SR whatever the range (verified 2026-10-17). The market reference
 // is used as the Tadawul SESSION CALENDAR (forecast evaluation counts sessions on it), so a 1-point series froze every
 // Saudi forecast with horizon>1. Fallback: union of session dates of liquid large caps, clearly labelled as a calendar.
 if(sa&&(!market||market.prices.length<SA_CALENDAR_MIN_SESSIONS)){
  const cal=await saudiSessionCalendar(asOf,read,historical);
  if(cal)market=cal;
 }
 return {market,sector:r[1]?.status==='fulfilled'?r[1].value:null};
}
export const SA_CALENDAR_MIN_SESSIONS=20;
export const SA_CALENDAR_PROXIES=['2222.SR','1120.SR','2010.SR'] as const;
/** Tadawul session calendar from liquid large caps (union of trading dates). Closes are the first proxy's when present;
 *  consumers of the market reference use its dates, never its returns. */
export async function saudiSessionCalendar(asOf:string,read:typeof upstream=upstream,historical=false):Promise<Benchmark|null>{
 const got=await Promise.allSettled(SA_CALENDAR_PROXIES.map(async symbol=>{const d=await read(dailyChartURL(symbol,asOf,historical,'2y'),true,300000);const p=chartInWindow(d,asOf,historical,'2y');if(p.meta.symbol!==symbol)throw Error('مرجع غير مطابق.');return p.prices as Price[];}));
 const byDate=new Map<string,Price>();
 for(const g of got)if(g.status==='fulfilled')for(const p of g.value)if(!byDate.has(p.date))byDate.set(p.date,p);
 if(byDate.size<SA_CALENDAR_MIN_SESSIONS)return null;
 const used=SA_CALENDAR_PROXIES.filter((_,i)=>got[i].status==='fulfilled');
 return {symbol:'TADAWUL-CALENDAR',name:'تقويم جلسات تداول (بديل: بيانات تاسي التاريخية غير متاحة من المزود؛ تواريخ جلسات '+used.join('، ')+')',prices:[...byDate.values()].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0),source:quoteURL('^TASI.SR')};
}
export async function fetchCompany(symbol:string,read:typeof upstream & {sourceAttempts?:FetchAttempt[]}=upstream,allowPartial=false,asOfOverride?:string):Promise<MarketReport>{
 if(!validSymbol(symbol))throw new Error('رمز التداول غير صالح.');
 const observations:SourceObservation[]=[],attemptStart=read.sourceAttempts?.length??0;
 const todayStr=today(),asOf=asOfOverride===undefined?todayStr:asOfOverride;
 if(!validHistoricalDate(asOf))throw new Error('asOf يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD.');
 if(asOf>todayStr)throw new Error('asOf لا يمكن أن يكون في المستقبل.');
 const isHistorical=asOf<todayStr;
 // Resolve the daily cutoff once, including before SEC revision deduplication.
 const publishedThrough=isHistorical?new Date(Date.parse(asOf+'T00:00:00Z')-86400000).toISOString().slice(0,10):asOf;
 const retrievedAt=new Date().toISOString(),checks:SourceCheck[]=[];
 const chartSource=quoteURL(symbol),isSaudi=/^\d{4,5}\.SR$/.test(symbol);
 const chartRequest=read(dailyChartURL(symbol,asOf,isHistorical,'5y',true)).then(d=>{const chart=chartInWindow(d,asOf,isHistorical,'5y');validateMarketIdentity(chart.meta,symbol);if(!chart.prices.length)throw Error('لم يرجع المصدر جلسات سعرية صالحة.');
   if(!isHistorical&&(!d._mizanSourceId||d._mizanSourceId==='yahoo')){
    const url=dailyChartURL(symbol,asOf,false,'5y',true);
    for(const dataType of ['history','price','dividends','corporateActions'] as const)
     observations.push(observeResult(dataType,parseExistingResponse('yahoo',dataType,d,url,{expectedSymbol:symbol,asOf}),!!d._mizanFallbackErrors?.length));
   }
   return {...chart,coverage:d._mizanCoverage||'',adjustment:d._mizanAdjustment||'',sourceId:d._mizanSourceId||'yahoo',source:d._mizanSource||quoteURL(symbol),fallbackErrors:d._mizanFallbackErrors||[]};});
 const completed=Promise.allSettled([
  chartRequest,
  getFundamentals(symbol,asOf,read,isHistorical,isHistorical?undefined:observations),
  isSaudi?read(saudiURL(symbol),false).then(h=>{const official=parseSaudiProfile(h,symbol,publishedThrough,true);return isHistorical?historicalOfficial(official,asOf):official;}):Promise.resolve(null),
  searchCompanies(symbol,'auto',read),
  read(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=6`),
  isSaudi?Promise.resolve(null):getRegulatory(symbol,publishedThrough,read,isHistorical?undefined:observations)
 ]);
 let chart;let chartFailure='';
 try{chart=await chartRequest;}catch(cause){
  const message=cause instanceof Error?cause.message:'';
  const detail=/[\u0600-\u06ff]/.test(message)?message.slice(0,300):cause instanceof Error&&cause.name==='AbortError'?'انتهت مهلة الاتصال بالمصدر.':'تعذر الاتصال أو التحقق من استجابة المصدر.';
  chartFailure='لم تصل أسعار صالحة لهذه الشركة من Yahoo Finance. '+detail;
  if(!allowPartial)throw new Error(chartFailure+' لم يصدر تحليل ببيانات بديلة.');
 }
 const results=await completed;
 if(!chart){const identities=results[3].status==='fulfilled'?results[3].value:[];const local=await searchCompanies(symbol,isSaudi?'sa':/^[A-Z][A-Z0-9-]*$/.test(symbol)?'us':'auto',read).catch(()=>[]);const identity=identities.find(c=>c.symbol===symbol)||local.find(c=>c.symbol===symbol);if(!identity)throw Error('لم تُثبت هوية الشركة في المصدر؛ قرار الانتظار إلى مراجعة الرمز.');chart={meta:{symbol,currency:isSaudi?'SAR':/^[A-Z][A-Z0-9-]*$/.test(symbol)?'USD':'',instrumentType:identity.instrument||'EQUITY',longName:identity.name,fullExchangeName:identity.exchange},prices:[],corporateActions:[],source:chartSource,fallbackErrors:[chartFailure]};}
 if(chart.meta.symbol!==symbol)throw new Error('اختلف رمز المصدر عن الرمز المطلوب؛ أوقفنا التحليل لتجنب الخلط بين الأوراق.');
 const facts:Fact[]=results[1].status==='fulfilled'?results[1].value:[],official=results[2].status==='fulfilled'?results[2].value:null;
 const candidates=results[3].status==='fulfilled'?results[3].value:[];
 const matchedCompany=candidates.find(c=>c.symbol===symbol);
 const company:Company=matchedCompany?{...matchedCompany}:{symbol,name:chart.meta.longName||chart.meta.shortName||symbol,exchange:chart.meta.fullExchangeName||'',sector:'',industry:'',source:chartSource};
 company.instrument=chart.meta.instrumentType;if(official?.sector)company.sector=official.sector;
 checks.push({name:'الأسعار اليومية',url:chart.source||chartSource,state:chart.prices.length?'ok':'missing',detail:chart.prices.length?`${chart.prices.length} جلسة؛ آخر جلسة ${chart.prices.at(-1)?.date}. أسعار مزود السوق وقد تتأخر.`:chartFailure},{name:'القوائم المالية',url:statementURL(symbol),state:facts.length?'partial':'missing',detail:facts.length?'تم جلب البنود مع الفترة والعملة. المزوّد لا يرفق تاريخ نشر كل بند؛ يلزم المصدر الأصلي لاعتماد القرار.':'لم تصل قوائم مالية قابلة للحساب.'});
 if(isSaudi)checks.push({name:'تداول السعودية',url:saudiURL(symbol),state:official?.facts.length?'ok':'missing',detail:official?.facts.length?'قوائم وإفصاحات من صفحة الشركة الرسمية؛ المقارنة أدناه توضح اختلاف التعريفات أو القيم.':results[2].status==='rejected'&&results[2].reason instanceof Error&&/[\u0600-\u06ff]/.test(results[2].reason.message)?results[2].reason.message.slice(0,300):'لم نتمكن من قراءة بيانات الشركة الرسمية.'});
 const rawRegulatory=results[5].status==='fulfilled'?results[5].value:null;
 const regulatory=isHistorical&&rawRegulatory?{...rawRegulatory,facts:factsPublishedBefore(rawRegulatory.facts,asOf),news:rawRegulatory.news.filter(n=>validHistoricalDate(n.date)&&n.date<asOf)}:rawRegulatory;
 if(regulatory?.documents)checks.push(...regulatory.documents);
 if(regulatory){for(const f of regulatory.facts)if(!facts.some(v=>v.key===f.key&&v.period===f.period&&v.date===f.date&&v.currency===f.currency&&v.source===f.source&&v.value===f.value&&v.publishedAt===f.publishedAt))facts.push(f);checks.push({name:'إفصاحات SEC',url:regulatory.source,state:regulatory.facts.length?'ok':'partial',detail:'بنود XBRL مؤرخة بتاريخ النشر؛ فترات 3 أشهر وسنوات كاملة فقط، دون تحويل التدفق التراكمي إلى ربع.'})}
 else if(!isSaudi){const reason=results[5].status==='rejected'&&results[5].reason instanceof Error?results[5].reason.message:'';checks.push({name:'إفصاحات SEC',url:'https://www.sec.gov/search-filings',state:'missing',detail:/[\u0600-\u06ff]/.test(reason)?reason.slice(0,300):'تعذر الوصول إلى المصدر الرسمي أو لا يوجد ملف مطابق.'});}
 const n=results[4].status==='fulfilled'?results[4].value.news||[]:[];
 const relevantNews=n.filter((x:any)=>Array.isArray(x.relatedTickers)&&x.relatedTickers.some((ticker:unknown)=>typeof ticker==='string'&&ticker.toUpperCase()===symbol.toUpperCase()));
 const news:News[]=[...(regulatory?.news||[]),...(official?.news||[]),...relevantNews.filter((x:any)=>x.link?.startsWith('https://')&&finite(x.providerPublishTime)&&new Date(x.providerPublishTime*1000).toISOString().slice(0,10)<=publishedThrough).map((x:any)=>({title:String(x.title).slice(0,700),url:x.link,date:new Date(x.providerPublishTime*1000).toISOString().slice(0,10),kind:'news' as const}))].slice(0,12);
 checks.push({name:'الأخبار والإعلانات',url:chartSource,state:news.length?'ok':'missing',detail:news.length?`وصلت ${news.length} أخبار أو إفصاحات؛ تاريخ كل خبر ظاهر. استُبعدت الأخبار العامة التي لم يؤكد المزود ارتباطها بالرمز. لا يُستنتج أثره من العنوان وحده.`:'تعذر جلب هذا الجزء من المصدر المحدد؛ لم تصل أخبار قابلة للتحقق.'});
 checks.push({name:'الأحداث القادمة',url:official?.source||chartSource,state:'partial',detail:'تُعرض تواريخ الاستحقاق المنشورة إن وجدت. لم يكتمل التحقق من تقويم النتائج والجمعيات؛ غياب التاريخ لا يعني غياب حدث.'});
 const [peers,context]=await Promise.all([getPeers(company,asOf,read,isHistorical),getContext(company,asOf,read,isHistorical)]);
 checks.push({name:'السوق والقطاع',url:context.market?.source||chartSource,state:context.market&&context.sector?'ok':'partial',detail:`مرجع السوق ${context.market?.symbol||'غير متاح'}؛ مرجع القطاع ${context.sector?.symbol||'غير متاح'}.`});
 if(isHistorical){
  const priceCheck=checks.find(c=>c.name==='الأسعار اليومية');
  const first=chart.prices[0]?.date,last=chart.prices.at(-1)?.date;
  const start=Number(new URL(dailyChartURL(symbol,asOf,true,'5y')).searchParams.get('period1'))*1000;
  const shortHistory=chart.prices.length<504||!!first&&Date.parse(first)>start+14*86400000;
  const stale=!!last&&Date.parse(asOf)-Date.parse(last)>3*86400000;
  if(priceCheck&&chart.prices.length&&(shortHistory||stale)){priceCheck.state='partial';priceCheck.detail+=` التغطية التاريخية ${first} إلى ${last}؛ ${shortHistory?'نافذة السنوات الخمس غير مكتملة أو عينة التهيئة غير كافية. ':''}${stale?'آخر جلسة أقدم من تاريخ القطع بأكثر من 3 أيام.':''}`;}
  checks.push({name:'الوضع الزمني',url:chartSource,state:'partial',detail:`نوافذ يومية تنتهي عند ${asOf}؛ الماليات والأخبار مؤرخة قبل يوم القطع. لا سعر مباشر تاريخي ولا إثبات لاكتمال الأرشيف.`});
 }
 let liveQuote:LiveQuote|null=null;if(!isHistorical){try{liveQuote=parseLiveQuote({_mizanSource:chart.source,chart:{result:[{meta:chart.meta}]}},symbol)}catch{}}
 if(!isHistorical){
  for(const type of ['history','price','financials','filings'] as const){
   if(!observations.some(o=>o.dataType===type))observations.push({dataType:type,state:'unavailable',provenance:null,
    quality:{grade:'invalid',score:0,reasons:['لم تتوفر قراءة صالحة لهذا النوع ضمن Source Layer.']},fallbackUsed:false});
  }
  // Selection remains with resolveFinancialSources; never rank the same financial fact twice.
  const officialFinancials=observations.some(o=>o.dataType==='financials'&&o.state==='ok'&&o.provenance?.official);
  for(const o of observations)if(o.dataType==='financials'&&o.state==='ok'&&o.provenance?.source==='yahoo'&&!officialFinancials&&!official?.facts.length)o.fallbackUsed=true;
 }
 return {...(!isHistorical?{sourceLayer:{observations,attempts:read.sourceAttempts?.slice(attemptStart)??[]}}:{}),priceCoverage:chart.coverage,priceAdjustment:chart.adjustment,priceSourceId:chart.sourceId,company,asOf,retrievedAt:new Date().toISOString(),context,regulatory,liveQuote,corporateActions:chart.corporateActions,prices:chart.prices,priceSource:chart.source||chartSource,quoteTime:!isHistorical&&chart.meta.regularMarketTime?new Date(chart.meta.regularMarketTime*1000).toISOString():null,currency:chart.meta.currency||'',facts,official,news,peers,checks,warnings:[...(chart.coverage?[chart.coverage]:[]),...(chart.adjustment==='raw'?['أسعار خام غير معدلة؛ لم يُربط مسار إجراءات الشركات من هذا المزود، وتحتاج القفزات ومقارنة الأداء عبر التجزئة إلى تحقق منفصل.']:[]),...(chart.fallbackErrors||[]),...(isHistorical?[
  'تشغيل تاريخي يومي: استُبعدت الماليات بلا تاريخ نشر صالح والمنشورة في يوم القطع أو بعده؛ قد تبقى مضاعفات النظراء غير متاحة.',
  'استُبعدت الحقول اللحظية والأحداث القادمة من صفحة الشركة الحالية؛ تاريخ نشر الأحداث غير محفوظ في هذا المسار.',
  'دليل الشركات وعينة النظراء وتصنيف القطاع بيانات حالية وليست أرشيفاً تاريخياً؛ مرجع القطاع تقريب بحسب التصنيف الحالي، وتحيز البقاء قائم.',
  'قد تكون الأسعار معدلة بأثر إجراءات لاحقة، وقد تعيد المصادر البديلة نافذة أقصر؛ تحديد تاريخ الجلب وحده لا يثبت اكتمال البيانات وقت الحدث.',
  'اختيار المصدر البديل ما زال يتبع إعدادات المسار الحالي؛ هذا التعديل يقص البيانات إلى النافذة المطلوبة ولا يضمن تجربة بديل يغطي الأرشيف عند نقصها.'
 ]:[]),'البيانات من مصادر عامة؛ توافرها وتأخرها يختلفان بحسب السوق.','السلسلة السعرية من المزود، والعائد النقدي للتوزيعات غير داخل في مؤشرات حركة السعر.','النظراء، إن توفروا، عينة شركات متقاربة في النشاط وليست متوسط القطاع كله. عدد الأسهم المستخدم في تقييم النظراء يعود إلى آخر قائمة متاحة.'],mode:isHistorical?'historical':'current',...(isHistorical?{historicalNote:`بيانات يومية حتى ${asOf}؛ تاريخ النشر مقبول قبل يوم القطع فقط. اكتمال الأرشيف والتصنيف التاريخي غير متحققين.`}:{})};
}
