import {env} from 'cloudflare:workers';
import {ownerIdentity} from './pin-lock';
import {adminSession} from './admin-access';

/** Hosting supplies the authenticated identity; a Cookie alone is not identity proof here.
 * This gate does not replace the route's existing adminSession check.
 */
export function authorizeAdminRequest(req:Request):Response|null {
 const runtime=env as unknown as {RECOMMENDATION_OWNER_EMAIL?:string};
 const headers={'Cache-Control':'no-store, private',Vary:'Cookie'};
 const deny=(error:string,status=403)=>Response.json({error},{status,headers});
 if(!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''))return deny('متاح لحساب مالك ميزان فقط.');
 try {
  const origin=req.headers.get('origin');
  if(req.headers.get('sec-fetch-site')==='cross-site'||(origin!==null&&origin!==new URL(req.url).origin))return deny('طلب مرفوض: مصدر غير موثوق.');
 }catch{return deny('طلب غير صالح.',400);}
 return null;
}

export async function authorizeAdminSession(req:Request):Promise<Response|null>{
 const denied=authorizeAdminRequest(req);if(denied)return denied;
 try{
  if(await adminSession((env as unknown as {DB:any}).DB,req))return null;
  return Response.json({error:'سجّل الدخول إلى إدارة ميزان.'},{status:401,headers:{'Cache-Control':'no-store, private'}});
 }catch{return Response.json({error:'تعذر التحقق من جلسة الإدارة.'},{status:503,headers:{'Cache-Control':'no-store, private'}});}
}
