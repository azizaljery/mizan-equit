// FCST-0004 verification 1: a US stock around Friday, the weekend and the next open, and missing completeness evidence.
// For every moment: which session the volume statistics use, how old it is, and what each consumer does when the volume lags.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lastBarStatus} from '../lib/session-volume.ts';
import {technical,volumeLabel} from '../lib/analysis.ts';
import {automaticAnalysis} from '../lib/automatic-analysis.ts';
import {forecastConditions} from '../lib/forecast-conditions.ts';
import {tradeScenario} from '../lib/trade-scenario.ts';
import {finalDecision} from '../lib/final-decision.ts';
import {researchFactors} from '../lib/research-model.ts';
import {syntheticReport} from '../research/forecast-repair/fixtures.mjs';

const Z=s=>Date.parse(s),OFF=-14400,FRI='2026-10-23',MON='2026-10-26',TUE='2026-10-27',THU='2026-10-22';
const win=d=>({start:Z(d+'T13:30:00Z'),end:Z(d+'T20:00:00Z')});
const quote=(d,now,{isOpen=false,known=true,quoteTime}={})=>({isOpen,sessionKnown:known,sessionStart:known?win(d).start:null,sessionEnd:known?win(d).end:null,gmtOffsetSeconds:OFF,quoteTime:quoteTime??new Date(now-6e4).toISOString()});
function build({lastDate,rLast,rPrev,q,now}){
 const r=syntheticReport({id:'BRK',drift:.0004,amplitude:.006,shock:.01}),n=r.prices.length,dates=[];
 for(let d=new Date(lastDate+'T00:00:00Z');dates.length<n;d.setUTCDate(d.getUTCDate()-1)){const w=d.getUTCDay();if(w!==0&&w!==6)dates.unshift(d.toISOString().slice(0,10))}
 r.prices=r.prices.map((p,i)=>({...p,date:dates[i],volume:1e6}));r.prices[n-1].volume=rLast*1e6;r.prices[n-2].volume=rPrev*1e6;
 r.asOf=new Date(now).toISOString().slice(0,10);r.mode='current';if(q)r.liveQuote={...q,symbol:r.company.symbol,currency:r.currency,retrievedAt:r.retrievedAt};return r}
const decide=(r,now)=>{const t=technical(r.prices),pr=technical(r.prices.slice(0,-1)),atr=t.atr.at(-1),res=pr.resistance;
 const sc={reasons:[],incomplete:[],levels:{low:res+.1*atr,high:res+.35*atr,stop:res-.8*atr,target1:res+atr,target2:res+2*atr}};
 const open=!!r.liveQuote?.isOpen,q={symbol:r.company.symbol,currency:r.currency,price:sc.levels.low+.05*atr,quoteTime:new Date(now-6e4).toISOString(),isOpen:open,source:'t'};
 return finalDecision(r,sc,q,now).checks.find(c=>c.name.includes('الاختراق')).ok};

