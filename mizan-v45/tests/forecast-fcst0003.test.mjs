// FCST-0003: pins the causes found in research/FCST-0003-ENGINE-TRACE.md. These tests describe CURRENT behavior
// (no engine change). They pass on the production engine mizan-scenarios-7-shock-warning-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {forecasts,researchFactors,forecastWeights,HORIZONS} from '../lib/research-model.ts';
import {DEFAULT_SETTINGS,adjustedWeights} from '../lib/site-settings.ts';
import {scenarioCenter} from '../lib/forecast-diagnostics.ts';
import {horizonCondition} from '../lib/forecast-conditions.ts';
import {directionOf} from '../lib/forecast-metrics.ts';
import {fmt} from '../lib/analysis.ts';
import {syntheticReport,NOW} from '../research/forecast-repair/fixtures.mjs';

const aapl=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/aapl-2026-09-05.json',import.meta.url),'utf8'));
const aaplNow=r=>Date.parse(r.asOf+'T20:00:00Z');
const pick=row=>({p:row.predictedPrice,r:row.range,c:row.diagnostics?.center?.centerLogReturn,d:row.direction,a:row.available});

test('per-horizon independence: each row is identical when computed alone, in reverse order, or with all six',()=>{
 for(const rep of [aapl(),syntheticReport(),syntheticReport({id:'TEST_SA_UP',market:'sa',drift:.0015})]){
  const now=rep.fixtureKind?NOW:aaplNow(rep),all=forecasts(rep,null,now,DEFAULT_SETTINGS);
  const rev=forecasts(rep,null,now,DEFAULT_SETTINGS,[...HORIZONS].reverse());
  for(const h of HORIZONS){
   const alone=forecasts(rep,null,now,DEFAULT_SETTINGS,[h]).rows[0];
   const a=all.rows.find(x=>x.sessions===h.sessions),b=rev.rows.find(x=>x.sessions===h.sessions);
   assert.deepEqual(pick(alone),pick(a),'alone vs all h='+h.sessions);assert.deepEqual(pick(b),pick(a),'reverse vs all h='+h.sessions);
  }
  // one reference price for every horizon (no per-horizon reference drift)
  for(const row of all.rows)assert.equal(row.price,all.price);
 }
});

test('consistency: center recomputed from factors x horizon weights -> bias -> scenarioCenter equals forecasts() (to 1e-15; the trace harness proves bit equality)',()=>{
 const rep=aapl(),now=aaplNow(rep),out=forecasts(rep,null,now,DEFAULT_SETTINGS);
 const {factors,conditioning}=researchFactors(rep,now);
 let checked=0;
 for(const row of out.rows){if(!row.available)continue;
  const w=adjustedWeights(forecastWeights(row.sessions),DEFAULT_SETTINGS);
  const avail=factors.filter(f=>f.signal!==null).sort((x,y)=>Math.abs(y.signal)*w[y.key]-Math.abs(x.signal)*w[x.key]);
  const bias=avail.reduce((s,f)=>s+f.signal*w[f.key],0)/100;
  const c=row.diagnostics.center;
  assert.ok(Math.abs(bias)<=1);
  if(row.sessions>1)assert.equal(c.annualLogTilt,bias*.15);
  const cond=horizonCondition(conditioning,row.sessions);
  const daySigma=row.rangeCheck.dailyVolatility/100,expectedScale=row.rangeCheck.horizonVolatility/100;
  const sc=scenarioCenter({bias,sessions:row.sessions,dailySigma:daySigma,expectedScale,positiveTiltMultiplier:cond.positiveTiltMultiplier});
  assert.ok(Math.abs(sc.centerLogReturn-c.centerLogReturn)<1e-15,'h='+row.sessions);
  assert.ok(Math.abs(row.predictedPrice-row.price*Math.exp(c.centerLogReturn))<1e-9*row.price);
  checked++;}
 assert.ok(checked>=5);
});

