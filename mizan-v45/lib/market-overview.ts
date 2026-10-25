// Market overview for the home page (owner request 2026-10-25): index price + descriptive analysis for the Saudi and
// US markets. Descriptive only — no forecast, no recommendation. Every number carries its source and time.
//
// Data reality (probe 2026-10-25): Yahoo serves ^TASI.SR live price, previous close and the intraday 1-minute series,
// but NOT its daily history (one point for any daily range). So TASI gets price/day change/intraday range, and the
// multi-period analysis for Saudi uses an explicitly labelled equal-weight proxy of Mizan's frozen 40-stock universe.
// US indices (^GSPC, ^IXIC, ^DJI) have full daily history.
import {SA_UNIVERSE,US_UNIVERSE} from './daily-picks-universe';
/** Same identification string the site already uses for Yahoo (lib/market-data.ts USER_AGENT); duplicated to keep this module light. */
const USER_AGENT='Mizan equity research https://mizan-equity.aljeryabod.chatgpt.site';

export type Bar={date:string;close:number};
export type Series={symbol:string;currency:string;price:number|null;previousClose:number|null;time:string|null;bars:Bar[];intraday:{high:number|null;low:number|null;points:number}};
export type Fetcher=(url:string)=>Promise<any>;
export type IndexAnalysis={
 symbol:string;name:string;currency:string;price:number|null;change:number|null;changePct:number|null;asOf:string|null;
 dayHigh:number|null;dayLow:number|null;
 returns:Record<'w1'|'m1'|'m3'|'ytd'|'y1',number|null>;
 ma50:number|null;ma200:number|null;aboveMa50:boolean|null;aboveMa200:boolean|null;
 rsi14:number|null;vol20:number|null;high52:number|null;low52:number|null;fromHigh52Pct:number|null;
 historyAvailable:boolean;historyNote?:string;source:string;
};
export type Breadth={universe:number;priced:number;advancers:number;decliners:number;unchanged:number;aboveMa50:number;aboveMa200:number;eligibleMa200:number;sessionDate:string|null};
export type MarketOverview={market:'sa'|'us';generatedAt:string;indices:IndexAnalysis[];proxy:IndexAnalysis|null;breadth:Breadth;summary:string[];notes:string[]};

const Y='https://query1.finance.yahoo.com/v8/finance/chart/';
const chartUrl=(symbol:string,interval:'1m'|'1d',range:'1d'|'1y'|'2y')=>`${Y}${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
export const quotePage=(symbol:string)=>`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
export const INDICES={sa:[{symbol:'^TASI.SR',name:'مؤشر السوق الرئيسية (تاسي)'},{symbol:'^NOMUC.SR',name:'مؤشر نمو الموازي'}],
 us:[{symbol:'^GSPC',name:'S&P 500'},{symbol:'^IXIC',name:'ناسداك المركب'},{symbol:'^DJI',name:'داو جونز الصناعي'},{symbol:'^VIX',name:'مؤشر التقلب VIX'}]} as const;

const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const r2=(v:number|null,d=2)=>v===null?null:Math.round(v*10**d)/10**d;

/** Parses a Yahoo chart response; refuses a response for another symbol. Drops null/invalid closes; never fills gaps. */
export function parseSeries(data:any,symbol:string):Series{
 const res=data?.chart?.result?.[0],meta=res?.meta;
 if(!meta||String(meta.symbol).toUpperCase()!==symbol.toUpperCase())throw Error('استجابة لرمز غير مطابق: '+symbol);
 const ts:number[]=res.timestamp||[],close:unknown[]=res.indicators?.quote?.[0]?.close||[],high:unknown[]=res.indicators?.quote?.[0]?.high||[],low:unknown[]=res.indicators?.quote?.[0]?.low||[];
 const bars:Bar[]=[];const seen=new Set<string>();
 ts.forEach((t,i)=>{const c=close[i];if(!num(t)||!num(c)||c<=0)return;const date=new Date(t*1000).toISOString().slice(0,10);if(seen.has(date)){bars[bars.length-1]={date,close:c};return;}seen.add(date);bars.push({date,close:c});});
 const hs=high.filter(num) as number[],ls=low.filter(num) as number[];
 return {symbol,currency:String(meta.currency||''),price:num(meta.regularMarketPrice)?meta.regularMarketPrice:null,previousClose:num(meta.chartPreviousClose)?meta.chartPreviousClose:num(meta.previousClose)?meta.previousClose:null,
  time:num(meta.regularMarketTime)?new Date(meta.regularMarketTime*1000).toISOString():null,bars,intraday:{high:hs.length?Math.max(...hs):null,low:ls.length?Math.min(...ls):null,points:ts.length}};
}

