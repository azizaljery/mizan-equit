// Deterministic outer replay. A fold trains only on outcomes available before its test issue time.
import {buildBridgeInputs,predictCorrection} from './core.mjs';
import {fitBridge} from './research.mjs';
import {trainDirection,fitProbabilityCalibration,predictProbability} from './probability.mjs';
const t=x=>{const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
function row(sample) {
  const input=buildBridgeInputs(sample.snapshot,sample.base),o=sample.outcome;
  if(t(o.targetAt)!==t(input.targetAt)||t(o.availableAt)<t(o.targetAt)||!(o.price>0))throw Error('invalid outcome');
  const realized=Math.log(o.price/input.currentPrice);
  return {sample,input,actualUp:Number(realized>0),actualPrice:o.price,features:{earlyError:input.earlyError,baselineRemainingLogReturn:input.baselineRemainingLogReturn,...input.context},asOf:input.asOf,targetAt:input.targetAt,availableAt:o.availableAt};
}
export function walkForward(samples,{market,evaluationAsOf,featureNames=['earlyError','baselineRemainingLogReturn'],minTrain=30,minCalibration=20,minTest=1,trainFraction=.7,calibrationFraction=.2,folds=3,lambda=1}={}) {
  if(!['SA','US'].includes(market)||!(trainFraction>0&&calibrationFraction>0&&trainFraction+calibrationFraction<1)||![folds,minTrain,minCalibration,minTest].every(x=>Number.isInteger(x)&&x>0)||!Number.isFinite(t(evaluationAsOf)))throw Error('invalid replay config');
  const all=samples.filter(s=>s.base.market===market).map(row).sort((a,b)=>t(a.asOf)-t(b.asOf));
  if(all.length<minTrain+minCalibration+minTest)throw Error('insufficient replay data');
  const results=[],foldSize=Math.max(minTest,Math.floor(all.length*(1-trainFraction-calibrationFraction)/folds));
  for(let f=0;f<folds;f++) {
    const start=Math.floor(all.length*(trainFraction+calibrationFraction))+f*foldSize;
    if(start>=all.length)break;
    const tested=all.slice(start,Math.min(all.length,start+foldSize));
    const cutoff=t(tested[0].asOf),eligible=all.slice(0,start).filter(r=>t(r.availableAt)<cutoff && t(r.targetAt)<cutoff);
    // Chronological train/calibration split on maturity, not on row position at issue.
    eligible.sort((a,b)=>t(a.availableAt)-t(b.availableAt));
    const split=Math.floor(eligible.length*(trainFraction/(trainFraction+calibrationFraction)));
    const train=eligible.slice(0,split),cal=eligible.slice(split);
    if(train.length<minTrain||cal.length<minCalibration) {results.push({fold:f,status:'insufficient_matured_history',testCount:tested.length});continue;}
    const trainCutoff=train.at(-1).availableAt,calCutoff=cal.at(-1).availableAt;
    // A calibration issue must follow the final training outcome; overlapping labels are purged.
    const cleanCal=cal.filter(r=>t(r.asOf)>t(trainCutoff));
    if(cleanCal.length<minCalibration) {results.push({fold:f,status:'insufficient_purged_calibration',testCount:tested.length});continue;}
    const bridge=fitBridge(train.map(r=>r.sample),{cutoff:trainCutoff,market,featureNames,lambda,minSamples:minTrain,version:`fold-${f}`});
    const directionRows=all.map(r=>({id:r.sample.base.id,market,horizon:21,asOf:r.asOf,featuresAvailableAt:r.asOf,targetAt:r.targetAt,availableAt:r.availableAt,actualUp:r.actualUp,features:r.features}));
    const direction=trainDirection(directionRows.filter(r=>t(r.availableAt)<=t(trainCutoff)),{market,horizon:21,cutoff:trainCutoff,featureNames,minSamples:minTrain,version:`fold-${f}`});
    const calibration=fitProbabilityCalibration(direction,cleanCal.map(r=>({id:r.sample.base.id,market,horizon:21,asOf:r.asOf,featuresAvailableAt:r.asOf,targetAt:r.targetAt,availableAt:r.availableAt,actualUp:r.actualUp,features:r.features})),{cutoff:calCutoff,minSamples:minCalibration});
    const predictions=[];
    for(const r of tested) {
      if(t(r.availableAt)>t(evaluationAsOf)) {predictions.push({id:r.sample.base.id,status:'pending',reason:'outcome_not_available'});continue;}
      if(t(r.asOf)<=t(calCutoff)) {predictions.push({id:r.sample.base.id,status:'abstained',reason:'calibration_not_available'});continue;}
      const prediction=predictCorrection(r.input,bridge,null),prob=predictProbability(direction,calibration,r.features,r.asOf);
      predictions.push({id:r.sample.base.id,status:prediction.status,asOf:r.asOf,targetAt:r.targetAt,actualPrice:r.actualPrice,currentPrice:r.input.currentPrice,baselinePrice:r.input.baselinePointPrice,pointPrice:prediction.pointPrice??null,probabilityUp:prob.probabilityUp,actualUp:r.actualUp});
    }
    const valid=predictions.filter(r=>r.status==='corrected');
    results.push({fold:f,status:'evaluated',trainCount:train.length,calibrationCount:cleanCal.length,testCount:tested.length,issuedCount:valid.length,predictions,metrics:{relativeMae:mean(valid.map(r=>Math.abs(r.actualPrice-r.pointPrice)/r.currentPrice)),baselineRelativeMae:mean(valid.map(r=>Math.abs(r.actualPrice-r.baselinePrice)/r.currentPrice)),directionAccuracy:mean(valid.map(r=>Number((r.pointPrice>r.currentPrice)===Boolean(r.actualUp)))),baselineDirectionAccuracy:mean(valid.map(r=>Number((r.baselinePrice>r.currentPrice)===Boolean(r.actualUp)))),brier:mean(valid.map(r=>(r.actualUp-r.probabilityUp)**2))}});
  }
  return {market,evaluationAsOf,folds:results,issued:results.reduce((n,f)=>n+(f.issuedCount??0),0),tested:results.reduce((n,f)=>n+f.testCount,0),pending:results.reduce((n,f)=>n+(f.predictions?.filter(p=>p.status==='pending').length??0),0),note:'No market data supplied; results require real point-in-time SA and US inputs.'};
}
