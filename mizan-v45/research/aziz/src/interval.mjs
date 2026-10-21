// Rolling split conformal on matured out-of-training residuals. Optional weights are exploratory.
const stamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
// A calibration set is one forecasting task: symbol, market, horizon, issue type and model version.
// Any record outside the requested scope makes the whole request abstain (no silent pooling/filtering).
export const ISSUE_TYPES=Object.freeze(['direct','bridge_5_to_21']);
const SCOPE=['symbol','market','horizon','issueType','modelVersion'];
function scopeOf({symbol,market,horizon,issueType,modelVersion}) {
  if(![symbol,market,modelVersion].every(x=>typeof x==='string'&&x.trim())||!Number.isInteger(horizon)||horizon<=0||!ISSUE_TYPES.includes(issueType))throw Error('invalid calibration scope');
  return {symbol,market,horizon,issueType,modelVersion};
}
const mismatches=(rows,scope)=>SCOPE.filter(f=>rows.some(r=>r?.[f]!==scope[f]));
function valid(rows,{asOf,minCount}) {
  const cutoff=stamp(asOf),seen=new Set(),out=[];
  for(const r of rows){
    if(typeof r.forecastId!=='string'||!r.forecastId||seen.has(r.forecastId))throw Error('duplicate calibration forecast');seen.add(r.forecastId);
    if(stamp(r.availableAt)>cutoff||stamp(r.targetAt)>stamp(r.availableAt)||stamp(r.issuedAt)>=stamp(r.targetAt)||!r.outOfTraining)throw Error('future or in-sample calibration');
    if(!Number.isFinite(r.predictedLogReturn)||!Number.isFinite(r.realizedLogReturn)||!(r.scale>0)||!Number.isFinite(r.scale))throw Error('invalid calibration score');
    out.push({...r,score:Math.abs(r.realizedLogReturn-r.predictedLogReturn)/r.scale});
  }
  out.sort((a,b)=>stamp(a.availableAt)-stamp(b.availableAt));
  if(out.length<minCount)throw Error('insufficient calibration');
  return out;
}
export function calibrateInterval(rows,{asOf,symbol,market,horizon,issueType,modelVersion,alpha=.1,minCount=30,maxCount=300,weights=null,minEffective=20}={}) {
  if(!(alpha>0&&alpha<1)||!Number.isInteger(minCount)||minCount<1||!Number.isInteger(maxCount)||maxCount<minCount)throw Error('invalid interval policy');
  const scope=scopeOf({symbol,market,horizon,issueType,modelVersion}),head={asOf,...scope,alpha,coverageGuarantee:false};
  if(!Array.isArray(rows))throw Error('rows must be an array');
  const mixed=mismatches(rows,scope);
  if(mixed.length)return {...head,status:'abstained',reason:'mixed_calibration_scope',mismatchedFields:mixed,quantile:null,count:0};
  const a=valid(rows,{asOf,minCount}).slice(-maxCount),n=a.length;
  if(weights) {
    if(weights.length!==n||weights.some(w=>!Number.isFinite(w)||w<0))throw Error('invalid weights');
    const sum=weights.reduce((x,y)=>x+y,0),squares=weights.reduce((x,y)=>x+y*y,0),effective=sum*sum/squares;
    if(!Number.isFinite(effective)||effective<minEffective)throw Error('insufficient effective calibration');
    // Test mass 1: if target exceeds historical mass, the honest bound is infinite -> abstain.
    const target=(1-alpha)*(sum+1),ordered=a.map((r,i)=>[r.score,weights[i]]).sort((x,y)=>x[0]-y[0]);let cumulative=0,quantile=null;
    for(const [score,w] of ordered){cumulative+=w;if(cumulative>=target){quantile=score;break;}}
    const w={...head,effectiveCount:effective,count:n,method:'exploratory_weighted'};
    return quantile==null?{...w,status:'abstained',reason:'insufficient_finite_sample_rank',quantile:null}:{...w,status:'available',reason:null,quantile};
  }
  // k=ceil((n+1)(1-alpha)); k>n means no finite conformal bound. Never clamp k to n.
  const scores=a.map(r=>r.score).sort((x,y)=>x-y),rank=Math.ceil((n+1)*(1-alpha)),r={...head,count:n,effectiveCount:n,finiteSampleRank:rank,method:'rolling_split'};
  return rank>n?{...r,status:'abstained',reason:'insufficient_finite_sample_rank',quantile:null}:{...r,status:'available',reason:null,quantile:scores[rank-1]};
}
export function applyInterval(calibration,{currentPrice,predictedLogReturn,scale,asOf,...request}={}) {
  const scope=scopeOf(request);
  if(!(currentPrice>0&&scale>0&&Number.isFinite(predictedLogReturn))||stamp(asOf)<stamp(calibration.asOf)||mismatches([calibration],scope).length)throw Error('invalid interval request');
  if(calibration.status!=='available')return {status:'unavailable',reason:calibration.reason??'calibration_unavailable'};
  const w=calibration.quantile*scale;if(!Number.isFinite(w))return {status:'unavailable',reason:'unbounded_interval'};
  return {status:'available',lowerPrice:currentPrice*Math.exp(predictedLogReturn-w),upperPrice:currentPrice*Math.exp(predictedLogReturn+w),alpha:calibration.alpha,method:calibration.method,coverageGuarantee:false};
}
// ACI: one update per forecastId, and only once the outcome is available at the caller's clock asOf.
export function updateAci(state,{forecastId,targetAt,availableAt,covered}={},asOf) {
  if(typeof forecastId!=='string'||!forecastId)throw Error('invalid forecast id');
  const t=stamp(availableAt);if(t<stamp(targetAt))throw Error('immature or unordered interval outcome');
  if(asOf==null||t>stamp(asOf))throw Error('interval outcome not yet available');
  if(state.seenIds.includes(forecastId))return {state,applied:false,reason:'duplicate_forecast_id'};
  if(state.lastAvailableAt&&t<stamp(state.lastAvailableAt))throw Error('immature or unordered interval outcome');
  if(typeof covered!=='boolean'||!(state.gamma>0)||!(state.alpha>0&&state.alpha<1))throw Error('invalid ACI state');
  const next={...state,alpha:Math.max(state.minAlpha??.001,Math.min(state.maxAlpha??.999,state.alpha+state.gamma*(state.targetAlpha-(covered?0:1)))),lastAvailableAt:availableAt,seenIds:[...state.seenIds,forecastId]};
  return {state:next,applied:true};
}
