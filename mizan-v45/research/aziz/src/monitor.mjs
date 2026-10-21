// The single CUSUM/Brier monitor (core.mjs re-exports it). One stream per market, horizon and model version.
// Caller persists state atomically. Each outcome is keyed by eventKey = forecastId (or id) @ targetAt, so a
// re-delivered outcome (even under a new delivery id) is a no-op; the same key with different content throws.
// Alarms are never silently cleared: a new crossing of h while recovering re-suspends and is logged, and the
// alarm/recovery history survives a return to 'normal'. plus/minus are never zeroed as a side effect.
const timestamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n))throw Error('invalid timestamp');return n;};
export const monitorEventKey=e=>{const id=e?.forecastId??e?.id;if(typeof id!=='string'||!id)throw Error('missing monitor event id');return `${id}@${timestamp(e.targetAt)}`;};
export function newMonitor({market,horizon,modelVersion,k,h,minOutcomes=20,recoveryCount=10,recoveryMaxBrier=.25}={}) {
  if(!['SA','US'].includes(market)||![5,21,63,126,252].includes(horizon)||!modelVersion||![k,h,recoveryMaxBrier].every(Number.isFinite)||!(k>0&&h>0&&recoveryMaxBrier>=0)||![minOutcomes,recoveryCount].every(x=>Number.isInteger(x)&&x>0))throw Error('invalid monitor policy');
  return {market,horizon,modelVersion,k,h,minOutcomes,recoveryCount,recoveryMaxBrier,status:'collecting',plus:0,minus:0,count:0,brierSum:0,recovery:[],seenIds:[],fingerprints:{},lastAvailableAt:null,alarms:0,alarmLog:[],recoveryLog:[]};
}
export function observeMonitor(state,event) {
  const key=monitorEventKey(event),{probabilityUp:p,actualUp:y}=event,print=`${p}|${y}|${timestamp(event.availableAt)}`;
  if(state.seenIds.includes(key)){if((state.fingerprints??{})[key]!==undefined&&state.fingerprints[key]!==print)throw Error('conflicting duplicate monitor event');return {state,applied:false,reason:'duplicate_event'};}
  const when=timestamp(event.availableAt);
  if(timestamp(event.targetAt)>when||timestamp(event.observedAt)>when||state.lastAvailableAt&&when<timestamp(state.lastAvailableAt))throw Error('immature or unordered observation');
  if(event.market!==state.market||event.horizon!==state.horizon||event.modelVersion!==state.modelVersion)throw Error('monitor scope mismatch');
  if(!Number.isFinite(p)||p<0||p>1||![0,1].includes(y))throw Error('invalid probability outcome');
  const brier=(y-p)**2,e=y-p,wasAlarm=Math.max(state.plus,state.minus)>=state.h;
  const next={...state,seenIds:[...state.seenIds,key],fingerprints:{...(state.fingerprints??{}),[key]:print},lastAvailableAt:event.availableAt,count:state.count+1,brierSum:state.brierSum+brier,plus:Math.max(0,state.plus+e-state.k),minus:Math.max(0,state.minus-e-state.k)};
  const alarm=Math.max(next.plus,next.minus)>=state.h,raise=()=>{next.status='suspended';next.alarms=state.alarms+1;next.recovery=[];next.alarmLog=[...(state.alarmLog??[]),{eventKey:key,availableAt:event.availableAt,plus:next.plus,minus:next.minus}];};
  if(state.status==='suspended'||state.status==='recovering') {
    if(alarm&&!wasAlarm) raise(); // new crossing during recovery: not swallowed
    else {
      next.recovery=[...state.recovery,brier].slice(-state.recoveryCount);next.status='recovering';
      if(!alarm&&next.recovery.length===state.recoveryCount&&next.recovery.reduce((a,b)=>a+b,0)/state.recoveryCount<=state.recoveryMaxBrier) {next.status='normal';next.recovery=[];next.recoveryLog=[...(state.recoveryLog??[]),{eventKey:key,availableAt:event.availableAt,afterAlarm:state.alarms}];}
    }
  } else if(next.count<state.minOutcomes) next.status='collecting';
  else if(alarm) raise();
  else next.status='normal';
  return {state:next,applied:true};
}
