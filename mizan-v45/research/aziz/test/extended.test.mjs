import {test} from 'node:test';import assert from 'node:assert/strict';
import {kalmanStep} from '../src/core.mjs';
import {trainDirection,fitProbabilityCalibration,predictProbability} from '../src/probability.mjs';
import {newMonitor,observeMonitor} from '../src/monitor.mjs';
import {calendarHazard,newRegime,updateRegime} from '../src/calendar-regime.mjs';
import {calibrateInterval,applyInterval,updateAci} from '../src/interval.mjs';
import {selectHorizon} from '../src/horizon.mjs';
const day=n=>new Date(Date.UTC(2024,0,1+n)).toISOString();
test('kalman rejects corrupted state and nonfinite parameters',()=>{for(const state of [{mean:NaN,variance:1},{mean:0,variance:-1},{mean:0,variance:Infinity}])assert.throws(()=>kalmanStep(state,.1,{persistence:.9,processVariance:.01,observationVariance:.1}));assert.throws(()=>kalmanStep({mean:0,variance:1},.1,{persistence:NaN,processVariance:0,observationVariance:.1}));});
test('probability training and calibration are separate and time gated',()=>{const rows=Array.from({length:25},(_,i)=>({id:`t${i}`,market:'US',horizon:21,asOf:day(i),targetAt:day(i+2),availableAt:day(i+3),actualUp:i%2,featuresAvailableAt:day(i),features:{x:(i%5)-2}}));const model=trainDirection(rows.slice(0,10),{market:'US',horizon:21,cutoff:day(13),featureNames:['x'],minSamples:10});assert.throws(()=>fitProbabilityCalibration(model,rows.slice(8,18),{cutoff:day(22),minSamples:10}));const cal=fitProbabilityCalibration(model,rows.slice(14,24),{cutoff:day(27),minSamples:10});assert.throws(()=>predictProbability(model,cal,{x:1},day(26)));const p=predictProbability(model,cal,{x:1},day(28));assert.ok(p.probabilityUp>0&&p.probabilityUp<1);});
test('monitor suspends, persists shadow outcomes and recovers only with evidence',()=>{let s=newMonitor({market:'SA',horizon:21,modelVersion:'v',k:.1,h:.5,minOutcomes:1,recoveryCount:2,recoveryMaxBrier:.1});const event=(i,p,y)=>({id:`o${i}`,market:'SA',horizon:21,modelVersion:'v',targetAt:day(i),observedAt:day(i),availableAt:day(i+1),probabilityUp:p,actualUp:y});s=observeMonitor(s,event(0,.1,1)).state;assert.equal(s.status,'suspended');assert.equal(observeMonitor(s,event(0,.1,1)).applied,false);s=observeMonitor(s,event(1,1,1)).state;assert.equal(s.status,'recovering');for(let i=2;i<12&&s.status!=='normal';i++)s=observeMonitor(s,event(i,1,1)).state;assert.equal(s.status,'normal');});
test('calendar rejects events announced later, uses constant hazard if absent',()=>{const h=calendarHazard(.02,[],day(1));assert.ok(Math.abs(h.hazard-.02)<1e-12);assert.throws(()=>calendarHazard(.02,[{type:'earnings',market:'SA',timeZone:'Asia/Riyadh',announcedAt:day(2),availableAt:day(2),eventAt:day(3)}],day(1)));const state=newRegime();const next=updateRegime(state,{returnValue:.01,availableAt:day(1),hazard:h.hazard});assert.ok(next.changeProbability>=0&&next.changeProbability<=1);assert.throws(()=>updateRegime(next,{returnValue:0,availableAt:day(1)}));});
test('rolling interval handles finite sample, future data, weights and delayed ACI',()=>{const rows=Array.from({length:9},(_,i)=>({forecastId:`f${i}`,symbol:'AAPL',modelVersion:'m1',market:'US',horizon:21,issueType:'bridge_5_to_21',issuedAt:day(i),targetAt:day(i+1),availableAt:day(i+2),predictedLogReturn:0,realizedLogReturn:(i+1)/100,scale:1,outOfTraining:true}));const scope={symbol:'AAPL',modelVersion:'m1',market:'US',horizon:21,issueType:'bridge_5_to_21'};const c=calibrateInterval(rows,{...scope,asOf:day(15),minCount:5,alpha:.05});assert.equal(c.status,'abstained');assert.equal(c.reason,'insufficient_finite_sample_rank');assert.equal(c.quantile,null);assert.equal(applyInterval(c,{...scope,currentPrice:100,predictedLogReturn:0,scale:1,asOf:day(15)}).status,'unavailable');assert.throws(()=>calibrateInterval(rows,{...scope,asOf:day(5),minCount:5}));assert.throws(()=>calibrateInterval(rows,{...scope,asOf:day(15),minCount:5,weights:Array(9).fill(0)}));const state={seenIds:[],alpha:.1,targetAlpha:.1,gamma:.01};assert.throws(()=>updateAci(state,{forecastId:'x',targetAt:day(4),availableAt:day(3),covered:false},day(10)));});
test('horizon chooser reports absent evidence and deterministic replay',()=>{const rows=Array.from({length:40},(_,i)=>({horizon:5,asOf:day(i),targetAt:day(i+1),availableAt:day(i+2),outOfTraining:true,actualUp:i%2,probability:i%2?.9:.1,referenceProbability:.5}));const a=selectHorizon(rows,{cutoff:day(43),minRows:30,draws:100,seed:7});const b=selectHorizon(rows,{cutoff:day(43),minRows:30,draws:100,seed:7});assert.deepEqual(a,b);assert.equal(a.preferred,5);assert.equal(a.simultaneous,false);});
import {walkForward} from '../src/walk-forward.mjs';
test('walk-forward evaluates only matured, purged folds with paired baseline',()=>{
 const samples=Array.from({length:240},(_,i)=>{
  const issued=day(i),shortTarget=day(i+5),target=day(i+21),p=100+i*.03,short=p*1.01,long=p*1.04,current=p*(1+(i%5-2)/100);
  const base={schemaVersion:1,id:`f${i}`,symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',issuedAt:issued,shortTargetAt:shortTarget,targetAt:target,shortHorizon:5,longHorizon:21,shortPrice:short,longPrice:long};
  const snapshot={schemaVersion:1,symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',asOf:shortTarget,observedThrough:shortTarget,elapsedSessions:5,remainingSessions:16,currentPrice:{value:current,availableAt:shortTarget}};
  return {base,snapshot,outcome:{targetAt:target,availableAt:day(i+22),price:current*(1+(i%7-3)/100)}};
 });
 const report=walkForward(samples,{market:'US',evaluationAsOf:day(300),minTrain:30,minCalibration:10,trainFraction:.6,calibrationFraction:.2,folds:2});
 assert.ok(report.folds.some(x=>x.status==='evaluated'));assert.ok(report.issued>0);assert.ok(report.issued<=report.tested);
 const first=report.folds.find(x=>x.status==='evaluated');assert.ok(Number.isFinite(first.metrics.brier));assert.equal(first.predictions[0].targetAt,samples.find(s=>s.base.id===first.predictions[0].id).base.targetAt);
});
import {fitCalendarMultipliers} from '../src/calendar-regime.mjs';
test('calendar multiplier training respects known announcements and market',()=>{
 const rows=Array.from({length:35},(_,i)=>({market:'SA',asOf:day(i),availableAt:day(i+1),returnValue:i%2?.01:-.01,events:[{market:'SA',type:'earnings',timeZone:'Asia/Riyadh',announcedAt:day(i),availableAt:day(i),eventAt:day(i+1)}]}));
 const fit=fitCalendarMultipliers(rows,{market:'SA',cutoff:day(36),eventTypes:['earnings'],grid:[.5,1,2]});assert.ok(Number.isFinite(fit.trainingLogLikelihood));assert.ok([.5,1,2].includes(fit.multipliers.earnings));
 assert.throws(()=>fitCalendarMultipliers([...rows,{...rows[0],availableAt:day(40)}],{market:'SA',cutoff:day(36),eventTypes:['earnings']}));
});
import {selectEffectiveForecast} from '../src/core.mjs';
test('recovery or absent monitor cannot activate candidate',()=>{const id={symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted'},base={id:'a',targetAt:day(20),...id},candidate={status:'corrected',baseForecastId:'a',targetAt:day(20),asOf:day(5),artifactVersion:'v1',...id},ctx={asOf:day(6),approval:{status:'approved',modelVersion:'v1'},eligibility:{status:'eligible'}};for(const status of [undefined,'collecting','recovering','suspended'])assert.equal(selectEffectiveForecast(base,candidate,status?{status,modelVersion:'v1'}:null,'ACTIVE',ctx).effective,base);assert.equal(selectEffectiveForecast(base,candidate,{status:'normal',modelVersion:'v1'},'ACTIVE',ctx).effective,candidate);});
test('probability training rejects future features even on matured outcomes',()=>{const rows=Array.from({length:10},(_,i)=>({market:'SA',horizon:21,asOf:day(i),targetAt:day(i+1),availableAt:day(i+2),featuresAvailableAt:day(i+3),actualUp:i%2,features:{x:i}}));assert.throws(()=>trainDirection(rows,{market:'SA',horizon:21,cutoff:day(15),featureNames:['x'],minSamples:10}));});
test('Saudi and US replay paths remain separate on synthetic records',()=>{
 const make=market=>Array.from({length:230},(_,i)=>{const issued=day(i),shortTarget=day(i+5),target=day(i+21),symbol=market==='SA'?'2222.SR':'AAPL',currency=market==='SA'?'SAR':'USD',p=100+i*.02;
 return {base:{schemaVersion:1,id:`${market}-${i}`,symbol,market,currency,priceBasis:'split_adjusted',issuedAt:issued,shortTargetAt:shortTarget,targetAt:target,shortHorizon:5,longHorizon:21,shortPrice:p*1.01,longPrice:p*1.03},snapshot:{schemaVersion:1,symbol,market,currency,priceBasis:'split_adjusted',asOf:shortTarget,observedThrough:shortTarget,elapsedSessions:5,remainingSessions:16,currentPrice:{value:p,availableAt:shortTarget}},outcome:{targetAt:target,availableAt:day(i+22),price:p*(1+(i%7-3)/100)}};});
 const combined=[...make('SA'),...make('US')];for(const market of ['SA','US']){const r=walkForward(combined,{market,evaluationAsOf:day(300),minTrain:30,minCalibration:10,trainFraction:.6,calibrationFraction:.2,folds:2});assert.ok(r.issued>0);assert.ok(r.folds.filter(f=>f.status==='evaluated').every(f=>f.predictions.every(p=>p.id.startsWith(`${market}-`))));}
});
test('regime evidence changes posterior beyond calendar hazard',()=>{
 const state={...newRegime({baseHazard:.1,priorMean:0,priorVariance:.001,observationVariance:.001}),probabilities:[.1,.9],means:[0,.5],variances:[.001,.001]};
 const result=updateRegime(state,{returnValue:0,availableAt:day(1)});
 assert.ok(result.changeProbability>.1,'return near prior should favor a change');
});
test('replay does not score outcomes unavailable by evaluation cutoff',()=>{
 const make=i=>{const issued=day(i),short=day(i+5),target=day(i+21),p=100+i*.01;
 return {base:{schemaVersion:1,id:`cut-${i}`,symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',issuedAt:issued,shortTargetAt:short,targetAt:target,shortHorizon:5,longHorizon:21,shortPrice:p*1.01,longPrice:p*1.04},snapshot:{schemaVersion:1,symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',asOf:short,observedThrough:short,elapsedSessions:5,remainingSessions:16,currentPrice:{value:p,availableAt:short}},outcome:{targetAt:target,availableAt:day(i+22),price:p*1.02}};};
 const report=walkForward(Array.from({length:240},(_,i)=>make(i)),{market:'US',evaluationAsOf:day(235),minTrain:30,minCalibration:10,trainFraction:.6,calibrationFraction:.2,folds:2});
 assert.ok(report.pending>0);
 assert.ok(report.folds.flatMap(f=>f.predictions??[]).filter(p=>p.status==='corrected').every(p=>p.actualPrice>0));
});
