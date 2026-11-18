/**
 * Does adding macro series to price features add information about the next 5/21 days? A walk-forward test with a declared design, nothing tuned to the answer.
 * Design: rows are sampled every 5 sessions; dates are split in time order (first 60% train, last 40% test, with a purge gap of one horizon); three predictors
 * (train base rate, price-only logistic, price+macro logistic, all on the same rows); Brier score on the test dates; a paired date-block bootstrap for the differences.
 * Pure and deterministic (seeded). Research only: it feeds no forecast, score or decision.
 */
import type {Price} from '../analysis';

export const BACKTEST_PARAMS=Object.freeze({sampleEvery:5,trainFrac:0.6,ridge:1,blockDates:4,bootstrap:600,seed:20261118,macroLagDays:1,macroLookback:20,startDate:'2024-12-20'});
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

export type MacroObs={date:string;value:number};
export type MacroFeatureSpec={id:string;kind:'pct'|'diff';label:string};
export const MACRO_FEATURES:MacroFeatureSpec[]=[
 {id:'YH:^VIX',kind:'pct',label:'تغير VIX'},{id:'YH:^TNX',kind:'diff',label:'تغير عائد 10 سنوات'},{id:'YH:^IRX',kind:'diff',label:'تغير عائد 13 أسبوعًا'},
 {id:'NYFED:EFFR',kind:'diff',label:'تغير الفائدة الفعلية'},{id:'YH:BZ=F',kind:'pct',label:'تغير برنت'},{id:'YH:DX-Y.NYB',kind:'pct',label:'تغير الدولار'},
];
export const PRICE_FEATURES=['زخم 20 جلسة','زخم 60 جلسة','البعد عن المتوسط 50','تذبذب 20 جلسة'];

/** Change of a macro series as known on `date`: the last observation dated at least `lagDays` before it, against the observation `lookback` observations earlier. No later data is read. */
export function macroChange(obs:MacroObs[],date:string,kind:'pct'|'diff',lagDays=BACKTEST_PARAMS.macroLagDays,lookback=BACKTEST_PARAMS.macroLookback):number|null{
 const cut=new Date(Date.parse(date+'T00:00:00Z')-lagDays*86400000).toISOString().slice(0,10);
 let lo=0,hi=obs.length-1,idx=-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(obs[mid].date<=cut){idx=mid;lo=mid+1;}else hi=mid-1;}
 if(idx<lookback)return null;
 const a=obs[idx].value,b=obs[idx-lookback].value;if(!fin(a)||!fin(b))return null;
 if(kind==='pct')return b!==0?a/b-1:null;
 return a-b;
}
/** Features known at session index i (data up to and including i). */
export function priceFeatures(prices:Price[],i:number):number[]|null{
 if(i<60)return null;
 const c=prices.map(p=>p.close);
 for(let k=i-60;k<=i;k++)if(!(c[k]>0))return null;
 let s=0;for(let k=i-49;k<=i;k++)s+=c[k];
 const rets:number[]=[];for(let k=i-19;k<=i;k++)rets.push(c[k]/c[k-1]-1);
 const m=rets.reduce((a,b)=>a+b,0)/rets.length,sd=Math.sqrt(rets.reduce((a,b)=>a+(b-m)**2,0)/rets.length);
 return [c[i]/c[i-20]-1,c[i]/c[i-60]-1,c[i]/(s/50)-1,sd];
}
export type Row={s:string;d:string;x:number[];y5:0|1|null;y21:0|1|null};
/** One symbol's sample rows: every `sampleEvery`-th session from startDate, with outcomes only when the future bar exists. Rows with a missing feature are skipped, never filled. */
export function buildRows(symbol:string,prices:Price[],macro:Record<string,MacroObs[]>,specs:MacroFeatureSpec[],p=BACKTEST_PARAMS):Row[]{
 const out:Row[]=[];
 for(let i=60;i<prices.length;i++){
  const d=prices[i].date;if(d<p.startDate||(i-60)%p.sampleEvery!==0)continue;
  const pf=priceFeatures(prices,i);if(!pf)continue;
  const mf:number[]=[];let ok=true;
  for(const sp of specs){const v=macroChange(macro[sp.id]||[],d,sp.kind);if(v===null){ok=false;break;}mf.push(v);}
  if(!ok)continue;
  const y=(h:number):0|1|null=>i+h<prices.length&&prices[i].close>0&&prices[i+h].close>0?(prices[i+h].close>prices[i].close?1:0):null;
  out.push({s:symbol,d,x:[...pf,...mf],y5:y(5),y21:y(21)});
 }
 return out;
}

