import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import(process.env.MIZAN_TEST_MODULE);
const candles=(n)=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:10000}));
const dataset=(n)=>({symbol:'AAPL',currency:'USD',adjustment:'split-adjusted',candles:candles(n)});
const report=()=>({company:{symbol:'AAPL',name:'Fixture',exchange:'NASDAQ',sector:'Retail',industry:'Retail',source:'fixture'},currency:'USD',priceSource:'fixture',facts:[],prices:[],asOf:'2025-01-01',retrievedAt:'2025-01-01',quoteTime:null,official:null,news:[],peers:[],checks:[],warnings:[],mode:'current'});
test('dynamic gating fails closed on invalid, duplicate, absent or zero-confidence inputs',()=>{
 const signal={expertId:'trend_momentum',prediction:.8,confidence:.9,varianceEstimate:.02};
 for(const experts of [[],[signal,signal],[{...signal,prediction:NaN}],[{...signal,varianceEstimate:-1}],[{...signal,confidence:0}]])assert.equal(m.DynamicGatingEngine.fuse(experts,'BULL_TREND',false,80).shouldAbstain,true);
 assert.equal(m.DynamicGatingEngine.fuse([signal],null,false,null).shouldAbstain,true);
 assert.equal(m.DynamicGatingEngine.fuse([signal],'BULL_TREND',true,80).shouldAbstain,true);
 const result=m.DynamicGatingEngine.fuse([signal,{...signal,expertId:'structural_flow',prediction:.6}],'BULL_TREND',false,80);
 assert.equal(result.shouldAbstain,false);assert.equal(result.calibrated,false);assert.ok(Math.abs(Object.values(result.activeWeights).reduce((s,x)=>s+x,0)-1)<1e-12);
});
test('window sorting happens before horizon assignment and preserves post-purge minimum',()=>{
 const d=dataset(100),options={minTrainSessions:10,testSessions:10,embargoPct:.05,predictionHorizonSessions:5};
 const splits=m.buildWalkForwardWindows(d,options);
 assert.deepEqual(splits,m.buildWalkForwardWindows({...d,candles:[...d.candles].reverse()},options));
 assert.ok(splits.length>1);
 for(const s of splits){assert.ok(s.train.length>=10);assert.equal(s.test.length,10);assert.ok(s.testEnd<=d.candles[94].date);for(const c of s.train){const idx=d.candles.findIndex(x=>x.date===c.date);assert.ok(d.candles[idx+5].date<s.testStart);}}
 assert.throws(()=>m.buildWalkForwardWindows({...d,candles:[...d.candles,d.candles[0]]},options));
 assert.throws(()=>m.buildWalkForwardWindows(d,{predictionHorizonSessions:0}));
});
test('historical reports remove future facts, undated facts, forecasts and live context',()=>{
 const d=dataset(100),base=report();
 const fact={key:'revenue',value:100,currency:'USD',period:'annual',date:'2019-01-01',source:'fixture'};
 base.facts=[{...fact,publishedAt:'2019-02-01'},{...fact,key:'netIncome',publishedAt:'2030-01-01'},{...fact,key:'debt'}];
 base.forecast={rows:[{available:true}]};base.liveQuote={price:9999};base.context={market:{future:true}};base.official={facts:base.facts};
 const r=m.historicalScenarioReport(base,d,d.candles.slice(0,50));
 assert.deepEqual(r.facts,[base.facts[0]]);assert.equal(r.forecast,undefined);assert.equal(r.liveQuote,undefined);assert.equal(r.context,undefined);assert.equal(r.official,null);assert.equal(r.mode,'historical');assert.equal(r.prices.at(-1).date,r.asOf);
});
test('execution honors entry zone, gap stops, costs, same-bar ambiguity and horizon maturity',()=>{
 const bars=candles(4),levels={low:99,high:102,stop:95,target1:110},costs={commissionBps:5,slippageBps:10,doubleSided:true};
 bars[1]={...bars[1],open:90,low:88,high:112,close:110};
 const gap=m.simulatePlannedTrade(bars,0,3,levels,costs);
 assert.equal(gap.exit,1);assert.equal(gap.exitReason,'stop');assert.ok(gap.exitPrice<90);assert.ok(gap.netReturn<-.1);
 assert.equal(m.simulatePlannedTrade(bars,0,5,levels,costs),null);
 assert.equal(m.simulatePlannedTrade([{...bars[0],open:105}],0,1,levels,costs),null);
 const both=m.simulatePlannedTrade([{...bars[0],low:94,high:111}],0,1,levels,costs);
 assert.equal(both.exitReason,'stop');
 const timeout=m.simulatePlannedTrade(candles(2),0,2,levels,costs);
 assert.equal(timeout.exitReason,'horizon');assert.ok(timeout.netReturn<0);
});
test('flat-series end-to-end backtest never fabricates trades, calibration or accepted results',()=>{
 const d=dataset(400),base=report(),a=m.runChampionshipBacktest(d,base),b=m.runChampionshipBacktest({...d,candles:[...d.candles].reverse()},base);
 assert.deepEqual(a,b);assert.ok(a.windowsEvaluated>0);assert.ok(a.missingFinancialSafetyChecks>0);assert.match(a.limitations.join(' '),/حقائق مالية معروفة وقتيًا/);assert.equal(a.totalTrades,0);assert.equal(a.finalCapital,a.initialCapital);assert.equal(a.profitFactor,null);assert.equal(a.championshipMetrics.brierScore,null);assert.equal(a.championshipMetrics.deflatedSharpeProbability,null);assert.equal(a.championshipMetrics.isAccepted,false);assert.ok(a.equityCurve.every(p=>p.return===0));
 assert.throws(()=>m.runChampionshipBacktest(dataset(50),base));
 assert.throws(()=>m.runChampionshipBacktest({...d,adjustment:'raw'},base));
 assert.throws(()=>m.runChampionshipBacktest(d,{...base,currency:'SAR'}));
});
test('extended analysis preserves missing debt, negative cash flow and absent forecast probabilities',()=>{
 const r=report();r.prices=candles(100);r.asOf=r.prices.at(-1).date;
 r.facts=['netIncome','operatingCashFlow','equity'].map((key,i)=>({key,value:[-100,-150,200][i],date:'2019-12-31',publishedAt:'2020-01-15',period:'annual',currency:'USD',source:'fixture'}));
 const x=m.extendedAnalysis(r);
 assert.equal(x.growthScore,null);assert.ok(x.metrics.some(v=>v.name==='صافي الدين'&&v.value===null));
 assert.ok(x.riskWarnings.some(v=>v.includes('الدين أو النقد')));assert.ok(!x.keyInsights.some(v=>v.includes('التدفق التشغيلي يغطي')));
 assert.ok(!x.keyInsights.some(v=>v.includes('احتمال صعود')));assert.equal(x.fair,null);
});
test('executed synthetic trades do not overlap and reconcile to daily portfolio equity after costs',()=>{
 const d=dataset(700),base=report();
 d.candles=d.candles.map((c,i)=>{const close=100+i*.08+Math.sin(i*.7)*2;return {...c,open:close-.15,high:close+.25,low:close-.25,close,volume:i%9===0?100000:10000};});
 // Construct eligible opening fills using only each previous session's information.
 for(let i=315;i<680;i++){
  const s=m.tradeScenario(m.historicalScenarioReport(base,d,d.candles.slice(0,i)));
  if(s.levels){const c=d.candles[i],open=s.levels.low;Object.assign(c,{open,high:Math.max(c.high,open),low:Math.min(c.low,open)});}
 }
 const r=m.runChampionshipBacktest(d,base);
 assert.ok(r.trades.length>2);
 for(let i=1;i<r.trades.length;i++)assert.ok(r.trades[i].entryDate>r.trades[i-1].exitDate);
 assert.ok(Math.abs(r.initialCapital+r.trades.reduce((s,t)=>s+t.netPnl,0)-r.finalCapital)<1e-7);
 assert.ok(Math.abs(r.equityCurve.reduce((v,p)=>v*(1+p.return),r.initialCapital)-r.finalCapital)<1e-7);
 assert.equal(r.equityCurve.at(-1).equity,r.finalCapital);
 const losses=r.trades.reduce((s,t)=>s+Math.max(0,-t.netPnl),0),gains=r.trades.reduce((s,t)=>s+Math.max(0,t.netPnl),0);
 assert.equal(r.profitFactor,losses>0?gains/losses:null);
 assert.equal(r.championshipMetrics.brierScore,null);
});

