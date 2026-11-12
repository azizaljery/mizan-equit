// BOT-0001 dashboard/admin queries. Reads are side-effect free; the only writes are the experiment lifecycle helpers
// (create / start / pause / stop), which respect the append-only triggers of drizzle/0018_paper_bot.sql.
import {CURRENT_STRATEGY,STRATEGY_V1,ledger,performance,valuation,type Fill,type Market,type StrategyConfig} from './engine';

type Db=any;
const all=async(db:Db,sql:string,...args:unknown[])=>((await db.prepare(sql).bind(...args).all()).results||[]) as any[];
const one=async(db:Db,sql:string,...args:unknown[])=>(await db.prepare(sql).bind(...args).first())||null;
/** A table that the migration has not created yet (or is empty) reads as "no data", never as an error. */
const safe=async<T>(f:()=>Promise<T>,fallback:T):Promise<T>=>{try{return await f();}catch{return fallback;}};

export const EXPORT_TABLES=['experiments','orders','fills','decisions','snapshots','signals','scorecard'] as const;
export type ExportTable=typeof EXPORT_TABLES[number];
const LIMIT=500;
const clampLimit=(n:unknown,max=5000)=>Math.min(Math.max(Math.trunc(Number(n))||LIMIT,1),max);

export async function listExperiments(db:Db){
  return all(db,'SELECT e.id,e.name,e.market,e.currency,e.initial_cash AS initialCash,e.mode,e.status,e.created_at AS createdAt,e.started_at AS startedAt,e.stopped_at AS stoppedAt,e.status_json AS statusJson,s.version AS strategyVersion FROM bot_experiments e JOIN bot_strategies s ON s.id=e.strategy_id ORDER BY e.created_at DESC');
}
export async function listOrders(db:Db,experimentId:string,limit?:number){
  return all(db,'SELECT id,created_at AS createdAt,symbol,horizon,side,quantity,status,status_reason AS statusReason,status_at AS statusAt,expires_at AS expiresAt,attempts,forecast_id AS forecastId,decision_id AS decisionId FROM bot_orders WHERE experiment_id=? ORDER BY created_at DESC,id DESC LIMIT ?',experimentId,clampLimit(limit));
}
export async function listFills(db:Db,experimentId:string,limit?:number){
  return all(db,'SELECT id,order_id AS orderId,created_at AS createdAt,symbol,horizon,side,quantity,quote_price AS quotePrice,fill_price AS fillPrice,commission,spread_cost AS spreadCost,slippage_cost AS slippageCost,currency,quote_time AS quoteTime,quote_age_seconds AS quoteAgeSeconds,price_source AS priceSource,forecast_id AS forecastId FROM bot_fills WHERE experiment_id=? ORDER BY created_at DESC,id DESC LIMIT ?',experimentId,clampLimit(limit));
}
export async function listDecisions(db:Db,experimentId:string,limit?:number){
  return all(db,'SELECT id,created_at AS createdAt,symbol,horizon,action,reason,forecast_id AS forecastId,forecast_created_at AS forecastCreatedAt,model_version AS modelVersion,strategy_version AS strategyVersion,data_json AS data FROM bot_decisions WHERE experiment_id=? ORDER BY created_at DESC,id DESC LIMIT ?',experimentId,clampLimit(limit));
}
export async function listSnapshots(db:Db,experimentId:string){
  return all(db,'SELECT snapshot_date AS date,created_at AS createdAt,cash,positions_value AS positionsValue,equity,benchmark_value AS benchmark,benchmark_name AS benchmarkName FROM bot_equity_snapshots WHERE experiment_id=? ORDER BY snapshot_date',experimentId);
}
export async function listSignals(db:Db,limit?:number){
  return safe(()=>all(db,'SELECT s.signal_key AS signalKey,s.source,s.source_version AS sourceVersion,s.market,s.symbol,s.horizon,s.direction,s.confidence,s.strength,s.issued_at AS issuedAt,s.forecast_id AS forecastId,o.resolved_at AS resolvedAt,o.start_price AS startPrice,o.end_price AS endPrice,o.up FROM bot_signals s LEFT JOIN bot_signal_outcomes o ON o.signal_id=s.id ORDER BY s.issued_at DESC LIMIT ?',clampLimit(limit)),[] as any[]);
}

