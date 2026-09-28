import {safeSourceUrl,type SourceConfig} from './admin-config';
import {validateMarketIdentity} from './market-identity';
import {parseLiveQuote} from './live-quote';
import {readAlpacaBars,type AlpacaConfig} from './alpaca-data';
import {parseChart} from './market-data';
export async function sourceFingerprint(source:SourceConfig){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source.url+'|'+source.adapter));return 'probe-'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function readExternalSource(url:string,fetcher:typeof fetch=fetch,timeoutMs=12000,options:{userAgent?:string}={}){
 safeSourceUrl(url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const r=await fetcher(url,{redirect:'manual',credentials:'omit',headers:{Accept:'application/json,text/html;q=0.8',...(options.userAgent?{'User-Agent':options.userAgent}:{})},signal:controller.signal});
 if(r.status>=300&&r.status<400)throw Error('الرابط يعيد التوجيه؛ استخدم الرابط النهائي ثم اختبره.');
 if(!r.ok)throw Error('تعذر جلب المصدر؛ رمز الاستجابة '+r.status+'.');
 const reader=r.body?.getReader();if(!reader)throw Error('المصدر أعاد محتوى فارغًا.');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>7000000){await reader.cancel();throw Error('استجابة المصدر أكبر من الحد.');}chunks.push(v.value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const raw=new TextDecoder().decode(bytes);if(!raw.trim())throw Error('المصدر أعاد محتوى فارغًا.');return {raw,contentType:r.headers.get('content-type')||'',status:r.status};
 }finally{clearTimeout(timer);}
}
export async function probeSource(source:SourceConfig,symbol='AAPL',fetcher:typeof fetch=fetch){
 if(!/^(?:[A-Z][A-Z0-9.-]{0,15}|\d{4,5}\.SR)$/.test(symbol))throw Error('أدخل رمز اختبار صحيحًا، مثل AAPL أو 2222.SR.');
 const url=source.url.replaceAll('{symbol}',encodeURIComponent(symbol)),checkedAt=new Date().toISOString();
 if(source.adapter==='alpaca')try{const d=await readAlpacaBars(symbol,'history',(await import('cloudflare:workers')).env as AlpacaConfig,fetcher);const series=parseChart(d,new Date().toISOString().slice(0,10));return {state:'partial',checkedAt,url,detail:`استُخرجت ${series.prices.length} شموع صحيحة من Alpaca؛ ${d._mizanCoverage}. يلزم استخدام البيانات في تحليل قبل وصف المصدر بأنه يعمل.`};}catch(e){return {state:'failed',checkedAt,url,detail:e instanceof Error?e.message:'تعذر الاتصال بـ Alpaca.'};}
 try{const response=await readExternalSource(url,fetcher);if(source.adapter==='chart-json'){
  const data=JSON.parse(response.raw),meta=data?.chart?.result?.[0]?.meta;validateMarketIdentity(meta,symbol);const q=parseLiveQuote(data,symbol);
  return {state:'partial',checkedAt,url,detail:'هوية وسعر مؤرخ مطابقان. وقت السعر: '+q.quoteTime+'؛ لم يُثبت استخدام سلسلة يومية صالحة في تحليل. نجاح هذا الاختبار لا يفعّل وصف يعمل.',quoteTime:q.quoteTime};
 }return {state:'partial',checkedAt,url,detail:'الرابط يستجيب. لم يثبت هذا الاختبار استخراج سعر أو قائمة مالية منه؛ رابط مراجعة حتى يتوفر اتصال بيانات مناسب.'};
 }catch(e){return {state:'failed',checkedAt,url,detail:e instanceof Error?e.message:'تعذر اختبار المصدر.'};}
}
