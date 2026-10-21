// Regression tests for the owner's spec defects (2026-10-21). Each fails on the pre-fix code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarHazard} from '../src/calendar-regime.mjs';
import {calibrateInterval,applyInterval,updateAci} from '../src/interval.mjs';
import {buildBridgeInputs,predictCorrection,selectEffectiveForecast,assessEligibility,replayKalman,recordMaturedOutcome} from '../src/core.mjs';
import {newMonitor,observeMonitor} from '../src/monitor.mjs';
import {fitBridge,replayBridge,kalmanStatesAtIssue} from '../src/research.mjs';
import {walkForward} from '../src/walk-forward.mjs';
const day=n=>new Date(Date.UTC(2024,0,1+n)).toISOString();
const sample=(i,{symbol='AAPL',market='US',price}={})=>{const p=100+i*.03,cur=p*(1+(i%5-2)/100),cfg=market==='SA'?{currency:'SAR'}:{currency:'USD'};
 return {base:{schemaVersion:1,id:`${symbol}-${i}`,symbol,market,...cfg,priceBasis:'split_adjusted',issuedAt:day(i),shortTargetAt:day(i+5),targetAt:day(i+21),shortHorizon:5,longHorizon:21,shortPrice:p*1.01,longPrice:p*1.04},
  snapshot:{schemaVersion:1,symbol,market,...cfg,priceBasis:'split_adjusted',asOf:day(i+5),observedThrough:day(i+5),elapsedSessions:5,remainingSessions:16,currentPrice:{value:cur,availableAt:day(i+5)}},
  outcome:{targetAt:day(i+21),availableAt:day(i+22),price:price??cur*(1+(i%7-3)/100)}};};

// 1. calendarHazard
const ev=(o={})=>({market:'SA',type:'earnings',timeZone:'Asia/Riyadh',announcedAt:day(0),availableAt:day(0),eventAt:day(3),...o});
test('1 calendar: far-dated announced event does not change hazard',()=>{
 const h=calendarHazard(.02,[ev({eventAt:'2040-01-01T00:00:00Z'})],day(1),{earnings:4},'SA');
 assert.equal(h.hazard,.02);assert.equal(h.usedCalendar,false);assert.equal(h.skipped.outOfWindow,1);
 assert.equal(calendarHazard(.02,[ev({eventAt:day(25)})],day(1),{earnings:4},'SA',{targetAt:day(22)}).hazard,.02);
 assert.ok(calendarHazard(.02,[ev({eventAt:day(25)})],day(1),{earnings:4},'SA',{targetAt:day(30)}).usedCalendar);
 assert.throws(()=>calendarHazard(.02,[],day(1),{},null,{windowDays:0}));
});
test('1 calendar: duplicate event counts once, conflicting id rejected',()=>{
 const once=calendarHazard(.02,[ev()],day(1),{earnings:4},'SA').hazard;
 assert.equal(calendarHazard(.02,[ev(),ev()],day(1),{earnings:4},'SA').hazard,once);
 const byId=calendarHazard(.02,[ev({id:'e1'}),ev({id:'e1'})],day(1),{earnings:4},'SA');
 assert.equal(byId.hazard,once);assert.equal(byId.skipped.duplicate,1);
 assert.throws(()=>calendarHazard(.02,[ev({id:'e1'}),ev({id:'e1',eventAt:day(4)})],day(1),{earnings:4},'SA'),/conflicting/);
});
test('1 calendar: in-window event behaves as before',()=>{
 const h=calendarHazard(.02,[ev()],day(1),{earnings:4},'SA');
 assert.ok(Math.abs(h.hazard-(1-.98**4))<1e-12);assert.deepEqual(h.eventTypes,['earnings']);
});

