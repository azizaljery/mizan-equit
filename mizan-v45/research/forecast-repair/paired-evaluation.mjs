// Evaluate ALREADY ISSUED forward observations, never create or backdate forecasts.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const quantile=(xs,p)=>{const a=[...xs].sort((a,b)=>a-b),i=(a.length-1)*p,l=Math.floor(i);return a[l]+(a[Math.ceil(i)]-a[l])*(i-l);};
function seedRandom(seed){let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
export function aggregateIssuedPairs(rows){
 const groups=new Map(),seen=new Set();
 for(const r of rows){
  if(!r.forecastId||seen.has(r.forecastId))throw Error('Duplicate or missing forecast identity; resolve outcome revisions at a fixed cutoff before scoring');seen.add(r.forecastId);
  const issue=Date.parse(r.issuedAt),data=Date.parse(r.dataAsOf),target=Date.parse(r.targetCloseAt),outcome=Date.parse(r.outcomeReceivedAt);
  if(![issue,data,target,outcome].every(Number.isFinite)||data>issue||target<=issue||outcome<target||r.kind!=='forward_issued')throw Error('Invalid knowledge or maturity times / forward evidence kind');
  if(!r.market||!r.symbol||!Number.isInteger(r.horizon)||r.horizon<1||r.horizon>252||r.priceBasis!==r.outcomePriceBasis||r.modelVersion!==rows[0].modelVersion||r.market!==rows[0].market||r.horizon!==rows[0].horizon)throw Error('Mixed scope or incompatible price basis');
  if(![r.referencePrice,r.predictedPrice,r.baselinePrice,r.actualPrice].every(x=>finite(x)&&x>0))throw Error('Invalid issued price');
  if(!r.sourceEvidenceId)throw Error('Source evidence identity required');
  const y=Math.log(r.actualPrice/r.referencePrice),mu=Math.log(r.predictedPrice/r.referencePrice),baseline=Math.log(r.baselinePrice/r.referencePrice);
  const gain=Math.abs(y-baseline)-Math.abs(y-mu),date=new Date(issue).toISOString().slice(0,10);
  if(!groups.has(date))groups.set(date,[]);groups.get(date).push(gain);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,gains])=>({date,count:gains.length,gain:gains.reduce((a,b)=>a+b,0)/gains.length}));
}
export function pairedBlockEvaluation(rows,protocol){
 const {deltaMAE,alphaSig,powerPlan,minDates,blockLength,replicates=2000,seed=20261026,protocolHash,cutoffAt}=protocol??{};
 if(!finite(deltaMAE)||deltaMAE<0||!(alphaSig>0&&alphaSig<1)||!powerPlan||!protocolHash||!Number.isFinite(Date.parse(cutoffAt))||!Number.isInteger(minDates)||minDates<2||!Number.isInteger(blockLength)||blockLength<1||!Number.isInteger(replicates)||replicates<100)throw Error('Frozen protocol, economic threshold, power plan and cutoff required');
 if(rows.some(r=>Date.parse(r.outcomeReceivedAt)>Date.parse(cutoffAt)))throw Error('Outcome after report cutoff');
 const dates=aggregateIssuedPairs(rows),n=dates.length;
 if(n<minDates||blockLength>n)return {decision:'INCONCLUSIVE',reason:'Insufficient dates for frozen plan',dates:n,rows:rows.length,protocolHash};
 const values=dates.map(x=>x.gain),mean=values.reduce((a,b)=>a+b,0)/n,rng=seedRandom(seed||1),samples=[];
 // Circular moving blocks: preserves within-block date dependence; test across block lengths separately.
 for(let b=0;b<replicates;b++){const sample=[];while(sample.length<n){const start=Math.floor(rng()*n);for(let j=0;j<blockLength&&sample.length<n;j++)sample.push(values[(start+j)%n]);}samples.push(sample.reduce((a,b)=>a+b,0)/n);}
 const ci=[quantile(samples,alphaSig/2),quantile(samples,1-alphaSig/2)];
 return {decision:ci[0]>deltaMAE?'SHADOW_EVIDENCE_REVIEW':ci[1]<deltaMAE?'BELOW_PRACTICAL_THRESHOLD':'INCONCLUSIVE',meanGainLog:mean,deltaMAE,ci,dates:n,rows:rows.length,blockLength,replicates,seed,protocolHash,cutoffAt,
  productionApproved:false,note:'Statistical evidence for the supplied cohort only; no causal, economic-return or universal power guarantee. Check missing issues, abstentions, provenance and protocol multiplicity separately.'};
}
