/**
 * Descriptive technical indicators from the book's technical chapters: OBV, Stochastic, Ichimoku, Fibonacci retracement.
 * Pure functions over OHLCV bars. They feed no score, forecast or decision (shadow/observation only) until measured out of sample.
 * Warm-up positions are null (never filled); an undefined ratio (flat range) is null, not an invented 50.
 */
import type {Price} from './analysis';

type Num=number|null;
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const windowMax=(a:number[],i:number,n:number)=>{let m=-Infinity;for(let j=i-n+1;j<=i;j++)if(a[j]>m)m=a[j];return m;};
const windowMin=(a:number[],i:number,n:number)=>{let m=Infinity;for(let j=i-n+1;j<=i;j++)if(a[j]<m)m=a[j];return m;};
const smaNullable=(a:Num[],n:number):Num[]=>a.map((_,i)=>{if(i<n-1)return null;let s=0;for(let j=i-n+1;j<=i;j++){const v=a[j];if(!fin(v))return null;s+=v;}return s/n;});
const bad=(p:Price)=>!fin(p.high)||!fin(p.low)||!fin(p.close)||!fin(p.volume)||p.high<p.low;

/** On-Balance Volume: running sum of volume signed by close-to-close direction (equal close adds nothing). Starts at 0. */
export function obv(prices:Price[]):Num[]{
 const out:Num[]=[];let run=0;
 for(let i=0;i<prices.length;i++){
  if(bad(prices[i])){out.push(null);run=NaN;continue;}
  if(i===0){run=0;}
  else if(!fin(run)){out.push(null);continue;}
  else{const d=prices[i].close-prices[i-1].close;run+=d>0?prices[i].volume:d<0?-prices[i].volume:0;}
  out.push(run);
 }
 return out;
}

/** Stochastic oscillator. fastK = 100*(close-LL)/(HH-LL) over `n` bars (null when HH==LL); slowK = SMA(fastK,kSmooth); slowD = SMA(slowK,dSmooth). */
export function stochastic(prices:Price[],n=14,kSmooth=3,dSmooth=3){
 const highs=prices.map(p=>p.high),lows=prices.map(p=>p.low);
 const fastK:Num[]=prices.map((p,i)=>{
  if(i<n-1)return null;
  for(let j=i-n+1;j<=i;j++)if(bad(prices[j]))return null;
  const hh=windowMax(highs,i,n),ll=windowMin(lows,i,n);
  return hh===ll?null:100*(p.close-ll)/(hh-ll);
 });
 const slowK=smaNullable(fastK,kSmooth),slowD=smaNullable(slowK,dSmooth);
 return {fastK,slowK,slowD};
}

/**
 * Ichimoku Kinko Hyo. Values are computed AT each bar from data up to that bar (no look-ahead).
 * tenkan=(HH+LL)/2 over 9, kijun over 26, senkouA=(tenkan+kijun)/2, senkouB over 52, chikou=close. Plotting displaces senkou 26 bars forward
 * and chikou 26 back; `cloudA/cloudB` therefore give the cloud AS DRAWN at bar i (senkou computed 26 bars earlier), which is what price is compared to.
 */
export function ichimoku(prices:Price[],tenkanN=9,kijunN=26,senkouBN=52,displacement=26){
 const highs=prices.map(p=>p.high),lows=prices.map(p=>p.low);
 const mid=(i:number,n:number):Num=>{if(i<n-1)return null;for(let j=i-n+1;j<=i;j++)if(bad(prices[j]))return null;return (windowMax(highs,i,n)+windowMin(lows,i,n))/2;};
 const tenkan=prices.map((_,i)=>mid(i,tenkanN)),kijun=prices.map((_,i)=>mid(i,kijunN)),senkouB=prices.map((_,i)=>mid(i,senkouBN));
 const senkouA:Num[]=prices.map((_,i)=>fin(tenkan[i])&&fin(kijun[i])?(tenkan[i]!+kijun[i]!)/2:null);
 const cloudA:Num[]=prices.map((_,i)=>i>=displacement?senkouA[i-displacement]:null),cloudB:Num[]=prices.map((_,i)=>i>=displacement?senkouB[i-displacement]:null);
 const position=prices.map((p,i):'above'|'below'|'inside'|null=>{const a=cloudA[i],b=cloudB[i];if(!fin(a)||!fin(b)||!fin(p.close))return null;const top=Math.max(a,b),bot=Math.min(a,b);return p.close>top?'above':p.close<bot?'below':'inside';});
 return {tenkan,kijun,senkouA,senkouB,cloudA,cloudB,position,displacement};
}

export const FIB_RATIOS=[0,0.236,0.382,0.5,0.618,0.786,1] as const;
/**
 * Fibonacci retracement levels over the last `lookback` bars. The swing is the window's highest high and lowest low;
 * if the low came before the high the swing is up (levels measured down from the high), otherwise down (measured up from the low).
 * Levels are reference prices only; the book gives no probability for them.
 */
export function fibonacci(prices:Price[],lookback=60){
 if(prices.length<lookback||lookback<2)return null;
 const w=prices.slice(-lookback);if(w.some(bad))return null;
 let hi=-Infinity,lo=Infinity,hiAt=-1,loAt=-1;
 w.forEach((p,i)=>{if(p.high>=hi){hi=p.high;hiAt=i;}if(p.low<=lo){lo=p.low;loAt=i;}});
 if(!(hi>lo))return null;
 const up=loAt<hiAt,range=hi-lo;
 return {direction:up?'up' as const:'down' as const,high:hi,low:lo,highDate:w[hiAt].date,lowDate:w[loAt].date,
  levels:FIB_RATIOS.map(r=>({ratio:r,price:up?hi-r*range:lo+r*range}))};
}
