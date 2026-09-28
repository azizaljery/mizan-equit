// Offline, prequential research inside Aziz. No live provider, database or order calls.
import {createHash} from 'node:crypto';
import {buildPathSignatureFeatures} from './path-signature.mjs';
import {fitRobustRidge,predictRobustRidge,harFeatures,squaredReturnSum} from './hybrid-math.mjs';
import {calibrateMaturedScores,applyMaturedCalibration} from './hybrid-conformal.mjs';

export const HYBRID_VERSION='AZIZ-signature-har-stack-conformal/0.1.0';
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const stamp=x=>{
 const t=Date.parse(x);
 if(typeof x!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(t))throw Error('timestamp with timezone required');
 return t;
};
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const positive=x=>Number.isFinite(x)&&x>0;

function policy(options={}){
 const p={trainWindow:504,minTrain:100,minStack:40,minCalibration:40,calibrationWindow:252,
  lookback:20,lambda:1,stackLambda:1,alpha:.1,maxBridgeAgeDays:7,maxIssueDelayHours:12,...options};
 for(const k of ['trainWindow','minTrain','minStack','minCalibration','calibrationWindow','lookback'])
  if(!Number.isInteger(p[k])||p[k]<1)throw Error(`invalid ${k}`);
 if(p.lookback<2||p.trainWindow<p.minTrain||p.calibrationWindow<p.minCalibration
  ||!positive(p.lambda)||!positive(p.stackLambda)||!positive(p.maxBridgeAgeDays)
  ||!positive(p.maxIssueDelayHours)||p.maxIssueDelayHours>12||!(p.alpha>0&&p.alpha<1))throw Error('invalid hybrid policy');
 p.embargoSessions=Math.ceil(.02*p.trainWindow);
 return Object.freeze(p);
}

function validateDataset(data){
 if(data?.schemaVersion!==1||!['SA','US'].includes(data.market)||!nonempty(data.symbol)
  ||!nonempty(data.currency)||!nonempty(data.priceBasis)||!nonempty(data.calendarId)
  ||!nonempty(data.provenance?.source)||data.provenance.pointInTime!==true
  ||!nonempty(data.provenance.adjustmentPolicy)||!Array.isArray(data.bars))throw Error('point-in-time dataset contract required');
 // Sessions must be supplied by the actual exchange calendar, never inferred from weekdays.
 let last=-Infinity,lastAvailable=-Infinity;
 for(let i=0;i<data.bars.length;i++){
  const b=data.bars[i],t=stamp(b.observedAt),a=stamp(b.availableAt);
  if(b.sessionIndex!==i||t-last<12*3600000||a<t||a<=lastAvailable||b.market!==data.market||b.symbol!==data.symbol
   ||b.priceBasis!==data.priceBasis)throw Error('invalid ordered session identity or availability');
  last=t;lastAvailable=a;
 }
 const ids=new Set();
 for(const s of data.bridgeSeries??[]){
  if(!nonempty(s.id)||ids.has(s.id)||!['SA','US'].includes(s.market)||!nonempty(s.symbol)||!nonempty(s.priceBasis)
   ||s.provenance?.pointInTime!==true||!nonempty(s.provenance?.source)||!Array.isArray(s.bars))throw Error('invalid bridge series');
  ids.add(s.id);let prev=-Infinity;
  for(let i=0;i<s.bars.length;i++){
   const b=s.bars[i];
   const t=stamp(b.observedAt),a=stamp(b.availableAt);
   if(b.sessionIndex!==i||t<=prev||a<t||b.market!==s.market||b.symbol!==s.symbol||b.priceBasis!==s.priceBasis)throw Error('invalid bridge chronology');
   prev=t;
  }
 }
}

function featuresAt(data,index,p){
 const current=data.bars[index],asOf=current.availableAt,cut=stamp(asOf);
 const bars=data.bars.slice(0,index+1);
 if(bars.length<Math.max(23,p.lookback+1))return null;
 for(const b of bars)if(!positive(b.close)||!Number.isFinite(b.volume)||b.volume<0)throw Error('invalid available OHLCV');
 const sig=buildPathSignatureFeatures({bars,asOf,lookback:p.lookback,market:data.market,symbol:data.symbol,priceBasis:data.priceBasis});
 if(sig.status!=='available')return null;
 const own=harFeatures(bars),risk=[...own],bridgeProvenance=[];
 for(const s of [...(data.bridgeSeries??[])].sort((a,b)=>a.id.localeCompare(b.id))){
  // An American close on the same date is not available before that actual timestamp.
  const known=s.bars.filter(b=>stamp(b.observedAt)<=cut&&stamp(b.availableAt)<=cut);
  const last=known.at(-1);
  if(known.length<23||cut-stamp(last.observedAt)>p.maxBridgeAgeDays*86400000)return null;
  const window=known.slice(-23);
  if(window.some((b,i)=>i>0&&b.sessionIndex!==window[i-1].sessionIndex+1))return null;
  risk.push(...harFeatures(window));
  bridgeProvenance.push({id:s.id,observedAt:last.observedAt,availableAt:last.availableAt});
 }
 const sigValues=Object.values(sig.features);
 if(!sigValues.every(Number.isFinite))throw Error('signature feature contract mismatch');
 const returns=[1,5,21].map(h=>Math.log(current.close/bars.at(-h-1).close));
 return {index,asOf,price:current.close,x:[...returns,...own,...sigValues,...risk.slice(3)],risk,
  featureNames:['return1','return5','return21','logSquaredReturn1','logMeanSquaredReturn5','logMeanSquaredReturn22',
   ...Object.keys(sig.features),...(data.bridgeSeries??[]).slice().sort((a,b)=>a.id.localeCompare(b.id)).flatMap(s=>[`${s.id}:har1`,`${s.id}:har5`,`${s.id}:har22`])],bridgeProvenance};
}

