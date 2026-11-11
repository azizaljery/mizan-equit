import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import(process.env.MIZAN_TEST_MODULE);
const rnd=(()=>{let a=23;return()=>(a=(a*16807)%2147483647)/2147483647;})();
function prices(n){const out=[];let d=new Date('2026-09-11T00:00:00Z'),c=50;const dates=[];while(dates.length<n){if(![0,6].includes(d.getUTCDay()))dates.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}
  for(const date of dates){c*=Math.exp(.02*(rnd()-.5));const w=.003+.01*rnd();out.push({date,open:c,high:c*Math.exp(w),low:c*Math.exp(-w),close:c,volume:1000+Math.floor(1000*rnd())});}return out;}
test('Aziz experimental reading: labelled exploratory, issues a reading for the last session and reports its own history',()=>{
  const P=prices(520),r=m.azizExperimentalReading({symbol:'TEST',market:'us',currency:'USD',source:'fixture',prices:P,horizon:5});
  assert.equal(r.policy,m.AZIZ_READING_POLICY);assert.equal(r.exploratory,true);assert.equal(r.approved,false);assert.equal(r.status,'available');
  assert.equal(r.asOf,P.at(-1).date);assert.ok(['صاعد','هابط'].includes(r.direction));assert.ok(r.pointPrice>0);assert.ok(Math.abs(r.changePct-100*(r.pointPrice/r.price-1))<1e-9);
  assert.ok(r.history.evaluated>0);assert.ok(r.history.directionAccuracyPct>=0&&r.history.directionAccuracyPct<=100);
  if(r.range)assert.ok(r.range[0]<r.range[1]);
  // no look-ahead: the same reading when later sessions are absent from the input by construction; a shorter series abstains with a reason
  const short=m.azizExperimentalReading({symbol:'TEST',market:'us',currency:'USD',source:'fixture',prices:P.slice(-200),horizon:5});
  assert.equal(short.status,'unavailable');assert.match(short.reason,/300/);assert.equal(short.direction,null);
});
