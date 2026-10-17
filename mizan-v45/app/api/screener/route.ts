import {env} from 'cloudflare:workers';
import {runScreener,planScreener} from '@/lib/screener';
import {createScreenerArchive,archivedScreenerBatch,finishScreenerArchive,screenerArchiveStatus} from '@/lib/screener-archive';
import {validateScreenerRequest,SCREENER_BATCH_SIZE} from '@/lib/screener-policy';
const headers={'Cache-Control':'no-store, private','Content-Type':'application/json; charset=utf-8'};
/** Browsers always send Origin on POST; a cross-site page cannot spoof it. Non-browser callers
 * (CI verification scripts) omit it, and are still bounded by the per-request batch cap below. */
function crossOrigin(req:Request){const origin=req.headers.get('origin');return origin!==null&&origin!==new URL(req.url).origin;}
/** Client retries 502/503/504 only, so non-retryable Arabic errors must not be 503. */
function errorStatus(message:string):{status:number;retryAfter?:number}{
 if(/قيد التشغيل/.test(message))return {status:409,retryAfter:20};                    // busy batch lease
 if(/انتهت صلاحية/.test(message))return {status:410};                                   // expired run
 if(/غير متاح لهذه الجلسة/.test(message))return {status:404};                           // unknown run/token
 if(/تغيرت إعدادات النموذج|تغير إعداد المسح/.test(message))return {status:409};          // model changed: restart, do not retry
 if(/بالترتيب|خارج الخطة|غير صالح|غير مكتمل|بلا دفعات|متوقف من إعدادات|غير مدعوم|يجب أن يكون/.test(message))return {status:400};
 return {status:503};                                                                     // storage / provider / unknown
}
export async function POST(req:Request){
 let body:any;
 if(crossOrigin(req))return Response.json({error:'طلب غير مسموح من مصدر آخر.'},{status:403,headers});
 try{
  if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')return Response.json({error:'يجب إرسال الطلب بصيغة JSON.'},{status:415,headers});
  if(Number(req.headers.get('content-length'))>20000)return Response.json({error:'الطلب أكبر من الحد.'},{status:413,headers});
  const text=await req.text();if(text.length>20000)return Response.json({error:'الطلب أكبر من الحد.'},{status:413,headers});
  body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('طلب غير صالح.');
  if(body.action!==undefined&&!['plan','batch','archive-batch','complete','archive-status'].includes(body.action))throw new Error('إجراء فرز غير معروف.');
  if(!['archive-batch','complete','archive-status'].includes(body.action)){
   for(const field of ['scanLimit','limit'])if(body[field]!==undefined&&(!Number.isInteger(body[field])||body[field]<5||body[field]>200))throw new Error('عدد الأسهم المفحوصة يجب أن يكون من 5 إلى 200.');
   if(body.resultCount!==undefined&&(!Number.isInteger(body.resultCount)||body.resultCount<5||body.resultCount>10))throw new Error('عدد النتائج يجب أن يكون عددًا صحيحًا من 5 إلى 10.');
   validateScreenerRequest(body);
  }
  if(body.action==='batch'&&(!Array.isArray(body.symbols)||!body.symbols.length||body.symbols.length>SCREENER_BATCH_SIZE||typeof body.expectedVersion!=='string'||!body.expectedVersion))throw new Error('الدفعة تحتاج خطة ونُسخة نموذج، وبحد أقصى 5 أسهم.');
  // The action-less path used to scan up to 200 symbols in ONE public request. Cap it to one batch;
  // full scans go through plan + archive-batch (the UI path).
  if(body.action===undefined&&(!Array.isArray(body.symbols)||!body.symbols.length||body.symbols.length>SCREENER_BATCH_SIZE))throw new Error(`الطلب المباشر يقبل دفعة واحدة فقط (حتى ${SCREENER_BATCH_SIZE} رموز)؛ استخدم خطة المسح للمسح الكامل.`);
 }catch(e){return Response.json({error:e instanceof SyntaxError?'JSON غير صالح.':e instanceof Error?e.message:'طلب غير صالح.'},{status:400,headers});}
 try{
  const db=(env as unknown as {DB?:any}).DB;
  if(body.action==='plan')return Response.json(body.archive===true?await createScreenerArchive(db,body):await planScreener(db,body),{headers});
  if(body.action==='archive-batch')return Response.json(await archivedScreenerBatch(db,body.runId,body.runToken,body.batchIndex),{headers});
  if(body.action==='complete')return Response.json(await finishScreenerArchive(db,body.runId,body.runToken),{headers});
  if(body.action==='archive-status')return Response.json(await screenerArchiveStatus(db,body.runId,body.runToken),{headers});
  return Response.json(await runScreener(db,body),{headers});
 }catch(e){
  const arabic=e instanceof Error&&/[\u0600-\u06ff]/.test(e.message);
  const {status,retryAfter}=arabic?errorStatus((e as Error).message):{status:503,retryAfter:undefined};
  return Response.json({error:arabic?(e as Error).message:'تعذر إكمال المسح أو حفظه؛ لم يُعتمد الأرشيف.'},{status,headers:retryAfter?{...headers,'Retry-After':String(retryAfter)}:headers});
 }
}
