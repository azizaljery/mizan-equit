import type {Price} from './analysis';
import {conformalQuantile,eligibleHistory,type ConformalContext} from './forecast-conformal';

/**
 * FCST-0006 shadow range (never displayed, never changes the published range or direction).
 * R1: published centre +/- 1.28155 x HAR-log forecast of Parkinson range volatility for the horizon.
 * R2: R1 with each half-width multiplied by the exact-rank 80% conformal quantile of the resolved,
 *     non-overlapping R1 scores saved earlier for the same symbol/market/currency/model/horizon.
 * Constants are the preregistered ones (research/fcst0006/range-core.mjs); a test pins the two together.
 * Recorded only to compare interval scores prospectively. No coverage is promised.
 */
export const SHADOW_HAR_POLICY='mizan-shadow-har-r2-v1';
export const SHADOW_HAR_ALPHA=.2,SHADOW_HAR_Z=1.28155,SHADOW_HAR_MIN_TRAIN=500,SHADOW_HAR_PK_FLOOR=1e-8;
export const SHADOW_HAR_TARGET=.8,SHADOW_HAR_MIN_SAMPLE=30,SHADOW_HAR_HORIZONS=[1,5,21];
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const interval=(v:any):v is [number,number]=>Array.isArray(v)&&v.length===2&&positive(v[0])&&positive(v[1])&&v[0]<v[1];

export const parkinsonVariance=(high:number,low:number)=>Math.max(SHADOW_HAR_PK_FLOOR,Math.log(high/low)**2/(4*Math.LN2));

function solve(A:number[][],b:number[]):number[]|null {
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    if(Math.abs(M[p][c])<1e-12)return null;[M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<n;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
  }
  return M.map((r,i)=>r[n]/M[i][i]);
}

/** Direct log-HAR forecast of the h-session log-return standard deviation at the last index of v; targets fully realised only. */
export function harSigma(v:readonly number[],h:number):{sigma:number;train:number}|null {
  const n=v.length,t=n-1;if(t<21||!v.every(positive))return null;
  const pre=[0];for(let i=0;i<n;i++)pre.push(pre[i]+v[i]);
  const avg=(a:number,b:number)=>(pre[b+1]-pre[a])/(b-a+1);
  const x=(i:number)=>[1,Math.log(v[i]),Math.log(avg(i-4,i)),Math.log(avg(i-21,i))];
  const XtX=[0,1,2,3].map(()=>[0,0,0,0]),Xty=[0,0,0,0];let cnt=0,syy=0;
  for(let i=21;i+h<=t;i++){const xi=x(i),y=Math.log(avg(i+1,i+h));cnt++;syy+=y*y;
    for(let a=0;a<4;a++){Xty[a]+=xi[a]*y;for(let b=0;b<4;b++)XtX[a][b]+=xi[a]*xi[b];}}
  if(cnt<SHADOW_HAR_MIN_TRAIN)return null;
  const beta=solve(XtX,Xty);if(!beta)return null;
  let sse=syy;for(let a=0;a<4;a++){sse-=2*beta[a]*Xty[a];for(let b=0;b<4;b++)sse+=beta[a]*beta[b]*XtX[a][b];}
  const s2=Math.max(0,sse/Math.max(1,cnt-4)),pred=x(t).reduce((s,q,a)=>s+q*beta[a],0),varH=h*Math.exp(pred+s2/2);
  return positive(varH)?{sigma:Math.sqrt(varH),train:cnt}:null;
}

/** 1 at the bound, 0 at the centre; all arguments are prices, measured in log space. */
export function shadowScore(range:[number,number],centre:number,actual:number):number|null {
  if(!interval(range)||!positive(centre)||!positive(actual)||!(range[0]<centre&&centre<range[1]))return null;
  const lo=Math.log(range[0]),m=Math.log(centre),hi=Math.log(range[1]),y=Math.log(actual);
  const s=y>=m?(y-m)/(hi-m):(m-y)/(m-lo);
  return Number.isFinite(s)&&s>=0?s:null;
}

export type ShadowHarResult={
  policy:string;mode:'shadow';displayed:false;status:'r1'|'r2'|'unavailable';reason:string;
  alpha:number;targetCoverage:number;guaranteedCoverage:false;sigma:number|null;train:number|null;
  r1:[number,number]|null;r2:[number,number]|null;sample:number;minimumSample:number;quantile:number|null;
  calibratedAt:string;calibrationThrough:string|null;
};

