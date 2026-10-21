// Gaussian BOCPD with fixed predictive variance; event multiplier is frozen upstream.
const finite=(x,name)=>{if(!Number.isFinite(x))throw Error(`invalid ${name}`);return x;};
const stamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(x))throw Error('invalid timestamp');return n;};
// Proximity window: an event counts only if asOf <= eventAt <= windowEnd. windowEnd is the
// forecast targetAt when supplied, otherwise asOf + windowDays. Default 31 calendar days ~= the
// 21-session target horizon; a far-dated announced event (e.g. 2040) does not move the hazard.
// Event identity is event.id, else market|type|eventAt; a repeated identity is counted once.
export const CALENDAR_WINDOW_DAYS=31;
const eventKey=e=>e.id!=null?`id:${e.id}`:`${e.market}|${e.type}|${stamp(e.eventAt)}`;
export function calendarHazard(baseHazard,events,asOf,multipliers={},market=null,{targetAt=null,windowDays=CALENDAR_WINDOW_DAYS}={}) {
  if(!(finite(baseHazard,'hazard')>0&&baseHazard<1))throw Error('invalid hazard');
  if(!(Number.isFinite(windowDays)&&windowDays>0))throw Error('invalid calendar window');
  const now=stamp(asOf),end=targetAt!=null?stamp(targetAt):now+windowDays*864e5;if(!(end>now))throw Error('invalid calendar window');
  let multiplier=1;const types=[],ids=[],seen=new Map(),skipped={outOfWindow:0,duplicate:0};
  for(const event of events??[]) {
    if(market && event?.market!==market)continue;
    if(!event||stamp(event.announcedAt)>now||stamp(event.availableAt)>now||!event.market||!event.type||!event.timeZone)throw Error('unknown or future event');
    const at=stamp(event.eventAt),key=eventKey(event),sig=`${event.market}|${event.type}|${at}`;
    if(seen.has(key)){if(seen.get(key)!==sig)throw Error('conflicting calendar event id');skipped.duplicate++;continue;}
    seen.set(key,sig);
    if(at<now)continue;
    if(at>end){skipped.outOfWindow++;continue;}
    const m=multipliers[event.type]??1;if(!(finite(m,'multiplier')>=0))throw Error('invalid multiplier');
    multiplier*=m;types.push(event.type);ids.push(key);
  }
  return {hazard:types.length?1-(1-baseHazard)**multiplier:baseHazard,eventTypes:types,eventIds:ids,skipped,windowEnd:new Date(end).toISOString(),usedCalendar:types.length>0};
}
const normal=(x,mu,v)=>Math.exp(-.5*(x-mu)**2/v)/Math.sqrt(2*Math.PI*v);
export function newRegime({baseHazard=.02,priorMean=0,priorVariance=.01,observationVariance=.01,maxRunLength=512}={}) {
  if(!(baseHazard>0&&baseHazard<1&&priorVariance>0&&observationVariance>0&&Number.isInteger(maxRunLength)&&maxRunLength>=2))throw Error('invalid regime config');
  return {baseHazard,priorMean,priorVariance,observationVariance,maxRunLength,probabilities:[1],means:[priorMean],variances:[priorVariance],lastAvailableAt:null};
}
export function updateRegime(state,{returnValue,availableAt,hazard}={}) {
  const when=stamp(availableAt);if(state.lastAvailableAt&&when<=stamp(state.lastAvailableAt))throw Error('unordered regime observation');
  finite(returnValue,'return');const h=hazard??state.baseHazard;if(!(finite(h,'hazard')>=0&&h<=1))throw Error('invalid hazard');
  const n=state.probabilities.length,next=Array(Math.min(n+1,state.maxRunLength+1)).fill(0),means=Array(next.length),variances=Array(next.length);
  // A new run predicts from the prior, whereas continuing runs predict from their own posterior.
  // Using the same likelihood for both branches makes the change probability equal the hazard.
  let change=normal(returnValue,state.priorMean,state.priorVariance+state.observationVariance)*h;
  for(let i=0;i<n;i++) {const mass=state.probabilities[i]*normal(returnValue,state.means[i],state.variances[i]+state.observationVariance);if(i+1<next.length)next[i+1]+=mass*(1-h);else next[next.length-1]+=mass*(1-h);}
  next[0]=change;const z=next.reduce((a,b)=>a+b,0);if(!(z>0))throw Error('degenerate regime update');for(let i=0;i<next.length;i++)next[i]/=z;
  means[0]=state.priorMean;variances[0]=state.priorVariance;
  for(let i=1;i<next.length;i++) {const old=Math.min(i-1,n-1),v=state.variances[old],k=v/(v+state.observationVariance);means[i]=state.means[old]+k*(returnValue-state.means[old]);variances[i]=(1-k)*v;}
  return {...state,probabilities:next,means,variances,lastAvailableAt:availableAt,changeProbability:next[0],predictiveLogDensity:Math.log(z)};
}
export function fitCalendarMultipliers(observations,{market,cutoff,eventTypes,grid=[.5,1,2,4],regimeConfig={},windowDays=CALENDAR_WINDOW_DAYS}={}) {
  if(!['SA','US'].includes(market)||!Array.isArray(eventTypes)||new Set(eventTypes).size!==eventTypes.length||!grid.includes(1)||grid.some(x=>!Number.isFinite(x)||x<0))throw Error('invalid calendar training policy');
  const limit=stamp(cutoff),rows=observations.filter(r=>r.market===market).sort((a,b)=>stamp(a.availableAt)-stamp(b.availableAt));
  if(rows.length<30||rows.some(r=>stamp(r.availableAt)>limit||stamp(r.asOf)>stamp(r.availableAt)))throw Error('insufficient or future calendar training data');
  const score=multipliers=>{
    let state=newRegime(regimeConfig),logLikelihood=0;
    for(const r of rows){const {hazard}=calendarHazard(state.baseHazard,r.events,r.asOf,multipliers,market,{targetAt:r.targetAt??null,windowDays});state=updateRegime(state,{returnValue:r.returnValue,availableAt:r.availableAt,hazard});logLikelihood+=state.predictiveLogDensity;}
    return logLikelihood;
  };
  const multipliers={};let bestScore=score(multipliers);
  for(const type of eventTypes){let best=1;for(const candidate of grid){const proposal={...multipliers,[type]:candidate},value=score(proposal);if(value>bestScore+1e-9){bestScore=value;best=candidate;}}multipliers[type]=best;}
  return {market,trainedThrough:cutoff,multipliers,trainingLogLikelihood:bestScore,baselineLogLikelihood:score({}),method:'in_sample_grid_requires_external_validation'};
}