function maturedLabel(data,feature,horizon,cutoffIndex,cutoffTime){
 const end=feature.index+horizon,b=data.bars[end];
 if(!b||end>cutoffIndex||stamp(b.availableAt)>=cutoffTime)return null;
 const closes=data.bars.slice(feature.index,end+1).map(x=>x.close);
 if(!closes.every(positive))throw Error('invalid matured outcome prices');
 return {y:Math.log(b.close/feature.price),varianceProxy:squaredReturnSum(closes),targetAt:b.observedAt,availableAt:b.availableAt};
}

function scoredRecords(issued,data,horizon,asOf){
 const cut=stamp(asOf),out=[];
 for(const r of issued){
  const label=maturedLabel(data,r,horizon,data.bars.length-1,cut);
  if(label)out.push({id:r.id,market:data.market,symbol:data.symbol,horizon,modelVersion:r.modelVersion,
   asOf:r.asOf,targetAt:label.targetAt,availableAt:label.availableAt,actualLogReturn:label.y,
   meanLogReturn:r.meanLogReturn,scale:r.scale,lowerLogReturn:r.interval?.lowerLogReturn,
   upperLogReturn:r.interval?.upperLogReturn});
 }
 return out;
}

function metrics(rows,alpha){
 if(!rows.length)return {count:0,mae:null,directionAccuracy:null,coverage:null,intervalScore:null,meanLogWidth:null};
 const bounded=rows.filter(r=>r.interval?.status==='available');
 return {count:rows.length,mae:mean(rows.map(r=>Math.abs(r.actualLogReturn-r.meanLogReturn))),
  baselineMae:mean(rows.map(r=>Math.abs(r.actualLogReturn-r.baselineLogReturn))),
  signatureMae:mean(rows.map(r=>Math.abs(r.actualLogReturn-r.signatureLogReturn))),
  directionAccuracy:mean(rows.map(r=>Number(Math.sign(r.actualLogReturn)===Math.sign(r.meanLogReturn)))),
  baselineDirectionAccuracy:mean(rows.map(r=>Number(Math.sign(r.actualLogReturn)===Math.sign(r.baselineLogReturn)))),
  intervalCount:bounded.length,coverage:bounded.length?mean(bounded.map(r=>Number(r.actualLogReturn>=r.interval.lowerLogReturn&&r.actualLogReturn<=r.interval.upperLogReturn))):null,
  meanLogWidth:bounded.length?mean(bounded.map(r=>r.interval.upperLogReturn-r.interval.lowerLogReturn)):null,
  intervalScore:bounded.length?mean(bounded.map(r=>{
   const l=r.interval.lowerLogReturn,u=r.interval.upperLogReturn,y=r.actualLogReturn;
   return u-l+2/alpha*(Math.max(l-y,0)+Math.max(y-u,0));
  })):null};
}

/** Fixed-policy forward replay. No optimizer chooses settings on these test outcomes.
 * The caller declares PIT provenance; the replay does not independently certify it.
 * Outputs never authorize live forecast routing, regardless of apparent gains.
 */
