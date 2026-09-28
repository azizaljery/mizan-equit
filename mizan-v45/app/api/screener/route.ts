import {env} from 'cloudflare:workers';
import {runScreener,planScreener} from '@/lib/screener';
import {createScreenerArchive,archivedScreenerBatch,finishScreenerArchive,screenerArchiveStatus} from '@/lib/screener-archive';
import {validateScreenerRequest,SCREENER_BATCH_SIZE} from '@/lib/screener-policy';
const headers={'Cache-Control':'no-store, private','Content-Type':'application/json; charset=utf-8'};
export async function POST(req:Request){
 let body:any;
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
 }catch(e){return Response.json({error:e instanceof SyntaxError?'JSON غير صالح.':e instanceof Error?e.message:'طلب غير صالح.'},{status:400,headers});}
 try{
  const db=(env as unknown as {DB?:any}).DB;
  if(body.action==='plan')return Response.json(body.archive===true?await createScreenerArchive(db,body):await planScreener(db,body),{headers});
  if(body.action==='archive-batch')return Response.json(await archivedScreenerBatch(db,body.runId,body.runToken,body.batchIndex),{headers});
  if(body.action==='complete')return Response.json(await finishScreenerArchive(db,body.runId,body.runToken),{headers});
  if(body.action==='archive-status')return Response.json(await screenerArchiveStatus(db,body.runId,body.runToken),{headers});
  return Response.json(await runScreener(db,body),{headers});
 }catch(e){return Response.json({error:e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر إكمال المسح أو حفظه؛ لم يُعتمد الأرشيف.'},{status:503,headers});}
}
