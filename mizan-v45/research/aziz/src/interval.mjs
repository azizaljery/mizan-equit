// Rolling split conformal on matured out-of-training residuals. Optional weights are exploratory.
const stamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
function valid(rows,{asOf,market,horizon,issueType,minCount}) {
  const cutoff=stamp(asOf),seen=new Set(),out=[];
  for(const r of rows){
    if(r.market!==market||r.horizon!==horizon||r.issueType!==issueType)continue;
    if(seen.has(r.forecastId))throw Error('duplicate calibration forecast');seen.add(r.forecastId);
    if(stamp(r.availableAt)>cutoff||stamp(r.targetAt)>stamp(r.availableAt)||stamp(r.issuedAt)>=stamp(r.targetAt)||!r.outOfTraining)throw Error('future or in-sample calibration');
    if(!Number.isFinite(r.predictedLogReturn)||!Number.isFinite(r.realizedLogReturn)||!(r.scale>0)||!Number.isFinite(r.scale))throw Error('invalid calibration score');
    out.push({...r,score:Math.abs(r.realizedLogReturn-r.predictedLogReturn)/r.scale});
  }
  out.sort((a,b)=>stamp(a.availableAt)-stamp(b.availableAt));
  if(out.length<minCount)throw Error('insufficient calibration');
  return out;
}
export function calibrateInterval(rows,{asOf,market,horizon,issueType='bridge',alpha=.1,minCount=30,maxCount=300,weights=null,minEffective=20}={}) {
  if(!(alpha>0&&alpha<1)||!Number.isInteger(minCount)||minCount<1||!Number.isInteger(maxCount)||maxCount<minCount)throw Error('invalid interval policy');
  const a=valid(rows,{asOf,market,horizon,issueType,minCount}).slice(-maxCount),n=a.length;
  if(weights) {
    if(weights.length!==n||weights.some(w=>!Number.isFinite(w)||w<0))throw Error('invalid weights');
    const sum=weights.reduce((x,y)=>x+y,0),squares=weights.reduce((x,y)=>x+y*y,0),effective=sum*sum/squares;
    if(!Number.isFinite(effective)||effective<minEffective)throw Error('insufficient effective calibration');
    // Test mass 1: if target exceeds historical mass, the honest bound is infinity.
    const target=(1-alpha)*(sum+1),ordered=a.map((r,i)=>[r.score,weights[i]]).sort((x,y)=>x[0]-y[0]);let cumulative=0,quantile=Infinity;
    for(const [score,w] of ordered){cumulative+=w;if(cumulative>=target){quantile=score;break;}}
    return {quantile,effectiveCount:effective,count:n,alpha,method:'exploratory_weighted',coverageGuarantee:false,asOf,market,horizon,issueType};
  }
  const scores=a.map(r=>r.score).sort((x,y)=>x-y),index=Math.ceil((n+1)*(1-alpha))-1;
  return {quantile:index>=n?Infinity:scores[index],count:n,effectiveCount:n,alpha,method:'rolling_split',coverageGuarantee:false,asOf,market,horizon,issueType};
}
export function applyInterval(calibration,{currentPrice,predictedLogReturn,scale,asOf,market,horizon,issueType='bridge'}={}) {
  if(!(currentPrice>0&&scale>0&&Number.isFinite(predictedLogReturn))||stamp(asOf)<stamp(calibration.asOf)||market!==calibration.market||horizon!==calibration.horizon||issueType!==calibration.issueType)throw Error('invalid interval request');
  const w=calibration.quantile*scale;if(!Number.isFinite(w))return {status:'unavailable',reason:'unbounded_interval'};
  return {status:'available',lowerPrice:currentPrice*Math.exp(predictedLogReturn-w),upperPrice:currentPrice*Math.exp(predictedLogReturn+w),alpha:calibration.alpha,method:calibration.method,coverageGuarantee:false};
}
export function updateAci(state,{forecastId,targetAt,availableAt,covered}={}) {
  const t=stamp(availableAt);if(t<stamp(targetAt)||state.lastAvailableAt&&t<stamp(state.lastAvailableAt))throw Error('immature or unordered interval outcome');
  if(state.seenIds.includes(forecastId))return {state,applied:false};
  if(typeof covered!=='boolean'||!(state.gamma>0)||!(state.alpha>0&&state.alpha<1))throw Error('invalid ACI state');
  const next={...state,alpha:Math.max(state.minAlpha??.001,Math.min(state.maxAlpha??.999,state.alpha+state.gamma*(state.targetAlpha-(covered?0:1)))),lastAvailableAt:availableAt,seenIds:[...state.seenIds,forecastId]};
  return {state:next,applied:true};
}
