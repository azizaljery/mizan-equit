/**
 * «سجل الترشيحات اليومي» job — PROTOCOL-DIR-0002 §4 (frozen at c831eb62). Own invocation: MAINTENANCE_SLOT_CRON at
 * 21:30 UTC (lib/jobs/cron-slots.ts). One provider pass per market (≤ 40 symbols + calendar), reused for BOTH phases:
 *   (a) record  — only when the market's latest session is new (weekend/holiday → nothing recorded, no duplicates);
 *   (b) evaluate— pending rows whose h-th session has passed; outcome written once.
 * Idempotent: deterministic row ids + UNIQUE(pick_date,market,horizon,symbol,model_version) + ON CONFLICT DO NOTHING,
 * all rows of a market-day and its run row in ONE D1 batch (transaction). Reference fields are protected by triggers.
 */
import {MAINTENANCE_SLOT_CRON,slotJob} from '../lib/jobs/cron-slots';
import {configuredReader} from '../lib/source-status';
import {readSettings} from '../lib/site-settings';
import {dailyChartURL,parseChart,SA_CALENDAR_PROXIES} from '../lib/market-data';
import {validateMarketIdentity} from '../lib/market-identity';
import {tryAcquireLock,releaseLock,withResolutionTimeout} from './scheduled';
import {MARKETS,UNIVERSE,CURRENCY,HORIZONS,MODEL_VERSION,US_CALENDAR_SYMBOL,type LedgerMarket} from '../lib/daily-picks-universe';
import {rankUniverse,buildLedgerRows,evaluateRow,unionCalendar,isNewSession,minCalendarDays,MIN_RANKED_FRACTION,type Close,type MizanForecast} from '../lib/daily-picks';

export const DAILY_PICKS_CRON=MAINTENANCE_SLOT_CRON;
export const DAILY_PICKS_STATE_ID='job:daily-picks:last';
const LOCK_ID='cron:daily-picks:v1';
const LOCK_MS=5*60*1000;
const FETCH_TIMEOUT_MS=12*1000;
const RUN_BUDGET_MS=4*60*1000; // stays inside the 5-minute lease
const CONCURRENCY=6;
const MIZAN_FORECAST_MAX_AGE_MS=4*86400000;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);
const logError=(stage:string,name:string,e:unknown)=>console.error('[mizan-daily-picks]',stage,name,errorText(e));

type Reader=(url:string,json?:boolean,ttl?:number,purpose?:'quote')=>Promise<any>;
export type MarketSummary={market:LedgerMarket;latestSession:string|null;lastRecorded:string|null;recorded:'recorded'|'gap'|'not-new-session'|'skipped'|'failed';
 rowsInserted:number;ranked:number;excluded:number;fetched:number;fetchFailed:number;due:number;evaluated:{complete:number;unavailable:number;stillPending:number};mizanForecasts:number;error?:string};
export type DailyPicksSummary={runId:string;startedAt:string;finishedAt:string;durationMs:number;triggeredBy:'cron'|'manual';modelVersion:string;
 status:'completed'|'partial'|'failed'|'locked';markets:MarketSummary[];errors:Array<{stage:string;name:string;error:string}>;stateSaved:boolean};

async function mapLimit<T,R>(items:readonly T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
 const out:R[]=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));
 return out;
}

/** Daily closes of one symbol from the site's configured reader, identity-checked like every other job. */
export async function fetchCloses(read:Reader,symbol:string,asOf:string):Promise<Close[]>{
 const data=await withResolutionTimeout(read(dailyChartURL(symbol,asOf,false,'1y'),true,300000),FETCH_TIMEOUT_MS);
 validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol);
 return parseChart(data,asOf).prices.map((p:{date:string;close:number})=>({date:p.date,close:p.close}));
}