// 2. calibrateInterval scope partition and conformal rank
const scope={symbol:'AAPL',market:'US',horizon:21,issueType:'bridge_5_to_21',modelVersion:'m1'};
const irow=(i,o={})=>({forecastId:`f${i}`,...scope,issuedAt:day(i),targetAt:day(i+1),availableAt:day(i+2),predictedLogReturn:0,realizedLogReturn:((i*7)%40+1)/100,scale:1,outOfTraining:true,...o});
test('2 interval: mixed symbols / model versions abstain with explicit reason',()=>{
 const mixed=Array.from({length:40},(_,i)=>irow(i,{symbol:i%2?'MSFT':'AAPL',modelVersion:i%4<2?'m1':'m2'}));
 const c=calibrateInterval(mixed,{...scope,asOf:day(50),minCount:5});
 assert.equal(c.status,'abstained');assert.equal(c.reason,'mixed_calibration_scope');assert.equal(c.quantile,null);
 assert.deepEqual(c.mismatchedFields,['symbol','modelVersion']);
 assert.equal(applyInterval(c,{...scope,currentPrice:100,predictedLogReturn:0,scale:1,asOf:day(50)}).status,'unavailable');
 const issue=Array.from({length:40},(_,i)=>irow(i,{issueType:i%2?'direct':'bridge_5_to_21'}));
 assert.deepEqual(calibrateInterval(issue,{...scope,asOf:day(50),minCount:5}).mismatchedFields,['issueType']);
 const other=Array.from({length:40},(_,i)=>irow(i,{market:i%2?'SA':'US'}));
 assert.equal(calibrateInterval(other,{...scope,asOf:day(50),minCount:5}).reason,'mixed_calibration_scope');
 assert.throws(()=>calibrateInterval(mixed,{...scope,issueType:'bridge',asOf:day(50),minCount:5}),/scope/);
 assert.throws(()=>calibrateInterval(mixed,{...scope,symbol:undefined,asOf:day(50),minCount:5}),/scope/);
});
test('2 interval: rank k=ceil((n+1)(1-alpha)) never clamped; k>n abstains',()=>{
 const rows=Array.from({length:40},(_,i)=>irow(i)),c=calibrateInterval(rows,{...scope,asOf:day(50),minCount:5});
 const sorted=rows.map(r=>r.realizedLogReturn).sort((a,b)=>a-b);
 assert.equal(c.status,'available');assert.equal(c.finiteSampleRank,37);assert.equal(c.quantile,sorted[36]);
 const nine=rows.slice(0,9);
 assert.equal(calibrateInterval(nine,{...scope,asOf:day(50),minCount:5,alpha:.1}).quantile,Math.max(...nine.map(r=>r.realizedLogReturn)));
 const k10=calibrateInterval(nine,{...scope,asOf:day(50),minCount:5,alpha:.09});
 assert.equal(k10.finiteSampleRank,10);assert.equal(k10.status,'abstained');assert.equal(k10.reason,'insufficient_finite_sample_rank');
 const w=calibrateInterval(rows.slice(0,25),{...scope,asOf:day(50),minCount:5,alpha:.01,weights:Array(25).fill(1)});
 assert.equal(w.status,'abstained');assert.equal(w.quantile,null);
});

// 3. selectEffectiveForecast identity check
const bridgeArtifact={schemaVersion:1,market:'US',horizon:21,featureNames:['earlyError'],weights:[.1],intercept:0,version:'v1'};
const good=()=>{const s=sample(0);const c=predictCorrection(buildBridgeInputs(s.snapshot,s.base),bridgeArtifact,null);return {base:s.base,c};};
const ctx={asOf:day(6),approval:{status:'approved',modelVersion:'v1'},eligibility:{status:'eligible'}},mon={status:'normal',modelVersion:'v1'};
test('3 select: candidate from another market/symbol falls back with reason',()=>{
 const {base,c}=good();
 assert.equal(c.symbol,'AAPL');assert.equal(c.market,'US');assert.equal(c.currency,'USD');assert.equal(c.priceBasis,'split_adjusted');
 const ok=selectEffectiveForecast(base,c,mon,'ACTIVE',ctx);assert.equal(ok.effective,c);assert.equal(ok.reason,null);
 const foreign={...c,symbol:'2222.SR',market:'SA',currency:'SAR'};
 const r=selectEffectiveForecast(base,foreign,mon,'ACTIVE',ctx);assert.equal(r.effective,base);assert.equal(r.route,'fallback');assert.equal(r.reason,'symbol_mismatch');
 assert.equal(selectEffectiveForecast(base,{...c,market:'SA'},mon,'ACTIVE',ctx).reason,'market_mismatch');
 assert.equal(selectEffectiveForecast(base,{...c,currency:'SAR'},mon,'ACTIVE',ctx).reason,'currency_mismatch');
 assert.equal(selectEffectiveForecast(base,{...c,priceBasis:'raw'},mon,'ACTIVE',ctx).reason,'price_basis_mismatch');
});
test('3 select: model version, validity, approval and eligibility enforced',()=>{
 const {base,c}=good(),reason=(cand,m=mon,x=ctx)=>selectEffectiveForecast(base,cand,m,'ACTIVE',x).reason;
 assert.equal(reason(c,{status:'normal',modelVersion:'v2'}),'model_version_mismatch');
 assert.equal(reason({...c,artifactVersion:undefined}),'model_version_mismatch');
 assert.equal(reason(c,mon,{...ctx,asOf:undefined}),'missing_decision_time');
 assert.equal(reason(c,mon,{...ctx,asOf:day(21)}),'candidate_expired');
 assert.equal(reason({...c,validUntil:day(6)}),'candidate_expired');
 assert.equal(reason(c,mon,{...ctx,asOf:day(4)}),'candidate_from_future');
 assert.equal(reason(c,mon,{...ctx,approval:null}),'not_approved');
 assert.equal(reason(c,mon,{...ctx,approval:{status:'approved',modelVersion:'v0'}}),'not_approved');
 assert.equal(reason(c,mon,{...ctx,approval:{...ctx.approval,expiresAt:day(6)}}),'approval_expired');
 assert.equal(reason(c,mon,{...ctx,eligibility:{status:'unknown'}}),'not_eligible');
 assert.equal(selectEffectiveForecast(base,c,mon,'SHADOW',ctx).reason,'mode_not_active');
});

