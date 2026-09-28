// One research pipeline. Components remain separate so each output is auditable.
// No live reads, persistence or production routing.
import {buildBridgeInputs,predictCorrection,assessEligibility,assessRisk,selectEffectiveForecast} from './core.mjs';
import {predictProbability} from './probability.mjs';
import {applyInterval} from './interval.mjs';
import {calendarHazard} from './calendar-regime.mjs';
// Full 5/21-session research replay; separate from the existing remaining-16-session bridge.
export {runAzizHybridReplay,HYBRID_VERSION} from './hybrid-replay.mjs';

const time=x=>{const t=Date.parse(x);if(typeof x!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(t))throw Error('timestamp with timezone required');return t;};
const scoped=(item,input,versionField='version')=>item?.market===input.market&&item?.horizon===21&&!!item?.[versionField];

/**
 * An immutable original plus optional, explicitly versioned research evidence.
 * Unknown or absent components abstain; nothing switches the live forecast.
 */
export function runAzizResearch({base,snapshot,bridge,direction,calibration,interval,
  kalmanState=null,monitor=null,policy=null,facts=null,exposure=null,
  regime=null,events=[],calendarMultipliers=null}={}) {
  const input=buildBridgeInputs(snapshot,base),issued=time(input.asOf);
  const components={bridge:'unavailable',probability:'unavailable',interval:'unavailable',regime:'unavailable'};
  let candidate=null,probabilityUp=null,range=null,calendar=null;
  if(bridge) {
    if(!scoped(bridge,input)||time(bridge.trainedThrough)>=issued)throw Error('bridge scope or availability mismatch');
    candidate=predictCorrection(input,bridge,kalmanState);
    components.bridge=candidate.status;
  }
  if(candidate?.status==='corrected'&&direction&&calibration) {
    if(!scoped(direction,input)||time(direction.trainedThrough)>=issued
      ||calibration.market!==input.market||calibration.horizon!==21)throw Error('probability scope mismatch');
    const features={earlyError:input.earlyError,baselineRemainingLogReturn:input.baselineRemainingLogReturn,
      kalmanMean:kalmanState?.mean,kalmanVariance:kalmanState?.variance,...input.context};
    probabilityUp=predictProbability(direction,calibration,features,input.asOf).probabilityUp;
    components.probability='available';
  }
  if(candidate?.status==='corrected'&&interval) {
    if(interval.market!==input.market||interval.horizon!==21)throw Error('interval scope mismatch');
    const scale=interval.scale;
    if(!(Number.isFinite(scale)&&scale>0))throw Error('interval scale missing');
    range=applyInterval(interval,{currentPrice:input.currentPrice,
      predictedLogReturn:candidate.remainingLogReturn,scale,asOf:input.asOf,market:input.market,horizon:21});
    components.interval=range.status;
  }
  if(regime) {
    if(regime.market!==input.market||time(regime.lastAvailableAt)>issued)throw Error('regime scope or availability mismatch');
    if(calendarMultipliers&&(calendarMultipliers.market!==input.market||time(calendarMultipliers.trainedThrough)>=issued))throw Error('calendar artifact unavailable');
    calendar=calendarHazard(regime.baseHazard,events,input.asOf,calendarMultipliers?.multipliers??{},input.market);
    components.regime='available';
  }
  if(monitor&&(monitor.market!==input.market||monitor.horizon!==21||monitor.modelVersion!==bridge?.version
    ||monitor.lastAvailableAt&&time(monitor.lastAvailableAt)>issued))throw Error('monitor scope or availability mismatch');
  const eligibility=policy&&facts?assessEligibility(policy,facts):{status:'unknown',reasons:['missing_policy_or_facts']};
  const risk=assessRisk(candidate?.status==='corrected'?candidate:null,exposure);
  const shadow=candidate?.status==='corrected'?Object.freeze({...candidate,probabilityUp,range}):candidate;
  const route=selectEffectiveForecast(base,shadow,monitor,'SHADOW');
  return Object.freeze({algorithm:'AZIZ-research/0.3',market:input.market,baseForecastId:base.id,
    asOf:input.asOf,targetAt:input.targetAt,original:base,shadow:route.shadow,
    effective:route.effective,route:route.route,components,eligibility,risk,
    calendar,monitorStatus:monitor?.status??'unavailable'});
}
