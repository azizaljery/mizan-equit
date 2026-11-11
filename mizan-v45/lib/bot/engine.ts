/**
 * BOT-0001 virtual trading bot: pure decision, execution-simulation and accounting rules. Paper money only.
 * No I/O here: every function takes what was known at decision time and returns a decision with its reason, so each
 * decision can be traced from the saved forecast to the simulated fill and the result. Nothing is created retroactively.
 */
export const BOT_STRATEGY_VERSION='bot-strategy-1';
export type Market='sa'|'us';
export type Horizon=1|5|21;
export type CostModel={commissionBps:number;minCommission:number;halfSpreadTiers:{minAdvValue:number;bps:number}[];impactCoef:number;priceDecimals:number};
export type StrategyConfig={version:string;horizons:Horizon[];
 entry:{direction:'صاعد';minVotes:number;maxForecastAgeHours:number;recordClass:'prospective-public'};
 sizing:{positionPctOfEquity:number;maxPositionsPerHorizon:number};
 liquidity:{maxOrderPctOfAdv:number;minAdvValue:{sa:number;us:number}};
 exits:{horizonEnd:boolean;directionFlip:boolean;stopBelowRangeLow:boolean};
 risk:{dailyLossHaltPct:number};
 execution:{requireOpen:boolean;maxQuoteAgeSeconds:number;orderExpiryHours:number};
 costs:{sa:CostModel;us:CostModel}};
/** Version 1, fixed before any experiment. A change is a new version with its own date; a running experiment keeps its version. */
export const STRATEGY_V1:StrategyConfig=Object.freeze({version:BOT_STRATEGY_VERSION,horizons:[1,5,21],
 entry:{direction:'صاعد',minVotes:2,maxForecastAgeHours:20,recordClass:'prospective-public'},
 sizing:{positionPctOfEquity:2,maxPositionsPerHorizon:15},
 liquidity:{maxOrderPctOfAdv:1,minAdvValue:{sa:3_750_000,us:1_000_000}},
 exits:{horizonEnd:true,directionFlip:true,stopBelowRangeLow:true},
 risk:{dailyLossHaltPct:3},
 execution:{requireOpen:true,maxQuoteAgeSeconds:900,orderExpiryHours:96},
 // Costs are stated assumptions, not broker quotes: Saudi commission 15.5 bps, US 1 bp; half-spread by daily traded value; square-root impact.
 costs:{sa:{commissionBps:15.5,minCommission:0,halfSpreadTiers:[{minAdvValue:187_500_000,bps:3},{minAdvValue:18_750_000,bps:7},{minAdvValue:3_750_000,bps:15},{minAdvValue:0,bps:40}],impactCoef:.5,priceDecimals:2},
  us:{commissionBps:1,minCommission:0,halfSpreadTiers:[{minAdvValue:50_000_000,bps:2},{minAdvValue:5_000_000,bps:5},{minAdvValue:1_000_000,bps:15},{minAdvValue:0,bps:40}],impactCoef:.5,priceDecimals:2}}}) as StrategyConfig;

const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const pos=(v:unknown):v is number=>fin(v)&&v>0;
export type ForecastView={id:string;symbol:string;horizon:number;createdAt:string;available:boolean;recordClass:string;model:string;price:number|null;range:[number,number]|null;
 call:{policy:string;direction:string;strength:string;votes:number;targetPrice:number|null}|null};
export type Liquidity={advValue:number|null;dailyVol:number|null};
export type Decision={action:'buy'|'sell'|'hold'|'abstain'|'suspend';reason:string;quantity?:number;detail?:Record<string,unknown>};
export const decisionKey=(experimentId:string,symbol:string,horizon:number,forecastId:string|null,action:string,day:string)=>[experimentId,symbol,horizon,forecastId??'none',action,day].join('|');
export const orderKey=(experimentId:string,symbol:string,horizon:number,forecastId:string|null,side:string)=>[experimentId,symbol,horizon,forecastId??'none',side].join('|');

