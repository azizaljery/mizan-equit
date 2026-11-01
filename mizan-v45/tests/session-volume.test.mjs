// FCST-0004: the last daily bar's volume is partial while its session is open (or just closed). Volume STATISTICS
// then come from completed sessions; the decision gates are deliberately unchanged (nothing becomes easier or harder to confirm).
import test from 'node:test';
import assert from 'node:assert/strict';
import {lastBarIncomplete,completedSessionPrices,POST_CLOSE_GRACE_MS} from '../lib/session-volume.ts';
import {technical} from '../lib/analysis.ts';
import {tradeScenario} from '../lib/trade-scenario.ts';
import {forecastConditions} from '../lib/forecast-conditions.ts';
import {marketEvidence} from '../lib/screener-shara.ts';
import {syntheticReport,AS_OF} from '../research/forecast-repair/fixtures.mjs';

const END=Date.parse(AS_OF+'T20:00:00Z'); // synthetic regular-session end (UTC)
const quote=(over={})=>({isOpen:true,sessionKnown:true,sessionEnd:END,quoteTime:AS_OF+'T17:00:00.000Z',...over});
const rep=(vols,q=quote())=>{const r=syntheticReport();const n=r.prices.length;r.prices=r.prices.map((p,i)=>({...p,volume:vols(i,n)}));r.liveQuote=q;r.mode='current';return r};
const OPEN=END-3*3600e3, JUST_CLOSED=END+30*60e3, LATER=END+POST_CLOSE_GRACE_MS+60e3;

test('lastBarIncomplete: open, just-closed (grace) and later; historical, no quote, previous-date bar',()=>{
 const r=rep(()=>1000);
 assert.equal(lastBarIncomplete(r,OPEN),true);
 assert.equal(lastBarIncomplete(r,JUST_CLOSED),true);
 assert.equal(lastBarIncomplete(r,END+POST_CLOSE_GRACE_MS-1),true);
 assert.equal(lastBarIncomplete(r,END+POST_CLOSE_GRACE_MS),false);
 assert.equal(lastBarIncomplete(r,LATER),false);
 assert.equal(lastBarIncomplete({...r,mode:'historical'},OPEN),false);
 assert.equal(lastBarIncomplete({...r,liveQuote:null},OPEN),false);
 const before=rep(()=>1000,quote({sessionEnd:END+86400e3})); // quote is for a later session than the last bar (bar is complete)
 assert.equal(lastBarIncomplete(before,END+86400e3-3*3600e3),false);
 const unknown=rep(()=>1000,quote({sessionKnown:false,sessionEnd:null}));
 assert.equal(lastBarIncomplete(unknown,OPEN),true);
 assert.equal(lastBarIncomplete(rep(()=>1000,quote({sessionKnown:false,sessionEnd:null,isOpen:false})),OPEN),false);
 assert.equal(completedSessionPrices(r,OPEN).length,r.prices.length-1);
 assert.equal(completedSessionPrices(r,LATER).length,r.prices.length);
});

test('technical: excludeLastVolume gives the completed-session relative volume; price indicators are unchanged',()=>{
 const r=rep((i,n)=>i===n-1?100:1000); // partial last bar = 10% of normal
 const full=technical(r.prices),fixed=technical(r.prices,{excludeLastVolume:true});
 assert.equal(full.volumeBasis,'last-bar'); assert.equal(fixed.volumeBasis,'previous-complete');
 assert.ok(full.relativeVolume<0.2,'partial bar understated: '+full.relativeVolume);
 assert.ok(Math.abs(fixed.relativeVolume-1)<1e-9,'completed sessions: '+fixed.relativeVolume);
 assert.equal(fixed.avgV20,1000); assert.equal(fixed.volumeRatio,1);
 assert.deepEqual(fixed.rsi,full.rsi); assert.deepEqual(fixed.sma50,full.sma50); assert.deepEqual(fixed.atr,full.atr); assert.equal(fixed.last,full.last);
 // zero-volume partial bar (pre-print) must not count as a zero-volume day when excluded
 const z=rep((i,n)=>i===n-1?0:1000);
 assert.equal(technical(z.prices).zeroVolume,1); assert.equal(technical(z.prices,{excludeLastVolume:true}).zeroVolume,0);
 // default behaviour is byte-identical to before for complete bars
 const c=rep(()=>1000); assert.deepEqual(technical(c.prices),technical(c.prices,{}));
});

test('forecast conditions: open or just-closed session uses completed sessions; a long-closed session uses the last bar',()=>{
 const r=rep((i,n)=>i===n-1?100:1000);
 assert.ok(Math.abs(forecastConditions(r,OPEN).relativeVolume-1)<1e-9);
 assert.ok(Math.abs(forecastConditions(r,JUST_CLOSED).relativeVolume-1)<1e-9);
 assert.ok(forecastConditions(r,LATER).relativeVolume<0.2); // complete bar, genuinely low volume: reported as is
});

test('trade scenario: the confirmation gate is UNCHANGED (partial volume is a lower bound); only the note explains it',()=>{
 const lc=(r,now)=>tradeScenario(r,now).executionPlan.liquidityConfirmation;
 // previous COMPLETED session had rvol 5, the open one is partial and small: not confirmed, as before
 const spike=rep((i,n)=>i===n-2?5000:1000), a=lc(spike,OPEN);
 assert.equal(a.isConfirmed,false); assert.match(a.note,/جزئي/);
 // open session whose partial volume already exceeds 1.5x: confirmed, as before (lower bound can only under-confirm)
 const early=rep((i,n)=>i===n-1?1800:1000), b=lc(early,OPEN);
 assert.equal(b.isConfirmed,true); assert.ok(Math.abs(b.rvol-1.8)<1e-9); assert.match(b.note,/حد أدنى/);
 // complete bar: unchanged
 const done=rep((i,n)=>i===n-1?5000:1000);
 assert.equal(lc(done,LATER).isConfirmed,true); assert.doesNotMatch(lc(done,LATER).note,/جزئي/);
});

test('screener evidence: volume statistics skip the incomplete bar; ATR and bar age still use it',()=>{
 const prices=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2025,11,31)-(39-i)*86400e3).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:i===39?0:100000}));
 const base=marketEvidence(prices,'2026-01-01T10:00:00.000Z'), fixed=marketEvidence(prices,'2026-01-01T10:00:00.000Z',{lastBarIncomplete:true});
 assert.equal(base.zeroVolumeDays20,1); assert.equal(fixed.zeroVolumeDays20,0);
 assert.equal(fixed.medianTradedValue20,100*100000);
 assert.equal(fixed.atrPct20,base.atrPct20); assert.equal(fixed.lastBarAgeDays,base.lastBarAgeDays);
});
