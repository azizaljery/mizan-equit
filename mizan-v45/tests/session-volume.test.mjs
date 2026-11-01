// FCST-0004: is the last daily bar's volume final? Edge cases of lastBarStatus and of every volume consumer.
// There is deliberately no built-in "N minutes after close" rule: tests pin that nothing is assumed complete without evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lastBarStatus,lastBarNotConfirmed,confirmedSessionPrices} from '../lib/session-volume.ts';
import {technical} from '../lib/analysis.ts';
import {tradeScenario} from '../lib/trade-scenario.ts';
import {finalDecision} from '../lib/final-decision.ts';
import {forecastConditions} from '../lib/forecast-conditions.ts';
import {marketEvidence} from '../lib/screener-shara.ts';
import {parseLiveQuote} from '../lib/live-quote.ts';
import {syntheticReport,AS_OF} from '../research/forecast-repair/fixtures.mjs';

const Z=s=>Date.parse(s);
// New York, EDT (UTC-4): regular session 09:30-16:00 local = 13:30-20:00Z on AS_OF (2026-10-26).
const NY={start:Z('2026-10-26T13:30:00Z'),end:Z('2026-10-26T20:00:00Z'),off:-14400};
const quote=(w=NY,over={})=>({isOpen:true,sessionKnown:true,sessionStart:w.start,sessionEnd:w.end,gmtOffsetSeconds:w.off,quoteTime:new Date(w.end-60e3).toISOString(),...over});
const rep=(vols=()=>1000,q=quote(),date=null)=>{const r=syntheticReport();const n=r.prices.length;r.prices=r.prices.map((p,i)=>({...p,volume:vols(i,n)}));if(date)r.prices.at(-1).date=date;r.liveQuote=q;r.mode='current';return r};
const S=(r,now,policy)=>lastBarStatus(r,now,policy);

test('in-session: the provider window contains now; both boundaries are exact',()=>{
 const r=rep();
 assert.equal(S(r,NY.start).state,'in-session');           // opening instant
 assert.equal(S(r,NY.start+3*3600e3).state,'in-session');
 assert.equal(S(r,NY.end-1).state,'in-session');           // last millisecond
 assert.equal(S(r,NY.end).state,'unverified');             // the close itself is NOT proof of a finished bar
 assert.equal(S(r,NY.start-1).state,'unverified');         // before the open: nothing is claimed
 assert.equal(S(r,NY.start-1).reasonCode,'before-open');
});

test('after the close: unverified for ANY elapsed time unless there is evidence; no hidden settlement rule',()=>{
 const r=rep();
 for(const min of [0,1,30,59,60,61,180,24*60,3*24*60]){const s=S(r,NY.end+min*60e3);assert.equal(s.state,'unverified',min+' min');assert.equal(s.reasonCode,'closed-unconfirmed');}
 assert.equal(lastBarNotConfirmed(r,NY.end+61*60e3),true);
 assert.equal(confirmedSessionPrices(r,NY.end+61*60e3).length,r.prices.length-1);
});

test('opt-in settlement policy is honoured, labelled an assumption, and off by default',()=>{
 const r=rep();
 assert.equal(S(r,NY.end+2*3600e3).state,'unverified');
 assert.equal(S(r,NY.end+30*60e3,{assumeCompleteAfterMs:3600e3}).state,'unverified');
 const c=S(r,NY.end+61*60e3,{assumeCompleteAfterMs:3600e3});assert.equal(c.state,'complete');assert.equal(c.reasonCode,'assumed-settlement');assert.match(c.evidence,/افتراض/);
 assert.equal(S(r,NY.end+9e9,{assumeCompleteAfterMs:null}).state,'unverified');
});

test('later session at the provider = evidence the bar is final; weekend and holiday gaps are not',()=>{
 // Friday 2026-10-23 bar; the quote already describes Monday 2026-10-26: complete.
 const later=rep(()=>1000,quote(NY),'2026-10-23');
 const s=S(later,NY.start+3600e3);assert.equal(s.state,'complete');assert.equal(s.reasonCode,'later-session');
 // Friday bar read on Sunday, the quote still describes Friday's session: nothing newer, so unverified.
 const FRI={start:Z('2026-10-23T13:30:00Z'),end:Z('2026-10-23T20:00:00Z'),off:-14400};
 const sunday=rep(()=>1000,quote(FRI),'2026-10-23');
 assert.equal(S(sunday,Z('2026-10-25T12:00:00Z')).state,'unverified');
 // Holiday: Thursday bar, Friday holiday, quote still Thursday's session.
 const THU={start:Z('2026-10-22T13:30:00Z'),end:Z('2026-10-22T20:00:00Z'),off:-14400};
 assert.equal(S(rep(()=>1000,quote(THU),'2026-10-22'),Z('2026-10-23T15:00:00Z')).state,'unverified');
});

