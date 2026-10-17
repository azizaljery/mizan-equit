import { fetchLiveQuote } from '../lib/market-data';
import { configuredReader } from '../lib/source-status';
import { readSettings } from '../lib/site-settings';
import { MAINTENANCE_SLOT_CRON, slotJob } from '../lib/jobs/cron-slots';
import { listingRestriction } from '../lib/listing-lifecycle';

const LOCK_ID='cron:market-watch:v1';
// Own invocation: MAINTENANCE_SLOT_CRON at 01/07/13/19:30 UTC, after market collection (see lib/jobs/cron-slots.ts).
export const MARKET_WATCH_CRON=MAINTENANCE_SLOT_CRON;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);

export async function latestPublicForecasts(db:any,symbol:string){
  // Latest public forecast PER HORIZON, chosen in SQL: a flat LIMIT after ORDER BY horizon
  // let many short-horizon rows push longer horizons out before the recordClass filter.
  const result=await db.prepare(`SELECT id,horizon,created_at,model,data FROM (
    SELECT id,horizon,created_at,model,data,ROW_NUMBER() OVER (PARTITION BY horizon ORDER BY created_at DESC,id DESC) AS rn
    FROM forecast_records WHERE symbol=? AND available=1 AND json_valid(data) AND json_extract(data,'$.recordClass')='prospective-public'
  ) WHERE rn=1 ORDER BY horizon ASC`).bind(symbol).all();
  const byHorizon=new Map<number,any>();
  for(const row of result.results||[]){
    try{
      const forecast=JSON.parse(row.data);
      if(forecast.recordClass!=='prospective-public')continue;
      const horizon=Number(forecast.horizon??row.horizon);
      if(!Number.isFinite(horizon)||byHorizon.has(horizon))continue;
      byHorizon.set(horizon,{
        id:forecast.id||row.id,
        horizon,
        sessions:forecast.sessions,
        direction:forecast.direction,
        referencePrice:forecast.price,
        predictedPrice:forecast.predictedPrice,
        range:forecast.range,
        confidence:forecast.confidence,
        model:forecast.model||row.model,
        createdAt:forecast.createdAt||row.created_at,
        priceTime:forecast.priceTime,
        source:forecast.source,
        recordClass:'prospective-public',
      });
    }catch(e){console.error('[mizan-market-watch]','parse-forecast',symbol,errorText(e));}
  }
  return [...byHorizon.values()].sort((a,b)=>a.horizon-b.horizon);
}
export async function scheduledMarketWatch(controller:{cron:string;scheduledTime:number},env:any){
  if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==MARKET_WATCH_CRON||slotJob(controller)!=='market-watch')return;
  const result=await runMarketWatchCycle(controller,env);
  // The scheduled dispatcher discards return values; log the outcome so failures are visible in Workers logs.
  if(result){
    console.log('[mizan-market-watch]',JSON.stringify({status:result.status,symbols:(result as any).symbols??null,saved:(result as any).saved??null,errors:((result as any).errors??[]).length}));
    if(result.status!=='completed')console.error('[mizan-market-watch]','result',result.status,errorText((result as any).error??((result as any).errors??[]).slice(0,3).join(' | ')));
  }
  return result;
}
async function runMarketWatchCycle(controller:{cron:string;scheduledTime:number},env:any){
  const db=env.DB; const token=crypto.randomUUID(); const now=Date.now();
  try{
    const lock=await db.prepare(`INSERT INTO research_locks(id,token,until_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until_ms=excluded.until_ms WHERE until_ms<? RETURNING token`).bind(LOCK_ID,token,now+10*60*1000,now).first();
    if(lock?.token!==token)return;
    const settings=await readSettings(db),read=await configuredReader(db,settings);
    const rows=await db.prepare('SELECT DISTINCT symbol,market FROM customer_market_watch').all();
    const seen=new Set<string>(),errors:string[]=[],excludedKnownInactive:string[]=[]; let saved=0;
    for(const row of rows.results||[]){
      const symbol=String(row.symbol); if(seen.has(symbol))continue; seen.add(symbol);
      if(!settings.enabledMarkets.includes(row.market))continue;
      // Keep the user's saved watch entry and forecast archive; skip only current collection.
      if(listingRestriction(symbol)){excludedKnownInactive.push(symbol);continue;}
      try{
        const q=await fetchLiveQuote(symbol,read);
        const observedAt=q.quoteTime||new Date().toISOString();
        const forecastSnapshot=await latestPublicForecasts(db,symbol);
        const comparison=forecastSnapshot.map((forecast:any)=>{
          const predicted=Number(forecast.predictedPrice);
          const distancePct=Number.isFinite(predicted)&&predicted!==0?((q.price-predicted)/predicted)*100:null;
          return {horizon:forecast.horizon,predictedPrice:Number.isFinite(predicted)?predicted:null,distancePct,direction:forecast.direction};
        });
        const data={symbol,market:row.market,price:q.price,currency:q.currency,changePct:q.changePct,quoteTime:q.quoteTime,retrievedAt:q.retrievedAt,isOpen:q.isOpen,delayed:q.delayed,ageSeconds:q.ageSeconds,source:q.source,coverage:q.coverage,forecastSnapshot,forecastComparison:{state:comparison.length?'available':'unavailable',items:comparison,note:'فارق السعر عن الهدف المتوقع؛ لا يمثل تقييم الدقة قبل نضج الأفق.'}};
        await db.prepare('INSERT OR IGNORE INTO market_observations(id,symbol,market,observed_at,source,data) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),symbol,row.market,observedAt,q.source,JSON.stringify(data)).run();
        saved++;
      }catch(e){console.error('[mizan-market-watch]','symbol',symbol,errorText(e));errors.push(symbol+': '+(e instanceof Error?e.message:'تعذر الجلب')); }
    }
    await db.prepare('DELETE FROM research_locks WHERE id=? AND token=?').bind(LOCK_ID,token).run();
    return {status:errors.length?'partial':'completed',symbols:seen.size,saved,excludedKnownInactive,errors:errors.slice(0,20),cron:controller.cron,scheduledTime:controller.scheduledTime};
  }catch(e){
    console.error('[mizan-market-watch]','cycle','*',errorText(e));
    try{await db.prepare('DELETE FROM research_locks WHERE id=? AND token=?').bind(LOCK_ID,token).run();}catch(release){console.error('[mizan-market-watch]','release-lock','*',errorText(release));}
    return {status:'failed',error:e instanceof Error?e.message:'تعذر تشغيل مراقبة السوق.'};
  }
}
