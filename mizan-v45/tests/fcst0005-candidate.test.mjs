import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../research/fcst0005/candidate.mjs';

const rng=C.mulberry32(7),gauss=()=>{let u=0,v=0;while(!u)u=rng();v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
const walk=(n,drift=0,s=.01)=>{const c=[100];for(let i=1;i<n;i++)c.push(c[i-1]*Math.exp(drift+s*gauss()));return c};

test('LAD recovers the conditional median under heavy tails (OLS would be pulled by outliers)',()=>{
 const n=2000,X=[],y=[],w=[];
 for(let i=0;i<n;i++){const x=gauss();X.push([1,x]);const noise=i%50===0?40*gauss():gauss();y.push(0.3+0.8*x+noise);w.push(1)}
 const b=C.lad(X,y,w);assert.ok(Math.abs(b[0]-0.3)<0.12&&Math.abs(b[1]-0.8)<0.12,JSON.stringify(b));
});
test('deterministic: same input, same output; no clock and no Math.random in the module',async()=>{
 const X=Array.from({length:200},(_,i)=>[1,Math.sin(i)]),y=X.map((r,i)=>r[1]+Math.cos(i*3)),w=X.map(()=>1);
 assert.deepEqual(C.lad(X,y,w),C.lad(X,y,w));
 const src=(await import('node:fs')).readFileSync(new URL('../research/fcst0005/candidate.mjs',import.meta.url),'utf8').replace(/\/\/.*$/gm,'');
 assert.ok(!/Math\.random|Date\.now|new Date\(/.test(src));
});
test('training loss equals evaluation loss: pinball(tau=.5) = NAE/2 on the same normalised target',()=>{
 const z=[.3,-1.2,.8,2.1],zh=[.1,.1,.1,.1],w=[1,1,1,1],S=[.02,.03,.01,.04],y=z.map((v,i)=>v*S[i]);
 const naeMean=y.reduce((s,v,i)=>s+C.nae(v,.1*S[i],S[i]),0)/4;
 assert.ok(Math.abs(C.pinballHalf(z,zh,w)-naeMean)<1e-12);
});
test('weighted median minimises weighted absolute error',()=>{
 const v=[1,2,3,10,11],w=[1,1,1,1,1];assert.equal(C.weightedMedian(v,w),3);
 assert.equal(C.weightedMedian([1,2,3],[1,1,5]),3);
});
test('Q0 shrinks the median by kappa=0.5; kappa is a constant, not a fitted value',()=>{
 const q=C.fitQ0([1,1,1,5,-3],[1,1,1,1,1]);assert.equal(q.median,1);assert.equal(q.predict(),.5);assert.equal(C.KAPPA,.5);
});
test('Q1 finds a planted linear median signal and shrinks it; with no signal its slope is near zero',()=>{
 const n=3000,X=[],z=[],w=[];for(let i=0;i<n;i++){const x=[gauss(),gauss(),gauss()];X.push(x);z.push(0.5*x[0]+gauss());w.push(1)}
 const q=C.fitQ1(X,z,w),hi=q.predict([2,0,0]),lo=q.predict([-2,0,0]);assert.ok(hi>0.3&&lo<-0.3,hi+' '+lo);
 const z0=X.map(()=>gauss()),q0=C.fitQ1(X,z0,w);assert.ok(Math.abs(q0.predict([2,2,2])-q0.predict([-2,-2,-2]))<0.4);
});
test('Q2 pools horizons with a sqrt(h) scale and keeps one coefficient set',()=>{
 const rows=[];for(const h of C.HORIZONS)for(let i=0;i<600;i++){const x=[gauss(),gauss(),gauss()];rows.push({h,x,w:1,z:Math.sqrt(h)*0.1*x[0]+gauss()})}
 const q=C.fitQ2(rows);const p1=q.predict([1,0,0],1),p21=q.predict([1,0,0],21);assert.ok(p21>p1*3.5&&p21<p1*5,p1+' '+p21);
});
test('no leakage: features and sigma63 at t are unchanged when every later price is altered',()=>{
 const c=walk(600),t=400,a=C.features(c,t),s=C.sigma63(c,t);
 const poisoned=c.map((v,i)=>i>t?v*(1+Math.sin(i))*7:v);
 assert.deepEqual(C.features(poisoned,t),a);assert.equal(C.sigma63(poisoned,t),s);
 assert.equal(C.features(c,251),null);assert.equal(C.sigma63(c,62),null);
});
test('block bootstrap is deterministic and brackets a known mean',()=>{
 const d=Array.from({length:400},()=>0.2+gauss());const a=C.blockBootstrapCI(d,5,500,123),b=C.blockBootstrapCI(d,5,500,123);
 assert.deepEqual(a,b);assert.ok(a.lo<0.2+0.2&&a.hi>0.2-0.2&&a.lo<a.mean&&a.mean<a.hi);
});
test('normInv matches the constants the protocol cites (z for alpha/36 = 2.99, multiplier 3.83)',()=>{
 assert.ok(Math.abs(C.normInv(1-0.05/36)-2.9910)<0.002);
 const t=C.testability({nNoOverlap:248,sigmaLR:0.019,maeRef:0.729,nDates:248});assert.ok(Math.abs(t.multiplier-3.833)<0.01);assert.ok(Math.abs(t.deltaMin-0.0064)<0.0004);
});
test('data availability limits which horizons can be trained inside the exposed window (about 1,235 sessions)',()=>{
 const S=1235;
 assert.deepEqual(C.HORIZONS.map(h=>C.nonOverlapping(S,h)),[1235,247,58,19,9,4]);
 assert.deepEqual(C.HORIZONS.filter(h=>C.minTrainSessions(h)+h<=S),[1,5,21]); // 63 needs 252+30*63=2142 sessions
});
test('per-horizon decisions are independent; exposed data cannot prove; untestable stays undecided; rejected needs the interval',()=>{
 const good={testable:true,cleanData:true,holmP:.01,relImprovement:.02,ciUpper:-.001,ciLower:-.04,stableOk:true,controlsOk:true};
 assert.equal(C.decideHorizon(good).status,'proven');
 assert.deepEqual(C.decideHorizon({...good,cleanData:false}),{status:'undecided',reason:'exposed-data-cannot-prove'});
 assert.equal(C.decideHorizon({...good,testable:false}).reason,'not-testable');
 assert.equal(C.decideHorizon({...good,controlsOk:false}).status,'undecided');
 assert.equal(C.decideHorizon({...good,ciLower:-.004,ciUpper:.01,holmP:.4,relImprovement:.003}).status,'rejected');
 assert.equal(C.decideHorizon({...good,holmP:.2}).status,'undecided');
});
test('display: only a proven horizon shows an approved price',()=>{
 assert.equal(C.displayStatus({status:'proven'}).showApprovedPrice,true);
 for(const s of ['undecided','rejected',undefined])assert.equal(C.displayStatus(s&&{status:s}).showApprovedPrice,false);
});

test('MZ-1: fixed combination rule (median of four, regime factor clipped), rank feature in [-0.5,0.5]', async () => {
  const C = await import('../research/fcst0005/candidate.mjs');
  assert.equal(C.medianOf([3, 1, 2]), 2); assert.equal(C.medianOf([4, 1, 2, 3]), 2.5);
  assert.equal(C.mz1Combine([0.1, 0.2, 0.3, 0.4], 0.02, 0.02), 0.25);          // factor 1: no change
  assert.equal(C.mz1Combine([0.1, 0.2, 0.3, 0.4], 0.08, 0.02), 0.25 * 0.5);    // high volatility: clipped at 0.5
  assert.equal(C.mz1Combine([0.1, 0.2, 0.3, 0.4], 0.01, 0.02), 0.25);          // low volatility never amplifies
  const r = C.rankFeature([5, 1, 3]); assert.deepEqual(r, [0.5, -0.5, 0]);
  assert.deepEqual(C.rankFeature([7]), [0]);
});
