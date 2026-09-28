// Horizon choice on matured validation predictions. Shared-date resampling preserves cross-symbol dependence.
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
function rng(seed){let x=seed>>>0;return ()=>((x=(1664525*x+1013904223)>>>0)/4294967296);}
export function selectHorizon(validation,{cutoff,minRows=30,draws=500,blockDays=10,seed=1,confidence=.95}={}) {
  if(!Number.isInteger(draws)||draws<100||!Number.isInteger(blockDays)||blockDays<1||!(confidence>0&&confidence<1))throw Error('invalid bootstrap policy');
  const stop=Date.parse(cutoff),groups=new Map();
  for(const r of validation){
    if(![5,21,63,126,252].includes(r.horizon)||!r.outOfTraining||Date.parse(r.availableAt)>stop||Date.parse(r.targetAt)>Date.parse(r.availableAt)||![r.probability,r.referenceProbability].every(p=>Number.isFinite(p)&&p>=0&&p<=1)||![0,1].includes(r.actualUp))throw Error('invalid validation row');
    const a=groups.get(r.horizon)??[];a.push(r);groups.set(r.horizon,a);
  }
  const rand=rng(seed),ranking=[];
  for(const [h,rows] of groups){if(rows.length<minRows)continue;
    const days=new Map();for(const r of rows){const day=r.asOf.slice(0,10),a=days.get(day)??[];a.push(r);days.set(day,a);}
    const dates=[...days.keys()].sort(),blockCount=Math.ceil(dates.length/blockDays),skills=[];
    const skill=sample=>{const m=avg(sample.map(r=>(r.actualUp-r.probability)**2)),b=avg(sample.map(r=>(r.actualUp-r.referenceProbability)**2));return b>0?1-m/b:null;};
    for(let j=0;j<draws;j++) {const sampled=[];for(let b=0;b<blockCount;b++){const start=Math.floor(rand()*dates.length);for(let k=0;k<blockDays;k++)sampled.push(...days.get(dates[(start+k)%dates.length]));}const s=skill(sampled);if(s!==null)skills.push(s);}
    skills.sort((a,b)=>a-b);const lower=skills.length?skills[Math.floor(skills.length*(1-confidence))]:null;
    ranking.push({horizon:h,rows:rows.length,skill:skill(rows),lowerBound:lower});
  }
  ranking.sort((a,b)=>(b.lowerBound??-Infinity)-(a.lowerBound??-Infinity));
  // This is exploratory: simultaneous family-wise confidence correction is not implemented.
  return {preferred:ranking[0]?.lowerBound>0?ranking[0].horizon:null,ranking,coverage:ranking.length/groups.size||0,confidence,simultaneous:false};
}
