/**
 * One stock, one audit: the technical indicators, the structure checks, the reaction layer and a decision state built from DECLARED evidence rules.
 * Every evidence item has a fixed equal weight (0.5, uncalibrated) and a stated rule; nothing is tuned to a result. Research only: it feeds no score, forecast or bot decision.
 */
import type {Price} from './analysis';
import {obv,stochastic,ichimoku,fibonacci} from './indicators-extra';
import {wyckoffAudit,latestImpulseCandidate,wyckoffClimaxes} from './structure-audit';
import {decisionState,type Evidence,type VetoRule} from './pulse-audit';
import {reactionAudit} from './transmission';

export const EVIDENCE_WEIGHT=0.5;
const sma=(c:number[],t:number,n:number)=>{let s=0;for(let i=t-n+1;i<=t;i++)s+=c[i];return s/n;};
const sign=(v:number):-1|0|1=>v>0?1:v<0?-1:0;
export type EvidenceRow=Evidence&{label:string;rule:string;value:string};

export function buildAudit(prices:Price[],today:string){
 const n=prices.length,t=n-1,closes=prices.map(p=>p.close);
 const ich=ichimoku(prices),st=stochastic(prices),ob=obv(prices),fib=fibonacci(prices),wy=wyckoffAudit(prices),imp=latestImpulseCandidate(prices),cl=wyckoffClimaxes(prices).slice(-3),re=reactionAudit(prices);
 const rows:EvidenceRow[]=[];
 const add=(id:string,label:string,direction:-1|0|1,rule:string,value:string)=>{if(direction!==0)rows.push({id,label,direction,weight:EVIDENCE_WEIGHT,rule,value});};
 const pos=ich.position[t];
 if(pos)add('ichimoku','موضع السعر من سحابة Ichimoku',pos==='above'?1:pos==='below'?-1:0,'فوق السحابة = +1، تحتها = −1، داخلها = لا شيء',pos==='above'?'فوق السحابة':pos==='below'?'تحت السحابة':'داخل السحابة');
 const k=st.slowK[t],d=st.slowD[t];
 if(typeof k==='number'&&typeof d==='number')add('stochastic','تقاطع Stochastic (K مقابل D)',sign(k-d),'K فوق D = +1، تحتها = −1',`K=${k.toFixed(1)} D=${d.toFixed(1)}`);
 const o1=ob[t],o0=ob[t-20];
 if(typeof o1==='number'&&typeof o0==='number')add('obv','اتجاه OBV خلال 20 جلسة',sign(o1-o0),'ارتفاع OBV = +1، انخفاضه = −1',`${o1-o0>0?'+':''}${Math.round(o1-o0)}`);
 if(n>=200&&closes.slice(-200).every(Number.isFinite)){const r=sma(closes,t,50)/sma(closes,t,200)-1;add('trend','المتوسط 50 مقابل 200',sign(r),'50 فوق 200 = +1، تحتها = −1',`${(100*r).toFixed(2)}%`);}
 if(n>=127&&closes[t-5]>0&&closes[t-126]>0){const r=Math.log(closes[t-5]/closes[t-126]);add('mom6','زخم 6 أشهر دون آخر 5 جلسات',sign(r),'موجب = +1، سالب = −1',`${(100*(Math.exp(r)-1)).toFixed(2)}%`);}
 if(wy.status==='ok')for(const e of wy.events){
  const dir=e.name==='SOS'||e.name==='Spring'?1:-1;
  add('wyckoff-'+e.name+'-'+e.index,`حدث ${e.name} (${e.date})`,dir,'قاعدة رقمية مسبقة على آخر 5 جلسات',e.name);
 }
 const last=prices[t].date,ageDays=Math.floor((Date.parse(today)-Date.parse(last))/86400000);
 const vetoes:VetoRule[]=[
  {id:'stale_prices',reason:'آخر جلسة أقدم من 7 أيام',active:ageDays>7},
  {id:'zero_volume_last',reason:'حجم آخر جلسة صفر',active:!(prices[t].volume>0)},
  {id:'thin_history',reason:'أقل من 127 جلسة',active:n<127},
 ];
 const decision=decisionState(rows,{vetoes});
 return {asOf:last,bars:n,decision,evidence:rows,vetoes,
  indicators:{obv:o1??null,stochastic:{fastK:st.fastK[t],slowK:k,slowD:d},ichimoku:{tenkan:ich.tenkan[t],kijun:ich.kijun[t],cloudA:ich.cloudA[t],cloudB:ich.cloudB[t],position:pos},fibonacci:fib},
  structure:{wyckoff:wy,elliottImpulse:imp,climaxes:cl},reaction:re};
}
