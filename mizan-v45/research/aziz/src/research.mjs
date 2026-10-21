// Offline fitting and replay only. Samples must be point-in-time records.
import { buildBridgeInputs, predictCorrection, bridgeFeatures, replayKalman } from './core.mjs';
const stamp = s => { const t=Date.parse(s); if(!Number.isFinite(t)) throw Error('invalid timestamp'); return t; };
function solve(a,b) { const n=b.length, m=a.map((row,i)=>[...row,b[i]]); for(let i=0;i<n;i++){ let p=i; for(let j=i+1;j<n;j++) if(Math.abs(m[j][i])>Math.abs(m[p][i])) p=j; if(Math.abs(m[p][i])<1e-12) throw Error('singular design'); [m[i],m[p]]=[m[p],m[i]]; const d=m[i][i]; for(let k=i;k<=n;k++) m[i][k]/=d; for(let j=0;j<n;j++) if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++) m[j][k]-=f*m[i][k];}} return m.map(r=>r[n]); }
// Kalman state per sample as known at its issue time (snapshot.asOf): the filter replays, per market and
// symbol, only bridge errors whose outcome was available strictly before that time. The observed error is
// log(outcome/currentPrice) - baselineRemainingLogReturn, i.e. the residual the bridge regresses on.
const KALMAN=['kalmanMean','kalmanVariance'];
export function kalmanStatesAtIssue(history, config, targets = history) {
  if(!config) throw Error('kalman config required');
  const {initial={mean:0,variance:1},...cfg}=config, matured=[];
  for(const s of history){ if(!s.outcome) continue;
    const x=buildBridgeInputs(s.snapshot,s.base), o=s.outcome;
    if(stamp(o.targetAt)!==stamp(x.targetAt) || stamp(o.availableAt)<stamp(o.targetAt) || !(o.price>0)) throw Error('invalid kalman history outcome');
    matured.push({id:s.base.id,key:`${x.market}|${x.symbol}`,targetAt:o.targetAt,availableAt:o.availableAt,error:Math.log(o.price/x.currentPrice)-x.baselineRemainingLogReturn});
  }
  matured.sort((a,b)=>stamp(a.availableAt)-stamp(b.availableAt) || a.id.localeCompare(b.id));
  const states=new Map();
  for(const s of targets){ const key=`${s.base.market}|${s.base.symbol}`, issue=stamp(s.snapshot.asOf);
    const state=replayKalman(matured.filter(e=>e.key===key && stamp(e.availableAt)<issue), s.snapshot.asOf, cfg, initial);
    states.set(s.base.id, Object.freeze({...state, asOf:s.snapshot.asOf}));
  }
  return states;
}
export function fitBridge(samples, {cutoff, market, featureNames=['earlyError','baselineRemainingLogReturn'], lambda=1, minSamples=30, version='research-1', kalman=null, kalmanStates=null}={}) {
  if (!(lambda>0) || !market) throw Error('invalid fit settings');
  const usesKalman=featureNames.some(n=>KALMAN.includes(n));
  if (usesKalman && !kalman) throw Error('kalman config required for kalman features');
  const states=usesKalman ? (kalmanStates ?? kalmanStatesAtIssue(samples.filter(s=>s.base.market===market), kalman)) : null;
  const t=stamp(cutoff), rows=[];
  for(const sample of samples){
    if(sample.base.market!==market || stamp(sample.outcome.availableAt)>t || stamp(sample.outcome.targetAt)>stamp(sample.outcome.availableAt)) continue;
    const x=buildBridgeInputs(sample.snapshot,sample.base);
    if(stamp(x.asOf)>=stamp(sample.outcome.targetAt) || stamp(x.targetAt)!==stamp(sample.outcome.targetAt)) throw Error('target mismatch');
    const price=sample.outcome.price;
    if(!(price>0) || !Number.isFinite(price)) throw Error('invalid outcome price');
    const kalmanState=usesKalman ? states.get(sample.base.id) ?? null : null;
    if(usesKalman && !kalmanState) throw Error(`missing kalman state for ${sample.base.id}`);
    const features=bridgeFeatures(x,kalmanState);
    const vector=[1,...featureNames.map(name=>{if(!Number.isFinite(features[name])) throw Error(`missing ${name}`);return features[name];})];
    rows.push({id:sample.base.id,x:vector,y:Math.log(price/x.currentPrice)-x.baselineRemainingLogReturn,kalman:kalmanState});
  }
  if(rows.length<minSamples) throw Error('insufficient matured samples');
  const n=featureNames.length+1, gram=Array.from({length:n},()=>Array(n).fill(0)), rhs=Array(n).fill(0);
  for(const row of rows) for(let i=0;i<n;i++){rhs[i]+=row.x[i]*row.y;for(let j=0;j<n;j++) gram[i][j]+=row.x[i]*row.x[j];}
  for(let i=1;i<n;i++) gram[i][i]+=lambda;
  const [intercept,...weights]=solve(gram,rhs);
  return {schemaVersion:1,market,horizon:21,featureNames,weights,intercept,version,trainedThrough:cutoff,sampleCount:rows.length,maxAbsCorrection:0.5,kalmanConfig:usesKalman?kalman:null,trainingKalman:usesKalman?Object.fromEntries(rows.map(r=>[r.id,r.kalman])):null};
}
// history: point-in-time samples (with outcomes) used to rebuild each record's Kalman state; defaults to records.
export function replayBridge(records, artifact, {history=records}={}) {
  const states=artifact.kalmanConfig ? kalmanStatesAtIssue(history, artifact.kalmanConfig, records) : null;
  const results=[];
  for(const record of records){
    const input=buildBridgeInputs(record.snapshot,record.base);
    if(stamp(artifact.trainedThrough)>=stamp(input.asOf)) throw Error('artifact trained after prediction time');
    const kalmanState=states?.get(record.base.id) ?? null;
    const predicted=predictCorrection(input,artifact,kalmanState);
    results.push({id:record.base.id,asOf:input.asOf,targetAt:input.targetAt,market:input.market,baselinePointPrice:input.baselinePointPrice,kalman:kalmanState,predicted});
  }
  return results;
}
export function chooseHorizon(rows,{minCount=30,lowerBoundByHorizon={}}={}) {
  const grouped=new Map();
  for(const row of rows){ if(![5,21,63,126,252].includes(row.horizon) || ![0,1].includes(row.actualUp) || ![row.probability,row.referenceProbability].every(x=>Number.isFinite(x)&&x>=0&&x<=1)) throw Error('invalid horizon row');
    const a=grouped.get(row.horizon)??[];a.push(row);grouped.set(row.horizon,a);
  }
  const ranking=[];
  for(const [h,a] of grouped){if(a.length<minCount) continue;const model=a.reduce((s,r)=>s+(r.actualUp-r.probability)**2,0)/a.length, baseline=a.reduce((s,r)=>s+(r.actualUp-r.referenceProbability)**2,0)/a.length;
    const skill=baseline>0?1-model/baseline:null;ranking.push({horizon:h,skill,count:a.length,lowerBound:lowerBoundByHorizon[h]??null});}
  ranking.sort((a,b)=>(b.lowerBound??-Infinity)-(a.lowerBound??-Infinity));
  return {preferred:ranking[0]?.lowerBound>0?ranking[0].horizon:null,ranking,coverage:ranking.length/grouped.size || 0};
}