/** Forecast accuracy per source/engine, kept separate (never merged). Baseline = share of ALL resolved outcomes of the same market and horizon that rose. */
export async function sourceScorecard(db:Db){
  return safe(async()=>{
    const rows=await all(db,`SELECT s.source,s.source_version AS sourceVersion,s.market,s.horizon,s.direction,o.up AS up
      FROM bot_signals s LEFT JOIN bot_signal_outcomes o ON o.signal_id=s.id`);
    const base=new Map<string,{n:number;up:number}>();
    for(const r of rows)if(r.up===0||r.up===1){const k=r.market+'|'+r.horizon,b=base.get(k)||{n:0,up:0};b.n++;b.up+=r.up;base.set(k,b);}
    const g=new Map<string,any>();
    for(const r of rows){
      const k=[r.source,r.sourceVersion,r.market,r.horizon].join('|');
      const x=g.get(k)||{source:r.source,sourceVersion:r.sourceVersion,market:r.market,horizon:r.horizon,signals:0,upCalls:0,resolved:0,upHit:0};
      x.signals++;
      if(r.direction==='up'){x.upCalls++;if(r.up===0||r.up===1){x.resolved++;x.upHit+=r.up;}}
      g.set(k,x);
    }
    return [...g.values()].map(x=>{const b=base.get(x.market+'|'+x.horizon);return {...x,
      hitRatePct:x.resolved?100*x.upHit/x.resolved:null,baselineUpPct:b&&b.n?100*b.up/b.n:null,
      edgePct:x.resolved&&b&&b.n?100*x.upHit/x.resolved-100*b.up/b.n:null};})
      .sort((a,b)=>a.source.localeCompare(b.source)||a.market.localeCompare(b.market)||a.horizon-b.horizon);
  },[] as any[]);
}

/** Everything the dashboard shows for one experiment. Cash/positions/realized P&L are rebuilt from fills alone (ledger). */
export async function experimentDashboard(db:Db,experimentId:string){
  const exp=await one(db,'SELECT e.*,s.version AS strategy_version,s.config_json AS strategy_config FROM bot_experiments e JOIN bot_strategies s ON s.id=e.strategy_id WHERE e.id=?',experimentId);
  if(!exp)return null;
  const fillRows=await all(db,'SELECT symbol,horizon,side,quantity,fill_price AS fillPrice,commission,spread_cost AS spreadCost,slippage_cost AS slippageCost,created_at AS createdAt,forecast_id AS forecastId FROM bot_fills WHERE experiment_id=? ORDER BY created_at,id',experimentId);
  const fills:Fill[]=fillRows.map(r=>({symbol:r.symbol,horizon:r.horizon,side:r.side,quantity:r.quantity,fillPrice:r.fillPrice,commission:r.commission,createdAt:r.createdAt,forecastId:r.forecastId}));
  let l:ReturnType<typeof ledger>|null=null,ledgerError:string|null=null;
  try{l=ledger(exp.initial_cash,fills);}catch(e){ledgerError=e instanceof Error?e.message:'ledger_error';}
  const snaps=await listSnapshots(db,experimentId);
  // Marks: last executed price per symbol (a stated simplification: the runner's daily snapshot is the authoritative equity).
  const marks:Record<string,number>={};for(const f of fills)marks[f.symbol]=f.fillPrice;
  const val=l?valuation(l,marks):null;
  const lastSnap=snaps.at(-1)||null;
  const perf=l?performance(exp.initial_cash,snaps.map((s:any)=>({date:s.date,equity:s.equity,benchmark:s.benchmark})),l.closed):null;
  const counts=await all(db,'SELECT status,COUNT(*) AS n FROM bot_orders WHERE experiment_id=? GROUP BY status',experimentId);
  const decisionCounts=await all(db,'SELECT action,COUNT(*) AS n FROM bot_decisions WHERE experiment_id=? GROUP BY action',experimentId);
  const abstainReasons=await all(db,"SELECT reason,COUNT(*) AS n FROM bot_decisions WHERE experiment_id=? AND action IN ('abstain','suspend','hold') GROUP BY reason ORDER BY n DESC LIMIT 12",experimentId);
  const unrealized=val?.unrealized??null;
  const totalCosts=fillRows.reduce((a,f)=>a+f.commission+f.spreadCost+f.slippageCost,0);
  return {
    experiment:{id:exp.id,name:exp.name,market:exp.market,currency:exp.currency,initialCash:exp.initial_cash,mode:exp.mode,status:exp.status,createdAt:exp.created_at,startedAt:exp.started_at,stoppedAt:exp.stopped_at,strategyVersion:exp.strategy_version,statusJson:safeJson(exp.status_json)},
    cash:l?.cash??null,positions:l?.positions??[],positionsValue:val?.positionsValue??null,equity:lastSnap?.equity??val?.equity??null,
    realized:l?.realized??null,unrealized,commissions:l?.commissions??null,totalCosts,closedTrades:l?.closed??[],
    performance:perf?{...perf,returnAfterCostsPct:perf.returnPct}:null,
    lastSnapshot:lastSnap,snapshots:snaps,orderCounts:Object.fromEntries(counts.map((c:any)=>[c.status,c.n])),decisionCounts:Object.fromEntries(decisionCounts.map((c:any)=>[c.action,c.n])),abstainReasons,ledgerError,
  };
}
const safeJson=(s:unknown)=>{try{return typeof s==='string'?JSON.parse(s):s;}catch{return {};}};