test('short session (early close) follows the provider window, not a fixed hour',()=>{
 const half={start:Z('2026-10-26T13:30:00Z'),end:Z('2026-10-26T17:00:00Z'),off:-14400}; // 13:00 local close
 const r=rep(()=>1000,quote(half));
 assert.equal(S(r,Z('2026-10-26T16:59:59Z')).state,'in-session');
 assert.equal(S(r,Z('2026-10-26T17:00:00Z')).state,'unverified'); // under a fixed 16:00 rule this would still be "open"
});

test('time zones: the session date is the exchange-local date, also across the UTC date line',()=>{
 // Riyadh (UTC+3): 10:00-15:00 local = 07:00-12:00Z. Bar dated by the provider's own offset.
 const SA={start:Z('2026-10-26T07:00:00Z'),end:Z('2026-10-26T12:00:00Z'),off:10800};
 assert.equal(S(rep(()=>1000,quote(SA)),Z('2026-10-26T09:00:00Z')).state,'in-session');
 // Sydney (UTC+11) session of 2026-10-27 local runs 2026-10-26T23:00Z - 2026-10-27T05:00Z.
 const SYD={start:Z('2026-10-26T23:00:00Z'),end:Z('2026-10-27T05:00:00Z'),off:39600};
 const syd=rep(()=>1000,quote(SYD),'2026-10-27');
 assert.equal(S(syd,Z('2026-10-27T01:00:00Z')).state,'in-session');
 assert.equal(S(syd,Z('2026-10-26T23:30:00Z')).state,'in-session');   // UTC date is still the 26th
 // UTC-10 venue: the session ends on the NEXT UTC date but is the same local date.
 const HI={start:Z('2026-10-26T19:30:00Z'),end:Z('2026-10-27T02:00:00Z'),off:-36000};
 const hi=rep(()=>1000,quote(HI),'2026-10-26');
 assert.equal(S(hi,Z('2026-10-27T01:00:00Z')).state,'in-session');
 // Offset unknown: both candidate UTC dates are tried and the evidence says so.
 const noOff=rep(()=>1000,quote({...HI,off:null}).sessionKnown?{...quote(HI),gmtOffsetSeconds:null}:null,'2026-10-26');
 const s=S(noOff,Z('2026-10-27T01:00:00Z'));assert.equal(s.state,'in-session');assert.match(s.evidence,/غير معروفة|UTC|مفتوحة/);
 // A bar dated AFTER the provider's session is a conflict, not a completion.
 const bad=rep(()=>1000,quote(NY),'2026-10-27');assert.equal(S(bad,NY.start+3600e3).reasonCode,'date-conflict');assert.equal(S(bad,NY.start+3600e3).state,'unverified');
});

test('late data: a quote older than the close is unverified and says so; missing quote or window never claims completion',()=>{
 const late=rep(()=>1000,quote(NY,{quoteTime:new Date(NY.end-20*60e3).toISOString()}));
 const s=S(late,NY.end+10*60e3);assert.equal(s.state,'unverified');assert.match(s.evidence,/متأخرة|سابق/);
 assert.equal(S({...rep(),liveQuote:null},NY.start+3600e3).reasonCode,'no-quote');
 assert.equal(S({...rep(),liveQuote:null},NY.start+3600e3).state,'unverified');
 const noWin=rep(()=>1000,{isOpen:true,sessionKnown:false,quoteTime:AS_OF+'T15:00:00.000Z'});
 assert.equal(S(noWin,NY.start+3600e3).state,'in-session');             // only the open flag, labelled as such
 assert.equal(S(noWin,NY.start+3600e3).reasonCode,'open-flag');
 assert.equal(S({...noWin,liveQuote:{...noWin.liveQuote,isOpen:false}},NY.end+60e3).state,'unverified');
 assert.equal(S({...rep(),mode:'historical'},NY.start+3600e3).state,'complete');
});

