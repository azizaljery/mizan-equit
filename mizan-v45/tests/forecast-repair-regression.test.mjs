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
test('shock warning widens the short range relative to the same data without the warning (latest-20 volatility)',()=>{
 const rep=syntheticReport({shock:-.025});const withWarn=forecasts(rep,null,NOW).rows.find(x=>x.sessions===5);
 assert.ok(withWarn.range[1]-withWarn.range[0]>0);assert.ok(withWarn.rangeCheck.dailyVolatility>0);
});
test('log drift is transformed exponentially',()=>{const x=scenarioCenter({bias:1,sessions:252,dailySigma:.03,expectedScale:.5,positiveTiltMultiplier:1});assert.equal(x.centerLogReturn,.15);assert.ok(Math.abs(100*Math.expm1(x.centerLogReturn)-16.1834242728283)<1e-10);});
test('range guard distinguishes wide range and unresolved price jump',()=>{const r=inspectScenarioRange({low:80,high:120,reference:100,sigma:.01,expectedScale:.01,maxSigma:3,longJump:true});assert.deepEqual(r.map(x=>x.code),['range_too_wide','corporate_action_or_jump_unresolved']);});
test('operator-disabled horizon remains disabled',()=>{const s=structuredClone(DEFAULT_SETTINGS);s.periods[5].enabled=false;const r=forecasts(syntheticReport(),null,NOW,s);assert.ok(r.rows.find(x=>x.sessions===5).diagnostics.blockers.some(x=>x.code==='horizon_disabled'));});
test('under a shock warning, range widths stay ordered by horizon (1 <= 5 <= 21 <= 63 <= 126 <= 252)',()=>{
 for(const shock of [-.025,.05,.08]){const f=forecasts(syntheticReport({shock}),null,NOW);const w=f.rows.map(r=>(r.range[1]-r.range[0])/f.price);for(let i=1;i<w.length;i++)assert.ok(w[i]>=w[i-1],`shock ${shock}: width[${i}] ${w[i]} < ${w[i-1]}`);}
});
