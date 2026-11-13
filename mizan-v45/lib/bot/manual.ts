/**
 * BOT-0001 manual paper trade ("اشترِ الآن / بِع الآن") — paper money only, no broker.
 * Same rules as the scheduled step: the experiment's own frozen strategy (costs, spread, impact, liquidity limit, quote freshness,
 * market-open requirement) decides whether and at what price the simulated fill happens. Nothing is filled when a condition fails;
 * the refusal is recorded as an `abstain` decision with its reason so it is never silent.
 * A manual purchase is labelled (`model_version = 'manual'`, forecast id `manual:<requestId>`) so it never counts as a forecast hit,
 * and it follows the scheduled exit rules afterwards (horizon end / flip to down by any source). `requestId` makes a repeated click idempotent.
 */
import {STRATEGY_V1,STRATEGY_V2,BOT_STRATEGY_VERSION,BOT_STRATEGY_VERSION_2,simulateFill,ledger,decisionKey,orderKey,type StrategyConfig,type Liquidity,type Market,type Fill} from './engine';
import {liquidityFromBars,type RunnerQuote,type BarLite} from './runner';

export type ManualInput={experimentId:string;symbol:string;side:'buy'|'sell';horizon?:number;amount?:number;requestId:string};
export type ManualDeps={fetchQuote:(symbol:string)=>Promise<RunnerQuote|null>;fetchBars:(symbol:string)=>Promise<BarLite[]>};
export type ManualResult={ok:boolean;status:'filled'|'refused'|'duplicate';reason:string;side:'buy'|'sell';symbol:string;
 fills:{horizon:number;quantity:number;fillPrice:number;commission:number;quotePrice:number;quoteTime:string}[]};
export class ManualInputError extends Error{status:number;constructor(m:string,status=400){super(m);this.status=status;}}

const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const parse=(s:unknown):any=>{try{return JSON.parse(String(s))}catch{return null}};
const marketOf=(symbol:string):Market=>symbol.endsWith('.SR')?'sa':'us';
const SYMBOL=/^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

