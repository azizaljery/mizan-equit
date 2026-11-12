/**
 * BOT-0001 signal layer: every nomination/forecast the bot may act on is normalised, recorded per source BEFORE any decision,
 * and later scored per source. Pure functions plus thin read-only D1 adapters; nothing here talks to the network or trades.
 * No source is merged into another: each keeps its own rows, version and scorecard.
 */
export type SignalMarket='sa'|'us';
export type SignalDirection='up'|'down'|'neutral';
export type Agreement='single'|'agree'|'disagree';
export type Signal={source:string;sourceVersion:string;market:SignalMarket;symbol:string;horizon:number;direction:SignalDirection;
 confidence:string|null;strength:number|null;issuedAt:string;forecastId:string|null;basis:Record<string,unknown>};
export type StoredSignal=Signal&{id:string;signalKey:string;recordedAt:string};
/** Minimal D1-like surface so the adapters run on D1 in production and on node:sqlite wrappers in tests. */
export type SignalDb={prepare(sql:string):{bind(...v:unknown[]):{all():Promise<{results?:any[]}>;first():Promise<any>;run():Promise<{meta?:{changes?:number}}>}}};

export const SIGNAL_SOURCES={
 mizan:'mizan-direction-v1',
 dailyPicks:'daily-picks-momentum',
 screener:'screener',
 aziz:'aziz-monitor',
 /** Not active: the bot discovering opportunities by itself needs a frozen, versioned rule first (see plan §12). */
 botScan:'bot-scan-v1'
} as const;
export const BOT_SCAN_ENABLED=false as const;
export const SIGNAL_HORIZONS=[1,5,21] as const;
export const MIZAN_SIGNAL_MAX_AGE_MS=20*3600*1000;
export const DAILY_PICK_SIGNAL_MAX_AGE_MS=48*3600*1000;
export const SCREENER_SIGNAL_MAX_AGE_MS=20*3600*1000;
export const AZIZ_SIGNAL_MAX_AGE_MS=48*3600*1000;

export function signalKey(s:Pick<Signal,'source'|'sourceVersion'|'market'|'symbol'|'horizon'|'issuedAt'|'forecastId'>):string{
 return [s.source,s.sourceVersion,s.market,s.symbol,s.horizon,s.forecastId??s.issuedAt].join('|');
}
function stableId(key:string):string{ // deterministic FNV-1a x2 so a repeated step reproduces the same id
 let a=0x811c9dc5,b=0x01000193;for(let i=0;i<key.length;i++){a^=key.charCodeAt(i);a=Math.imul(a,0x01000193);b=Math.imul(b^key.charCodeAt(i),0x85ebca6b)>>>0;}
 return 'sig_'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function signalId(key:string):string{return stableId(key);}

/** One vote per source: the latest signal of each source wins; all sources equal on direction => agree, otherwise disagree. Neutral against up counts as disagreement. */
export function agreement(signals:readonly Pick<Signal,'source'|'direction'|'issuedAt'>[]):Agreement{
 const latest=new Map<string,Pick<Signal,'source'|'direction'|'issuedAt'>>();
 for(const s of signals){const c=latest.get(s.source);if(!c||s.issuedAt>c.issuedAt)latest.set(s.source,s);}
 if(latest.size<=1)return 'single';
 const dirs=new Set([...latest.values()].map(s=>s.direction));
 return dirs.size===1?'agree':'disagree';
}

export type PricePoint={date:string;close:number};
export type SignalOutcome={resolvedAt:string;startPrice:number;endPrice:number;up:0|1;horizonSessions:number;changePct:number};
/**
 * Outcome of one signal against closes only. Start = last close on or before the issue date (the reference price known when it was issued);
 * end = the close `horizon` sessions later. Returns null while the horizon has not fully elapsed (never a partial or guessed result).
 */
export function evaluateSignal(signal:Pick<Signal,'issuedAt'|'horizon'>,prices:readonly PricePoint[]):SignalOutcome|null{
 const issued=signal.issuedAt.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(issued)||!(signal.horizon>=1))return null;
 const p=prices.filter(x=>Number.isFinite(x.close)&&x.close>0&&/^\d{4}-\d{2}-\d{2}/.test(x.date)).slice().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
 let s=-1;for(let i=0;i<p.length;i++){if(p[i].date.slice(0,10)<=issued)s=i;else break;}
 if(s<0)return null;
 const e=s+signal.horizon;if(e>=p.length)return null;
 const a=p[s].close,b=p[e].close;
 return {resolvedAt:p[e].date.slice(0,10),startPrice:a,endPrice:b,up:b>a?1:0,horizonSessions:signal.horizon,changePct:(b/a-1)*100};
}