export function sma(closes:number[],n:number){return closes.length>=n?closes.slice(-n).reduce((a,b)=>a+b,0)/n:null;}
/** Wilder RSI over n periods; null when fewer than n+1 closes. */
export function rsi(closes:number[],n=14){
 if(closes.length<n+1)return null;let g=0,l=0;
 for(let i=1;i<=n;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;}
 let ag=g/n,al=l/n;
 for(let i=n+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n;}
 return al===0?100:100-100/(1+ag/al);
}
/** Annualised standard deviation of the last n daily log returns (252 sessions); null when too short. */
export function realizedVol(closes:number[],n=20){
 if(closes.length<n+1)return null;const r=[];for(let i=closes.length-n;i<closes.length;i++)r.push(Math.log(closes[i]/closes[i-1]));
 const m=r.reduce((a,b)=>a+b,0)/r.length,v=r.reduce((a,b)=>a+(b-m)**2,0)/(r.length-1);return Math.sqrt(v*252);
}
/** Return from the last close on or before the reference date to the latest close (in %). */
export function periodReturn(bars:Bar[],fromDate:string){
 if(bars.length<2)return null;const last=bars[bars.length-1];let base:Bar|null=null;
 for(const b of bars){if(b.date<=fromDate)base=b;else break;}
 return base&&base.date<last.date?(last.close/base.close-1)*100:null;
}
const shiftDays=(iso:string,days:number)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};

export function analyse(series:Series,name:string,live?:Series):IndexAnalysis{
 const bars=series.bars,closes=bars.map(b=>b.close),last=bars.at(-1)?.date??null;
 const price=live?.price??series.price,prev=live?.previousClose??(closes.length>=2?closes.at(-2)!:series.previousClose);
 const hist=closes.length>=60;
 const ma50=sma(closes,50),ma200=sma(closes,200),year=closes.slice(-252);
 const high52=year.length>=200?Math.max(...year):null,low52=year.length>=200?Math.min(...year):null;
 return {symbol:series.symbol,name,currency:series.currency,price:r2(price),change:price!==null&&prev!==null?r2(price-prev):null,changePct:price!==null&&prev?r2((price/prev-1)*100):null,
  asOf:live?.time??series.time,dayHigh:r2(live?.intraday.high??null),dayLow:r2(live?.intraday.low??null),
  returns:last?{w1:r2(periodReturn(bars,shiftDays(last,7))),m1:r2(periodReturn(bars,shiftDays(last,30))),m3:r2(periodReturn(bars,shiftDays(last,91))),ytd:r2(periodReturn(bars,String(Number(last.slice(0,4))-1)+'-12-31')),y1:r2(periodReturn(bars,shiftDays(last,365)))}:{w1:null,m1:null,m3:null,ytd:null,y1:null},
  ma50:r2(ma50),ma200:r2(ma200),aboveMa50:price!==null&&ma50!==null?price>ma50:null,aboveMa200:price!==null&&ma200!==null?price>ma200:null,
  rsi14:r2(rsi(closes.slice(-120)),1),vol20:r2(realizedVol(closes)===null?null:realizedVol(closes)!*100,1),high52:r2(high52),low52:r2(low52),
  fromHigh52Pct:price!==null&&high52?r2((price/high52-1)*100):null,historyAvailable:hist,
  ...(hist?{}:{historyNote:'المزود لا يقدّم التاريخ اليومي لهذا المؤشر؛ المعروض السعر وتغيّر اليوم ونطاقه فقط.'}),source:quotePage(series.symbol)};
}

/** Equal-weight proxy: average of each member's daily return on dates where at least 75% of members have a close. */
export function equalWeightProxy(members:Series[],minShare=0.75):Bar[]{
 const byDate=new Map<string,number[]>();
 for(const m of members){for(let i=1;i<m.bars.length;i++){const r=m.bars[i].close/m.bars[i-1].close-1;if(!Number.isFinite(r))continue;const a=byDate.get(m.bars[i].date)||[];a.push(r);byDate.set(m.bars[i].date,a);}}
 const need=Math.ceil(members.length*minShare),out:Bar[]=[];let level=100;
 for(const d of [...byDate.keys()].sort()){const rs=byDate.get(d)!;if(rs.length<need)continue;level*=1+rs.reduce((a,b)=>a+b,0)/rs.length;out.push({date:d,close:level});}
 return out;
}

export function breadth(members:Series[],universe:number):Breadth{
 const latest=members.map(m=>m.bars.at(-1)?.date).filter(Boolean).sort().at(-1)||null;
 let adv=0,dec=0,unc=0,a50=0,a200=0,e200=0,priced=0;
 for(const m of members){
  const b=m.bars;if(!b.length||b.at(-1)!.date!==latest)continue;priced++;
  const c=b.map(x=>x.close),last=c.at(-1)!,prev=c.length>1?c.at(-2)!:null;
  if(prev!==null){if(last>prev)adv++;else if(last<prev)dec++;else unc++;}
  const m50=sma(c,50),m200=sma(c,200);if(m50!==null&&last>m50)a50++;if(m200!==null){e200++;if(last>m200)a200++;}
 }
 return {universe,priced,advancers:adv,decliners:dec,unchanged:unc,aboveMa50:a50,aboveMa200:a200,eligibleMa200:e200,sessionDate:latest};
}

