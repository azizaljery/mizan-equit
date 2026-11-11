import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import(process.env.MIZAN_TEST_MODULE),B=m.botEngine,S=B.STRATEGY_V1;
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const T0=Date.parse('2026-11-12T10:00:00Z');
const fc=(o={})=>({id:'f1',symbol:'AAA',horizon:5,createdAt:new Date(T0-3600000).toISOString(),available:true,recordClass:'prospective-public',model:'m',price:100,range:[95,106],
  call:{policy:'mizan-direction-v1',direction:'صاعد',strength:'متوسطة',votes:2,targetPrice:103},...o});
const ctx=(o={})=>({now:T0,experimentStartedAt:T0-86400000,holdsSymbol:false,hasOpenOrder:false,openPositionsInHorizon:0,equity:1_000_000,cash:1_000_000,haltedToday:false,price:100,liquidity:{advValue:50_000_000,dailyVol:.02},...o});
const quote=(o={})=>({price:100,quoteTime:new Date(T0-30000).toISOString(),isOpen:true,ageSeconds:30,delayAccepted:true,source:'fixture',...o});

test('strategy v1 is frozen and versioned',()=>{assert.equal(S.version,'bot-strategy-1');assert.deepEqual(S.horizons,[1,5,21]);assert.ok(Object.isFrozen(S));});
test('entry: buys only on a fresh public up call of sufficient strength, sized by equity, liquidity and cash',()=>{
  const d=B.decideEntry(S,'us',fc(),ctx());assert.equal(d.action,'buy');assert.equal(d.quantity,200);          // 2% of 1,000,000 / 100
  assert.equal(B.decideEntry(S,'us',fc(),ctx({liquidity:{advValue:1_500_000,dailyVol:.02}})).quantity,150);      // 1% of ADV binds
  assert.equal(B.decideEntry(S,'us',fc(),ctx({cash:5000})).quantity,49);                                         // cash binds
  for(const [f,c,reason] of [[null,{},'no_forecast'],[fc({available:false}),{},'forecast_unavailable'],[fc({recordClass:'private'}),{},'forecast_not_public_prospective'],
    [fc({createdAt:new Date(T0-21*3600000).toISOString()}),{},'forecast_stale'],[fc({call:{...fc().call,direction:'هابط',votes:-2}}),{},'direction_not_up'],
    [fc({call:{...fc().call,votes:1}}),{},'signal_too_weak'],[fc({horizon:63}),{},'horizon_not_in_strategy'],[fc(),{haltedToday:true},'daily_loss_halt'],
    [fc(),{openPositionsInHorizon:15},'max_positions_reached'],[fc(),{liquidity:{advValue:500_000,dailyVol:.02}},'liquidity_below_minimum'],[fc(),{cash:50},'insufficient_cash_or_size']])
    {const r=B.decideEntry(S,'us',f,ctx(c));assert.equal(r.action,'abstain');assert.equal(r.reason,reason);}
  assert.equal(B.decideEntry(S,'us',fc(),ctx({holdsSymbol:true})).action,'hold');assert.equal(B.decideEntry(S,'us',fc(),ctx({hasOpenOrder:true})).reason,'order_already_pending');
});
test('no retroactive or guessed decisions: future or pre-experiment forecasts and missing data never trade',()=>{
  assert.deepEqual(B.decideEntry(S,'us',fc({createdAt:new Date(T0+1000).toISOString()}),ctx()),{action:'suspend',reason:'forecast_time_invalid_or_in_future'});
  assert.equal(B.decideEntry(S,'us',fc({createdAt:new Date(T0-2*86400000).toISOString()}),ctx()).reason,'forecast_predates_experiment');
  assert.deepEqual(B.decideEntry(S,'us',fc(),ctx({price:null})),{action:'suspend',reason:'price_unavailable'});
  assert.deepEqual(B.decideEntry(S,'us',fc(),ctx({liquidity:{advValue:null,dailyVol:null}})),{action:'suspend',reason:'liquidity_unavailable'});
});
test('exit: horizon end, then a newer down call, then the stop below the entry range; otherwise hold',()=>{
  const p={quantity:200,entryForecast:fc(),entryOutcomeComplete:false},later=o=>fc({id:'f2',createdAt:new Date(T0).toISOString(),...o});
  assert.equal(B.decideExit(S,{...p,entryOutcomeComplete:true},null,{price:100,hasOpenOrder:false}).reason,'horizon_ended');
  assert.equal(B.decideExit(S,p,later({call:{...fc().call,direction:'هابط',votes:-2}}),{price:100,hasOpenOrder:false}).reason,'direction_flipped_down');
  assert.equal(B.decideExit(S,p,later({horizon:21,call:{...fc().call,direction:'هابط'}}),{price:100,hasOpenOrder:false}).action,'hold');   // other horizon does not close it
  assert.equal(B.decideExit(S,p,fc({id:'old',createdAt:new Date(T0-7200000).toISOString(),call:{...fc().call,direction:'هابط'}}),{price:100,hasOpenOrder:false}).action,'hold'); // older forecast ignored
  const stop=B.decideExit(S,p,null,{price:94.9,hasOpenOrder:false});assert.equal(stop.reason,'stop_below_range_low');assert.equal(stop.quantity,200);
  assert.equal(B.decideExit(S,p,null,{price:95,hasOpenOrder:false}).action,'hold');
  assert.equal(B.decideExit(S,p,null,{price:null,hasOpenOrder:false}).action,'suspend');
  assert.equal(B.decideExit(S,{...p,entryOutcomeComplete:true},null,{price:100,hasOpenOrder:true}).reason,'order_already_pending');
});
test('execution: no fill unless the market is open, the quote is fresh and liquidity is known',()=>{
  const liq={advValue:50_000_000,dailyVol:.02};
  for(const [q,l,reason] of [[null,liq,'no_quote'],[quote({isOpen:false}),liq,'market_closed'],[quote({ageSeconds:901}),liq,'quote_stale'],[quote({delayAccepted:false}),liq,'quote_stale'],
    [quote(),{advValue:null,dailyVol:null},'liquidity_unavailable'],[quote(),{advValue:1_000_000,dailyVol:.02},'order_exceeds_liquidity_limit']])
    assert.deepEqual(B.simulateFill(S,'us','buy',200,q,l),{filled:false,reason});
  assert.equal(B.simulateFill(S,'us','buy',0,quote(),liq).reason,'invalid_quantity');
});
test('execution costs: half-spread tier, square-root impact, rounding against the trader, commission',()=>{
  const liq={advValue:50_000_000,dailyVol:.02},buy=B.simulateFill(S,'us','buy',200,quote(),liq),sell=B.simulateFill(S,'us','sell',200,quote(),liq);
  const impact=1e4*.5*.02*Math.sqrt(20000/50_000_000);near(buy.impactBps,impact);assert.equal(buy.halfSpreadBps,2);
  assert.equal(buy.fillPrice,Math.ceil(100*(1+(2+impact)/1e4)*100-1e-9)/100);assert.equal(sell.fillPrice,Math.floor(100*(1-(2+impact)/1e4)*100+1e-9)/100);
  assert.ok(buy.fillPrice>100&&sell.fillPrice<100);near(buy.commission,200*buy.fillPrice*1/1e4);near(buy.spreadCost,200*100*2/1e4);assert.ok(buy.slippageCost>=0);
  const sa=B.simulateFill(S,'sa','buy',100,quote({price:30}),{advValue:20_000_000,dailyVol:.015});assert.equal(sa.halfSpreadBps,7);near(sa.commission,100*sa.fillPrice*15.5/1e4);
  assert.equal(B.simulateFill(S,'us','buy',10,quote({price:5}),{advValue:900_000,dailyVol:.03}).halfSpreadBps,40);
});
test('ledger rebuilds cash, positions and realised results from fills alone; order of input does not matter',()=>{
  const fills=[{symbol:'AAA',horizon:5,side:'buy',quantity:100,fillPrice:10,commission:1,createdAt:'2026-11-12T10:00:00Z',forecastId:'f1'},
    {symbol:'BBB',horizon:21,side:'buy',quantity:50,fillPrice:20,commission:2,createdAt:'2026-11-12T10:05:00Z',forecastId:'f2'},
    {symbol:'AAA',horizon:5,side:'sell',quantity:100,fillPrice:11,commission:1,createdAt:'2026-11-19T10:00:00Z'}];
  const l=B.ledger(10000,fills),l2=B.ledger(10000,[fills[2],fills[0],fills[1]]);assert.deepEqual(l,l2);
  near(l.cash,10000-1001-1002+1099);near(l.realized,1099-1001);near(l.commissions,4);assert.equal(l.positions.length,1);assert.equal(l.positions[0].symbol,'BBB');near(l.positions[0].avgCost,1002/50);
  assert.equal(l.closed[0].forecastId,'f1');near(l.closed[0].returnPct,100*98/1001);
  const v=B.valuation(l,{BBB:22});near(v.positionsValue,1100);near(v.equity,l.cash+1100);near(v.unrealized,1100-1002);
  assert.deepEqual(B.valuation(l,{}).missingMarks,['BBB']);
  assert.throws(()=>B.ledger(100,fills),/buy exceeds cash/);assert.throws(()=>B.ledger(10000,[fills[2]]),/sell exceeds holding/);
});
test('performance: return, maximum drawdown, win rate and benchmark over the same dates',()=>{
  const p=B.performance(1000,[{date:'2026-11-12',equity:1000,benchmark:100},{date:'2026-11-13',equity:1100,benchmark:101},{date:'2026-11-14',equity:990,benchmark:null},{date:'2026-11-15',equity:1045,benchmark:103}],[{pnl:5},{pnl:-2},{pnl:1}]);
  near(p.returnPct,4.5);near(p.maxDrawdownPct,10);near(p.winRatePct,200/3);near(p.benchmarkReturnPct,3);
  assert.equal(B.performance(1000,[],[]).winRatePct,null);
  assert.equal(B.haltedToday(S,1000,970),true);assert.equal(B.haltedToday(S,1000,971),false);assert.equal(B.haltedToday(S,null,1),false);
  assert.equal(B.decisionKey('e','AAA',5,'f1','buy','2026-11-12'),'e|AAA|5|f1|buy|2026-11-12');assert.equal(B.orderKey('e','AAA',5,null,'sell'),'e|AAA|5|none|sell');
});