test('execution panel plan keeps missing liquidity and sizing unknown, never grants live buy',()=>{
 const r=report(); r.prices=candles(21);r.asOf=r.prices.at(-1).date;
 const p=m.tradeScenario(r);
 assert.equal(p.executionPlan.status,'standby');
 assert.equal(p.executionPlan.positionSizing.recommendedFraction,null);
 assert.equal(p.executionPlan.liquidityConfirmation.rvol,1);
 assert.equal(p.executionPlan.liquidityConfirmation.isConfirmed,false);
 assert.equal(p.cashFlowQuality.fcfYieldPercent,null);
 for(const volumes of [[],[100],Array(20).fill(100)]){
  const missing=m.tradeScenario({...r,prices:r.prices.slice(0,volumes.length).map((c,i)=>({...c,volume:volumes[i]}))});
  assert.equal(missing.executionPlan.liquidityConfirmation.rvol,null);
  assert.equal(missing.executionPlan.liquidityConfirmation.isConfirmed,false);
 }
 r.prices[20].volume=14999;
 assert.equal(m.tradeScenario(r).executionPlan.liquidityConfirmation.isConfirmed,false);
 r.prices[20].volume=15000;
 assert.equal(m.tradeScenario(r).executionPlan.liquidityConfirmation.isConfirmed,true);
 assert.equal(m.tradeScenario(r).executionPlan.status,'standby');
});