const pct=(v:number|null)=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
/** Rule-based description of the observed state. States facts; makes no prediction. */
export function describe(day:IndexAnalysis|null,trend:IndexAnalysis|null,b:Breadth,dayLabel:string,trendLabel:string):string[]{
 const out:string[]=[];
 if(day&&day.changePct!==null)out.push(`${dayLabel} ${day.changePct>0?'مرتفع':day.changePct<0?'منخفض':'دون تغيّر'} ${pct(day.changePct)} في آخر جلسة.`);
 if(trend&&trend.aboveMa200!==null)out.push(`${trendLabel}: `+(trend.aboveMa200?(trend.aboveMa50?'فوق متوسطي 50 و200 جلسة — اتجاه عام صاعد بالمقياس الوصفي.':'فوق متوسط 200 وتحت متوسط 50 — اتجاه عام صاعد مع ضعف قصير المدى.'):(trend.aboveMa50?'تحت متوسط 200 وفوق متوسط 50 — اتجاه عام هابط مع ارتداد قصير المدى.':'تحت متوسطي 50 و200 جلسة — اتجاه عام هابط بالمقياس الوصفي.')));
 if(trend&&trend.rsi14!==null)out.push(`${trendLabel}: مؤشر القوة النسبية (14) عند ${trend.rsi14}${trend.rsi14>=70?' — منطقة تشبع شرائي':trend.rsi14<=30?' — منطقة تشبع بيعي':''}.`);
 if(b.priced){const moved=b.advancers+b.decliners+b.unchanged;out.push(`اتساع السوق في عينة ميزان (${b.priced} شركة): ${b.advancers} صاعدة و${b.decliners} هابطة${moved?` (${Math.round(b.advancers/moved*100)}% صاعدة)`:''}${b.eligibleMa200?`، و${Math.round(b.aboveMa200/b.eligibleMa200*100)}% فوق متوسط 200 جلسة`:''}.`);}
 out.push('وصف للحالة المرصودة فقط، وليس توقعًا ولا توصية.');
 return out;
}

async function fetchJson(fetcher:Fetcher,url:string){return fetcher(url);}
export const defaultFetcher:Fetcher=async url=>{
 const host=new URL(url).hostname;if(host!=='query1.finance.yahoo.com')throw Error('مصدر غير مسموح.');
 const r=await fetch(url,{headers:{'User-Agent':USER_AGENT,Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'manual'});
 if(!r.ok)throw Error('HTTP '+r.status);return r.json();
};
async function pool<T,R>(items:readonly T[],n:number,fn:(t:T)=>Promise<R>){const out:PromiseSettledResult<R>[]=new Array(items.length);let i=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;try{out[k]={status:'fulfilled',value:await fn(items[k])};}catch(e){out[k]={status:'rejected',reason:e};}}}));return out;}

export async function buildOverview(market:'sa'|'us',fetcher:Fetcher=defaultFetcher,now=new Date()):Promise<MarketOverview>{
 const notes:string[]=[];const defs=INDICES[market];
 const indices=(await pool(defs,4,async d=>{
  const live=parseSeries(await fetchJson(fetcher,chartUrl(d.symbol,'1m','1d')),d.symbol);
  let daily:Series={...live,bars:[]};
  try{daily=parseSeries(await fetchJson(fetcher,chartUrl(d.symbol,'1d','1y')),d.symbol);}catch{}
  return analyse(daily,d.name,live);
 })).flatMap((r,i)=>{if(r.status==='fulfilled')return [r.value];notes.push(`تعذر جلب ${defs[i].name} الآن.`);return [];});
 const universe=market==='sa'?SA_UNIVERSE:US_UNIVERSE;
 const got=await pool(universe,8,async s=>parseSeries(await fetchJson(fetcher,chartUrl(s,'1d','1y')),s));
 const members=got.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
 if(members.length<universe.length)notes.push(`تعذر جلب ${universe.length-members.length} من ${universe.length} شركة في عينة الاتساع؛ الحساب على المتاح فقط.`);
 const b=breadth(members,universe.length);
 let proxy:IndexAnalysis|null=null;
 if(market==='sa'&&members.length>=Math.ceil(universe.length*0.75)){
  const bars=equalWeightProxy(members);
  if(bars.length>=60){proxy=analyse({symbol:'MIZAN-SA40-EW',currency:'نقاط',price:bars.at(-1)!.close,previousClose:bars.at(-2)?.close??null,time:bars.at(-1)!.date+'T12:00:00Z',bars,intraday:{high:null,low:null,points:0}},'مؤشر بديل: متوسط متساوي الأوزان لعينة ميزان (40 شركة سعودية كبيرة)');proxy.source='محسوب من أسعار الشركات الأربعين (Yahoo)';}
  notes.push('التاريخ اليومي لتاسي غير متاح من المزود؛ تحليل الفترات والمتوسطات للسوق السعودي محسوب على مؤشر بديل متساوي الأوزان من 40 شركة كبيرة، وليس تاسي نفسه.');
 }
 const summary=market==='sa'?describe(indices.find(x=>x.symbol==='^TASI.SR')??null,proxy,b,'تاسي','المؤشر البديل (40 شركة)'):describe(indices[0]??null,indices[0]??null,b,'مؤشر S&P 500','S&P 500');
 return {market,generatedAt:now.toISOString(),indices,proxy,breadth:b,summary,notes};
}