/** Rows for one export table. Always scoped by experiment except experiments/signals/scorecard (global). */
export async function exportRows(db:Db,table:ExportTable,experimentId?:string):Promise<Record<string,unknown>[]>{
  if(table==='experiments')return listExperiments(db);
  if(table==='signals')return listSignals(db,5000);
  if(table==='scorecard')return sourceScorecard(db);
  if(!experimentId)throw new Error('experiment_required');
  if(table==='orders')return listOrders(db,experimentId,5000);
  if(table==='fills')return listFills(db,experimentId,5000);
  if(table==='decisions')return listDecisions(db,experimentId,5000);
  return listSnapshots(db,experimentId);
}

/** UTF-8 BOM CSV with spreadsheet-formula neutralisation (same rule as lib/export-data). */
export function toCsv(rows:Record<string,unknown>[]){
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const cell=(v:unknown)=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[\t\r\n ]*[=+@-]/.test(s)&&typeof v!=='number')s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '﻿'+[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
}

// ---------- lifecycle (admin-only callers) ----------
export type CreateInput={name:string;market:Market;mode:'dry_run'|'paper';initialCash?:number;positionPct?:number;maxPositionsPerHorizon?:number;dailyLossHaltPct?:number;start?:boolean;note?:string};
const CAPITAL:Record<Market,{currency:'SAR'|'USD';cash:number}>={sa:{currency:'SAR',cash:3_750_000},us:{currency:'USD',cash:1_000_000}};
export class BotInputError extends Error{}
const inRange=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
const stable=(v:unknown):string=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v as any).sort().map(k=>JSON.stringify(k)+':'+stable((v as any)[k])).join(',')+'}':JSON.stringify(v);