// 4. assessEligibility data quality
test('4 eligibility: zero/NaN/missing quality is ineligible; threshold required',()=>{
 const policy={minDataQuality:.5};
 for(const dataQuality of [0,NaN,undefined,null,'good',-1,2]){const e=assessEligibility(policy,{market:'US',dataQuality});assert.equal(e.status,'ineligible');assert.deepEqual(e.reasons,['data_quality_missing_or_invalid']);}
 assert.deepEqual(assessEligibility(policy,{market:'US',dataQuality:.4}).reasons,['low_data_quality']);
 assert.equal(assessEligibility(policy,{market:'US',dataQuality:.9}).status,'eligible');
 assert.deepEqual(assessEligibility({},{market:'US',dataQuality:.9}),{status:'unknown',reasons:['missing_data_quality_threshold'],action:'buy'});
 assert.throws(()=>assessEligibility({minDataQuality:0},{market:'US',dataQuality:.9}));
 assert.equal(assessEligibility(policy,{market:'US',dataQuality:0},'exit').status,'eligible');
});

// 5. Kalman integration
test('5 kalman: reserved context names rejected',()=>{
 const s=sample(0);
 for(const name of ['kalmanMean','earlyError','baselineRemainingLogReturn','kalmanVariance'])
  assert.throws(()=>buildBridgeInputs({...s.snapshot,context:{[name]:{value:5,availableAt:day(5)}}},s.base),/reserved/);
});
test('5 kalman: missing required state abstains with reason, never 0',()=>{
 const s=sample(0),x=buildBridgeInputs(s.snapshot,s.base),art={...bridgeArtifact,featureNames:['earlyError','kalmanMean'],weights:[.1,.1]};
 const r=predictCorrection(x,art,null);assert.equal(r.status,'abstained');assert.equal(r.reason,'missing_kalman_state');assert.equal(r.feature,'kalmanMean');
 assert.equal(predictCorrection(x,art,{mean:.01,variance:.1}).status,'corrected');
 assert.throws(()=>predictCorrection(x,art,{mean:.01,variance:.1,lastAvailableAt:day(5)}),/issue time/);
});
const kcfg={persistence:.9,processVariance:.001,observationVariance:.01};
test('5 kalman: state at issue time uses only outcomes available before it',()=>{
 const samples=Array.from({length:60},(_,i)=>sample(i)),states=kalmanStatesAtIssue(samples,kcfg),s30=states.get('AAPL-30');
 assert.equal(s30.observations,13);assert.ok(Date.parse(s30.lastAvailableAt)<Date.parse(day(35)));
 const changed=samples.map((s,i)=>i===20?{...s,outcome:{...s.outcome,price:s.outcome.price*2}}:s);
 assert.deepEqual(kalmanStatesAtIssue(changed,kcfg).get('AAPL-30'),s30);
 const other=kalmanStatesAtIssue([...samples,...Array.from({length:60},(_,i)=>sample(i,{symbol:'MSFT',price:1}))],kcfg);
 assert.deepEqual(other.get('AAPL-30'),s30,'other symbol history must not leak');
 const manual=replayKalman(samples.slice(0,13).map(s=>{const x=buildBridgeInputs(s.snapshot,s.base);return {id:s.base.id,targetAt:s.outcome.targetAt,availableAt:s.outcome.availableAt,error:Math.log(s.outcome.price/x.currentPrice)-x.baselineRemainingLogReturn};}),day(35),kcfg);
 assert.ok(Math.abs(manual.mean-s30.mean)<1e-15);
});
test('5 kalman: fit, replay and walk-forward build the same features from history',()=>{
 const samples=Array.from({length:80},(_,i)=>sample(i)),featureNames=['earlyError','kalmanMean','kalmanVariance'];
 assert.throws(()=>fitBridge(samples,{cutoff:day(60),market:'US',featureNames,minSamples:10}),/kalman config/);
 const fit=fitBridge(samples,{cutoff:day(60),market:'US',featureNames,minSamples:10,kalman:kcfg});
 assert.ok(fit.sampleCount>=10);assert.deepEqual(fit.kalmanConfig,kcfg);assert.equal(fit.trainingKalman['AAPL-30'].observations,13);
 const replay=replayBridge(samples.slice(60),fit,{history:samples});
 assert.ok(replay.every(r=>r.kalman&&r.predicted.reason!=='missing_kalman_state'));
 assert.ok(replay.some(r=>r.predicted.status==='corrected'));
 const wf=walkForward(Array.from({length:240},(_,i)=>sample(i)),{market:'US',evaluationAsOf:day(300),featureNames,minTrain:30,minCalibration:10,trainFraction:.6,calibrationFraction:.2,folds:2,kalman:kcfg});
 assert.ok(wf.issued>0);assert.ok(wf.folds.flatMap(f=>f.predictions??[]).every(p=>p.reason!=='missing_kalman_state'));
});