test('units: for h>=2 requested log return = bias*0.15*h/252 and can never exceed 0.15*h/252 (annual ceiling, log units)',()=>{
 for(const h of [5,21,63,126,252])for(const bias of [-1,-.3,0,.3,1]){
  const x=scenarioCenter({bias,sessions:h,dailySigma:.02,expectedScale:10,positiveTiltMultiplier:1});
  assert.ok(Math.abs(x.requestedLogReturn-bias*.15*h/252)<1e-15);
  assert.ok(Math.abs(x.centerLogReturn)<=.15*h/252+1e-15);
 }
 // the ceiling relative to one sigma*sqrt(h) shrinks toward short horizons: 0.15*sqrt(h)/(252*sigma_d)
 const ratio=h=>.15*h/252/(.0166*Math.sqrt(h));
 assert.ok(ratio(5)<.09&&ratio(21)<.17&&ratio(252)<.6);
});

test('neutral band vs ceiling: weekly "up" is arithmetically unreachable when the 0.6 low-volume multiplier applies',()=>{
 const chg=(bias,h,m)=>100*Math.expm1(scenarioCenter({bias,sessions:h,dailySigma:.02,expectedScale:10,positiveTiltMultiplier:m}).centerLogReturn);
 const thr=h=>h===1?.1:h<=5?.25:.5;
 assert.equal(directionOf(chg(1,5,.6),thr(5)),'محايد'); // even the maximum possible bias
 assert.equal(directionOf(chg(1,5,1),thr(5)),'صاعد');
 assert.equal(directionOf(chg(.8,5,1),thr(5)),'محايد'); // needs |bias| > ~0.839 at h=5
 assert.equal(directionOf(chg(.39,21,1),thr(21)),'محايد'); // needs |bias| > ~0.399 at h=21
 assert.equal(directionOf(chg(.14,63,1),thr(63)),'صاعد');  // needs |bias| > ~0.133 at h=63
});

test('h=1 uses a different scale (0.25*daily sigma) than h>=5 (0.15/yr): the one-session centre exceeds the five-session centre',()=>{
 const sd=.0166;
 for(const bias of [-.3,.16,.5]){
  const c1=scenarioCenter({bias,sessions:1,dailySigma:sd,expectedScale:1,positiveTiltMultiplier:1}).centerLogReturn;
  const c5=scenarioCenter({bias,sessions:5,dailySigma:sd,expectedScale:1,positiveTiltMultiplier:1}).centerLogReturn;
  assert.ok(Math.abs(c1)>Math.abs(c5));
  assert.ok(Math.abs(c1/bias*252-.25*sd*252)<1e-12); // implied annual drift per unit bias ~1.05 vs 0.15
 }
});

test('display rounding: distinct engine centres can print as the same 2-decimal price (presentation, not duplicated state)',()=>{
 const p=10.81,a=p*Math.exp(.0003),b=p*Math.exp(.0004);
 assert.notEqual(a,b);assert.equal(fmt(a),fmt(b));
});

test('patch (shock-warning-2): partial in-progress session volume is not compared with complete sessions',async()=>{
 const {forecastConditions}=await import('../lib/forecast-conditions.ts');
 const rep=syntheticReport();rep.mode='current';
 for(let i=0;i<rep.prices.length;i++)rep.prices[i].volume=1000000;
 rep.prices.at(-1).volume=300000; // 30% of a normal session: mid-session partial bar
 const closed=forecastConditions(rep,NOW);
 assert.ok(Math.abs(closed.relativeVolume-.3)<1e-12,'no live quote: last bar treated as a complete session (unchanged)');
 rep.liveQuote={symbol:rep.company.symbol,price:rep.prices.at(-1).close,currency:rep.currency,quoteTime:rep.asOf+'T15:00:00Z',isOpen:true};
 const open=forecastConditions(rep,NOW);
 assert.equal(open.relativeVolume,1,'session open: ratio uses the last 21 complete sessions');
 rep.liveQuote={...rep.liveQuote,isOpen:false};
 assert.ok(Math.abs(forecastConditions(rep,NOW).relativeVolume-.3)<1e-12,'session closed: unchanged');
 rep.liveQuote={...rep.liveQuote,isOpen:true};rep.mode='historical';
 assert.ok(Math.abs(forecastConditions(rep,NOW).relativeVolume-.3)<1e-12,'historical mode: unchanged');
});