// Realistic last-trade time: while the market is open it is ~now; otherwise it is the close of the bar's own session (no trades on weekends).
const lastTrade=(bar,now,open)=>new Date(open?now-6e4:Math.min(now-6e4,win(bar).end+1e3)).toISOString();
// [label, last bar date, provider session, now, isOpen, expected state, session whose volume the statistics use]
const TL=[
 ['Fri in session',FRI,FRI,'2026-10-23T17:00:00Z',true,'in-session',THU],
 ['Fri just closed',FRI,FRI,'2026-10-23T20:30:00Z',false,'unverified',THU],
 ['Sat, quote still Friday',FRI,FRI,'2026-10-24T12:00:00Z',false,'unverified',THU],
 // FCST-0005: the provider window advancing to Monday is NOT evidence (no trade in it yet): still unverified, volume stays on Thursday.
 ['Sat, window already Monday, last trade Friday',FRI,MON,'2026-10-24T12:00:00Z',false,'unverified',THU],
 ['Sun night, quote still Friday',FRI,FRI,'2026-10-25T23:00:00Z',false,'unverified',THU],
 ['Mon pre-open, quote still Friday',FRI,FRI,'2026-10-26T12:00:00Z',false,'unverified',THU],
 ['Mon pre-open, window Monday, no Monday trade yet',FRI,MON,'2026-10-26T12:00:00Z',false,'unverified',THU],
 ['Mon open, Monday bar delivered (partial)',MON,MON,'2026-10-26T14:00:00Z',true,'in-session',FRI],
 ['Mon open, Monday bar not yet delivered',FRI,MON,'2026-10-26T14:00:00Z',true,'complete',FRI],
 ['Mon closed',MON,MON,'2026-10-26T21:00:00Z',false,'unverified',FRI],
 ['Tue open, quote Tuesday',MON,TUE,'2026-10-27T14:00:00Z',true,'complete',MON],
];
test('timeline: state, session used by the volume statistics, and a visible lag whenever it is not the price bar',()=>{
 for(const [label,bar,sess,when,open,state,vsess] of TL){
  const now=Z(when),r=build({lastDate:bar,rLast:1,rPrev:1.8,q:quote(sess,now,{isOpen:open,quoteTime:lastTrade(bar,now,open)}),now});
  assert.equal(lastBarStatus(r,now).state,state,label);
  const t=automaticAnalysis(r,'trader',now).tech,fc=forecastConditions(r,now);
  assert.equal(t.volumeSessionDate,vsess,label);assert.equal(fc.volumeSessionDate,vsess,label);
  assert.equal(t.priceBarDate,bar,label);
  if(state==='complete'){assert.equal(t.volumeLagSessions,0,label);assert.equal(volumeLabel(t),null,label)}
  else{assert.equal(t.volumeLagSessions,1,label);const l=volumeLabel(t);assert.ok(l.includes(vsess)&&l.includes(bar)&&l.includes('ليست حجم الجلسة الحالية'),label)}
 }
});
test('a previous session\'s volume never confirms a current breakout: weak last bar + strong previous bar stays unconfirmed in every state',()=>{
 for(const [label,bar,sess,when,open] of TL){
  const now=Z(when),r=build({lastDate:bar,rLast:1.0,rPrev:1.8,q:quote(sess,now,{isOpen:open,quoteTime:lastTrade(bar,now,open)}),now});
  assert.equal(tradeScenario(r,now).executionPlan.liquidityConfirmation.isConfirmed,false,label);
  assert.equal(decide(r,now),false,label);
  const t=automaticAnalysis(r,'trader',now).tech;
  if(t.volumeBasis==='previous-confirmed')assert.ok(t.relativeVolume>=1.5,'the lagging ratio is high, yet it confirms nothing: '+label);
 }
});
test('a strong CURRENT bar still confirms, in every state (gate unchanged: partial volume is a lower bound)',()=>{
 for(const [label,bar,sess,when,open] of TL){
  const now=Z(when),r=build({lastDate:bar,rLast:1.8,rPrev:0.9,q:quote(sess,now,{isOpen:open,quoteTime:lastTrade(bar,now,open)}),now});
  assert.equal(tradeScenario(r,now).executionPlan.liquidityConfirmation.isConfirmed,true,label);
  assert.equal(decide(r,now),true,label);
 }
});
test('missing completeness evidence: unverified for every kind of gap, volume statistics use the previous confirmed session',()=>{
 const sat=Z('2026-10-24T12:00:00Z'),mon=Z('2026-10-26T21:00:00Z');
 const cases=[
  ['no quote',build({lastDate:FRI,rLast:1,rPrev:1.8,q:null,now:sat}),sat,'no-quote'],
  ['quote without session window',build({lastDate:FRI,rLast:1,rPrev:1.8,q:quote(FRI,sat,{known:false}),now:sat}),sat,'no-session-window'],
  ['quote on an older session than the bar',build({lastDate:MON,rLast:1,rPrev:1.8,q:quote(FRI,mon),now:mon}),mon,'date-conflict'],
  ['last trade before the close',build({lastDate:FRI,rLast:1,rPrev:1.8,q:quote(FRI,Z('2026-10-23T21:00:00Z'),{quoteTime:'2026-10-23T18:10:00Z'}),now:Z('2026-10-23T21:00:00Z')}),Z('2026-10-23T21:00:00Z'),'closed-unconfirmed'],
 ];
 for(const [label,r,now,reason] of cases){const s=lastBarStatus(r,now);assert.equal(s.state,'unverified',label);assert.equal(s.reasonCode,reason,label);
  assert.equal(automaticAnalysis(r,'trader',now).tech.volumeBasis,'previous-confirmed',label)}
 assert.match(lastBarStatus(cases[3][1],cases[3][2]).evidence,/متأخرة|بلا صفقات/);
});
test('unavailable when needed: no confirmed ratio is invented, and the display says so',()=>{
 const now=Z('2026-10-24T12:00:00Z');
 // 21 bars, last one unconfirmed: only 20 confirmed sessions remain, a ratio needs the session plus 20 before it.
 const r=build({lastDate:FRI,rLast:1,rPrev:1.8,q:quote(FRI,now),now});r.prices=r.prices.slice(-21);
 const fc=forecastConditions(r,now);assert.equal(fc.relativeVolume,null);assert.equal(fc.volumeSessionDate,null);assert.match(fc.notes.join(' '),/غير متحقق/);
 // one bar only: no confirmed session at all.
 const one=r.prices.slice(-1),t=technical(one,{excludeLastVolume:true});
 assert.equal(t.relativeVolume,null);assert.equal(t.volumeSessionDate,null);assert.match(volumeLabel(t),/غير متاح/);
});
test('every place that shows the ratio names its session: research factor detail carries the label',()=>{
 const now=Z('2026-10-24T12:00:00Z'),r=build({lastDate:FRI,rLast:1,rPrev:1.8,q:quote(FRI,now),now});
 const d=researchFactors(r,now).factors.find(f=>f.key==='momentum').detail;
 assert.ok(d.includes(THU)&&d.includes('ليست حجم الجلسة الحالية'));
 const now2=Z('2026-10-26T14:00:00Z'),c=build({lastDate:FRI,rLast:1,rPrev:1.8,q:quote(MON,now2,{isOpen:true}),now:now2}); // a Monday trade exists: Friday is final
 assert.ok(!researchFactors(c,now2).factors.find(f=>f.key==='momentum').detail.includes('ليست حجم'));
});