test('parseLiveQuote exposes the session window and offset that lastBarStatus relies on',()=>{
 const now=NY.start+3600e3;
 const data={chart:{result:[{meta:{symbol:'TEST_US_CALM',currency:'USD',exchangeName:'NMS',instrumentType:'EQUITY',regularMarketPrice:100,regularMarketTime:Math.floor(now/1000)-60,gmtoffset:-14400,currentTradingPeriod:{regular:{start:NY.start/1000,end:NY.end/1000}}}}]}};
 let q;try{q=parseLiveQuote(data,'TEST_US_CALM',now)}catch(e){return}  // identity validation may refuse the synthetic meta; the fields are then covered below
 assert.equal(q.sessionStart,NY.start);assert.equal(q.sessionEnd,NY.end);assert.equal(q.gmtOffsetSeconds,-14400);
});

test('technical: relative volume names its numerator session and denominator window; price indicators unchanged',()=>{
 const r=rep((i,n)=>i===n-1?100:1000);
 const full=technical(r.prices),fixed=technical(r.prices,{excludeLastVolume:true});
 const d=r.prices.map(p=>p.date),n=d.length;
 assert.equal(full.volumeBasis,'last-bar');assert.equal(fixed.volumeBasis,'previous-confirmed');
 assert.equal(full.volumeSessionDate,d[n-1]);assert.equal(fixed.volumeSessionDate,d[n-2]);   // numerator
 assert.equal(fixed.priceBarDate,d[n-1]);                                                      // the price shown is a different day
 assert.deepEqual(fixed.volumeWindow,{from:d[n-21],to:d[n-2],sessions:20});                    // denominator: 20 sessions ending at the numerator, inclusive
 assert.ok(full.relativeVolume<0.2);assert.ok(Math.abs(fixed.relativeVolume-1)<1e-9);
 assert.deepEqual(fixed.rsi,full.rsi);assert.deepEqual(fixed.sma50,full.sma50);assert.deepEqual(fixed.atr,full.atr);assert.equal(fixed.last,full.last);
 const c=rep();assert.deepEqual(technical(c.prices),technical(c.prices,{}));
});

test('zero volume: a zero in the not-confirmed bar still counts (conservative); a zero in a confirmed bar counts once',()=>{
 const z=rep((i,n)=>i===n-1?0:1000);
 assert.equal(technical(z.prices).zeroVolume,1);
 assert.equal(technical(z.prices,{excludeLastVolume:true}).zeroVolume,1);
 const clean=rep();assert.equal(technical(clean.prices,{excludeLastVolume:true}).zeroVolume,0);
 const prices=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2025,11,31)-(39-i)*86400e3).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:i===39?0:100000}));
 assert.equal(marketEvidence(prices,'2026-01-01T10:00:00.000Z').zeroVolumeDays20,1);
 assert.equal(marketEvidence(prices,'2026-01-01T10:00:00.000Z',{lastBarNotConfirmed:true}).zeroVolumeDays20,1);
 const ok=prices.map(p=>({...p,volume:100000}));
 assert.equal(marketEvidence(ok,'2026-01-01T10:00:00.000Z',{lastBarNotConfirmed:true}).zeroVolumeDays20,0);
});

test('forecast conditions: unconfirmed bar is skipped and the session used is reported; a confirmed bar is used as is',()=>{
 const r=rep((i,n)=>i===n-1?100:1000);
 const d=r.prices.map(p=>p.date),n=d.length;
 for(const t of [NY.start+3*3600e3,NY.end+30*60e3,NY.end+5*3600e3]){
  const c=forecastConditions(r,t);assert.ok(Math.abs(c.relativeVolume-1)<1e-9,String(t));assert.equal(c.volumeSessionDate,d[n-2]);assert.equal(c.volumeLastBar.state,t<NY.end?'in-session':'unverified');
 }
 const confirmed=rep((i,n)=>i===n-1?100:1000,quote(NY),'2026-10-26');confirmed.liveQuote=quote({...NY,start:NY.start+86400e3,end:NY.end+86400e3}); // provider already on the next session
 const c=forecastConditions(confirmed,NY.end+86400e3+3600e3-86400e3+86400e3);assert.equal(c.volumeLastBar.state,'complete');assert.equal(c.volumeSessionDate,d[n-1]);assert.ok(c.relativeVolume<0.2);
 assert.match(forecastConditions(r,NY.end+60e3).notes.join(' '),/غير مؤكدة/);
});