/** Settings are validated against bounds; anything that deviates from STRATEGY_V1 becomes a NEW dated strategy version (existing versions are never edited). */
export async function createExperiment(db:Db,input:CreateInput,now=new Date()){
  const name=String(input.name||'').trim();
  if(!/^[\p{L}\p{N} _.-]{3,60}$/u.test(name))throw new BotInputError('اسم التجربة 3–60 حرفًا (حروف وأرقام ومسافة وشرطة).');
  if(input.market!=='sa'&&input.market!=='us')throw new BotInputError('السوق: sa أو us.');
  if(input.mode!=='dry_run'&&input.mode!=='paper')throw new BotInputError('الوضع: dry_run أو paper.');
  const cap=CAPITAL[input.market],cash=input.initialCash===undefined?cap.cash:input.initialCash;
  if(!inRange(cash,1000,1e10))throw new BotInputError('رأس المال خارج النطاق.');
  const pct=input.positionPct??CURRENT_STRATEGY.sizing.positionPctOfEquity,maxPos=input.maxPositionsPerHorizon??CURRENT_STRATEGY.sizing.maxPositionsPerHorizon,halt=input.dailyLossHaltPct??CURRENT_STRATEGY.risk.dailyLossHaltPct;
  if(!inRange(pct,.1,10))throw new BotInputError('حجم الصفقة بين 0.1% و10% من قيمة المحفظة.');
  if(!Number.isInteger(maxPos)||!inRange(maxPos,1,50))throw new BotInputError('أقصى عدد مراكز لكل أفق بين 1 و50.');
  if(!inRange(halt,.5,20))throw new BotInputError('حد إيقاف الشراء اليومي بين 0.5% و20%.');
  const cfg:StrategyConfig={...CURRENT_STRATEGY,sizing:{positionPctOfEquity:pct,maxPositionsPerHorizon:maxPos},risk:{dailyLossHaltPct:halt}} as StrategyConfig;
  const custom=pct!==CURRENT_STRATEGY.sizing.positionPctOfEquity||maxPos!==CURRENT_STRATEGY.sizing.maxPositionsPerHorizon||halt!==CURRENT_STRATEGY.risk.dailyLossHaltPct;
  const fingerprint=await sha256(stable({...cfg,version:undefined}));
  const version=custom?`${CURRENT_STRATEGY.version}+${fingerprint.slice(0,8)}`:CURRENT_STRATEGY.version;
  const stamp=now.toISOString(),strategyId='strat-'+version,expId='exp-'+(await sha256(name+'|'+stamp)).slice(0,16);
  const running=input.start!==false;
  const stmts=[
    db.prepare('INSERT OR IGNORE INTO bot_strategies(id,version,created_at,config_json,fingerprint,note) VALUES(?,?,?,?,?,?)').bind(strategyId,version,stamp,JSON.stringify({...cfg,version}),fingerprint,String(input.note||'').slice(0,300)),
    db.prepare('INSERT INTO bot_experiments(id,name,market,currency,initial_cash,strategy_id,mode,status,created_at,started_at,stopped_at,status_json) VALUES(?,?,?,?,?,(SELECT id FROM bot_strategies WHERE version=?),?,?,?,?,NULL,?)').bind(expId,name,input.market,cap.currency,cash,version,input.mode,running?'running':'paused',stamp,stamp,JSON.stringify(running?{resumedAt:stamp}:{})),
  ];
  try{await db.batch!(stmts);}catch(e){if(/UNIQUE/i.test(String(e instanceof Error?e.message:e)))throw new BotInputError('اسم التجربة مستخدم.');throw e;}
  return {id:expId,strategyVersion:version,status:running?'running':'paused',startedAt:stamp};
}

/** start/resume, pause, stop. Stopped is final (trigger). A resumed experiment only acts on forecasts issued at or after status_json.resumedAt. */
export async function setExperimentStatus(db:Db,id:string,action:'start'|'pause'|'stop',now=new Date()){
  const e=await one(db,'SELECT status,status_json FROM bot_experiments WHERE id=?',id);
  if(!e)throw new BotInputError('التجربة غير موجودة.');
  if(e.status==='stopped')throw new BotInputError('التجربة متوقفة نهائيًا.');
  const stamp=now.toISOString(),sj:any=safeJson(e.status_json)||{};
  if(action==='start'){if(e.status==='running')return {status:'running'};await db.prepare("UPDATE bot_experiments SET status='running',status_json=? WHERE id=? AND status='paused'").bind(JSON.stringify({...sj,resumedAt:stamp}),id).run();return {status:'running'};}
  if(action==='pause'){if(e.status==='paused')return {status:'paused'};await db.prepare("UPDATE bot_experiments SET status='paused',status_json=? WHERE id=? AND status='running'").bind(JSON.stringify({...sj,pausedAt:stamp}),id).run();return {status:'paused'};}
  await db.prepare("UPDATE bot_experiments SET status='stopped',stopped_at=?,status_json=? WHERE id=? AND status<>'stopped'").bind(stamp,JSON.stringify({...sj,stoppedAt:stamp}),id).run();return {status:'stopped'};
}
