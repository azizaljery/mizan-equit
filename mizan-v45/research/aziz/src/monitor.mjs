// One stream per market, horizon and model version. Caller persists state atomically.
const timestamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
export function newMonitor({market,horizon,modelVersion,k,h,minOutcomes=20,recoveryCount=10,recoveryMaxBrier=.25}={}) {
  if(!['SA','US'].includes(market)||![5,21,63,126,252].includes(horizon)||!modelVersion||![k,h,recoveryMaxBrier].every(Number.isFinite)||!(k>0&&h>0&&recoveryMaxBrier>=0)||![minOutcomes,recoveryCount].every(x=>Number.isInteger(x)&&x>0))throw Error('invalid monitor policy');
  return {market,horizon,modelVersion,k,h,minOutcomes,recoveryCount,recoveryMaxBrier,status:'collecting',plus:0,minus:0,count:0,brierSum:0,recovery:[],seenIds:[],lastAvailableAt:null,alarms:0};
}
export function observeMonitor(state,event) {
  if(state.seenIds.includes(event.id))return {state,applied:false};
  const when=timestamp(event.availableAt);
  if(timestamp(event.targetAt)>when||timestamp(event.observedAt)>when||state.lastAvailableAt&&when<timestamp(state.lastAvailableAt))throw Error('immature or unordered observation');
  if(event.market!==state.market||event.horizon!==state.horizon||event.modelVersion!==state.modelVersion)throw Error('monitor scope mismatch');
  const {probabilityUp:p,actualUp:y}=event;
  if(!Number.isFinite(p)||p<0||p>1||![0,1].includes(y))throw Error('invalid probability outcome');
  const brier=(y-p)**2,e=y-p;
  const next={...state,seenIds:[...state.seenIds,event.id],lastAvailableAt:event.availableAt,count:state.count+1,brierSum:state.brierSum+brier,plus:Math.max(0,state.plus+e-state.k),minus:Math.max(0,state.minus-e-state.k)};
  if(state.status==='suspended'||state.status==='recovering') {
    next.recovery=[...state.recovery,brier].slice(-state.recoveryCount);
    next.status='recovering';
    if(next.recovery.length===state.recoveryCount&&next.recovery.reduce((a,b)=>a+b,0)/state.recoveryCount<=state.recoveryMaxBrier&&Math.max(next.plus,next.minus)<state.h) { next.status='normal';next.recovery=[]; }
  } else if(next.count<state.minOutcomes) next.status='collecting';
  else if(Math.max(next.plus,next.minus)>=state.h) {next.status='suspended';next.alarms=state.alarms+1;next.recovery=[];}
  else next.status='normal';
  return {state:next,applied:true};
}