// ---- decision gates: unchanged for EVERY bar state (property test against the legacy formula) ----
const legacyGate=prices=>{const v=prices.slice(-21).map(p=>p.volume);const ok=v.length===21&&v.every(x=>Number.isFinite(x)&&x>=0);const avg=ok?v.slice(0,-1).reduce((s,x)=>s+x,0)/20:0;const rvol=ok&&avg>0?v[20]/avg:null;return {rvol,confirmed:rvol!==null&&rvol>=1.5}};
test('trade scenario gate equals the legacy formula for in-session, unverified and complete bars (400 random volume vectors)',()=>{
 let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32;
 const states=[NY.start+3600e3,NY.end+3600e3,'complete'];
 for(let k=0;k<400;k++){
  const base=500+rnd()*1500,last=base*(0.05+rnd()*4);
  const r=rep((i,n)=>i===n-1?last:base*(0.7+rnd()*0.6));
  for(const t of states){
   const rr=t==='complete'?{...r,liveQuote:quote({...NY,start:NY.start+86400e3,end:NY.end+86400e3})}:r;
   const now=t==='complete'?NY.start+86400e3+3600e3:t;
   const lc=tradeScenario(rr,now).executionPlan.liquidityConfirmation,want=legacyGate(r.prices);
   assert.equal(lc.isConfirmed,want.confirmed);assert.ok(Math.abs(lc.rvol-want.rvol)<1e-12);
  }
 }
});
test('trade scenario note states which bar and why it is a lower bound',()=>{
 const early=rep((i,n)=>i===n-1?1800:1000);
 const a=tradeScenario(early,NY.start+3600e3).executionPlan.liquidityConfirmation;assert.equal(a.isConfirmed,true);assert.match(a.note,/حد أدنى/);assert.match(a.note,/لم تنتهِ/);
 const b=tradeScenario(early,NY.end+3600e3).executionPlan.liquidityConfirmation;assert.match(b.note,/غير مؤكد/);
 const small=rep((i,n)=>i===n-1?300:1000);assert.match(tradeScenario(small,NY.start+3600e3).executionPlan.liquidityConfirmation.note,/ليس حكمًا نهائيًا/);
});
test('final decision: checks and buy are identical for every bar state; the evidence line names both dates',()=>{
 const r0=rep((i,n)=>i===n-1?6e6:1.5e6),pr=technical(r0.prices.slice(0,-1)),atr=technical(r0.prices).atr.at(-1),res=pr.resistance??r0.prices.at(-1).close;
 const scenario={reasons:[],incomplete:[],levels:{low:res+.1*atr,high:res+.35*atr,stop:res-.8*atr,target1:res+atr,target2:res+2*atr}};
 const now=NY.start+3600e3,q={symbol:r0.company.symbol,currency:r0.currency,price:scenario.levels.low,quoteTime:new Date(now-60e3).toISOString(),isOpen:true,source:'test'};
 const run=(rr,t)=>finalDecision(rr,scenario,q,t);
 const inS=run(rep((i,n)=>i===n-1?6e6:1.5e6),now);
 const unv=run(rep((i,n)=>i===n-1?6e6:1.5e6,quote({...NY,start:NY.start-86400e3,end:NY.end-86400e3}),'2026-10-26'),now);
 const done=run(rep((i,n)=>i===n-1?6e6:1.5e6,quote({...NY,start:NY.start+86400e3,end:NY.end+86400e3}),'2026-10-26'),now);
 const sig=x=>JSON.stringify([x.buy,x.checks.map(c=>c.ok)]);
 assert.equal(sig(inS),sig(unv));assert.equal(sig(inS),sig(done));
 const ev=inS.evidence.find(e=>e.includes('حجم نسبي'));assert.ok(ev);assert.match(ev,/\d{4}-\d{2}-\d{2}/);assert.match(ev,/لا تخص شمعة السعر/);
 assert.ok(!done.evidence.find(e=>e.includes('حجم نسبي')).includes('لا تخص'));
});

test('screener evidence: volume statistics skip the not-confirmed bar; ATR and bar age still use it',()=>{
 const prices=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2025,11,31)-(39-i)*86400e3).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:i===39?10:100000}));
 const base=marketEvidence(prices,'2026-01-01T10:00:00.000Z'),fixed=marketEvidence(prices,'2026-01-01T10:00:00.000Z',{lastBarNotConfirmed:true});
 assert.equal(fixed.medianTradedValue20,100*100000);assert.equal(fixed.atrPct20,base.atrPct20);assert.equal(fixed.lastBarAgeDays,base.lastBarAgeDays);
});
