import {env} from 'cloudflare:workers';
import {MACRO_FEATURES} from '@/lib/integration/backtest';
/** Stored macro observations used by the integration test: one value per date (latest retrieval), no revisions invented. */
export async function GET(){
 try{
  const out:Record<string,{date:string;value:number}[]>={};
  for(const f of MACRO_FEATURES){
   const rows=(await (env as any).DB.prepare(`SELECT obs_date,value FROM macro_observations WHERE series_id=? ORDER BY obs_date ASC,retrieved_at ASC`).bind(f.id).all()).results||[];
   const byDate=new Map<string,number>();for(const r of rows)if(typeof r.value==='number'&&Number.isFinite(r.value))byDate.set(String(r.obs_date),r.value);
   out[f.id]=[...byDate].map(([date,value])=>({date,value}));
  }
  return Response.json({series:out},{headers:{'Cache-Control':'public, max-age=600'}});
 }catch{return Response.json({error:'تعذر قراءة بيانات الاقتصاد الكلي.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
