/**
 * BOT-0001 one scheduled step (paper money only; no broker). All I/O is injected so a step is deterministic in tests and every row
 * it writes is keyed (decision_key / order_key / order_id / experiment+date), so a repeated or interrupted step neither repeats nor loses anything.
 *
 * What a step writes, per `running` experiment (mode `dry_run` and `paper` behave identically; the mode only labels the experiment so a
 * dry run is never counted in the official forward results):
 *   decisions (every up-call candidate and every position check, with the reason, the sources and whether they agree), pending orders,
 *   fills (only when the simulation's conditions hold), order expiry/cancel, and at most one equity snapshot per day.
 * Resumption: a candidate that already has a terminal decision today is skipped; a candidate cut off by the call budget is retried next step.
 */
import {STRATEGY_V1,BOT_STRATEGY_VERSION,decideEntry,decideExit,simulateFill,ledger,valuation,haltedToday,decisionKey,orderKey,
 type StrategyConfig,type ForecastView,type Liquidity,type Quote,type Market,type Fill,type Decision} from './engine';
import {US_BENCHMARK_SYMBOL,US_BENCHMARK_NAME,SA_BENCHMARK_NAME,basketReturn,chainBasket} from './benchmark';

export type BotSignal={source:string;source_version:string;market:Market;symbol:string;horizon:number;direction:'up'|'down'|'neutral';confidence:string|null;
 strength:number|null;issued_at:string;forecast_id:string|null;basis_json:string;signal_key?:string};
export type BarLite={date:string;close:number;volume:number};
export type RunnerQuote=Quote&{previousClose:number|null};
export type RunnerOptions={collectSignals:(db:any,market:Market,now:number)=>Promise<BotSignal[]>;fetchQuote:(symbol:string)=>Promise<RunnerQuote|null>;
 fetchBars:(symbol:string)=>Promise<BarLite[]>;experimentId?:string;maxFetches?:number;maxDecisions?:number};
export type ExperimentSummary={id:string;market:Market;mode:string;decisions:number;orders:number;fills:number;expired:number;cancelled:number;stillPending:number;
 abstained:number;suspended:number;skippedToday:number;fetches:number;budgetExhausted:boolean;snapshot:'written'|'exists'|'skipped';error?:string};
export type BotStepSummary={startedAt:string;experiments:ExperimentSummary[]};

const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const dayOf=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const errText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);
const minDays=(h:number)=>Math.floor(h*7/5);
const AR={up:'صاعد',down:'هابط',neutral:'محايد'} as const;
const parse=(s:unknown):any=>{try{return JSON.parse(String(s))}catch{return null}};

/** Average daily traded value of the last 20 COMPLETED sessions (today's partial bar is dropped) and the daily volatility of the last 60 log returns. */
export function liquidityFromBars(bars:readonly BarLite[],today:string):Liquidity{
 const done=bars.filter(b=>b.date<today&&fin(b.close)&&b.close>0&&fin(b.volume)&&b.volume>=0).sort((a,b)=>a.date.localeCompare(b.date));
 if(done.length<21)return {advValue:null,dailyVol:null};
 const last20=done.slice(-20),adv=last20.reduce((s,b)=>s+b.close*b.volume,0)/20;
 const r=done.slice(-61).map((b,i,a)=>i?Math.log(b.close/a[i-1].close):NaN).filter(Number.isFinite),mu=r.reduce((s,v)=>s+v,0)/r.length;
 const vol=r.length>=20?Math.sqrt(r.reduce((s,v)=>s+(v-mu)**2,0)/(r.length-1)):null;
 return {advValue:adv>0?adv:null,dailyVol:vol};
}

function view(sig:BotSignal):ForecastView{
 const basis=parse(sig.basis_json)||{},range=Array.isArray(basis.range)&&basis.range.length===2&&basis.range.every(fin)?[basis.range[0],basis.range[1]] as [number,number]:null;
 const votes=fin(sig.strength)?(sig.direction==='down'?-Math.abs(sig.strength):Math.abs(sig.strength)):0;
 return {id:sig.forecast_id??sig.signal_key??`${sig.source}|${sig.symbol}|${sig.horizon}|${sig.issued_at}`,symbol:sig.symbol,horizon:sig.horizon,createdAt:sig.issued_at,available:true,
  recordClass:'prospective-public',model:sig.source+'@'+sig.source_version,price:fin(basis.price)?basis.price:null,range,
  call:{policy:sig.source+'@'+sig.source_version,direction:AR[sig.direction]??'محايد',strength:String(sig.strength??''),votes,targetPrice:fin(basis.targetPrice)?basis.targetPrice:null}};
}
const srcRec=(s:BotSignal)=>({source:s.source,version:s.source_version,direction:s.direction,strength:s.strength,confidence:s.confidence??'غير متاحة',issuedAt:s.issued_at,forecastId:s.forecast_id,signalKey:s.signal_key??null,basis:parse(s.basis_json)});

