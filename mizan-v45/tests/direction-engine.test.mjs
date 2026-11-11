import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import(process.env.MIZAN_TEST_MODULE),D=m.directionEngine;
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const series=(n,drift)=>Array.from({length:n},(_,i)=>100*Math.exp(drift*i));
const rets=Array.from({length:60},(_,i)=>(i%2?1:-1)*(0.01+i*0.001));
test('direction call is always صاعد or هابط, with strength from the size of the vote',()=>{
  const up=D.directionCall({closes:series(300,.001),bias:.2,price:130,horizonReturns:rets});
  assert.equal(up.direction,'صاعد');assert.equal(up.votes,4);assert.equal(up.strength,'قوية');assert.equal(up.policy,D.DIRECTION_POLICY);
  const down=D.directionCall({closes:series(300,-.001),bias:-.2,price:70,horizonReturns:rets});
  assert.equal(down.direction,'هابط');assert.equal(down.votes,-4);
  const mixed=D.directionCall({closes:series(300,.001),bias:-.2,price:130,horizonReturns:rets});assert.equal(mixed.votes,2);assert.equal(mixed.strength,'متوسطة');
  const tie=D.directionCall({closes:[100,100,100],bias:0,price:100,horizonReturns:[]});
  assert.equal(tie.direction,'صاعد');assert.equal(tie.strength,'ضعيفة');assert.equal(tie.targetPrice,null);
});
test('target is the typical horizon move in the called direction',()=>{
  const abs=rets.map(Math.abs).sort((a,b)=>a-b),typical=abs[Math.floor((abs.length-1)/2)];
  const up=D.directionCall({closes:series(300,.001),bias:.2,price:40,horizonReturns:rets});
  near(up.targetPrice,40*Math.exp(typical));near(up.targetChangePct,100*(Math.exp(typical)-1));assert.ok(up.targetPrice>40);
  const down=D.directionCall({closes:series(300,-.001),bias:-.2,price:40,horizonReturns:rets});near(down.targetPrice,40*Math.exp(-typical));assert.ok(down.targetPrice<40);
});
test('evaluation scores the saved call only; an unchanged close is not scored',()=>{
  const f={price:100,call:{policy:D.DIRECTION_POLICY,direction:'صاعد',strength:'قوية',targetPrice:104}};
  assert.equal(D.evaluateDirectionCall(f,103).correct,true);near(D.evaluateDirectionCall(f,103).targetErrorPct,100/103);
  assert.equal(D.evaluateDirectionCall(f,99).correct,false);assert.equal(D.evaluateDirectionCall(f,100).correct,null);
  assert.equal(D.evaluateDirectionCall({price:100},103),null);assert.equal(D.evaluateDirectionCall({...f,call:{...f.call,policy:'x'}},103),null);
});
test('forecast rows carry the call without changing centre, range or three-way direction; stats report call accuracy',()=>{
  const row=(correct,strength)=>({symbol:'A'+Math.random(),model:'m',horizon:1,created_at:'2026-01-01T00:00:00.000Z',available:1,recordClass:'prospective-public',outcome:{state:'complete',actualDate:'2026-01-02',call:{correct,strength}}});
  const s=m.performanceStats([row(true,'قوية'),row(false,'قوية'),row(true,'ضعيفة'),row(null,'ضعيفة')]);
  assert.equal(s.callCount,3);near(s.callAccuracy,200/3);near(s.callStrongAccuracy,50);near(s.callWeakAccuracy,100);assert.equal(s.callMediumAccuracy,null);
});
