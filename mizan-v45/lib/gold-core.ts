// Gold is a distinct asset class. Never pass these values to the equity model.
export const TROY_OUNCE_GRAMS = 31.1034768;
export const GOLD_FRAMES = ['1min','5min','15min','30min','1h','4h','1day','1week','1month'] as const;
export type GoldFrame = typeof GOLD_FRAMES[number];
export type GoldCurrency = 'USD'|'SAR';
export type Karat = 24|21|18;
export type GoldProvider = 'goldapi'|'metalsdev';
export type GoldQuote = {
  symbol:'XAU/USD'; kind:'spot'; currency:'USD'; unit:'troy_ounce'; price:number;
  source:GoldProvider; sourceUrl:string; quoteTime:string; fetchedAt:string;
  timeBasis:'provider_timestamp'|'provider_collection'; feedDelaySeconds:number|null;
  bid:number|null; ask:number|null; open:number|null; high:number|null; low:number|null;
  previousClose:number|null; change:number|null; changePercent:number|null;
  marketState:'unknown';
};
export type GoldFx = {rate:number;base:'USD';quote:'SAR';priceTime:string;fetchedAt:string;source:string;sourceUrl:string;frequency:'daily'};
export type GoldBar = {time:string;open:number;high:number;low:number;close:number};
export type GoldSeries = {symbol:'XAU/USD';unit:'troy_ounce';currency:'USD';frame:GoldFrame;bars:GoldBar[];source:string;sourceUrl:string;fetchedAt:string;timeBasis:'UTC candle opening'|'provider session date'};
export const GOLD_SOURCE_INFO = {
  goldapi:{name:'GoldAPI.io',url:'https://www.goldapi.io/',docs:'https://www.goldapi.io/llms.txt',key:'GOLDAPI_KEY'},
  metalsdev:{name:'Metals.dev',url:'https://metals.dev/',docs:'https://metals.dev/docs',key:'METALS_DEV_API_KEY'},
  twelvedata:{name:'Twelve Data',url:'https://twelvedata.com/commodities',docs:'https://twelvedata.com/docs',key:'TWELVE_DATA_API_KEY'},
  exchangerate:{name:'ExchangeRate-API',url:'https://www.exchangerate-api.com',docs:'https://www.exchangerate-api.com/docs/free',key:''},
};
export function isGoldQuery(raw:string){return /^(?:الذهب|ذهب|gold|xau|xau[ /-]?usd|(?:24|21|18)\s*k|عيار\s*(?:24|21|18))$/i.test(raw.trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)));}
export function asksAboutGold(raw:string){
  // An issuer or comparison containing the word Gold must stay in equity search.
  if(/\b(?:barrick|kinross|newmont|gold\s+(?:corp|inc|fields|mining|resources))\b|(?:سهم|أسهم|شركة|شركه|قارن)/i.test(raw))return false;
  return /(?:\b(?:gold|xau(?:[ /-]?usd)?|(?:24|21|18)\s*k)\b|(?:^|\s)(?:الذهب|ذهب|عيار\s*[١٢٤٨0-9]+)(?:\s|$|[؟?.,،]))/i.test(raw);
}
export function goldNumber(v:unknown):number|null{if(typeof v!=='number'&&typeof v!=='string')return null;if(typeof v==='string'&&!v.trim())return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function positive(v:unknown,label:string){const n=goldNumber(v);if(n===null||n<=0)throw Error(label+' غير صالح.');return n;}
export function goldGramPrice(ounce:number,karat:Karat,currency:GoldCurrency,fx:number|null){
  positive(ounce,'سعر الأونصة');if(![24,21,18].includes(karat))throw Error('العيار غير مدعوم.');
  if(currency!=='USD'&&currency!=='SAR')throw Error('العملة غير مدعومة.');
  return ounce/TROY_OUNCE_GRAMS*(karat/24)*(currency==='SAR'?positive(fx,'سعر الصرف'):1);
}
export function goldProductValue(ounce:number,grams:number,purity:number,currency:GoldCurrency,fx:number|null,extraCost:number){
  positive(grams,'الوزن');positive(purity,'النقاوة');if(purity>1||!Number.isFinite(extraCost)||extraCost<0)throw Error('النقاوة أو التكلفة الإضافية غير صالحة.');
  const metal=goldGramPrice(ounce,24,currency,fx)*purity*grams;
  return {metal,extraCost,total:metal+extraCost,fineGrams:grams*purity};
}
function timestamp(value:unknown,now:number){
  const n=typeof value==='number'?value*1000:typeof value==='string'?Date.parse(value):NaN;
  if(!Number.isFinite(n)||n<=0||n>now+60000)throw Error('توقيت المصدر غير صالح أو في المستقبل.');return new Date(n).toISOString();
}
export function parseGoldQuote(source:GoldProvider,data:any,now=Date.now()):GoldQuote{
  const isPrimary=source==='goldapi';
  if(isPrimary?(data?.metal!=='XAU'||data?.currency!=='USD'||data?.unit!=='troy_ounce'):(data?.status!=='success'||data?.metal!=='gold'||data?.currency!=='USD'||data?.unit!=='toz'))throw Error('لم تتطابق هوية الذهب الفوري أو الدولار أو الأونصة الترويسية.');
  if(data.kind&&data.kind!=='spot'||data.type&&/future|cfd/i.test(data.type)||data.symbol&&/fut|=F|GC[=\d]/i.test(data.symbol))throw Error('المصدر لا يمثل سعر الذهب الفوري المطلوب.');
  const rate=isPrimary?data:data.rate,price=positive(rate?.price,'سعر الذهب');
  // Broad corruption guard, not a forecast ceiling or a market valuation.
  if(price>1e7)throw Error('سعر غير منطقي؛ يلزم التحقق من وحدة المصدر.');
  const optional=(v:unknown)=>{const n=goldNumber(v);return n!==null&&n>0?n:null;};
  const bid=optional(rate.bid),ask=optional(rate.ask),high=optional(isPrimary?rate.high_price:rate.high),low=optional(isPrimary?rate.low_price:rate.low),open=optional(rate.open_price);
  if(bid!==null&&ask!==null&&bid>ask||high!==null&&low!==null&&high<low)throw Error('أسعار المصدر متعارضة داخليًا.');
  let previousClose=optional(rate.prev_close_price),change=goldNumber(rate.change);
  if(previousClose===null&&change!==null&&price-change>0)previousClose=price-change;
  if(previousClose!==null)change=price-previousClose;
  const quoteTime=timestamp(isPrimary?(data.timestamp??data.datetime):data.timestamp,now);
  if(isPrimary&&data.timestamp!=null&&data.datetime!=null&&Math.abs(Date.parse(quoteTime)-Date.parse(timestamp(data.datetime,now)))>60000)throw Error('توقيتا المصدر غير متطابقين.');
  return {symbol:'XAU/USD',kind:'spot',currency:'USD',unit:'troy_ounce',price,source,sourceUrl:GOLD_SOURCE_INFO[source].url,quoteTime,fetchedAt:new Date(now).toISOString(),timeBasis:isPrimary?'provider_timestamp':'provider_collection',feedDelaySeconds:isPrimary?null:60,bid,ask,open,high,low,previousClose,change,changePercent:previousClose!==null&&change!==null?change/previousClose*100:null,marketState:'unknown'};
}
export function parseGoldFx(data:any,now=Date.now()):GoldFx{
  if(data?.result!=='success'||data.base_code!=='USD'||data.rates?.USD!==1)throw Error('هوية زوج الصرف غير صحيحة.');
  const rate=positive(data.rates?.SAR,'سعر الدولار بالريال');if(rate<0.1||rate>100)throw Error('وحدة سعر الصرف غير منطقية.');
  const priceTime=timestamp(data.time_last_update_unix,now);if(now-Date.parse(priceTime)>48*3600000)throw Error('مرجع الصرف أقدم من 48 ساعة.');
  return {rate,base:'USD',quote:'SAR',priceTime,fetchedAt:new Date(now).toISOString(),source:'ExchangeRate-API',sourceUrl:GOLD_SOURCE_INFO.exchangerate.url,frequency:'daily'};
}
export function goldFreshness(quote:GoldQuote|null,maxDelaySeconds=900,now=Date.now()){
  if(!quote)return {usable:false,label:'لم يصل سعر صالح',ageSeconds:null};
  const at=Date.parse(quote.quoteTime);if(!Number.isFinite(at)||at>now+60000)return {usable:false,label:'توقيت السعر غير صالح',ageSeconds:null};
  const age=Math.max(0,Math.floor((now-at)/1000)),effectiveAge=age+(quote.timeBasis==='provider_collection'?(quote.feedDelaySeconds??0):0),usable=effectiveAge<=maxDelaySeconds;
  return {usable,label:!usable?'آخر سعر معروف — تعذر تأكيد التحديث':quote.feedDelaySeconds===null?'وقت المصدر موثق — تأخير التغذية غير محدد':'متأخر بحسب التغذية',ageSeconds:age};
}
export function parseGoldSeries(data:any,frame:GoldFrame,now=Date.now()):GoldSeries{
  if(!GOLD_FRAMES.includes(frame)||data?.status==='error'||data?.meta?.symbol!=='XAU/USD'||data.meta.interval!==frame)throw Error('هوية الشارت أو إطاره الزمني غير متطابق.');
  if(data.meta.type&&/future|cfd|stock|equity|fund|etf/i.test(data.meta.type))throw Error('نوع الأداة لا يطابق الذهب الفوري.');
  if(data.meta.currency_quote&&data.meta.currency_quote!=='USD'||data.meta.currency&&data.meta.currency!=='USD')throw Error('عملة الشارت غير صحيحة.');
  const intraday=!['1day','1week','1month'].includes(frame);
  // The adapter explicitly requests timezone=UTC. exchange_timezone describes
  // the venue and is not proof of the returned datetime timezone.
  if(!Array.isArray(data.values)||!data.values.length||data.values.length>5000)throw Error('لم تصل شموع صالحة لهذا الإطار.');
  const seen=new Set<string>();const bars:GoldBar[]=data.values.map((v:any)=>{
    const str=String(v.datetime||'');if(!(intraday?/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(str))throw Error('تاريخ شمعة غير صالح.');
    const time=intraday?str.replace(' ','T')+'Z':str,date=Date.parse(time);
    if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==str.slice(0,10)||date>now+60000||seen.has(time))throw Error('شمعة مكررة أو مؤرخة بصورة غير صالحة.');seen.add(time);
    const open=positive(v.open,'الافتتاح'),high=positive(v.high,'الأعلى'),low=positive(v.low,'الأدنى'),close=positive(v.close,'الإغلاق');
    if(low>Math.min(open,close)||high<Math.max(open,close)||low>high)throw Error('قيم شمعة غير متسقة.');
    return {time,open,high,low,close};
  }).sort((a:GoldBar,b:GoldBar)=>a.time.localeCompare(b.time));
  return {symbol:'XAU/USD',unit:'troy_ounce',currency:'USD',frame,bars,source:'Twelve Data',sourceUrl:GOLD_SOURCE_INFO.twelvedata.url,fetchedAt:new Date(now).toISOString(),timeBasis:intraday?'UTC candle opening':'provider session date'};
}
export function convertGoldSeries(series:GoldSeries,karat:Karat|null,currency:GoldCurrency,fx:GoldFx|null){
  const factor=(karat===null?1:karat/24/TROY_OUNCE_GRAMS)*(currency==='SAR'?positive(fx?.rate,'سعر الصرف'):1);
  return {factor,bars:series.bars.map(b=>({...b,open:b.open*factor,high:b.high*factor,low:b.low*factor,close:b.close*factor})),conversion:currency==='SAR'?`تحويل عرض بصرف ثابت ${fx!.rate} من ${fx!.priceTime}؛ ليست شموع ريال تاريخية فعلية.`:'سلسلة الدولار؛ لا يوجد افتراض صرف.'};
}
