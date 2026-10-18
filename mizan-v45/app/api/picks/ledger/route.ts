import {env} from 'cloudflare:workers';
import {validLedgerRequest,ledgerStats,type StatRow} from '@/lib/daily-picks';
import {MODEL_VERSION,PROTOCOL_COMMIT,DISPLAY_TOP,TOP_FRACTION,MARKETS,UNIVERSE,type LedgerMarket} from '@/lib/daily-picks-universe';
import {eligibleSaudiCompanies} from '@/lib/saudi-directory';
import {eligibleUSCompanies} from '@/lib/us-directory';

const headers={'Cache-Control':'public, max-age=60'};
let names:Map<string,string>|undefined;
function nameOf(symbol:string){
 if(!names){names=new Map();const wanted=new Set([...UNIVERSE.sa,...UNIVERSE.us]);
  for(const c of [...eligibleSaudiCompanies('directory'),...eligibleUSCompanies()])if(wanted.has(c.symbol)&&!names.has(c.symbol))names.set(c.symbol,c.name);}
 return names.get(symbol)||symbol;
}
const COLS=`id,pick_date,market,horizon,symbol,rank,universe_size,percentile,mom126_5,in_top,ref_price,ref_price_date,currency,mizan_predicted_price,
 mizan_forecast_id,target_date,actual_price,actual_change_pct,went_up,outcome_state,evaluated_at,created_at`;
const withName=(r:any)=>({...r,name:nameOf(String(r.symbol))});

/** Read-only «سجل الترشيحات اليومي» (PROTOCOL-DIR-0002): displayed top-3 per date + outcomes + descriptive stats. */
export async function GET(request:Request){
 let req;try{const p=new URL(request.url).searchParams;req=validLedgerRequest(p.get('market'),p.get('horizon'),p.get('limit'));}
 catch(e){return Response.json({error:e instanceof Error?e.message:'طلب غير صالح.'},{status:400,headers:{'Cache-Control':'no-store'}});}
 try{
  const db=(env as any).DB;
  const dates=((await db.prepare(`SELECT DISTINCT pick_date FROM daily_picks WHERE market=? AND horizon=? AND model_version=? ORDER BY pick_date DESC LIMIT ?`)
   .bind(req.market,req.horizon,MODEL_VERSION,req.limit).all()).results||[]).map((r:any)=>String(r.pick_date));
  const history=dates.length?((await db.prepare(`SELECT ${COLS} FROM daily_picks WHERE market=? AND horizon=? AND model_version=? AND in_top=1 AND rank<=? AND pick_date>=?
   ORDER BY pick_date DESC,rank ASC`).bind(req.market,req.horizon,MODEL_VERSION,DISPLAY_TOP,dates.at(-1)).all()).results||[]).map(withName):[];
  const statRows=((await db.prepare(`SELECT pick_date,rank,in_top,outcome_state,went_up,target_date FROM daily_picks WHERE market=? AND horizon=? AND model_version=? LIMIT 200000`)
   .bind(req.market,req.horizon,MODEL_VERSION).all()).results||[]) as StatRow[];
  const latestByMarket:Record<string,{date:string|null;picks:any[]}>={};
  for(const m of MARKETS as readonly LedgerMarket[]){
   const rows=((await db.prepare(`SELECT ${COLS} FROM daily_picks WHERE market=? AND horizon=? AND model_version=? AND in_top=1 AND rank<=?
    AND pick_date=(SELECT MAX(pick_date) FROM daily_picks WHERE market=? AND horizon=? AND model_version=?) ORDER BY rank`)
    .bind(m,req.horizon,MODEL_VERSION,DISPLAY_TOP,m,req.horizon,MODEL_VERSION).all()).results||[]).map(withName);
   latestByMarket[m]={date:rows[0]?.pick_date??null,picks:rows};
  }
  const lastRun=await db.prepare(`SELECT market,pick_date,status,universe_ok,universe_failed,created_at FROM daily_pick_runs WHERE market=? AND model_version=? ORDER BY pick_date DESC LIMIT 1`)
   .bind(req.market,MODEL_VERSION).first();
  return Response.json({market:req.market,horizon:req.horizon,modelVersion:MODEL_VERSION,protocolCommit:PROTOCOL_COMMIT,topFraction:TOP_FRACTION,displayTop:DISPLAY_TOP,
   generatedAt:new Date().toISOString(),latestByMarket,history,stats:ledgerStats(statRows,req.horizon),lastRun:lastRun??null},{headers});
 }catch(e){console.error('[mizan-picks-ledger]','read',e instanceof Error?e.message.slice(0,200):String(e));
  return Response.json({error:'تعذر قراءة سجل الترشيحات الآن؛ أعد المحاولة.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