const INSERT_DECISION=`INSERT INTO bot_decisions(id,experiment_id,decision_key,created_at,symbol,horizon,action,reason,forecast_id,forecast_created_at,model_version,strategy_version,data_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;
const INSERT_ORDER=`INSERT INTO bot_orders(id,experiment_id,decision_id,order_key,created_at,expires_at,symbol,horizon,side,quantity,status,status_reason,status_at,forecast_id,attempts,last_attempt_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,'pending','',?,?,0,'{}') ON CONFLICT DO NOTHING`;
const INSERT_FILL=`INSERT INTO bot_fills(id,experiment_id,order_id,created_at,symbol,horizon,side,quantity,quote_price,fill_price,commission,spread_cost,slippage_cost,currency,quote_time,quote_age_seconds,price_source,forecast_id,data_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;

export async function runBotStep(db:any,now:number,opts:RunnerOptions):Promise<BotStepSummary>{
 const out:BotStepSummary={startedAt:new Date(now).toISOString(),experiments:[]};
 const rows=(await db.prepare(`SELECT e.id,e.market,e.currency,e.initial_cash,e.mode,e.started_at,e.status_json,e.strategy_id,s.config_json,s.version FROM bot_experiments e JOIN bot_strategies s ON s.id=e.strategy_id
  WHERE e.status='running' ${opts.experimentId?'AND e.id=?':''} ORDER BY e.id`).bind(...(opts.experimentId?[opts.experimentId]:[])).all()).results||[];
 for(const e of rows){
  const sum:ExperimentSummary={id:e.id,market:e.market,mode:e.mode,decisions:0,orders:0,fills:0,expired:0,cancelled:0,stillPending:0,abstained:0,suspended:0,skippedToday:0,fetches:0,budgetExhausted:false,snapshot:'skipped'};
  out.experiments.push(sum);
  try{await runExperiment(db,now,opts,e,sum);}catch(err){sum.error=errText(err);}
 }
 return out;
}

async function runExperiment(db:any,now:number,opts:RunnerOptions,e:any,sum:ExperimentSummary){
 const market=e.market as Market,exp=e.id as string,iso=new Date(now).toISOString(),today=dayOf(now),startedMs=Math.max(Date.parse(e.started_at),Date.parse(String(parse(e.status_json)?.resumedAt??''))||0);
 const cfg=parse(e.config_json) as StrategyConfig|null,S:StrategyConfig=cfg&&cfg.version===e.version&&cfg.entry&&cfg.costs?cfg:(e.version===BOT_STRATEGY_VERSION?STRATEGY_V1:(()=>{throw new Error('strategy_config_unreadable')})());
 const maxFetches=opts.maxFetches??60,maxDecisions=opts.maxDecisions??400;
 const quotes=new Map<string,RunnerQuote|null>(),liqs=new Map<string,Liquidity>();
 const exhausted=()=>sum.fetches>=maxFetches;
 const quoteOf=async(sym:string):Promise<RunnerQuote|null>=>{
  if(quotes.has(sym))return quotes.get(sym)!;
  if(exhausted()){sum.budgetExhausted=true;return null;}
  sum.fetches++;let q:RunnerQuote|null=null;try{q=await opts.fetchQuote(sym);}catch{q=null;}quotes.set(sym,q);return q;
 };
 const liqOf=async(sym:string):Promise<Liquidity>=>{
  if(liqs.has(sym))return liqs.get(sym)!;
  if(exhausted()){sum.budgetExhausted=true;return {advValue:null,dailyVol:null};}
  sum.fetches++;let l:Liquidity={advValue:null,dailyVol:null};try{l=liquidityFromBars(await opts.fetchBars(sym),today);}catch{}liqs.set(sym,l);return l;
 };
 const loadFills=async():Promise<Fill[]>=>((await db.prepare(`SELECT symbol,horizon,side,quantity,fill_price,commission,created_at,forecast_id FROM bot_fills WHERE experiment_id=? ORDER BY created_at,id`).bind(exp).all()).results||[])
  .map((r:any)=>({symbol:r.symbol,horizon:Number(r.horizon),side:r.side,quantity:Number(r.quantity),fillPrice:Number(r.fill_price),commission:Number(r.commission),createdAt:r.created_at,forecastId:r.forecast_id}));
 const loadPending=async():Promise<any[]>=>(await db.prepare(`SELECT * FROM bot_orders WHERE experiment_id=? AND status='pending' ORDER BY created_at,id`).bind(exp).all()).results||[];
 const record=async(d:Decision,sym:string,horizon:number,fcId:string|null,fcAt:string|null,model:string|null,data:any,order?:{side:'buy'|'sell';quantity:number}):Promise<boolean>=>{
  if(sum.decisions>=maxDecisions)return false;
  const key=decisionKey(exp,sym,horizon,fcId,d.action,today),id='dec:'+key,stmts=[db.prepare(INSERT_DECISION).bind(id,exp,key,iso,sym,horizon,d.action,d.reason,fcId,fcAt,model,S.version,JSON.stringify({...data,decision:d}))];
  let ordKey:string|null=null;
  if(order){ordKey=orderKey(exp,sym,horizon,fcId,order.side);
   stmts.push(db.prepare(INSERT_ORDER).bind('ord:'+ordKey,exp,id,ordKey,iso,new Date(now+S.execution.orderExpiryHours*3600000).toISOString(),sym,horizon,order.side,order.quantity,iso,fcId));}
  const res=await db.batch(stmts);
  if(Number(res?.[0]?.meta?.changes??0)>0){sum.decisions++;if(order&&Number(res?.[1]?.meta?.changes??0)>0)sum.orders++;}
  if(d.action==='abstain')sum.abstained++;if(d.action==='suspend')sum.suspended++;
  return true;
 };

 // 1. Rebuild the portfolio from the fill log alone (restart safety), then mark held positions.
 const fills=await loadFills(),book=ledger(Number(e.initial_cash),fills);
 const pending0=await loadPending();
 const marks:Record<string,number>={};
 for(const p of book.positions){const q=await quoteOf(p.symbol);if(q&&q.price>0)marks[p.symbol]=q.price;}
 const val=valuation(book,marks);
 const prev=await db.prepare(`SELECT equity,benchmark_value,benchmark_name FROM bot_equity_snapshots WHERE experiment_id=? AND snapshot_date<? ORDER BY snapshot_date DESC LIMIT 1`).bind(exp,today).first();
 const halted=haltedToday(S,prev?Number(prev.equity):Number(e.initial_cash),val.equity);

 // 2. Signals known now (each source kept on its own).
 const signals=(await opts.collectSignals(db,market,now)).filter(s=>s.market===market&&Date.parse(s.issued_at)<=now);
 const fresh=signals.filter(s=>(now-Date.parse(s.issued_at))/3600000<=S.entry.maxForecastAgeHours);
 const group=new Map<string,BotSignal[]>();for(const s of signals){const k=s.symbol+'|'+s.horizon;(group.get(k)??group.set(k,[]).get(k)!).push(s);}
 const doneToday=new Set(((await db.prepare(`SELECT symbol,horizon,forecast_id FROM bot_decisions WHERE experiment_id=? AND created_at>=? AND action<>'suspend'`).bind(exp,today+'T00:00:00.000Z').all()).results||[])
  .map((r:any)=>r.symbol+'|'+r.horizon+'|'+(r.forecast_id??'none')));
 const pendingKeys=new Set(pending0.map((o:any)=>o.symbol+'|'+o.horizon));

 // 3. Exits for open positions, in the documented order.
 for(const p of book.positions){
  if(!S.horizons.includes(p.horizon as any))continue;
  const k=p.symbol+'|'+p.horizon,fcId=p.forecastId;
  if(doneToday.has(k+'|'+(fcId??'none'))){sum.skippedToday++;continue;}
  const src=await db.prepare(`SELECT d.data_json FROM bot_fills f JOIN bot_orders o ON o.id=f.order_id JOIN bot_decisions d ON d.id=o.decision_id
   WHERE f.experiment_id=? AND f.symbol=? AND f.horizon=? AND f.side='buy' ORDER BY f.created_at DESC LIMIT 1`).bind(exp,p.symbol,p.horizon).first();
  const entry=parse(src?.data_json),entryView=entry?.view as ForecastView|undefined;
  if(!entryView){await record({action:'suspend',reason:'entry_record_missing'},p.symbol,p.horizon,fcId,null,null,{positionQuantity:p.quantity});continue;}
  const cand=(group.get(k)||[]).filter(s=>s.source===entry?.primarySource),pool=cand.length?cand:(group.get(k)||[]);
  const latest=[...pool].sort((a,b)=>b.issued_at.localeCompare(a.issued_at))[0];
  const complete=now>=Date.parse(p.openedAt)+minDays(p.horizon)*86400000;
  const q=await quoteOf(p.symbol);
  const d=decideExit(S,{quantity:p.quantity,entryForecast:entryView,entryOutcomeComplete:complete},latest?view(latest):null,{price:q?.price??null,hasOpenOrder:pendingKeys.has(k)});
  const data={view:entryView,primarySource:entry?.primarySource,exit:{price:q?.price??null,quoteTime:q?.quoteTime??null,openedAt:p.openedAt,horizonComplete:complete}};
  await record(d,p.symbol,p.horizon,fcId,entryView.createdAt,entryView.model,data,d.action==='sell'?{side:'sell',quantity:d.quantity!}:undefined);
  if(d.action==='sell')pendingKeys.add(k);
 }

 // 4. Entries: only up-call candidates, strongest first, bounded by the call budget.
 const openByHorizon=(h:number)=>book.positions.filter(p=>p.horizon===h).length+pending0.filter((o:any)=>o.side==='buy'&&Number(o.horizon)===h).length;
 const cands:{k:string;ups:BotSignal[]}[]=[];
 for(const [k,list] of group){
  const h=Number(k.split('|')[1]);if(!S.horizons.includes(h as any))continue;
  const ups=list.filter(s=>s.direction==='up');if(!ups.length)continue;
  cands.push({k,ups:ups.sort((a,b)=>(b.strength??0)-(a.strength??0)||b.issued_at.localeCompare(a.issued_at)||a.source.localeCompare(b.source))});
 }
 cands.sort((a,b)=>(b.ups[0].strength??0)-(a.ups[0].strength??0)||a.k.localeCompare(b.k));
 const heldKeys=new Set(book.positions.map(p=>p.symbol+'|'+p.horizon));
 for(const c of cands){
  const primary=c.ups[0],f=view(primary),[sym,hs]=c.k.split('|'),h=Number(hs);
  if(doneToday.has(c.k+'|'+f.id)){sum.skippedToday++;continue;}
  if(heldKeys.has(c.k))continue; // already held: the exit rule above owns it
  const freshList=fresh.filter(s=>s.symbol===sym&&s.horizon===h&&s.direction!=='neutral'),conflict=freshList.some(s=>s.direction==='down'),
   agreement=conflict?'disagree':new Set(freshList.map(s=>s.source)).size>1?'agree':'single';
  const data:any={view:f,primarySource:primary.source,agreement,sources:(group.get(c.k)||[]).map(srcRec)};
  if(conflict){await record({action:'suspend',reason:'pending_sources_conflict',detail:{agreement}},sym,h,f.id,primary.issued_at,f.model,data);continue;}
  const equity=val.equity,cash=book.cash,base={now,experimentStartedAt:startedMs-S.entry.maxForecastAgeHours*3600000,holdsSymbol:false,hasOpenOrder:pendingKeys.has(c.k),openPositionsInHorizon:openByHorizon(h),equity,cash,haltedToday:halted};
  let d=decideEntry(S,market,f,{...base,price:null,liquidity:{advValue:null,dailyVol:null}});
  let price:number|null=null,liq:Liquidity={advValue:null,dailyVol:null};
  if(d.action==='suspend'&&d.reason==='price_unavailable'){
   const q=await quoteOf(sym);price=q?.price??null;liq=await liqOf(sym);
   d=decideEntry(S,market,f,{...base,price,liquidity:liq});
   data.entry={price,quoteTime:q?.quoteTime??null,liquidity:liq};
   if(!q&&exhausted()){continue;} // cut off by the call budget: retried next step, nothing recorded
  }
  if(d.action==='buy'&&(await db.prepare('SELECT 1 AS x FROM bot_orders WHERE order_key=?').bind(orderKey(exp,sym,h,f.id,'buy')).first())){d={action:'hold',reason:'order_already_recorded'};}
  if(!await record(d,sym,h,f.id,primary.issued_at,f.model,data,d.action==='buy'?{side:'buy',quantity:d.quantity!}:undefined))break;
  if(d.action==='buy')pendingKeys.add(c.k);
 }

 // 5. Pending orders: expire, or fill only when the simulation's conditions hold. Each fill + order transition is ONE batch.
 const inMem=[...fills];
 for(const o of await loadPending()){
  const upd=(status:string,reason:string,extra?:object)=>db.prepare(`UPDATE bot_orders SET status=?,status_reason=?,status_at=?,attempts=attempts+1,last_attempt_json=? WHERE id=? AND status='pending'`).bind(status,reason,iso,JSON.stringify({at:iso,reason,...extra}),o.id);
  if(now>=Date.parse(o.expires_at)){await upd('expired','order_expired').run();sum.expired++;continue;}
  const cur=ledger(Number(e.initial_cash),inMem);
  if(o.side==='sell'&&!((cur.positions.find((p:any)=>p.symbol===o.symbol&&p.horizon===Number(o.horizon))?.quantity??0)>=Number(o.quantity))){await upd('cancelled','no_position').run();sum.cancelled++;continue;}
  const q=await quoteOf(o.symbol),liq=await liqOf(o.symbol),r=simulateFill(S,market,o.side,Number(o.quantity),q,liq);
  if(!r.filled){await upd('pending',r.reason,{quote:q?{price:q.price,quoteTime:q.quoteTime,ageSeconds:q.ageSeconds,isOpen:q.isOpen}:null}).run();sum.stillPending++;continue;}
  if(o.side==='buy'&&Number(o.quantity)*r.fillPrice+r.commission>cur.cash+1e-6){await upd('cancelled','insufficient_cash').run();sum.cancelled++;continue;}
  const fid='fill:'+o.order_key;
  await db.batch([db.prepare(INSERT_FILL).bind(fid,exp,o.id,iso,o.symbol,Number(o.horizon),o.side,Number(o.quantity),r.quotePrice,r.fillPrice,r.commission,r.spreadCost,r.slippageCost,e.currency,r.quoteTime,r.quoteAgeSeconds,r.source,o.forecast_id,
   JSON.stringify({halfSpreadBps:r.halfSpreadBps,impactBps:r.impactBps,liquidity:liq,strategy:S.version,mode:e.mode})),upd('filled','filled',{fillId:fid})]);
  inMem.push({symbol:o.symbol,horizon:Number(o.horizon),side:o.side,quantity:Number(o.quantity),fillPrice:r.fillPrice,commission:r.commission,createdAt:iso,forecastId:o.forecast_id});sum.fills++;
 }

 // 6. One equity snapshot per UTC day (the first of the day is final: records are never edited), with its benchmark.
 try{
  const book2=ledger(Number(e.initial_cash),inMem),marks2:Record<string,number>={...marks};
  for(const p of book2.positions)if(!marks2[p.symbol]){const q=await quoteOf(p.symbol);if(q&&q.price>0)marks2[p.symbol]=q.price;}
  const v2=valuation(book2,marks2);let bench:number|null=null,benchName='';
  if(market==='us'){const q=await quoteOf(US_BENCHMARK_SYMBOL);bench=q?.price??null;benchName=US_BENCHMARK_NAME;}
  else{const basket=[...new Set(cands.map(c=>c.k.split('|')[0]).concat(book2.positions.map(p=>p.symbol)))].map(s=>quotes.get(s)).filter((q):q is RunnerQuote=>!!q);
   const ret=basketReturn(basket.map(q=>({price:q.price,previousClose:q.previousClose})));
   bench=chainBasket(prev?.benchmark_value!=null?Number(prev.benchmark_value):null,!prev,ret);benchName=SA_BENCHMARK_NAME;}
  const res=await db.prepare(`INSERT INTO bot_equity_snapshots(experiment_id,snapshot_date,created_at,cash,positions_value,equity,benchmark_value,benchmark_name,data_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
   .bind(exp,today,iso,v2.cash,v2.positionsValue,v2.equity,bench,benchName,JSON.stringify({unrealized:v2.unrealized,realized:book2.realized,commissions:book2.commissions,missingMarks:v2.missingMarks,haltedToday:halted,
    positions:book2.positions.map(p=>({symbol:p.symbol,horizon:p.horizon,quantity:p.quantity,mark:marks2[p.symbol]??null})),strategy:S.version,mode:e.mode})).run();
  sum.snapshot=Number(res?.meta?.changes??0)>0?'written':'exists';
 }catch(err){sum.error=(sum.error?sum.error+' | ':'')+'snapshot:'+errText(err);}
}