export type ScoreRow={source:string;sourceVersion:string;market:string;symbol:string;horizon:number;direction:SignalDirection;issuedAt:string;up:0|1|null};
export type SourceScore={source:string;sourceVersion:string;market:string;horizon:number;signals:number;resolved:number;upCalls:number;upCallsResolved:number;
 upCallHits:number;hitRate:number|null;baselineUpRate:number|null;edge:number|null;ci95:[number,number]|null;smallSample:boolean;note:string};
export const MIN_SCORED_CALLS=30;
function wilson(k:number,n:number):[number,number]|null{if(n<=0)return null;const z=1.96,p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return [Math.max(0,(c-m)/d),Math.min(1,(c+m)/d)];}
/**
 * Per source+version+market+horizon, never merged. hitRate = share of resolved UP calls that rose. baselineUpRate = share of ALL resolved
 * signals (any source) on the same market/horizon, one per symbol+issue date, that rose, i.e. what "always up" on those stocks and dates scores.
 * edge = hitRate - baseline. Neutral/down signals are counted but are not scored as up calls.
 */
export function scorecard(rows:readonly ScoreRow[]):SourceScore[]{
 const base=new Map<string,Map<string,0|1>>();
 for(const r of rows){if(r.up===null)continue;const k=r.market+'|'+r.horizon;let m=base.get(k);if(!m){m=new Map();base.set(k,m);}m.set(r.symbol+'|'+r.issuedAt.slice(0,10),r.up);}
 const groups=new Map<string,ScoreRow[]>();
 for(const r of rows){const k=[r.source,r.sourceVersion,r.market,r.horizon].join('|');(groups.get(k)??groups.set(k,[]).get(k)!).push(r);}
 const out:SourceScore[]=[];
 for(const [,g] of [...groups.entries()].sort((a,b)=>a[0]<b[0]?-1:1)){
  const f=g[0],resolved=g.filter(r=>r.up!==null),ups=g.filter(r=>r.direction==='up'),upsR=ups.filter(r=>r.up!==null),hits=upsR.filter(r=>r.up===1).length;
  const bm=base.get(f.market+'|'+f.horizon),bv=bm?[...bm.values()]:[],baseline=bv.length?bv.reduce<number>((a,b)=>a+b,0)/bv.length:null;
  const hit=upsR.length?hits/upsR.length:null,small=upsR.length<MIN_SCORED_CALLS;
  out.push({source:f.source,sourceVersion:f.sourceVersion,market:f.market,horizon:f.horizon,signals:g.length,resolved:resolved.length,upCalls:ups.length,upCallsResolved:upsR.length,
   upCallHits:hits,hitRate:hit,baselineUpRate:baseline,edge:hit!==null&&baseline!==null?hit-baseline:null,ci95:wilson(hits,upsR.length),smallSample:small,
   note:upsR.length===0?'لا نتائج محسومة بعد':small?`عينة أقل من ${MIN_SCORED_CALLS} نداءً محسومًا؛ لا يُستنتج منها شيء`:''});
 }
 return out;
}

// ---- Adapters (read-only) -------------------------------------------------------------------------------------------------------------------
function mapDirection(text:unknown):SignalDirection{
 const t=String(text??'').trim();
 if(t.startsWith('صاعد')||t==='up')return 'up';
 if(t.startsWith('هابط')||t==='down')return 'down';
 return 'neutral'; // محايد / unknown text never becomes a directional claim
}
function num(x:unknown):number|null{const n=Number(x);return x!==null&&x!==undefined&&x!==''&&Number.isFinite(n)?n:null;}
function parse(s:unknown):any{try{return typeof s==='string'?JSON.parse(s):s;}catch{return null;}}
const sinceIso=(now:number,ms:number)=>new Date(now-ms).toISOString();

/** Latest public prospective Mizan forecast per symbol+horizon that carries a direction call (mizan-direction-v1). */
export async function collectMizanSignals(db:SignalDb,market:SignalMarket,now:number,maxAgeMs=MIZAN_SIGNAL_MAX_AGE_MS):Promise<Signal[]>{
 const res=await db.prepare(`SELECT id,symbol,horizon,created_at,confidence,data FROM (
   SELECT id,symbol,horizon,created_at,confidence,data,ROW_NUMBER() OVER (PARTITION BY symbol,horizon ORDER BY created_at DESC,id DESC) AS rn
   FROM forecast_records WHERE market=? AND horizon IN (1,5,21) AND created_at>=? AND available=1 AND json_valid(data)
    AND json_extract(data,'$.recordClass')='prospective-public' AND json_extract(data,'$.call.policy') IS NOT NULL) WHERE rn=1`).bind(market,sinceIso(now,maxAgeMs)).all();
 const out:Signal[]=[];
 for(const r of res.results||[]){
  const d=parse(r.data),c=d?.call;if(!c)continue;
  const conf=r.confidence&&String(r.confidence)?String(r.confidence):null;
  out.push({source:SIGNAL_SOURCES.mizan,sourceVersion:String(c.policy||SIGNAL_SOURCES.mizan),market,symbol:String(r.symbol),horizon:Number(r.horizon),direction:mapDirection(c.direction),
   confidence:conf,strength:num(c.votes),issuedAt:String(r.created_at),forecastId:String(r.id),
   basis:{model:d.model??null,price:num(d.price),targetPrice:num(c.targetPrice),typicalMovePct:num(c.typicalMovePct),strengthLabel:c.strength??null,components:c.components??null,
    experimental:Boolean(c.experimental),statisticalCentre:num(d.predictedPrice)}});
 }
 return out;
}

