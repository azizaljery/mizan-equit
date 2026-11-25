import {env} from 'cloudflare:workers';
import {buildBoard,NO_SIGNAL_PCT,type Cell,type BaseCell} from '@/lib/accuracy-board';
/** Read-only accuracy board for up-picks: aggregates stored outcomes (daily picks, bot signals, forecast model). Writes nothing. */
const FORECAST_SQL=`SELECT model engine,market,horizon,date,
 CASE WHEN state IS NULL OR state<>'complete' OR e IS NULL THEN 'unknown' WHEN e>=? THEN 'up' WHEN e<=-? THEN 'down' ELSE 'none' END signal,
 CASE WHEN state='complete' THEN 1 ELSE 0 END resolved,COUNT(*) n,SUM(CASE WHEN state='complete' AND a>0 THEN 1 ELSE 0 END) ups
 FROM (SELECT r.model,r.market,r.horizon,substr(r.created_at,1,10) date,json_extract(o.data,'$.state') state,json_extract(o.data,'$.metrics.expectedChangePct') e,json_extract(o.data,'$.metrics.actualChangePct') a
       FROM forecast_records r LEFT JOIN forecast_outcomes o ON o.id=r.id WHERE r.available=1 AND r.horizon IN (1,5,21))
 GROUP BY 1,2,3,4,5,6`;
const SIGNAL_SQL=`SELECT s.source engine,s.market,s.horizon,substr(s.issued_at,1,10) date,
 CASE s.direction WHEN 'up' THEN 'up' WHEN 'down' THEN 'down' ELSE 'none' END signal,
 CASE WHEN o.signal_id IS NULL THEN 0 ELSE 1 END resolved,COUNT(*) n,COALESCE(SUM(o.up),0) ups
 FROM bot_signals s LEFT JOIN bot_signal_outcomes o ON o.signal_id=s.id WHERE s.source<>'daily-picks-momentum' GROUP BY 1,2,3,4,5,6`;
const PICKS_SQL=`SELECT 'daily-picks-momentum' engine,market,horizon,pick_date date,CASE WHEN in_top=1 THEN 'up' ELSE 'none' END signal,
 CASE WHEN outcome_state='complete' THEN 1 ELSE 0 END resolved,COUNT(*) n,COALESCE(SUM(CASE WHEN outcome_state='complete' THEN went_up ELSE 0 END),0) ups
 FROM daily_picks WHERE outcome_state<>'unavailable' GROUP BY 1,2,3,4,5,6`;
const UNIVERSE_SQL=`SELECT market,horizon,pick_date date,COUNT(*) n,SUM(went_up) ups FROM daily_picks WHERE outcome_state='complete' GROUP BY 1,2,3`;
export async function GET(){
 try{
  const db=(env as any).DB;
  const q=async(sql:string,...p:any[])=>((await db.prepare(sql).bind(...p).all()).results||[]) as any[];
  const [f,s,p,u]=await Promise.all([q(FORECAST_SQL,NO_SIGNAL_PCT,NO_SIGNAL_PCT),q(SIGNAL_SQL),q(PICKS_SQL),q(UNIVERSE_SQL)]);
  const cells:Cell[]=[...f,...s,...p].map(r=>({...r,resolved:r.resolved===1,n:Number(r.n),ups:Number(r.ups||0)}));
  const base:BaseCell[]=u.map(r=>({...r,n:Number(r.n),ups:Number(r.ups||0)}));
  const forecastEngines=new Set(f.map(r=>r.engine));
  const rows=buildBoard(cells,base,e=>forecastEngines.has(e)?'self':'universe');
  return Response.json({rows,noSignalPct:NO_SIGNAL_PCT,generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch{return Response.json({error:'تعذر حساب لوحة الدقة.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
