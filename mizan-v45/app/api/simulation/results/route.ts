import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {SIM_SPEC,SIM_LABEL,SIM_SPEC_VERSION} from '@/lib/simulation/spec';
/** «محاكاة تاريخية» results: kept in their own table, never mixed with forecasts the live engine issued. */
async function fingerprint(){const b=new TextEncoder().encode(JSON.stringify(SIM_SPEC));const h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function GET(){
 try{
  const row=await (env as any).DB.prepare('SELECT id,label,spec_version,spec_fingerprint,payload,created_at FROM historical_simulations ORDER BY created_at DESC LIMIT 1').first();
  if(!row)return Response.json({run:null},{headers:{'Cache-Control':'no-store'}});
  return Response.json({run:{id:row.id,label:row.label,specVersion:row.spec_version,specFingerprint:row.spec_fingerprint,createdAt:row.created_at,result:JSON.parse(row.payload)}},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'تعذر قراءة المحاكاة المحفوظة.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
export async function POST(request:Request){
 const denied=await authorizeAdminSession(request);if(denied)return denied;
 try{
  const body=await request.json() as any,result=body?.result;
  if(!result||result.label!==SIM_LABEL||result.specVersion!==SIM_SPEC_VERSION||!Array.isArray(result.rows))return Response.json({error:'نتيجة غير صالحة.'},{status:400});
  const text=JSON.stringify(result);if(text.length>900000)return Response.json({error:'النتيجة أكبر من الحد.'},{status:413});
  const id=crypto.randomUUID();
  await (env as any).DB.prepare('INSERT INTO historical_simulations(id,label,spec_version,spec_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?)').bind(id,SIM_LABEL,SIM_SPEC_VERSION,await fingerprint(),text,new Date().toISOString()).run();
  return Response.json({id},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'تعذر حفظ المحاكاة.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
