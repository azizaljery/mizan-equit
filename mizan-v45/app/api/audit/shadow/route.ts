import {env} from 'cloudflare:workers';
import {summarize,SHADOW_PARAMS,type ShadowRow,type ShadowOutcome} from '@/lib/audit-shadow';
/** Read-only summary of the forward shadow log of the /audit decision. Research only. */
export async function GET(){
 try{
  const db=(env as any).DB;
  const rows=((await db.prepare('SELECT id,symbol,asof,state,support,opposition,price FROM audit_shadow').all()).results||[]) as ShadowRow[];
  const outs=((await db.prepare('SELECT shadow_id,horizon,end_date,end_price,up FROM audit_shadow_outcomes').all()).results||[]) as ShadowOutcome[];
  return Response.json({...summarize(rows,outs),minResolvedPerGroup:SHADOW_PARAMS.minResolvedPerGroup},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch{return Response.json({error:'تعذر قراءة سجل الظل.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