export function shadowHarRange(forecast:any,prices:readonly Price[],records:any[],ctx:ConformalContext,options:{readError?:boolean}={}):ShadowHarResult {
  const base:ShadowHarResult={policy:SHADOW_HAR_POLICY,mode:'shadow',displayed:false,status:'unavailable',reason:'',alpha:SHADOW_HAR_ALPHA,
    targetCoverage:SHADOW_HAR_TARGET,guaranteedCoverage:false,sigma:null,train:null,r1:null,r2:null,sample:0,minimumSample:SHADOW_HAR_MIN_SAMPLE,
    quantile:null,calibratedAt:ctx.asOf,calibrationThrough:null};
  const fail=(reason:string):ShadowHarResult=>({...base,reason});
  if(ctx.recordClass!=='prospective-public'||!['sa','us'].includes(ctx.market)||!SHADOW_HAR_HORIZONS.includes(ctx.horizon))return fail('outside-scope');
  if(!forecast?.available||!positive(forecast.predictedPrice)||!interval(forecast.range)||forecast.sessions!==ctx.horizon||
    forecast.rangeMeaning!=='end_close_estimate'||typeof forecast.anchorDate!=='string')return fail('no-valid-centre');
  const used=prices.filter(p=>p.date<=forecast.anchorDate);
  if(!used.length||!used.every(p=>positive(p.high)&&positive(p.low)&&p.high>=p.low))return fail('invalid-high-low');
  const har=harSigma(used.map(p=>parkinsonVariance(p.high,p.low)),ctx.horizon);
  if(!har)return fail('insufficient-history');
  const c=forecast.predictedPrice,w=SHADOW_HAR_Z*har.sigma,r1:[number,number]=[c*Math.exp(-w),c*Math.exp(w)];
  if(!interval(r1))return fail('invalid-range');
  const withR1:ShadowHarResult={...base,status:'r1',reason:'collecting-calibration',sigma:har.sigma,train:har.train,r1};
  if(options.readError)return {...withR1,reason:'history-read-error'};
  const sample=eligibleHistory(records,ctx).map(r=>{const s=r.forecast.shadowHar;
    if(s?.policy!==SHADOW_HAR_POLICY||s.calibratedAt!==r.forecast.createdAt||!interval(s.r1))return null;
    const score=shadowScore(s.r1,r.forecast.predictedPrice,r.outcome.actualPrice);return score===null?null:{score,evaluatedAt:r.evaluated_at as string};
  }).filter((r):r is {score:number;evaluatedAt:string}=>r!==null);
  const counted={...withR1,sample:sample.length,calibrationThrough:sample.length?sample.reduce((a,r)=>a>r.evaluatedAt?a:r.evaluatedAt,''):null};
  if(sample.length<SHADOW_HAR_MIN_SAMPLE)return counted;
  const q=conformalQuantile(sample.map(r=>r.score),SHADOW_HAR_TARGET);
  if(!q||!positive(q.value))return {...counted,reason:'no-finite-quantile'};
  const r2:[number,number]=[c*Math.exp(-q.value*w),c*Math.exp(q.value*w)];
  if(!interval(r2))return {...counted,reason:'invalid-calibrated-range'};
  return {...counted,status:'r2',reason:'shadow',quantile:q.value,r2};
}

export type ShadowHarComparison={
  policy:string;alpha:number;
  baseline:{hit:boolean;widthLogPct:number;intervalScoreLogPct:number};
  r1:{hit:boolean;widthLogPct:number;intervalScoreLogPct:number};
  r2:{hit:boolean;widthLogPct:number;intervalScoreLogPct:number}|null;
};
function scoreLog(range:[number,number],actual:number){
  const lo=Math.log(range[0]),hi=Math.log(range[1]),y=Math.log(actual);
  return {hit:actual>=range[0]&&actual<=range[1],widthLogPct:100*(hi-lo),
    intervalScoreLogPct:100*((hi-lo)+2/SHADOW_HAR_ALPHA*(Math.max(0,lo-y)+Math.max(0,y-hi)))};
}
/** Scores only the ranges saved at issuance; never recomputes them with later information. */
export function evaluateShadowHar(forecast:any,actual:number):ShadowHarComparison|null {
  const s=forecast?.shadowHar;
  if(s?.policy!==SHADOW_HAR_POLICY||s.mode!=='shadow'||s.calibratedAt!==forecast.createdAt||!interval(s.r1)||!interval(forecast.range)||!positive(actual))return null;
  const result={policy:SHADOW_HAR_POLICY,alpha:SHADOW_HAR_ALPHA,baseline:scoreLog(forecast.range,actual),r1:scoreLog(s.r1,actual),
    r2:s.status==='r2'&&interval(s.r2)?scoreLog(s.r2,actual):null};
  const nums=[result.baseline,result.r1,result.r2].filter(Boolean).flatMap(x=>[x!.widthLogPct,x!.intervalScoreLogPct]);
  return nums.every(Number.isFinite)?result:null;
}