/** Entry rule. `now` and every input are what was known at decision time; a forecast newer than `now` is refused. */
export function decideEntry(s:StrategyConfig,market:Market,f:ForecastView|null,ctx:{now:number;experimentStartedAt:number;holdsSymbol:boolean;hasOpenOrder:boolean;openPositionsInHorizon:number;
 equity:number;cash:number;haltedToday:boolean;price:number|null;liquidity:Liquidity}):Decision{
 if(!f)return {action:'abstain',reason:'no_forecast'};
 const created=Date.parse(f.createdAt);
 if(!Number.isFinite(created)||created>ctx.now)return {action:'suspend',reason:'forecast_time_invalid_or_in_future'};
 if(created<ctx.experimentStartedAt)return {action:'abstain',reason:'forecast_predates_experiment'};
 if(!f.available||!f.call)return {action:'abstain',reason:'forecast_unavailable'};
 if(f.recordClass!==s.entry.recordClass)return {action:'abstain',reason:'forecast_not_public_prospective'};
 if(!s.horizons.includes(f.horizon as Horizon))return {action:'abstain',reason:'horizon_not_in_strategy'};
 if((ctx.now-created)/3600000>s.entry.maxForecastAgeHours)return {action:'abstain',reason:'forecast_stale'};
 if(f.call.direction!==s.entry.direction)return {action:'abstain',reason:'direction_not_up'};
 if(!(Math.abs(f.call.votes)>=s.entry.minVotes))return {action:'abstain',reason:'signal_too_weak'};
 if(ctx.holdsSymbol)return {action:'hold',reason:'already_held'};
 if(ctx.hasOpenOrder)return {action:'hold',reason:'order_already_pending'};
 if(ctx.haltedToday)return {action:'abstain',reason:'daily_loss_halt'};
 if(ctx.openPositionsInHorizon>=s.sizing.maxPositionsPerHorizon)return {action:'abstain',reason:'max_positions_reached'};
 if(!pos(ctx.price))return {action:'suspend',reason:'price_unavailable'};
 if(!pos(ctx.liquidity.advValue))return {action:'suspend',reason:'liquidity_unavailable'};
 if(ctx.liquidity.advValue<s.liquidity.minAdvValue[market])return {action:'abstain',reason:'liquidity_below_minimum'};
 const budget=Math.min(ctx.equity*s.sizing.positionPctOfEquity/100,ctx.liquidity.advValue*s.liquidity.maxOrderPctOfAdv/100,ctx.cash*.98);
 const quantity=Math.floor(budget/ctx.price);
 if(!(quantity>=1))return {action:'abstain',reason:'insufficient_cash_or_size'};
 return {action:'buy',reason:'entry_up_call',quantity,detail:{budget,votes:f.call.votes,strength:f.call.strength,targetPrice:f.call.targetPrice}};
}
/** Exit rule for one open position; the first matching condition wins, in the documented order. */
export function decideExit(s:StrategyConfig,p:{quantity:number;entryForecast:ForecastView;entryOutcomeComplete:boolean},latest:ForecastView|null,ctx:{price:number|null;hasOpenOrder:boolean}):Decision{
 if(ctx.hasOpenOrder)return {action:'hold',reason:'order_already_pending'};
 if(s.exits.horizonEnd&&p.entryOutcomeComplete)return {action:'sell',reason:'horizon_ended',quantity:p.quantity};
 if(s.exits.directionFlip&&latest&&latest.available&&latest.call&&latest.horizon===p.entryForecast.horizon&&Date.parse(latest.createdAt)>Date.parse(p.entryForecast.createdAt)&&latest.call.direction==='هابط')
  return {action:'sell',reason:'direction_flipped_down',quantity:p.quantity,detail:{flipForecastId:latest.id}};
 if(s.exits.stopBelowRangeLow&&p.entryForecast.range){
  if(!pos(ctx.price))return {action:'suspend',reason:'price_unavailable'};
  if(ctx.price<p.entryForecast.range[0])return {action:'sell',reason:'stop_below_range_low',quantity:p.quantity,detail:{rangeLow:p.entryForecast.range[0],price:ctx.price}};
 }
 return {action:'hold',reason:'no_exit_condition'};
}
export type Quote={price:number;quoteTime:string;isOpen:boolean;ageSeconds:number;delayAccepted:boolean;source:string};
export type FillResult={filled:false;reason:string}|{filled:true;quotePrice:number;fillPrice:number;commission:number;spreadCost:number;slippageCost:number;halfSpreadBps:number;impactBps:number;quoteTime:string;quoteAgeSeconds:number;source:string};
/** A fill happens only when the market is open, the quote is fresh and liquidity is known; otherwise the order stays pending with the reason. */
export function simulateFill(s:StrategyConfig,market:Market,side:'buy'|'sell',quantity:number,q:Quote|null,liq:Liquidity):FillResult{
 if(!q||!pos(q.price))return {filled:false,reason:'no_quote'};
 if(s.execution.requireOpen&&!q.isOpen)return {filled:false,reason:'market_closed'};
 if(!fin(q.ageSeconds)||q.ageSeconds<0||q.ageSeconds>s.execution.maxQuoteAgeSeconds||!q.delayAccepted)return {filled:false,reason:'quote_stale'};
 if(!pos(liq.advValue)||!fin(liq.dailyVol)||liq.dailyVol<0)return {filled:false,reason:'liquidity_unavailable'};
 if(!Number.isInteger(quantity)||quantity<1)return {filled:false,reason:'invalid_quantity'};
 const c=s.costs[market],value=quantity*q.price;
 if(value>liq.advValue*s.liquidity.maxOrderPctOfAdv/100*1.0000001)return {filled:false,reason:'order_exceeds_liquidity_limit'};
 const halfSpreadBps=c.halfSpreadTiers.find(t=>liq.advValue!>=t.minAdvValue)!.bps,impactBps=1e4*c.impactCoef*liq.dailyVol*Math.sqrt(value/liq.advValue);
 const sign=side==='buy'?1:-1,raw=q.price*(1+sign*(halfSpreadBps+impactBps)/1e4),k=10**c.priceDecimals;
 const fillPrice=side==='buy'?Math.ceil(raw*k-1e-9)/k:Math.floor(raw*k+1e-9)/k;
 if(!pos(fillPrice))return {filled:false,reason:'invalid_fill_price'};
 const gross=quantity*fillPrice,commission=Math.max(c.minCommission,gross*c.commissionBps/1e4);
 return {filled:true,quotePrice:q.price,fillPrice,commission,spreadCost:quantity*q.price*halfSpreadBps/1e4,slippageCost:Math.max(0,sign*(fillPrice-q.price)*quantity-quantity*q.price*halfSpreadBps/1e4),
  halfSpreadBps,impactBps,quoteTime:q.quoteTime,quoteAgeSeconds:q.ageSeconds,source:q.source};
}
export type Fill={symbol:string;horizon:number;side:'buy'|'sell';quantity:number;fillPrice:number;commission:number;createdAt:string;forecastId?:string|null};
export type Position={symbol:string;horizon:number;quantity:number;avgCost:number;openedAt:string;forecastId:string|null};
/** Rebuilds cash, open positions and realised results from the fill log alone, so a restart loses nothing and repeats nothing. */
export function ledger(initialCash:number,fills:readonly Fill[]){
 let cash=initialCash,realized=0,costs=0;const open=new Map<string,Position>(),closed:{symbol:string;horizon:number;pnl:number;returnPct:number;openedAt:string;closedAt:string;forecastId:string|null}[]=[];
 for(const f of [...fills].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
  const key=f.symbol+'|'+f.horizon,p=open.get(key);costs+=f.commission;
  if(f.side==='buy'){
   const total=f.quantity*f.fillPrice+f.commission;if(total>cash+1e-6)throw new Error('ledger: buy exceeds cash');cash-=total;
   if(p){const q=p.quantity+f.quantity;open.set(key,{...p,quantity:q,avgCost:(p.avgCost*p.quantity+total)/q});}
   else open.set(key,{symbol:f.symbol,horizon:f.horizon,quantity:f.quantity,avgCost:total/f.quantity,openedAt:f.createdAt,forecastId:f.forecastId??null});
  }else{
   if(!p||p.quantity<f.quantity)throw new Error('ledger: sell exceeds holding');
   const proceeds=f.quantity*f.fillPrice-f.commission,pnl=proceeds-p.avgCost*f.quantity;cash+=proceeds;realized+=pnl;
   closed.push({symbol:f.symbol,horizon:f.horizon,pnl,returnPct:100*pnl/(p.avgCost*f.quantity),openedAt:p.openedAt,closedAt:f.createdAt,forecastId:p.forecastId});
   if(p.quantity===f.quantity)open.delete(key);else open.set(key,{...p,quantity:p.quantity-f.quantity});
  }
 }
 return {cash,realized,commissions:costs,positions:[...open.values()],closed};
}
export function valuation(l:ReturnType<typeof ledger>,marks:Record<string,number>){
 let positionsValue=0,unrealized=0;const missing:string[]=[];
 for(const p of l.positions){const m=marks[p.symbol];if(!pos(m)){missing.push(p.symbol);positionsValue+=p.avgCost*p.quantity;continue;}positionsValue+=m*p.quantity;unrealized+=(m-p.avgCost)*p.quantity;}
 return {cash:l.cash,positionsValue,equity:l.cash+positionsValue,unrealized,missingMarks:missing};
}
/** Portfolio performance from daily equity snapshots and closed trades; benchmark is compared over the same dates. */
export function performance(initialCash:number,snapshots:readonly {date:string;equity:number;benchmark:number|null}[],closed:readonly {pnl:number}[]){
 const s=[...snapshots].sort((a,b)=>a.date.localeCompare(b.date));let peak=initialCash,maxDrawdownPct=0;
 for(const x of s){peak=Math.max(peak,x.equity);maxDrawdownPct=Math.max(maxDrawdownPct,100*(peak-x.equity)/peak);}
 const last=s.at(-1),b=s.filter(x=>pos(x.benchmark)),wins=closed.filter(c=>c.pnl>0).length;
 return {returnPct:last?100*(last.equity/initialCash-1):0,maxDrawdownPct,closedTrades:closed.length,winRatePct:closed.length?100*wins/closed.length:null,
  benchmarkReturnPct:b.length>=2?100*(b.at(-1)!.benchmark!/b[0].benchmark!-1):null};
}
export const haltedToday=(s:StrategyConfig,equityAtDayStart:number|null,equityNow:number)=>pos(equityAtDayStart)&&100*(equityAtDayStart-equityNow)/equityAtDayStart>=s.risk.dailyLossHaltPct;
