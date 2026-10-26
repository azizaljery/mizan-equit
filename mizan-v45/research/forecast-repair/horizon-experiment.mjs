// RESEARCH ONLY. Reuses the repository's QR RobustRidge; never imported by production.
import {fitRobustRidge,predictRobustRidge} from '../aziz/src/hybrid-math.mjs';
import {createHash} from 'node:crypto';
export const FEATURE_SCHEMA='forecast-repair-demo-v1:logret[5,21,63],sd20,log(close/sma50)';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function validateSeries(dataset){
 if(dataset.kind!=='synthetic')throw Error('This demonstration runner accepts synthetic data only; real-market training requires a separately frozen approved protocol.');
 if(!Array.isArray(dataset.bars)||dataset.bars.length<100)throw Error('Insufficient ordered bars');
 for(let i=0;i<dataset.bars.length;i++){
  const b=dataset.bars[i];
  if(!finite(b.close)||b.close<=0||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date||(i&&dataset.bars[i-1].date>=b.date))throw Error('Invalid price/date/order');
 }
}
export function featuresAt(bars,t){
 if(t<63||t>=bars.length)throw Error('Feature window unavailable');
 const p=bars[t].close,rs=[];for(let i=t-19;i<=t;i++)rs.push(Math.log(bars[i].close)-Math.log(bars[i-1].close));
 const mean=rs.reduce((a,b)=>a+b,0)/rs.length,sd=Math.sqrt(rs.reduce((a,b)=>a+(b-mean)**2,0)/(rs.length-1));
 const sma50=bars.slice(t-49,t+1).reduce((a,b)=>a+b.close/50,0);
 return [5,21,63].map(h=>Math.log(p)-Math.log(bars[t-h].close)).concat(sd,Math.log(p/sma50));
}
export function maturedRows(bars,{start,end,cutoff,horizon}){
 if(![start,end,cutoff,horizon].every(Number.isInteger)||start<63||end<start||horizon<1||cutoff>=bars.length)throw Error('Invalid split');
 const rows=[];for(let t=start;t<=end;t++){
  if(t+horizon>cutoff)continue;
  rows.push({issueIndex:t,targetIndex:t+horizon,issueDate:bars[t].date,targetDate:bars[t+horizon].date,x:featuresAt(bars,t),y:Math.log(bars[t+horizon].close)-Math.log(bars[t].close)});
 }return rows;
}
export function conformalQuantile(scores,alpha){
 if(!(alpha>0&&alpha<1)||!scores.every(x=>finite(x)&&x>=0))throw Error('Invalid calibration');
 const k=Math.ceil((scores.length+1)*(1-alpha));
 return k>scores.length?null:[...scores].sort((a,b)=>a-b)[k-1];
}
export function runHorizonExperiment(dataset,{horizons=[1,5,21,63,126,252],trainCut=800,calibrationCut=1150,embargo=20,lambda=1,alphaPI=.1}={}){
 validateSeries(dataset);const {bars}=dataset;
 if(!Number.isInteger(trainCut)||!Number.isInteger(calibrationCut)||!Number.isInteger(embargo)||trainCut<100||embargo<0||calibrationCut<=trainCut+embargo||calibrationCut+embargo>=bars.length)throw Error('Invalid chronological split');
 if(!Array.isArray(horizons)||new Set(horizons).size!==horizons.length||horizons.some(h=>!Number.isInteger(h)||h<1||h>252))throw Error('Invalid horizons');
 const results=[];
 for(const h of horizons){
  const training=maturedRows(bars,{start:63,end:trainCut,cutoff:trainCut,horizon:h});
  const calibration=maturedRows(bars,{start:trainCut+embargo+1,end:calibrationCut,cutoff:calibrationCut,horizon:h});
  if(training.length<30||!calibration.length){results.push({horizon:h,status:'insufficient',trainingCount:training.length,calibrationCount:calibration.length});continue;}
  const model=fitRobustRidge(training,{lambda}),trainingMean=training.reduce((s,r)=>s+r.y/training.length,0);
  const q=conformalQuantile(calibration.map(r=>Math.abs(r.y-predictRobustRidge(model,r.x))),alphaPI);
  const issues=[];
  // Non-overlapping evaluation anchors for each horizon. This is not a claim of independence.
  for(let t=calibrationCut+embargo+1;t+h<bars.length;t+=h){
   const x=featuresAt(bars,t),mu=predictRobustRidge(model,x),actual=Math.log(bars[t+h].close)-Math.log(bars[t].close),reference=bars[t].close;
   const momentum=x[1]*h/21;
   issues.push({issueDate:bars[t].date,targetDate:bars[t+h].date,horizon:h,reference,predictedLogReturn:mu,predictedPrice:reference*Math.exp(mu),actualLogReturn:actual,actualPrice:bars[t+h].close,
    lossModel:Math.abs(actual-mu),lossZero:Math.abs(actual),lossTrainingMean:Math.abs(actual-trainingMean),lossMomentum:Math.abs(actual-momentum),
    range:q===null?null:[reference*Math.exp(mu-q),reference*Math.exp(mu+q)],rangeHit:q===null?null:Math.abs(actual-mu)<=q});
  }
  const avg=k=>issues.length?issues.reduce((s,r)=>s+r[k]/issues.length,0):null;
  results.push({horizon:h,status:'DEMONSTRATION_ONLY',featureSchema:FEATURE_SCHEMA,trainingCount:training.length,calibrationCount:calibration.length,
   lastTrainingTarget:training.at(-1).targetDate,firstCalibrationIssue:calibration[0].issueDate,lastCalibrationTarget:calibration.at(-1).targetDate,firstEvaluationIssue:issues[0]?.issueDate??null,
   artifactHash:createHash('sha256').update(JSON.stringify({h,model,featureSchema:FEATURE_SCHEMA,trainCut,calibrationCut,embargo})).digest('hex'),model,
   metrics:{sample:issues.length,maeLog:avg('lossModel'),maeZero:avg('lossZero'),maeTrainingMean:avg('lossTrainingMean'),maeMomentum:avg('lossMomentum'),empiricalRangeCoverage:q===null||!issues.length?null:issues.filter(r=>r.rangeHit).length/issues.length},
   interval:{alphaPI,quantile:q,calibratedForProduction:false,warning:'Dependent time-series calibration; no finite-sample exchangeability coverage guarantee asserted.'},issues});
 }
 return {schemaVersion:1,kind:'synthetic_demo',decision:'DEMONSTRATION_ONLY',productionApproved:false,accuracyEvidence:false,
  protocol:{trainCut,calibrationCut,embargo,lambda,alphaPI,selection:'lambda fixed before demonstration; no tuning on evaluation'},results};
}
