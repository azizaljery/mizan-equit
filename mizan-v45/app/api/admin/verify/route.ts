import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {adminSession} from '@/lib/admin-access';
import {verifyProductionState} from '@/lib/jobs/verify-state';
const headers={'Cache-Control':'no-store, private','Content-Type':'application/json; charset=utf-8',Vary:'Cookie'};
const error=(message:string,status:number)=>Response.json({error:message},{status,headers});
export async function GET(req:Request){
  try{
    const r=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL?:string},origin=req.headers.get('origin');
    if(origin!==null&&origin!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return error('طلب غير مسموح.',403);
    if(!ownerIdentity(req.headers,r.RECOMMENDATION_OWNER_EMAIL||''))return error('متاح لحساب مالك ميزان فقط.',403);
    if(!await adminSession(r.DB,req))return error('سجّل الدخول إلى إدارة ميزان.',401);
    if(new URL(req.url).search)return error('هذا الفحص لا يقبل معاملات.',400);
    return Response.json(await verifyProductionState(r.DB),{headers});
  }catch{return error('تعذر التحقق من جلسة الإدارة أو قراءة الحالة.',503);}
}