const INSERT_DECISION=`INSERT INTO bot_decisions(id,experiment_id,decision_key,created_at,symbol,horizon,action,reason,forecast_id,forecast_created_at,model_version,strategy_version,data_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;
const INSERT_ORDER=`INSERT INTO bot_orders(id,experiment_id,decision_id,order_key,created_at,expires_at,symbol,horizon,side,quantity,status,status_reason,status_at,forecast_id,attempts,last_attempt_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT DO NOTHING`;
const INSERT_FILL=`INSERT INTO bot_fills(id,experiment_id,order_id,created_at,symbol,horizon,side,quantity,quote_price,fill_price,commission,spread_cost,slippage_cost,currency,quote_time,quote_age_seconds,price_source,forecast_id,data_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;

export async function manualOrder(db:any,now:number,input:ManualInput,deps:ManualDeps):Promise<ManualResult>{
 const symbol=String(input.symbol||'').trim().toUpperCase(),side=input.side,horizon=input.horizon??5;
 if(!SYMBOL.test(symbol))throw new ManualInputError('رمز السهم غير صالح.');
 if(side!=='buy'&&side!=='sell')throw new ManualInputError('الجانب يجب أن يكون buy أو sell.');
 if(![1,5,21].includes(horizon))throw new ManualInputError('الأفق يجب أن يكون 1 أو 5 أو 21 يومًا.');
 if(input.amount!==undefined&&(!fin(input.amount)||input.amount<=0))throw new ManualInputError('المبلغ يجب أن يكون رقمًا موجبًا.');
 if(typeof input.requestId!=='string'||!/^[A-Za-z0-9\-]{8,64}$/.test(input.requestId))throw new ManualInputError('معرّف الطلب غير صالح.');
 const e:any=await db.prepare(`SELECT e.id,e.market,e.currency,e.initial_cash,e.mode,e.status,s.config_json,s.version FROM bot_experiments e JOIN bot_strategies s ON s.id=e.strategy_id WHERE e.id=?`).bind(input.experimentId).first();
 if(!e)throw new ManualInputError('التجربة غير موجودة.',404);
 if(e.status!=='running')throw new ManualInputError('التجربة غير مشغّلة؛ شغّلها أولًا.',409);
 const market=e.market as Market;
 if(marketOf(symbol)!==market)throw new ManualInputError(market==='sa'?'هذه التجربة سعودية: استخدم رمزًا ينتهي بـ .SR':'هذه التجربة أمريكية: لا تستخدم رمزًا ينتهي بـ .SR');
 const S:StrategyConfig=e.version===BOT_STRATEGY_VERSION?STRATEGY_V1:e.version===BOT_STRATEGY_VERSION_2?STRATEGY_V2:(()=>{const c=parse(e.config_json);if(!c)throw new ManualInputError('إعدادات الاستراتيجية غير مقروءة.',500);return c as StrategyConfig;})();
 const iso=new Date(now).toISOString(),today=iso.slice(0,10),fcId='manual:'+input.requestId;
 const dup=await db.prepare(`SELECT id FROM bot_decisions WHERE experiment_id=? AND forecast_id=? LIMIT 1`).bind(e.id,fcId).first();
 if(dup)return {ok:true,status:'duplicate',reason:'duplicate_request',side,symbol,fills:[]};

 const fills:Fill[]=((await db.prepare(`SELECT symbol,horizon,side,quantity,fill_price,commission,created_at,forecast_id FROM bot_fills WHERE experiment_id=? ORDER BY created_at,id`).bind(e.id).all()).results||[])
  .map((r:any)=>({symbol:r.symbol,horizon:Number(r.horizon),side:r.side,quantity:Number(r.quantity),fillPrice:Number(r.fill_price),commission:Number(r.commission),createdAt:r.created_at,forecastId:r.forecast_id}));
 const book=ledger(Number(e.initial_cash),fills);
 const refuse=async(reason:string,h:number,extra?:object):Promise<ManualResult>=>{
  const key=decisionKey(e.id,symbol,h,fcId,'abstain',today);
  await db.prepare(INSERT_DECISION).bind('dec:'+key,e.id,key,iso,symbol,h,'abstain','manual_'+side+'_refused:'+reason,fcId,iso,'manual',S.version,JSON.stringify({manual:true,side,requested:{amount:input.amount??null,horizon:h},...extra})).run();
  return {ok:false,status:'refused',reason,side,symbol,fills:[]};
 };

 const q=await deps.fetchQuote(symbol).catch(()=>null);
 let liq:Liquidity={advValue:null,dailyVol:null};try{liq=liquidityFromBars(await deps.fetchBars(symbol),today);}catch{}
 if(!q||!(q.price>0))return refuse('no_quote',horizon);

 // Lots to trade: a buy opens/extends one lot at the chosen horizon; a sell closes every open lot of the symbol.
 const lots:{horizon:number;quantity:number}[]=[];
 if(side==='sell'){
  for(const p of book.positions)if(p.symbol===symbol&&p.quantity>0)lots.push({horizon:p.horizon,quantity:p.quantity});
  if(!lots.length)return refuse('no_position',horizon);
 }else{
  const invested=book.positions.reduce((s:number,p:any)=>s+p.quantity*p.avgCost,0),equity=book.cash+invested;
  if(!(S.horizons as number[]).includes(horizon))return refuse('horizon_not_allowed',horizon);
  const cap=Math.min(input.amount??equity*S.sizing.positionPctOfEquity/100,book.cash);
  let qty=Math.floor(cap/q.price);
  if(fin(liq.advValue)&&liq.advValue>0)qty=Math.min(qty,Math.floor(liq.advValue*S.liquidity.maxOrderPctOfAdv/100/q.price));
  if(qty<1)return refuse(cap<q.price?'amount_below_one_share':'liquidity_limit',horizon,{cap,price:q.price});
  lots.push({horizon,quantity:qty});
 }

 const done:ManualResult['fills']=[];let lastReason='';
 for(const lot of lots){
  let quantity=lot.quantity,r=simulateFill(S,market,side,quantity,q,liq);
  if(r.filled&&side==='buy'&&quantity*r.fillPrice+r.commission>book.cash+1e-6){
   quantity=Math.floor((book.cash-(r.commission))/r.fillPrice);
   r=quantity>=1?simulateFill(S,market,side,quantity,q,liq):{filled:false,reason:'insufficient_cash'};
   if(r.filled&&quantity*r.fillPrice+r.commission>book.cash+1e-6)r={filled:false,reason:'insufficient_cash'};
  }
  if(!r.filled){lastReason=r.reason;await refuse(r.reason,lot.horizon,{quote:{price:q.price,quoteTime:q.quoteTime,ageSeconds:q.ageSeconds,isOpen:q.isOpen}});continue;}
  const view={id:fcId,symbol,horizon:lot.horizon,createdAt:iso,available:true,recordClass:'prospective-public',model:'manual',price:q.price,range:null,
   call:{policy:'manual',direction:'صاعد',strength:'',votes:0,targetPrice:null}};
  const dk=decisionKey(e.id,symbol,lot.horizon,fcId,side,today),did='dec:'+dk,ok=orderKey(e.id,symbol,lot.horizon,fcId,side),oid='ord:'+ok,fid='fill:'+ok;
  const note={manual:true,primarySource:'manual',view,decision:{action:side,reason:'manual_'+side,quantity},requestId:input.requestId};
  const res=await db.batch([
   db.prepare(INSERT_DECISION).bind(did,e.id,dk,iso,symbol,lot.horizon,side,'manual_'+side,fcId,iso,'manual',S.version,JSON.stringify(note)),
   db.prepare(INSERT_ORDER).bind(oid,e.id,did,ok,iso,iso,symbol,lot.horizon,side,quantity,'filled','filled',iso,fcId,JSON.stringify({at:iso,reason:'filled',fillId:fid,manual:true})),
   db.prepare(INSERT_FILL).bind(fid,e.id,oid,iso,symbol,lot.horizon,side,quantity,r.quotePrice,r.fillPrice,r.commission,r.spreadCost,r.slippageCost,e.currency,r.quoteTime,r.quoteAgeSeconds,r.source,fcId,
    JSON.stringify({halfSpreadBps:r.halfSpreadBps,impactBps:r.impactBps,liquidity:liq,strategy:S.version,mode:e.mode,manual:true}))]);
  if(Number(res?.[2]?.meta?.changes??0)>0)done.push({horizon:lot.horizon,quantity,fillPrice:r.fillPrice,commission:r.commission,quotePrice:r.quotePrice,quoteTime:r.quoteTime});
 }
 return done.length?{ok:true,status:'filled',reason:'filled',side,symbol,fills:done}:{ok:false,status:'refused',reason:lastReason||'not_filled',side,symbol,fills:[]};
}
