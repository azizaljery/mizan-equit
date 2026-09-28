import {env} from 'cloudflare:workers';
import {adminSession} from '@/lib/admin-access';
import {readAzizArchiveStatus} from '@/lib/aziz/archive-status';
import {ownerIdentity} from '@/lib/pin-lock';

const headers={'Cache-Control':'no-store, private'};

export async function GET(req:Request){
 const runtime=env as any,{DB}=runtime;
 if(!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''))return Response.json({error:'يلزم حساب المالك.'},{status:403,headers});
 if(!DB||!await adminSession(DB,req))return Response.json({error:'انتهت جلسة الإدارة.'},{status:401,headers});
 try{return Response.json(await readAzizArchiveStatus(DB),{headers});}
 catch{return Response.json({error:'تعذر قراءة أرشيف عزيز من D1؛ تحقق من ترحيل الجداول.'},{status:503,headers});}
}
