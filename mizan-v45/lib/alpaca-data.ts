import {searchUSDirectory} from './us-directory';
export type AlpacaConfig={ALPACA_API_KEY?:string;ALPACA_API_SECRET?:string;ALPACA_DATA_FEED?:string;ALPACA_DISPLAY_AUTHORIZED?:string;ALPACA_DELAY_MINUTES?:string};
const cache=new Map<string,{until:number;data:any}>(),inflight=new Map<string,Promise<any>>();
export function alpacaSetup(config:AlpacaConfig){
 if(config.ALPACA_DISPLAY_AUTHORIZED!=='true')throw Error('Alpaca ينتظر تأكيد حقوق عرض البيانات داخل ميزان على الخادم؛ لم يُشترَ اشتراك.');
 if(!config.ALPACA_API_KEY||!config.ALPACA_API_SECRET)throw Error('Alpaca يحتاج ALPACA_API_KEY وALPACA_API_SECRET في إعدادات الخادم الآمنة، وليس في المحادثة.');
 if(!['iex','sip'].includes(config.ALPACA_DATA_FEED||''))throw Error('حدد ALPACA_DATA_FEED صراحة: iex أو sip حسب الصلاحيات.');
 if(!['0','15'].includes(config.ALPACA_DELAY_MINUTES||''))throw Error('حدد تأخير خطة Alpaca في ALPACA_DELAY_MINUTES: 0 أو 15.');
 return {feed:config.ALPACA_DATA_FEED!,delay:Number(config.ALPACA_DELAY_MINUTES)};
}
/** Only the documented US bars GET endpoint; never accepts an arbitrary host or trading endpoint. */
export async function readAlpacaBars(symbol:string,purpose:'history'|'quote',config:AlpacaConfig,fetcher:typeof fetch=fetch,now=Date.now()){
 const {feed,delay}=alpacaSetup(config),company=searchUSDirectory(symbol).companies.find(c=>c.symbol===symbol&&c.instrument==='EQUITY'&&c.analysisAvailable!==false);
 if(!company||!/^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol))throw Error('الرمز لم يطابق سهمًا في الدليل الأمريكي؛ لا تُفترض هوية أو عملة.');
 const end=new Date(now-delay*60000).toISOString(),start=new Date(now-(purpose==='history'?5*366:7)*86400000).toISOString();
 const url=new URL('https://data.alpaca.markets/v2/stocks/bars');
 for(const [key,value]of Object.entries({symbols:symbol,timeframe:purpose==='history'?'1Day':'1Min',start,end,limit:purpose==='history'?'10000':'1',sort:purpose==='history'?'asc':'desc',currency:'USD',adjustment:'raw',feed}))url.searchParams.set(key,value);
 // Credential-scoped cache, bounded in size. No keys are logged or returned to the browser.
 const identityBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.ALPACA_API_KEY+'|'+config.ALPACA_API_SECRET));const identity=Array.from(new Uint8Array(identityBytes),b=>b.toString(16).padStart(2,'0')).join('');
 const key=[identity,symbol,purpose,feed,delay].join('|'),hit=cache.get(key);if(hit&&hit.until>now)return hit.data;if(inflight.has(key))return inflight.get(key);
 const work=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),purpose==='quote'?4000:10000);
  try{const response=await fetcher(url.href,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json','APCA-API-KEY-ID':config.ALPACA_API_KEY!,'APCA-API-SECRET-KEY':config.ALPACA_API_SECRET!}});
   if(!response.ok)throw Error(response.status===401||response.status===403?'Alpaca: صلاحية الوصول أو التغذية غير متاحة (HTTP '+response.status+').':response.status===429?'Alpaca: بلغ حد الطلبات (HTTP 429)؛ لم تُنفذ إعادة محاولة متكررة.':'Alpaca: تعذر الجلب (HTTP '+response.status+').');
   const reader=response.body?.getReader();if(!reader)throw Error('Alpaca أعاد محتوى فارغًا.');let size=0;const chunks:Uint8Array[]=[];
   for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>4000000){await reader.cancel();throw Error('استجابة Alpaca أكبر من الحد.');}chunks.push(c.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const payload=JSON.parse(new TextDecoder().decode(bytes));
   if(purpose==='history'&&payload.next_page_token)throw Error('سلسلة Alpaca تحتاج صفحات إضافية؛ لم يُعتمد تاريخ مبتور.');
   if(!payload.bars||!Object.hasOwn(payload.bars,symbol)||Object.keys(payload.bars).some(s=>s!==symbol)||!Array.isArray(payload.bars[symbol]))throw Error('رمز استجابة Alpaca غير مطابق.');
   const seen=new Set<string>(),bars=payload.bars[symbol].filter((b:any)=>{const t=Date.parse(b.t);if(!Number.isFinite(t)||t>now||seen.has(b.t)||![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||b.o<=0||b.c<=0||b.l<=0||b.v<0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c))return false;seen.add(b.t);return true;}).sort((a:any,b:any)=>Date.parse(a.t)-Date.parse(b.t));
   if(!bars.length)throw Error('لم تصل شموع Alpaca صالحة للرمز المطلوب.');const last=bars.at(-1);
   const exchange=/nasdaq/i.test(company.exchange)?'NASDAQ':/arca/i.test(company.exchange)?'NYSEARCA':/bats/i.test(company.exchange)?'BATS':/nyse|amex/i.test(company.exchange)?'NYSE':company.exchange;
   const data={_mizanSource:url.href,_mizanEndpoint:url.href,_mizanSourceId:'alpaca',_mizanCoverage:feed==='iex'?'IEX فقط — الحجم لا يمثل جميع البورصات الأمريكية':'SIP — تغذية مجمعة للأسهم الأمريكية وفق الصلاحيات',_mizanDelayMinutes:delay,_mizanAdjustment:'raw',_mizanPriceKind:purpose==='quote'?'minute-close':'daily-close',_mizanRetrievedAt:new Date(now).toISOString(),chart:{result:[{meta:{symbol,longName:company.name,currency:'USD',instrumentType:'EQUITY',exchangeName:exchange,fullExchangeName:exchange,dataGranularity:purpose==='history'?'1d':'1m',regularMarketPrice:last.c,regularMarketTime:Date.parse(last.t)/1000},timestamp:bars.map((b:any)=>Date.parse(b.t)/1000),indicators:{quote:[Object.fromEntries(['open','high','low','close','volume'].map((k,i)=>[k,bars.map((b:any)=>b[['o','h','l','c','v'][i]])]))]}}]}};
   if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,{until:now+(purpose==='quote'?15000:300000),data});return data;
  }finally{clearTimeout(timer);}
 })();inflight.set(key,work);try{return await work;}finally{inflight.delete(key);}
}