/** Daily momentum picks: a name in the top group (in_top=1) is an UP nomination at its horizon; others are not signals. */
export async function collectDailyPickSignals(db:SignalDb,market:SignalMarket,now:number,maxAgeMs=DAILY_PICK_SIGNAL_MAX_AGE_MS):Promise<Signal[]>{
 const res=await db.prepare(`SELECT id,pick_date,horizon,symbol,rank,universe_size,percentile,mom126_5,ref_price,ref_price_date,mizan_forecast_id,model_version,created_at
   FROM daily_picks WHERE market=? AND in_top=1 AND horizon IN (1,5,21) AND created_at>=?`).bind(market,sinceIso(now,maxAgeMs)).all();
 return (res.results||[]).map((r:any):Signal=>({source:SIGNAL_SOURCES.dailyPicks,sourceVersion:String(r.model_version),market,symbol:String(r.symbol),horizon:Number(r.horizon),direction:'up',
  confidence:null,strength:null,issuedAt:String(r.created_at),forecastId:r.mizan_forecast_id?String(r.mizan_forecast_id):null,
  basis:{pickId:String(r.id),pickDate:r.pick_date,rank:num(r.rank),universeSize:num(r.universe_size),percentile:num(r.percentile),mom126_5:num(r.mom126_5),refPrice:num(r.ref_price),refPriceDate:r.ref_price_date}}));
}

/** Screener nominations: the nomination is recorded as such; its direction is the one in the linked forecast's own call (neutral when it has none). */
export async function collectScreenerSignals(db:SignalDb,market:SignalMarket,now:number,maxAgeMs=SCREENER_SIGNAL_MAX_AGE_MS):Promise<Signal[]>{
 const res=await db.prepare(`SELECT p.run_id,p.rank,f.id,f.symbol,f.horizon,f.created_at,f.confidence,f.data FROM screener_picks p JOIN forecast_records f ON f.id=p.forecast_id
   WHERE p.market=? AND f.available=1 AND f.horizon IN (1,5,21) AND f.created_at>=? AND json_valid(f.data) AND json_extract(f.data,'$.recordClass')='prospective-public'`).bind(market,sinceIso(now,maxAgeMs)).all();
 return (res.results||[]).map((r:any):Signal=>{const d=parse(r.data),c=d?.call;
  return {source:SIGNAL_SOURCES.screener,sourceVersion:'screener-v1',market,symbol:String(r.symbol),horizon:Number(r.horizon),direction:c?mapDirection(c.direction):'neutral',
   confidence:r.confidence?String(r.confidence):null,strength:c?num(c.votes):null,issuedAt:String(r.created_at),forecastId:String(r.id),
   basis:{runId:String(r.run_id),rank:num(r.rank),callPolicy:c?.policy??null,price:num(d?.price)}};});
}

/**
 * Aziz: only what is already stored in aziz_monitor_records (an untrained pilot journal). Its model DIR-0001 is rejected, so these rows are
 * recorded and scored like any source but are expected to stay "neutral" or unproven; nothing here may be promoted to a trade by itself.
 */
export async function collectAzizSignals(db:SignalDb,market:SignalMarket,now:number,maxAgeMs=AZIZ_SIGNAL_MAX_AGE_MS):Promise<Signal[]>{
 let res:{results?:any[]};
 try{res=await db.prepare(`SELECT id,symbol,issued_at,available_at,horizon,base_price,status,data FROM aziz_monitor_records WHERE market=? AND horizon IN (1,5,21) AND available_at>=?`).bind(market,sinceIso(now,maxAgeMs)).all();}
 catch{return [];} // table absent => no Aziz source yet
 return (res.results||[]).map((r:any):Signal=>{const d=parse(r.data)||{};
  return {source:SIGNAL_SOURCES.aziz,sourceVersion:String(d.kind||'aziz-monitor'),market,symbol:String(r.symbol),horizon:Number(r.horizon),
   direction:String(d.direction||'').startsWith('محايد')?'neutral':mapDirection(d.direction),confidence:null,strength:null,issuedAt:String(r.available_at||r.issued_at),forecastId:null,
   basis:{recordId:String(r.id),status:r.status,basePrice:num(r.base_price),expectedClose:num(d.expectedClose),closeRange:d.closeRange??null,note:d.note??null}};});
}