async function latestMizanForecasts(db:any,market:LedgerMarket,now:number):Promise<Map<string,MizanForecast>>{
 const since=new Date(now-MIZAN_FORECAST_MAX_AGE_MS).toISOString(),universe=new Set(UNIVERSE[market]),out=new Map<string,MizanForecast>();
 const res=await db.prepare(`SELECT id,symbol,horizon,data FROM (
   SELECT id,symbol,horizon,data,ROW_NUMBER() OVER (PARTITION BY symbol,horizon ORDER BY created_at DESC,id DESC) AS rn
   FROM forecast_records WHERE market=? AND horizon IN (${HORIZONS.join(',')}) AND created_at>=? AND available=1 AND json_valid(data)
    AND json_extract(data,'$.recordClass')='prospective-public') WHERE rn=1`).bind(market,since).all();
 for(const r of res.results||[]){
  if(!universe.has(String(r.symbol)))continue;
  try{const d=JSON.parse(r.data),p=Number(d?.predictedPrice);if(Number.isFinite(p)&&p>0)out.set(r.symbol+'|'+Number(r.horizon),{id:String(r.id),predictedPrice:p});}
  catch(e){logError('mizan-forecast',String(r.symbol),e);}
 }
 return out;
}

const INSERT_PICK=`INSERT INTO daily_picks(id,pick_date,market,horizon,symbol,rank,universe_size,percentile,mom126_5,in_top,ref_price,ref_price_date,currency,
 mizan_predicted_price,mizan_forecast_id,model_version,protocol_commit,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;
const UPSERT_RUN=`INSERT INTO daily_pick_runs(id,market,pick_date,model_version,created_at,status,universe_ok,universe_failed,failures_json) VALUES(?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,status=excluded.status,universe_ok=excluded.universe_ok,universe_failed=excluded.universe_failed,failures_json=excluded.failures_json
 WHERE daily_pick_runs.status='gap'`;

async function runMarket(db:any,read:Reader,market:LedgerMarket,now:number,deadline:number,summary:DailyPicksSummary):Promise<MarketSummary>{
 const today=new Date(now).toISOString().slice(0,10),universe=UNIVERSE[market];
 const ms:MarketSummary={market,latestSession:null,lastRecorded:null,recorded:'skipped',rowsInserted:0,ranked:0,excluded:0,fetched:0,fetchFailed:0,due:0,evaluated:{complete:0,unavailable:0,stillPending:0},mizanForecasts:0};
 const fail=(stage:string,name:string,e:unknown)=>{logError(stage,name,e);if(summary.errors.length<40)summary.errors.push({stage,name,error:errorText(e)});};
 const last=await db.prepare(`SELECT MAX(pick_date) AS d FROM daily_pick_runs WHERE market=? AND model_version=? AND status='recorded'`).bind(market,MODEL_VERSION).first();
 ms.lastRecorded=last?.d??null;
 const dueRows=((await db.prepare(`SELECT id,symbol,pick_date,horizon,ref_price FROM daily_picks WHERE market=? AND model_version=? AND outcome_state='pending'
   AND julianday(?)-julianday(pick_date) >= CASE horizon WHEN 5 THEN ? ELSE ? END ORDER BY pick_date LIMIT 4000`)
  .bind(market,MODEL_VERSION,today,minCalendarDays(5),minCalendarDays(21)).all()).results||[]) as {id:string;symbol:string;pick_date:string;horizon:number;ref_price:number}[];
 ms.due=dueRows.length;

 // Calendar first (Tadawul proxy calendar = union of large caps; SPY for the US). It decides whether anything is needed.
 const series=new Map<string,Close[]|null>();
 const grab=async(symbol:string)=>{
  if(series.has(symbol))return series.get(symbol)!;
  if(Date.now()>deadline){series.set(symbol,null);ms.fetchFailed++;fail('fetch',symbol,'run-budget-exhausted');return null;}
  try{const c=await fetchCloses(read,symbol,today);series.set(symbol,c);ms.fetched++;return c;}
  catch(e){series.set(symbol,null);ms.fetchFailed++;fail('fetch',symbol,e);return null;}
 };
 const calSymbols=market==='sa'?[...SA_CALENDAR_PROXIES]:[US_CALENDAR_SYMBOL];
 const calendar=unionCalendar(await mapLimit(calSymbols,CONCURRENCY,grab));
 if(calendar.length<20){ms.recorded='failed';ms.error='تقويم الجلسات غير متاح من المزود؛ لا تسجيل ولا تقييم لهذا السوق اليوم (فجوة).';fail('calendar',market,ms.error);return ms;}
 const latest=calendar.at(-1)!;ms.latestSession=latest;
 const needRecord=isNewSession(latest,ms.lastRecorded);
 if(!needRecord)ms.recorded='not-new-session';
 if(!needRecord&&!dueRows.length)return ms;

 const symbols=needRecord?[...universe]:[...new Set(dueRows.map(r=>r.symbol))];
 await mapLimit(symbols,CONCURRENCY,grab);

 // (a) record
 if(needRecord){
  const {ranked,excluded}=rankUniverse(universe.map(symbol=>({symbol,closes:series.get(symbol)??null})),latest);
  ms.ranked=ranked.length;ms.excluded=excluded.length;
  const createdAt=new Date().toISOString(),runId=`${MODEL_VERSION}|${market}|${latest}`;
  const okEnough=ranked.length>=Math.ceil(universe.length*MIN_RANKED_FRACTION);
  const runStmt=(status:'recorded'|'gap')=>db.prepare(UPSERT_RUN).bind(runId,market,latest,MODEL_VERSION,createdAt,status,ranked.length,excluded.length,JSON.stringify(excluded));
  try{
   if(!okEnough){
    await runStmt('gap').run();ms.recorded='gap';
    fail('record',market,`ranked ${ranked.length}/${universe.length} < ${MIN_RANKED_FRACTION*100}% — day logged as gap`);
   }else{
    let mizan=new Map<string,MizanForecast>();
    try{mizan=await latestMizanForecasts(db,market,now);}catch(e){fail('mizan-forecast',market,e);} // optional field; NULL when unavailable
    ms.mizanForecasts=mizan.size;
    const rows=buildLedgerRows(market,latest,ranked,CURRENCY[market],createdAt,mizan);
    const res=await db.batch([...rows.map(r=>db.prepare(INSERT_PICK).bind(r.id,r.pick_date,r.market,r.horizon,r.symbol,r.rank,r.universe_size,r.percentile,r.mom126_5,r.in_top,
     r.ref_price,r.ref_price_date,r.currency,r.mizan_predicted_price,r.mizan_forecast_id,r.model_version,r.protocol_commit,r.created_at)),runStmt('recorded')]);
    ms.rowsInserted=(res||[]).slice(0,rows.length).reduce((n:number,x:any)=>n+Number(x?.meta?.changes??0),0);
    ms.recorded='recorded';
   }
  }catch(e){ms.recorded='failed';ms.error='تعذر حفظ ترشيحات اليوم.';fail('record',market,e);}
 }

 // (b) evaluate (same series; target session from the market calendar)
 if(dueRows.length){
  const attempted=[...new Set(dueRows.map(r=>r.symbol))],okCount=attempted.filter(s=>series.get(s)).length;
  const providerHealthy=attempted.length>0&&okCount/attempted.length>=0.75;
  const evaluatedAt=new Date().toISOString(),updates:any[]=[];
  for(const r of dueRows){
   const ev=evaluateRow(r,{calendar,closes:series.get(r.symbol)??null,today,providerHealthy});
   if(ev.state==='pending'){ms.evaluated.stillPending++;continue;}
   if(ev.state==='complete'){ms.evaluated.complete++;
    updates.push(db.prepare(`UPDATE daily_picks SET target_date=?,actual_price=?,actual_change_pct=?,went_up=?,outcome_state='complete',evaluated_at=? WHERE id=? AND outcome_state='pending'`)
     .bind(ev.targetDate,ev.actualPrice,ev.changePct,ev.wentUp?1:0,evaluatedAt,r.id));}
   else{ms.evaluated.unavailable++;
    updates.push(db.prepare(`UPDATE daily_picks SET target_date=?,went_up=0,outcome_state='unavailable',evaluated_at=? WHERE id=? AND outcome_state='pending'`).bind(ev.targetDate,evaluatedAt,r.id));}
  }
  for(let i=0;i<updates.length;i+=100){
   try{await db.batch(updates.slice(i,i+100));}catch(e){fail('evaluate',market,e);}
  }
 }
 return ms;
}

export async function runDailyPicks(db:any,options:{triggeredBy:'cron'|'manual';read?:Reader;now?:number}):Promise<DailyPicksSummary>{
 const start=Date.now(),now=options.now??start;
 const summary:DailyPicksSummary={runId:crypto.randomUUID(),startedAt:new Date(start).toISOString(),finishedAt:'',durationMs:0,triggeredBy:options.triggeredBy,modelVersion:MODEL_VERSION,
  status:'completed',markets:[],errors:[],stateSaved:false};
 let token:string|null=null;
 try{
  token=await tryAcquireLock(db,LOCK_ID,LOCK_MS);
  if(!token){summary.status='locked';summary.finishedAt=new Date().toISOString();summary.durationMs=Date.now()-start;return summary;}
  const read:Reader=options.read??await configuredReader(db,await readSettings(db));
  const deadline=start+RUN_BUDGET_MS;
  for(const market of MARKETS){
   try{summary.markets.push(await runMarket(db,read,market,now,deadline,summary));}
   catch(e){logError('market',market,e);summary.errors.push({stage:'market',name:market,error:errorText(e)});
    summary.markets.push({market,latestSession:null,lastRecorded:null,recorded:'failed',rowsInserted:0,ranked:0,excluded:0,fetched:0,fetchFailed:0,due:0,evaluated:{complete:0,unavailable:0,stillPending:0},mizanForecasts:0,error:'تعذر تشغيل السوق.'});}
  }
  if(summary.errors.length||summary.markets.some(m=>m.recorded==='failed'||m.recorded==='gap'))summary.status='partial';
  if(summary.markets.length&&summary.markets.every(m=>m.recorded==='failed'))summary.status='failed';
 }catch(e){logError('cycle','*',e);summary.status='failed';summary.errors.push({stage:'cycle',name:'*',error:errorText(e)});}
 finally{
  if(token||summary.status==='failed'){
   summary.finishedAt=new Date().toISOString();summary.durationMs=Date.parse(summary.finishedAt)-start;summary.stateSaved=true;
   try{await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
    .bind(DAILY_PICKS_STATE_ID,JSON.stringify(summary),summary.finishedAt).run();}
   catch(e){summary.stateSaved=false;logError('save-state','*',e);}
  }
  if(token)await releaseLock(db,LOCK_ID,token);
 }
 return summary;
}

export async function scheduledDailyPicks(controller:{cron:string;scheduledTime?:number},env:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string}){
 if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==DAILY_PICKS_CRON||slotJob(controller)!=='daily-picks')return;
 const result=await runDailyPicks(env.DB,{triggeredBy:'cron',now:Number.isFinite(controller.scheduledTime)?Number(controller.scheduledTime):undefined});
 console.log('[mizan-daily-picks]',JSON.stringify({status:result.status,durationMs:result.durationMs,markets:result.markets.map(m=>({market:m.market,latest:m.latestSession,recorded:m.recorded,rows:m.rowsInserted,ranked:m.ranked,due:m.due,evaluated:m.evaluated,fetchFailed:m.fetchFailed})),errors:result.errors.length}));
 if(result.status==='failed')console.error('[mizan-daily-picks]','result','failed',result.errors.slice(0,3).map(e=>`${e.stage}/${e.name}: ${e.error}`).join(' | '));
 return result;
}
