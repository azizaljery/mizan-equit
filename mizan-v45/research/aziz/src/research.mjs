// Offline fitting and replay only. Samples must be point-in-time records.
import { buildBridgeInputs, predictCorrection } from './core.mjs';
const stamp = s => { const t=Date.parse(s); if(!Number.isFinite(t)) throw Error('invalid timestamp'); return t; };
function solve(a,b) { const n=b.length, m=a.map((row,i)=>[...row,b[i]]); for(let i=0;i<n;i++){ let p=i; for(let j=i+1;j<n;j++) if(Math.abs(m[j][i])>Math.abs(m[p][i])) p=j; if(Math.abs(m[p][i])<1e-12) throw Error('singular design'); [m[i],m[p]]=[m[p],m[i]]; const d=m[i][i]; for(let k=i;k<=n;k++) m[i][k]/=d; for(let j=0;j<n;j++) if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++) m[j][k]-=f*m[i][k];}} return m.map(r=>r[n]); }
export function fitBridge(samples, {cutoff, market, featureNames=['earlyError','baselineRemainingLogReturn'], lambda=1, minSamples=30, version='research-1'}={}) {
  if (!(lambda>0) || !market) throw Error('invalid fit settings');
  const t=stamp(cutoff), rows=[];
  for(const sample of samples){
    if(sample.base.market!==market || stamp(sample.outcome.availableAt)>t || stamp(sample.outcome.targetAt)>stamp(sample.outcome.availableAt)) continue;
    const x=buildBridgeInputs(sample.snapshot,sample.base);
    if(stamp(x.asOf)>=stamp(sample.outcome.targetAt) || stamp(x.targetAt)!==stamp(sample.outcome.targetAt)) throw Error('target mismatch');
    const price=sample.outcome.price;
    if(!(price>0) || !Number.isFinite(price)) throw Error('invalid outcome price');
    const features={earlyError:x.earlyError,baselineRemainingLogReturn:x.baselineRemainingLogReturn,...x.context};
    const vector=[1,...featureNames.map(name=>{if(!Number.isFinite(features[name])) throw Error(`missing ${name}`);return features[name];})];
    rows.push({x:vector,y:Math.log(price/x.currentPrice)-x.baselineRemainingLogReturn});
  }
  if(rows.length<minSamples) throw Error('insufficient matured samples');
  const n=featureNames.length+1, gram=Array.from({length:n},()=>Array(n).fill(0)), rhs=Array(n).fill(0);
  for(const row of rows) for(let i=0;i<n;i++){rhs[i]+=row.x[i]*row.y;for(let j=0;j<n;j++) gram[i][j]+=row.x[i]*row.x[j];}
  for(let i=1;i<n;i++) gram[i][i]+=lambda;
  const [intercept,...weights]=solve(gram,rhs);
  return {schemaVersion:1,market,horizon:21,featureNames,weights,intercept,version,trainedThrough:cutoff,sampleCount:rows.length,maxAbsCorrection:0.5};
}
export function replayBridge(records, artifact) {
  const results=[];
  for(const record of records){
    const input=buildBridgeInputs(record.snapshot,record.base);
    if(stamp(artifact.trainedThrough)>=stamp(input.asOf)) throw Error('artifact trained after prediction time');
    const predicted=predictCorrection(input,artifact,null);
    results.push({id:record.base.id,asOf:input.asOf,targetAt:input.targetAt,market:input.market,baselinePointPrice:input.baselinePointPrice,predicted});
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