export async function collectAllSignals(db:SignalDb,market:SignalMarket,now:number):Promise<Signal[]>{
 const parts=await Promise.all([collectMizanSignals(db,market,now),collectDailyPickSignals(db,market,now),collectScreenerSignals(db,market,now),collectAzizSignals(db,market,now)]);
 return parts.flat();
}

/** Record signals before any decision (idempotent: a repeated step re-inserts nothing). Returns the stored rows with their stable ids. */
export async function recordSignals(db:SignalDb,signals:readonly Signal[],nowIso:string):Promise<{stored:StoredSignal[];inserted:number}>{
 const stored:StoredSignal[]=[];let inserted=0;
 for(const s of signals){
  const key=signalKey(s),id=signalId(key);
  const r=await db.prepare(`INSERT OR IGNORE INTO bot_signals(id,signal_key,source,source_version,market,symbol,horizon,direction,confidence,strength,issued_at,forecast_id,basis_json,recorded_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,key,s.source,s.sourceVersion,s.market,s.symbol,s.horizon,s.direction,s.confidence,s.strength,s.issuedAt,s.forecastId,JSON.stringify(s.basis),nowIso).run();
  if((r.meta?.changes??0)>0)inserted++;
  stored.push({...s,id,signalKey:key,recordedAt:nowIso});
 }
 return {stored,inserted};
}
/** Append the link between a decision and every signal that was on the table for it, with the agreement state. */
export async function linkDecisionSignals(db:SignalDb,decisionId:string,signals:readonly StoredSignal[]):Promise<Agreement>{
 const a=agreement(signals);
 for(const s of signals)await db.prepare(`INSERT OR IGNORE INTO bot_decision_signals(decision_id,signal_id,agreement) VALUES(?,?,?)`).bind(decisionId,s.id,a).run();
 return a;
}
/** Resolve one signal's outcome from closes; writes once (UNIQUE signal_id). Returns the outcome or null when the horizon has not elapsed. */
export async function recordOutcome(db:SignalDb,signalId_:string,signal:Pick<Signal,'issuedAt'|'horizon'>,prices:readonly PricePoint[]):Promise<SignalOutcome|null>{
 const o=evaluateSignal(signal,prices);if(!o)return null;
 await db.prepare(`INSERT OR IGNORE INTO bot_signal_outcomes(signal_id,resolved_at,start_price,end_price,up,horizon_sessions) VALUES(?,?,?,?,?,?)`).bind(signalId_,o.resolvedAt,o.startPrice,o.endPrice,o.up,o.horizonSessions).run();
 return o;
}
/** Signals still without an outcome (oldest first) so a scheduled step can resolve them as closes arrive. */
export async function pendingSignals(db:SignalDb,market:SignalMarket,limit=500):Promise<StoredSignal[]>{
 const res=await db.prepare(`SELECT s.* FROM bot_signals s LEFT JOIN bot_signal_outcomes o ON o.signal_id=s.id WHERE s.market=? AND o.signal_id IS NULL ORDER BY s.issued_at LIMIT ?`).bind(market,limit).all();
 return (res.results||[]).map((r:any):StoredSignal=>({id:r.id,signalKey:r.signal_key,source:r.source,sourceVersion:r.source_version,market:r.market,symbol:r.symbol,horizon:Number(r.horizon),direction:r.direction,
  confidence:r.confidence??null,strength:r.strength===null||r.strength===undefined?null:Number(r.strength),issuedAt:r.issued_at,forecastId:r.forecast_id??null,basis:parse(r.basis_json)||{},recordedAt:r.recorded_at}));
}
/** Rows for the per-source scorecard (signals joined with their outcomes, if any). */
export async function scoreRows(db:SignalDb,market?:SignalMarket):Promise<ScoreRow[]>{
 const res=await db.prepare(`SELECT s.source,s.source_version,s.market,s.symbol,s.horizon,s.direction,s.issued_at,o.up FROM bot_signals s LEFT JOIN bot_signal_outcomes o ON o.signal_id=s.id WHERE (?1 IS NULL OR s.market=?1)`).bind(market??null).all();
 return (res.results||[]).map((r:any):ScoreRow=>({source:r.source,sourceVersion:r.source_version,market:r.market,symbol:r.symbol,horizon:Number(r.horizon),direction:r.direction,issuedAt:r.issued_at,up:r.up===null||r.up===undefined?null:(Number(r.up)===1?1:0)}));
}
