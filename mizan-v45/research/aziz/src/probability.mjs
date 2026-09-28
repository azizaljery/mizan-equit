// Offline directional model. Training and calibration sets must be disjoint in time.
const t = x => {const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
const sigmoid = x => x>=0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x));
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
function fit(rows, dimension, {iterations=600, learningRate=.1, regularization=.01}={}) {
  if(!Number.isInteger(iterations)||iterations<1||!(learningRate>0)||!(regularization>=0))throw Error('invalid optimizer');
  let weights=Array(dimension+1).fill(0);
  for(let j=0;j<iterations;j++) {
    const grad=Array(dimension+1).fill(0);
    for(const row of rows) {const x=[1,...row.x], d=sigmoid(dot(weights,x))-row.y;for(let i=0;i<x.length;i++)grad[i]+=d*x[i];}
    for(let i=0;i<weights.length;i++)weights[i]-=learningRate*(grad[i]/rows.length+(i?regularization*weights[i]:0));
  }
  if(weights.some(x=>!Number.isFinite(x)))throw Error('nonfinite model');
  return weights;
}
function validated(rows, cutoff, names, scope) {
  const end=t(cutoff), out=[];
  for(const r of rows) {
    if(r.market!==scope.market||r.horizon!==scope.horizon)continue;
    if(t(r.availableAt)>end||t(r.targetAt)>t(r.availableAt)||t(r.asOf)>=t(r.targetAt))throw Error('unmatured or future training row');
    if(!r.featuresAvailableAt||t(r.featuresAvailableAt)>t(r.asOf))throw Error('future or undocumented features');
    if(![0,1].includes(r.actualUp))throw Error('invalid outcome');
    const x=names.map(n=>r.features?.[n]);if(x.some(v=>!Number.isFinite(v)))throw Error('missing feature');
    out.push({x,y:r.actualUp,id:r.id,asOf:r.asOf,targetAt:r.targetAt,availableAt:r.availableAt});
  }
  if(out.length<scope.minSamples)throw Error('insufficient outcomes');
  return out;
}
export function trainDirection(rows,{market,horizon,cutoff,featureNames,minSamples=30,version='research-1',optimizer}={}) {
  if(!['SA','US'].includes(market)||![5,21,63,126,252].includes(horizon)||!Array.isArray(featureNames)||!featureNames.length||new Set(featureNames).size!==featureNames.length)throw Error('invalid scope');
  const a=validated(rows,cutoff,featureNames,{market,horizon,minSamples});
  return {schemaVersion:1,market,horizon,featureNames,weights:fit(a,featureNames.length,optimizer),trainedThrough:cutoff,version,sampleCount:a.length};
}
export function rawProbability(model,features) {
  const x=model.featureNames.map(n=>features?.[n]);if(x.some(v=>!Number.isFinite(v))||model.weights?.length!==x.length+1||model.weights.some(v=>!Number.isFinite(v)))throw Error('invalid model input');
  return sigmoid(dot(model.weights,[1,...x]));
}
export function fitProbabilityCalibration(model,rows,{cutoff,minSamples=30,optimizer}={}) {
  const a=validated(rows,cutoff,model.featureNames,{market:model.market,horizon:model.horizon,minSamples});
  if(a.some(r=>t(r.asOf)<=t(model.trainedThrough)))throw Error('calibration overlaps training time');
  const z=a.map(r=>{
    const features=Object.fromEntries(model.featureNames.map((n,i)=>[n,r.x[i]]));
    const p=Math.max(1e-6,Math.min(1-1e-6,rawProbability(model,features)));
    return {x:[Math.log(p/(1-p))],y:r.y};
  });
  return {schemaVersion:1,market:model.market,horizon:model.horizon,modelVersion:model.version,weights:fit(z,1,optimizer),calibratedThrough:cutoff,sampleCount:z.length,version:`${model.version}/platt-1`};
}
export function predictProbability(model,calibration,features,asOf) {
  if(t(model.trainedThrough)>=t(asOf)||!calibration||calibration.modelVersion!==model.version||calibration.market!==model.market||calibration.horizon!==model.horizon||t(calibration.calibratedThrough)>=t(asOf))throw Error('unavailable calibration at prediction time');
  const p=Math.max(1e-6,Math.min(1-1e-6,rawProbability(model,features)));
  return {probabilityUp:sigmoid(dot(calibration.weights,[1,Math.log(p/(1-p))])),calibrationVersion:calibration.version};
}
