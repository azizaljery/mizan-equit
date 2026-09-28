// Gaussian BOCPD with fixed predictive variance; event multiplier is frozen upstream.
const finite=(x,name)=>{if(!Number.isFinite(x))throw Error(`invalid ${name}`);return x;};
const stamp=x=>{const n=Date.parse(x);if(!Number.isFinite(n)||!/(?:Z|[+-]\d\d:\d\d)$/.test(x))throw Error('invalid timestamp');return n;};
export function calendarHazard(baseHazard,events,asOf,multipliers={},market=null) {
  if(!(finite(baseHazard,'hazard')>0&&baseHazard<1))throw Error('invalid hazard');
  const now=stamp(asOf);let multiplier=1,types=[];
  for(const event of events??[]) {
    if(market && event?.market!==market)continue;
    if(!event||stamp(event.announcedAt)>now||stamp(event.availableAt)>now||!event.market||!event.type||!event.timeZone)throw Error('unknown or future event');
    if(stamp(event.eventAt)<now)continue;
    const m=multipliers[event.type]??1;if(!(finite(m,'multiplier')>=0))throw Error('invalid multiplier');
    multiplier*=m;types.push(event.type);
  }
  return {hazard:types.length?1-(1-baseHazard)**multiplier:baseHazard,eventTypes:types,usedCalendar:types.length>0};
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
export function fitCalendarMultipliers(observations,{market,cutoff,eventTypes,grid=[.5,1,2,4],regimeConfig={}}={}) {
  if(!['SA','US'].includes(market)||!Array.isArray(eventTypes)||new Set(eventTypes).size!==eventTypes.length||!grid.includes(1)||grid.some(x=>!Number.isFinite(x)||x<0))throw Error('invalid calendar training policy');
  const limit=stamp(cutoff),rows=observations.filter(r=>r.market===market).sort((a,b)=>stamp(a.availableAt)-stamp(b.availableAt));
  if(rows.length<30||rows.some(r=>stamp(r.availableAt)>limit||stamp(r.asOf)>stamp(r.availableAt)))throw Error('insufficient or future calendar training data');
  const score=multipliers=>{
    let state=newRegime(regimeConfig),logLikelihood=0;
    for(const r of rows){const {hazard}=calendarHazard(state.baseHazard,r.events,r.asOf,multipliers,market);state=updateRegime(state,{returnValue:r.returnValue,availableAt:r.availableAt,hazard});logLikelihood+=state.predictiveLogDensity;}
    return logLikelihood;
  };
  const multipliers={};let bestScore=score(multipliers);
  for(const type of eventTypes){let best=1;for(const candidate of grid){const proposal={...multipliers,[type]:candidate},value=score(proposal);if(value>bestScore+1e-9){bestScore=value;best=candidate;}}multipliers[type]=best;}
  return {market,trainedThrough:cutoff,multipliers,trainingLogLikelihood:bestScore,baselineLogLikelihood:score({}),method:'in_sample_grid_requires_external_validation'};
}
