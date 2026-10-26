import test from 'node:test';
import assert from 'node:assert/strict';
import {forecasts,MODEL_VERSION} from '../lib/research-model.ts';
import {DEFAULT_SETTINGS} from '../lib/site-settings.ts';
import {forecastPoint,forecastDisplayStatus} from '../lib/forecast-presentation.ts';
import {scenarioCenter,inspectScenarioRange} from '../lib/forecast-diagnostics.ts';
import {syntheticReport,NOW} from '../research/forecast-repair/fixtures.mjs';
test('missing predicted price is not replaced with the observed price',()=>{assert.equal(forecastPoint({available:false,price:100}),null);assert.equal(forecastPoint({available:true,price:100}),null);});
test('forecast labels contain no buy recommendation',()=>{assert.doesNotMatch(forecastDisplayStatus({available:true,direction:'صاعد'}).label,/نوصي|شراء/);});
test('all six horizons carry numeric diagnostic evidence',()=>{const r=forecasts(syntheticReport(),null,NOW);assert.equal(r.rows.length,6);for(const row of r.rows)assert.equal(row.diagnostics.sessions,row.sessions);assert.match(MODEL_VERSION,/shock-warning-1/);});
test('shock policy: short horizons are issued WITH a warning, low confidence, and no shock blocker',()=>{
 const r=forecasts(syntheticReport({shock:-.025}),null,NOW);
 for(const row of r.rows.filter(x=>x.sessions<=21)){assert.equal(row.available,true,'sessions '+row.sessions);assert.match(row.shockWarning,/صدمة تقلب|كسر هيكلي/);assert.equal(row.confidence,'منخفض');assert.ok(!row.diagnostics.blockers.some(x=>x.code==='volatility_shock_policy'));assert.ok(Number.isFinite(row.predictedPrice)&&row.range&&row.range[0]<row.range[1]);}
 for(const row of r.rows.filter(x=>x.sessions>21))assert.ok(!row.shockWarning);
});
test('shock policy does not bypass admin settings: confidence floor and disabled horizons still withhold',()=>{
 const strict=structuredClone(DEFAULT_SETTINGS);strict.minConfidence='medium';
 const r=forecasts(syntheticReport({shock:-.025}),null,NOW,strict);
 for(const row of r.rows.filter(x=>x.sessions<=21)){assert.equal(row.available,false);assert.ok(row.diagnostics.blockers.some(x=>x.code==='confidence_policy'));}
 const off=structuredClone(DEFAULT_SETTINGS);off.periods[5].enabled=false;
 const q=forecasts(syntheticReport({shock:-.025}),null,NOW,off);assert.ok(q.rows.find(x=>x.sessions===5).diagnostics.blockers.some(x=>x.code==='horizon_disabled'));
});
test('shock policy keeps withholding when the price series is invalid',()=>{
 const rep=syntheticReport({shock:-.025});rep.prices[rep.prices.length-1].date=rep.prices[rep.prices.length-2].date;
 const r=forecasts(rep,null,NOW);for(const row of r.rows)assert.equal(row.available,false);
 assert.ok(r.rows[0].diagnostics.blockers.some(x=>x.code==='price_series_invalid'));
});

test('log drift is transformed exponentially',()=>{const x=scenarioCenter({bias:1,sessions:252,dailySigma:.03,expectedScale:.5,positiveTiltMultiplier:1});assert.equal(x.centerLogReturn,.15);assert.ok(Math.abs(100*Math.expm1(x.centerLogReturn)-16.1834242728283)<1e-10);});
test('range guard distinguishes wide range and unresolved price jump',()=>{const r=inspectScenarioRange({low:80,high:120,reference:100,sigma:.01,expectedScale:.01,maxSigma:3,longJump:true});assert.deepEqual(r.map(x=>x.code),['range_too_wide','corporate_action_or_jump_unresolved']);});
test('operator-disabled horizon remains disabled',()=>{const s=structuredClone(DEFAULT_SETTINGS);s.periods[5].enabled=false;const r=forecasts(syntheticReport(),null,NOW,s);assert.ok(r.rows.find(x=>x.sessions===5).diagnostics.blockers.some(x=>x.code==='horizon_disabled'));});


const sampleStd=v=>{const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1));};
const last20=rep=>sampleStd(rep.prices.slice(-21).slice(1).map((p,i)=>Math.log(p.close/rep.prices.slice(-21)[i].close)));
function reviewerCase(){ // calm base, then 19 alternating +/-1% sessions and a final +4% move: last move > 2.8 x 20-session vol
 const rep=syntheticReport({id:'T_REVIEW'});const n=rep.prices.length;let c=rep.prices[n-22].close;
 for(let k=0;k<20;k++){c*=Math.exp(k===19?.04:(k%2?.01:-.01));const p=rep.prices[n-20+k];p.close=c;p.open=c;p.high=c*1.001;p.low=c*.999;}
 return rep;
}
test('shock widening is REAL: same inputs with vs without the policy; short range uses at least the latest-20-session volatility',()=>{
 let widenedSomewhere=false;
 for(const [name,rep] of [['down',syntheticReport({shock:-.025})],['up5',syntheticReport({shock:.05})],['up8',syntheticReport({shock:.08})],['reviewer',reviewerCase()]]){
  const withP=forecasts(rep,null,NOW),without=forecasts(rep,null,NOW,DEFAULT_SETTINGS,undefined,{shockWarning:false});
  const short=100*last20(rep);
  for(const row of withP.rows){
   const base=without.rows.find(x=>x.sessions===row.sessions);
   if(row.sessions>21){assert.deepEqual(row.range,base.range,name+' '+row.sessions);assert.equal(row.shockWarning,null);continue;}
   assert.ok(row.modelCondition.shock,name+' must be a shock case');assert.ok(row.shockWarning,name);assert.equal(base.shockWarning,null);
   assert.ok(row.rangeCheck.dailyVolatility>=short-1e-9,`${name} s${row.sessions}: used ${row.rangeCheck.dailyVolatility} < latest-20 ${short}`);
   assert.ok(Math.abs(row.rangeCheck.dailyVolatility-Math.max(base.rangeCheck.dailyVolatility,short))<1e-9,name);
   const w=r=>r.range[1]-r.range[0];assert.ok(w(row)>=w(base)-1e-12,`${name} s${row.sessions}`);if(w(row)>w(base)*1.0001)widenedSomewhere=true;
  }
 }
 assert.ok(widenedSomewhere,'the policy must widen at least one short range in these cases');
});
