import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {adminSession} from '@/lib/admin-access';
import {StateInputError,listStateRows,listStateKeys,stateExists,readStateField,readStateSlices,stateId} from '@/lib/jobs/read-state';
const headers={'Cache-Control':'no-store, private',Vary:'Cookie'};
const error=(message:string,status:number)=>Response.json({error:message},{status,headers});
export async function GET(req:Request){
 try{
  const runtime=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL?:string};
  const origin=req.headers.get('origin');
  if(origin!==null&&origin!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return error('طلب غير مسموح.',403);
  if(!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''))return error('متاح لحساب مالك ميزان فقط.',403);
  if(!await adminSession(runtime.DB,req))return error('سجّل الدخول إلى إدارة ميزان.',401);
  const p=new URL(req.url).searchParams,mode=p.get('mode')??'list';
  const allowed=mode==='list'||mode==='keys'?['mode','offset','limit']:mode==='exists'?['mode','id']:mode==='fields'?['mode','id','fields']:mode==='slices'?['mode','id','offset','length','updatedAt']:[];
  if(!allowed.length||[...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))throw new StateInputError('نوع قراءة أو حقل غير معروف أو مكرر.');
  const number=(k:string)=>{const v=p.get(k);if(v===null)return undefined;if(!/^\d+$/.test(v))throw new StateInputError('قيمة عددية غير صالحة.');return Number(v);};
  if(mode==='list')return Response.json(await listStateRows(runtime.DB,{offset:number('offset'),limit:number('limit')}),{headers});
  if(mode==='keys')return Response.json(await listStateKeys(runtime.DB,{offset:number('offset'),limit:number('limit')}),{headers});
  const id=stateId(p.get('id'));
  if(mode==='exists')return Response.json({id,...await stateExists(runtime.DB,id)},{headers});
  if(mode==='fields'){
   const fields=(p.get('fields')??'').split(',').map(f=>f.trim());
   const result=await readStateField(runtime.DB,id,fields);
   return result?Response.json({id,fields:result},{headers}):error('السجل غير موجود.',404);
  }
  const result=await readStateSlices(runtime.DB,id,{offset:number('offset'),length:number('length'),updatedAt:p.get('updatedAt')??undefined});
  return result?Response.json(result,{headers}):error('السجل غير موجود.',404);
 }catch(e){return e instanceof StateInputError?error(e.message,400):error('تعذرت قراءة الحالة من قاعدة البيانات.',503);}
}
