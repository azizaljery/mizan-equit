import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {readScreenerOperations,saveFollowupConfig,FOLLOWUP_LAST_ID} from '@/lib/screener-operations';
import {validateFollowupConfig} from '@/lib/screener-operations-core';
const headers={'Cache-Control':'no-store, private'};
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 try{return Response.json(await readScreenerOperations((env as any).DB),{headers});}
 catch{return Response.json({error:'تعذر قراءة الأداء؛ لا تُعرض أصفار بدل فشل القراءة.'},{status:503,headers});}
}
export async function POST(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 try{
  const raw=await req.text();if(raw.length>3000)throw Error('request-too-large');
  const config=validateFollowupConfig(JSON.parse(raw)),db=(env as any).DB;
  if(config.enabled){
   const row=await db.prepare('SELECT data FROM research_state WHERE id=?').bind(FOLLOWUP_LAST_ID).first();
   const proof=row?JSON.parse(row.data):null;
   const matches=proof?.status==='completed'&&proof?.trigger==='manual'&&proof?.stateSaved===true&&['sa','us'].every(m=>proof.markets?.[m]?.state==='complete'&&proof.markets[m].scanned===config.scanPerMarket)&&['scanPerMarket','resultCount','horizonSessions'].every(k=>proof.config?.[k]===config[k as keyof typeof config]);
   if(!matches)return Response.json({error:'يلزم نجاح تجربة كاملة للسوقين بنفس العدد والمدة قبل تفعيل التشغيل الدوري.'},{status:409,headers});
  }
  return Response.json(await saveFollowupConfig(db,config),{headers});
 }catch{return Response.json({error:'تعذر حفظ إعدادات المتابعة.'},{status:400,headers});}
}