export function runAzizHybridReplay(data,{horizon=5,evaluationAsOf,options={}}={}){
 validateDataset(data);if(![5,21].includes(horizon))throw Error('only full 5/21-session horizons supported');
 const evaluationCut=stamp(evaluationAsOf),p=policy(options);
 const identity={algorithm:HYBRID_VERSION,market:data.market,symbol:data.symbol,currency:data.currency,
  priceBasis:data.priceBasis,calendarId:data.calendarId,horizon,policy:p,
  bridges:(data.bridgeSeries??[]).map(s=>({id:s.id,market:s.market,symbol:s.symbol,priceBasis:s.priceBasis})).sort((a,b)=>a.id.localeCompare(b.id))};
 const modelVersion=HYBRID_VERSION+':'+createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,16);
 const features=[],experts=[],issued=[],skipped=[];
 for(let i=0;i<data.bars.length;i++){
 const b=data.bars[i];if(stamp(b.availableAt)>evaluationCut)break;
  // Freshness is decided from this observation alone, never by peeking at future tail metadata.
  if(stamp(b.availableAt)-stamp(b.observedAt)>p.maxIssueDelayHours*3600000){
   skipped.push({sessionIndex:i,reason:'stale_observation_at_issue'});continue;
  }
  const feature=featuresAt(data,i,p);if(!feature){skipped.push({sessionIndex:i,reason:'insufficient_or_stale_features'});continue;}
  const cutIndex=i-p.embargoSessions,cutBar=data.bars[cutIndex];
  const training=features.flatMap(f=>{
   if(f.index<i-p.trainWindow)return [];
   const label=cutBar?maturedLabel(data,f,horizon,cutIndex,stamp(cutBar.availableAt)):null;
   return label?[{...f,...label}]:[];
  });
  features.push(feature);
  if(training.length<p.minTrain){skipped.push({sessionIndex:i,reason:'insufficient_purged_training'});continue;}
  const returnModel=fitRobustRidge(training.map(r=>({x:r.x,y:r.y})),{lambda:p.lambda});
  const riskModel=fitRobustRidge(training.map(r=>({x:r.risk,y:Math.log(r.varianceProxy+1e-12)})),{lambda:p.lambda});
  const baselineLogReturn=mean(training.map(r=>r.y)),signatureLogReturn=predictRobustRidge(returnModel,feature.x);
  const logVariance=predictRobustRidge(riskModel,feature.risk),varianceProxy=Math.exp(logVariance);
  if(!positive(varianceProxy)||!Number.isFinite(signatureLogReturn)){
   skipped.push({sessionIndex:i,reason:'invalid_model_output'});continue;
  }
  const metaRows=experts.flatMap(r=>{
   if(r.index<i-p.trainWindow)return [];
   const label=maturedLabel(data,r,horizon,cutIndex,stamp(cutBar.availableAt));
   return label?[{x:[r.baselineLogReturn,r.signatureLogReturn],y:label.y}]:[];
  });
  // This expert output is saved before its own outcome is observed, for future OOF stacking.
  experts.push({...feature,baselineLogReturn,signatureLogReturn});
  if(metaRows.length<p.minStack){skipped.push({sessionIndex:i,reason:'insufficient_matured_oof_stack'});continue;}
  const stack=fitRobustRidge(metaRows,{lambda:p.stackLambda});
  const meanLogReturn=predictRobustRidge(stack,[baselineLogReturn,signatureLogReturn]);
  const pointPrice=feature.price*Math.exp(meanLogReturn);
  if(!positive(pointPrice)){skipped.push({sessionIndex:i,reason:'invalid_point_price'});continue;}
  const calibration=calibrateMaturedScores(scoredRecords(issued,data,horizon,feature.asOf),{
   asOf:feature.asOf,market:data.market,symbol:data.symbol,horizon,modelVersion,
   alpha:p.alpha,minSamples:p.minCalibration,maxSamples:p.calibrationWindow});
  const interval=applyMaturedCalibration(calibration,{currentPrice:feature.price,meanLogReturn,
   integratedVariance:varianceProxy,asOf:feature.asOf,market:data.market,symbol:data.symbol,horizon,modelVersion});
  const inputFingerprint=createHash('sha256').update(JSON.stringify({feature,returnModel,riskModel,stack,calibration})).digest('hex');
  issued.push({id:`${modelVersion}:${feature.asOf}:${inputFingerprint}`,inputFingerprint,index:i,market:data.market,symbol:data.symbol,horizon,modelVersion,
   asOf:feature.asOf,price:feature.price,pointPrice,meanLogReturn,baselineLogReturn,signatureLogReturn,
   scale:Math.sqrt(varianceProxy),varianceProxy,interval,calibration,
   audit:{trainCount:training.length,stackCount:metaRows.length,embargoSessions:p.embargoSessions,
    trainCutoff:cutBar.availableAt,lastTrainingTargetSessionIndex:training.at(-1).index+horizon,lastTrainingTargetAt:training.at(-1).targetAt,
    lastTrainingOutcomeAvailableAt:training.at(-1).availableAt,featureNames:feature.featureNames,
    bridgeProvenance:feature.bridgeProvenance}});
 }
 const evaluated=issued.flatMap(r=>{
  const label=maturedLabel(data,r,horizon,data.bars.length-1,evaluationCut);
  return label?[{...r,actualLogReturn:label.y,targetAt:label.targetAt,outcomeAvailableAt:label.availableAt}]:[];
 });
 return {schemaVersion:1,algorithm:HYBRID_VERSION,modelVersion,market:data.market,symbol:data.symbol,horizon,
  evaluationAsOf,policy:p,mode:'REPLAY',canActivate:false,provenance:'caller_declared_not_independently_verified',
  inputProvenance:{...data.provenance},calendarId:data.calendarId,priceBasis:data.priceBasis,
  comparator:'historical_mean_return_not_live_mizan',issued,evaluated,pending:issued.length-evaluated.length,skipped,
  metrics:metrics(evaluated,p.alpha),promotion:{approved:false,reasons:['real_SA_US_PIT_validation_required',
   'paired_live_mizan_baseline_required','nested_selection_and_untouched_holdout_required',
   'dependence_aware_significance_and_multiple_testing_required','no_automatic_live_routing']}};
}
