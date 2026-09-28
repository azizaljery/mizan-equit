import {env} from 'cloudflare:workers';
import {resolveGoldCredentials} from '@/lib/gold-credentials';
import {adminSession} from '@/lib/admin-access';
import {ownerIdentity} from '@/lib/pin-lock';
import {DEFAULT_GOLD_SETTINGS,getGoldQuote,goldRead,goldSettings,goldSetup,saveGoldSettings,validateGoldSettings,type GoldRuntime} from '@/lib/gold-service';
const headers={'Cache-Control':'no-store, private'};
export async function POST(req:Request){try{
  const runtime=env as unknown as GoldRuntime&{RECOMMENDATION_OWNER_EMAIL:string};
  if(req.headers.get('origin')!==new URL(req.url).origin||!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||'')||!await adminSession(runtime.DB,req))return Response.json({error:'يلزم حساب المالك وجلسة إدارة ميزان الحالية.'},{status:401,headers});
  const raw=await req.text();if(raw.length>12000)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw);
  let settings=await goldSettings(runtime.DB);
  if(b.action==='save')settings=await saveGoldSettings(runtime.DB,validateGoldSettings(b.settings),'save');
  else if(b.action==='reset')settings=await saveGoldSettings(runtime.DB,structuredClone(DEFAULT_GOLD_SETTINGS),'reset');
  else if(b.action==='restore'){const old=await goldRead<any>(runtime.DB,'settings-history:'+String(b.id));if(!old)throw Error('نسخة الإعدادات غير موجودة.');settings=await saveGoldSettings(runtime.DB,validateGoldSettings(old.old),'restore');}
  else if(b.action==='test')await getGoldQuote(runtime,settings);
  else if(b.action!=='load')throw Error('طلب غير صالح.');
  const records=await runtime.DB.prepare("SELECT id,data,updated_at FROM gold_state WHERE id LIKE 'status:%' OR id LIKE 'settings-history:%' OR id LIKE 'source-switch:%' ORDER BY updated_at DESC LIMIT 100").all();
  return Response.json({settings,setup:goldSetup(await resolveGoldCredentials(runtime),settings),records:(records.results||[]).map((r:any)=>({...r,data:JSON.parse(r.data)}))},{headers});
}catch(e){return Response.json({error:e instanceof Error?e.message:'تعذر حفظ إعدادات الذهب.'},{status:400,headers});}}