/** Ridge logistic regression by Newton steps on standardised features. Deterministic. */
export function fitLogistic(X:number[][],y:number[],ridge=BACKTEST_PARAMS.ridge){
 const n=X.length,k=X[0]?.length??0;
 const mean=Array(k).fill(0),sd=Array(k).fill(1);
 for(let j=0;j<k;j++){let m=0;for(const r of X)m+=r[j];m/=n;let v=0;for(const r of X)v+=(r[j]-m)**2;mean[j]=m;sd[j]=Math.sqrt(v/n)||1;}
 const Z=X.map(r=>[1,...r.map((v,j)=>(v-mean[j])/sd[j])]);
 let w=Array(k+1).fill(0);
 for(let it=0;it<25;it++){
  const g=Array(k+1).fill(0),H=Array.from({length:k+1},()=>Array(k+1).fill(0));
  for(let i=0;i<n;i++){
   const z=Z[i];let t=0;for(let j=0;j<=k;j++)t+=w[j]*z[j];const p=1/(1+Math.exp(-t)),r=y[i]-p,q=p*(1-p);
   for(let a=0;a<=k;a++){g[a]+=r*z[a];for(let b=0;b<=k;b++)H[a][b]+=q*z[a]*z[b];}
  }
  for(let a=1;a<=k;a++){g[a]-=ridge*w[a];H[a][a]+=ridge;}
  H[0][0]+=1e-9;
  const step=solve(H,g);if(!step)break;
  let mx=0;for(let a=0;a<=k;a++){w[a]+=step[a];mx=Math.max(mx,Math.abs(step[a]));}
  if(mx<1e-8)break;
 }
 return {mean,sd,w,predict:(x:number[])=>{let t=w[0];for(let j=0;j<k;j++)t+=w[j+1]*(x[j]-mean[j])/sd[j];return 1/(1+Math.exp(-t));}};
}
function solve(A:number[][],b:number[]):number[]|null{
 const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  if(Math.abs(M[p][c])<1e-12)return null;
  [M[c],M[p]]=[M[p],M[c]];
  for(let r=c+1;r<n;r++){const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
 }
 const x=Array(n).fill(0);
 for(let r=n-1;r>=0;r--){let s=M[r][n];for(let k=r+1;k<n;k++)s-=M[r][k]*x[k];x[r]=s/M[r][r];}
 return x;
}
function rng(seed:number){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const brier=(p:number,y:number)=>(p-y)**2;

export type Diff={mean:number;lo:number;hi:number;excludesZero:boolean};
export type Analysis={status:'ok';horizon:5|21;rows:number;dates:number;trainDates:number;testDates:number;testRows:number;baseRate:number;
 accuracy:{base:number;price:number;full:number};brier:{base:number;price:number;full:number};
 macroVsPrice:Diff;fullVsBase:Diff;priceVsBase:Diff;addsInformation:boolean;coefficients:{name:string;weight:number}[]}|{status:'insufficient';reason:string};
/** Negative Brier difference (a minus b) means a is better. All three models are scored on the same test rows. */
export function analyze(rows:Row[],horizon:5|21,macroNames:string[],p=BACKTEST_PARAMS):Analysis{
 const key=horizon===5?'y5':'y21';
 const R=rows.filter(r=>r[key]!==null);
 const dates=[...new Set(R.map(r=>r.d))].sort();
 if(dates.length<40||R.length<400)return {status:'insufficient',reason:`العينة صغيرة: ${R.length} صفًا و${dates.length} تاريخًا (المطلوب 400 و40 على الأقل).`};
 const cut=Math.floor(dates.length*p.trainFrac),gap=Math.ceil(horizon/p.sampleEvery)+1;
 const trainSet=new Set(dates.slice(0,cut)),testSet=new Set(dates.slice(cut+gap));
 const tr=R.filter(r=>trainSet.has(r.d)),te=R.filter(r=>testSet.has(r.d));
 if(tr.length<200||te.length<100)return {status:'insufficient',reason:'التقسيم الزمني ترك تدريبًا أو اختبارًا صغيرًا.'};
 const nP=PRICE_FEATURES.length,yv=(r:Row)=>r[key] as number;
 const base=tr.reduce((s,r)=>s+yv(r),0)/tr.length;
 const mP=fitLogistic(tr.map(r=>r.x.slice(0,nP)),tr.map(yv)),mF=fitLogistic(tr.map(r=>r.x),tr.map(yv));
 const pb=te.map(()=>base),pp=te.map(r=>mP.predict(r.x.slice(0,nP))),pf=te.map(r=>mF.predict(r.x));
 const acc=(ps:number[])=>te.reduce((s,r,i)=>s+((ps[i]>=0.5?1:0)===yv(r)?1:0),0)/te.length;
 const br=(ps:number[])=>te.reduce((s,r,i)=>s+brier(ps[i],yv(r)),0)/te.length;
 // paired block bootstrap over test dates
 const tDates=[...testSet].sort(),byDate=new Map<string,number[]>();te.forEach((r,i)=>{if(!byDate.has(r.d))byDate.set(r.d,[]);byDate.get(r.d)!.push(i);});
 const dsum=(a:number[],b:number[])=>tDates.map(d=>{let s=0,c=0;for(const i of byDate.get(d)||[]){s+=brier(a[i],yv(te[i]))-brier(b[i],yv(te[i]));c++;}return [s,c] as [number,number];});
 const pairs={mp:dsum(pf,pp),fb:dsum(pf,pb),pb:dsum(pp,pb)};
 const rand=rng(p.seed),B=p.bootstrap,bl=p.blockDates,nd=tDates.length;
 const boot=(d:[number,number][])=>{
  const est:number[]=[];
  for(let b=0;b<B;b++){let s=0,c=0,got=0;while(got<nd){const st=Math.floor(rand()*nd);for(let k=0;k<bl&&got<nd;k++,got++){const q=d[(st+k)%nd];s+=q[0];c+=q[1];}}est.push(c?s/c:0);}
  est.sort((a,b)=>a-b);
  const mean=d.reduce((s,q)=>s+q[0],0)/d.reduce((s,q)=>s+q[1],0),lo=est[Math.floor(0.025*B)],hi=est[Math.ceil(0.975*B)-1];
  return {mean,lo,hi,excludesZero:lo>0||hi<0};
 };
 const mp=boot(pairs.mp),fb=boot(pairs.fb),pbd=boot(pairs.pb);
 const names=[...PRICE_FEATURES,...macroNames];
 return {status:'ok',horizon,rows:R.length,dates:dates.length,trainDates:trainSet.size,testDates:tDates.length,testRows:te.length,baseRate:base,
  accuracy:{base:acc(pb),price:acc(pp),full:acc(pf)},brier:{base:br(pb),price:br(pp),full:br(pf)},
  macroVsPrice:mp,fullVsBase:fb,priceVsBase:pbd,
  addsInformation:mp.hi<0&&fb.hi<0,   // macro must beat price-only AND the full model must beat the base rate, both with the whole interval below zero
  coefficients:names.map((name,j)=>({name,weight:mF.w[j+1]}))};
}

/** Declared test universe: fixed before any result was seen. */
export const UNIVERSE=['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','JPM','V','MA','UNH','JNJ','PG','XOM','CVX','HD','KO','PEP','ABBV','MRK','LLY','AVGO','COST','WMT','BAC','WFC','CSCO','ORCL','ADBE','CRM','NFLX','AMD','INTC','QCOM','TXN','CAT','BA','GE','MMM','HON','IBM','DIS','NKE','MCD','SBUX','T','VZ','PFE','LIN','NEE'] as const;