// 6. monitor unification, idempotence, alarm history
const mev=(i,p,y,o={})=>({id:`delivery-${i}`,forecastId:`fc${i}`,market:'SA',horizon:21,modelVersion:'v',targetAt:day(i),observedAt:day(i),availableAt:day(i+1),probabilityUp:p,actualUp:y,...o});
test('6 monitor: one implementation; re-delivered outcome does not change state or count',()=>{
 assert.equal(recordMaturedOutcome,observeMonitor);
 const s0=newMonitor({market:'SA',horizon:21,modelVersion:'v',k:.1,h:.5,minOutcomes:1}),a=observeMonitor(s0,mev(0,.4,1)).state;
 const again=observeMonitor(a,mev(0,.4,1,{id:'delivery-retry'}));
 assert.equal(again.applied,false);assert.equal(again.state,a);assert.equal(a.count,1);
 assert.throws(()=>observeMonitor(a,mev(0,.9,1,{id:'x'})),/conflicting/);
 assert.throws(()=>observeMonitor(s0,mev(0,.4,1,{id:undefined,forecastId:undefined})),/id/);
});
test('6 monitor: CUSUM alarm during recovery is not swallowed; history survives recovery',()=>{
 let s=newMonitor({market:'SA',horizon:21,modelVersion:'v',k:.1,h:.5,minOutcomes:1,recoveryCount:10,recoveryMaxBrier:.1});
 s=observeMonitor(s,mev(0,.1,1)).state;assert.equal(s.status,'suspended');assert.equal(s.alarms,1);
 for(let i=1;i<=4;i++)s=observeMonitor(s,mev(i,1,1)).state;
 assert.equal(s.status,'recovering');assert.ok(s.plus<s.h);
 s=observeMonitor(s,mev(5,.1,1)).state;
 assert.equal(s.status,'suspended');assert.equal(s.alarms,2);assert.equal(s.alarmLog.length,2);assert.deepEqual(s.recovery,[]);
 let i=6;while(s.status!=='normal'&&i<60)s=observeMonitor(s,mev(i++,1,1)).state;
 assert.equal(s.status,'normal');assert.equal(s.alarms,2);assert.equal(s.alarmLog.length,2);assert.equal(s.recoveryLog.length,1);assert.equal(s.recoveryLog[0].afterAlarm,2);
});

// 7. ACI
test('7 ACI: no update before availability, never twice per forecast id',()=>{
 const s0={seenIds:[],alpha:.1,targetAlpha:.1,gamma:.01},o=(id,n)=>({forecastId:id,targetAt:day(n),availableAt:day(n+1),covered:false});
 assert.throws(()=>updateAci(s0,o('f1',4),day(4)),/not yet available/);
 assert.throws(()=>updateAci(s0,o('f1',4)),/not yet available/);
 assert.throws(()=>updateAci(s0,{...o('f1',4),forecastId:undefined},day(9)),/forecast id/);
 const a=updateAci(s0,o('f1',4),day(9)).state,b=updateAci(a,o('f2',6),day(9)).state;
 const dup=updateAci(b,o('f1',4),day(9));assert.equal(dup.applied,false);assert.equal(dup.state,b);
 assert.equal(updateAci(a,o('f1',4),day(9)).applied,false);
});
