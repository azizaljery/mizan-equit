import {safeSourceUrl,type SourceConfig} from './admin-config';
import {validateMarketIdentity} from './market-identity';
import {parseLiveQuote} from './live-quote';
import {readAlpacaBars,type AlpacaConfig} from './alpaca-data';
import {parseChart} from './market-data';
export async function sourceFingerprint(source:SourceConfig){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source.url+'|'+source.adapter));return 'probe-'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
/** Registrable site of a host: last two labels, or three for second-level public suffixes such as gov.sa / com.sa. */
export function siteOf(host:string){const parts=host.toLowerCase().split('.');return parts.slice(/^(?:gov|com|org|net|edu|co|ac)$/.test(parts.at(-2)||'')&&(parts.at(-1)||'').length===2?-3:-2).join('.');}
const MAX_REDIRECTS=3;
export async function readExternalSource(url:string,fetcher:typeof fetch=fetch,timeoutMs=12000,options:{userAgent?:string}={}){
 safeSourceUrl(url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{let current=url,r!:Response;
 // Follow at most three redirects, each re-validated, and only within the same site (e.g. stats.gov.sa → www.stats.gov.sa/ar).
 for(let hop=0;;hop++){
  r=await fetcher(current,{redirect:'manual',credentials:'omit',headers:{Accept:'application/json,text/html;q=0.8',...(options.userAgent?{'User-Agent':options.userAgent}:{})},signal:controller.signal});
  if(r.status<300||r.status>=400)break;
  const location=r.headers.get('location');
  if(!location||hop>=MAX_REDIRECTS)throw Error('الرابط يعيد التوجيه أكثر من المسموح؛ استخدم الرابط النهائي ثم اختبره.');
  let next:string;try{next=new URL(location,current).href;safeSourceUrl(next);}catch{throw Error('الرابط يعيد التوجيه إلى عنوان غير صالح أو غير آمن؛ لم يُتبع.');}
  if(siteOf(new URL(next).hostname)!==siteOf(new URL(url).hostname))throw Error('الرابط يعيد التوجيه إلى موقع آخر ('+new URL(next).hostname+')؛ لم يُتبع. راجع الرابط واستخدم العنوان النهائي إن كان موثوقًا.');
  try{await r.body?.cancel();}catch{}
  current=next;
 }
 if(!r.ok)throw Error('تعذر جلب المصدر؛ رمز الاستجابة '+r.status+'.');
 const reader=r.body?.getReader();if(!reader)throw Error('المصدر أعاد محتوى فارغًا.');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>7000000){await reader.cancel();throw Error('استجابة المصدر أكبر من الحد.');}chunks.push(v.value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const raw=new TextDecoder().decode(bytes);if(!raw.trim())throw Error('المصدر أعاد محتوى فارغًا.');return {raw,contentType:r.headers.get('content-type')||'',status:r.status,finalUrl:current};
 }finally{clearTimeout(timer);}
}
export async function probeSource(source:SourceConfig,symbol='AAPL',fetcher:typeof fetch=fetch){
 if(!/^(?:[A-Z][A-Z0-9.-]{0,15}|\d{4,5}\.SR)$/.test(symbol))throw Error('أدخل رمز اختبار صحيحًا، مثل AAPL أو 2222.SR.');
 const url=source.url.replaceAll('{symbol}',encodeURIComponent(symbol)),checkedAt=new Date().toISOString();
 if(source.adapter==='alpaca')try{const d=await readAlpacaBars(symbol,'history',(await import('cloudflare:workers')).env as AlpacaConfig,fetcher);const series=parseChart(d,new Date().toISOString().slice(0,10));return {state:'partial',checkedAt,url,detail:`استُخرجت ${series.prices.length} شموع صحيحة من Alpaca؛ ${d._mizanCoverage}. يلزم استخدام البيانات في تحليل قبل وصف المصدر بأنه يعمل.`};}catch(e){return {state:'failed',checkedAt,url,detail:e instanceof Error?e.message:'تعذر الاتصال بـ Alpaca.'};}
 try{const response=await readExternalSource(url,fetcher);if(source.adapter==='chart-json'){
  const data=JSON.parse(response.raw),meta=data?.chart?.result?.[0]?.meta;validateMarketIdentity(meta,symbol);const q=parseLiveQuote(data,symbol);
  return {state:'partial',checkedAt,url,detail:'هوية وسعر مؤرخ مطابقان. وقت السعر: '+q.quoteTime+'؛ لم يُثبت استخدام سلسلة يومية صالحة في تحليل. نجاح هذا الاختبار لا يفعّل وصف يعمل.',quoteTime:q.quoteTime};
 }const moved=response.finalUrl!==url?` يعيد الرابط التوجيه داخل الموقع نفسه إلى ${response.finalUrl}؛ يُفضّل حفظ هذا العنوان النهائي.`:'';
 return {state:'partial',checkedAt,url,...(moved?{finalUrl:response.finalUrl}:{}),detail:'الرابط يستجيب.'+moved+' هذا رابط مراجعة: لا يستخرج ميزان منه سعرًا أو قائمة مالية آليًا، ولا يؤثر على التحليل.'};
 }catch(e){return {state:'failed',checkedAt,url,detail:e instanceof Error?e.message:'تعذر اختبار المصدر.'};}
}
