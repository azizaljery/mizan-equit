import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {adminSession} from '@/lib/admin-access';

export const botHeaders={'Cache-Control':'no-store, private'};
type Runtime={DB:any;RECOMMENDATION_OWNER_EMAIL:string};
export const botError=(message:string,status:number)=>Response.json({error:message},{status,headers:botHeaders});
export function rejectCrossOrigin(req:Request){
  const origin=req.headers.get('origin');
  return (origin!==null&&origin!==new URL(req.url).origin)||req.headers.get('sec-fetch-site')==='cross-site';
}
/** Same guard as /api/admin/run-background: owner identity AND an admin session. Returns the DB or a Response to send back. */
export async function botGuard(req:Request,write:boolean):Promise<{db:any}|Response>{
  const r=env as unknown as Runtime;
  if(write&&rejectCrossOrigin(req))return botError('طلب غير مسموح.',403);
  if(!ownerIdentity(req.headers,r.RECOMMENDATION_OWNER_EMAIL||''))return botError('متاح لحساب مالك ميزان فقط.',403);
  if(!await adminSession(r.DB,req))return botError('سجّل الدخول إلى إدارة ميزان لعرض البوت.',401);
  return {db:r.DB};
}
