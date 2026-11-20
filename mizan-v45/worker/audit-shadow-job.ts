/** Daily shadow log of the /audit decision (research only). Runs after the macro refresh; any failure is reported and never blocks it. */
import {configuredReader} from '../lib/source-status';
import {dailyChartURL,parseChart} from '../lib/market-data';
import {validateMarketIdentity} from '../lib/market-identity';
import {SHADOW_SYMBOLS,shadowRow,resolveOutcomes,type ShadowRow} from '../lib/audit-shadow';

export async function runAuditShadow(db:any,now:number){
 const read=await configuredReader(db),today=new Date(now).toISOString().slice(0,10),iso=new Date(now).toISOString(),started=Date.now();
 const out={logged:0,resolved:0,errors:[] as string[]};
 for(const symbol of SHADOW_SYMBOLS){
  if(Date.now()-started>20000){out.errors.push('time_budget');break;}
  try{
   const data=await read(dailyChartURL(symbol,today,false,'1y'),true,300000);
   validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol);
   const prices=parseChart(data,today).prices,row=shadowRow(symbol,prices,today);
   if(row){
    const r=await db.prepare('INSERT OR IGNORE INTO audit_shadow(id,symbol,asof,state,support,opposition,price,logged_at) VALUES(?,?,?,?,?,?,?,?)').bind(row.id,row.symbol,row.asof,row.state,row.support,row.opposition,row.price,iso).run();
    out.logged+=r?.meta?.changes??0;
   }
   const logged=((await db.prepare('SELECT id,symbol,asof,state,support,opposition,price FROM audit_shadow WHERE symbol=? ORDER BY asof DESC LIMIT 60').bind(symbol).all()).results||[]) as ShadowRow[];
   const have=new Set(((await db.prepare('SELECT shadow_id||\'|\'||horizon k FROM audit_shadow_outcomes WHERE shadow_id IN (SELECT id FROM audit_shadow WHERE symbol=?)').bind(symbol).all()).results||[]).map((x:any)=>x.k));
   for(const o of resolveOutcomes(logged,prices,have)){
    const r=await db.prepare('INSERT OR IGNORE INTO audit_shadow_outcomes(shadow_id,horizon,end_date,end_price,up,resolved_at) VALUES(?,?,?,?,?,?)').bind(o.shadow_id,o.horizon,o.end_date,o.end_price,o.up,iso).run();
    out.resolved+=r?.meta?.changes??0;
   }
  }catch(e){out.errors.push(`${symbol}: ${(e instanceof Error?e.message:String(e)).slice(0,80)}`);}
 }
 return out;
}
