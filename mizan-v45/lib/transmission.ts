/**
 * REACTION and TRANSMISSION layers plus the causal map (book P-005, P-006, P-023..P-029).
 * Pure functions. The causal map is a set of DECLARED hypotheses (sign + lag range + mechanism), never a measured fact; propagation only says what the map expects, and
 * comparison with what was observed lists matches and mismatches. Thresholds are frozen and uncalibrated (research only). Nothing here feeds a score or decision.
 */
import type {Price} from './analysis';
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

export const REACTION_PARAMS=Object.freeze({baselineBars:60,minBars:62,abnormalZ:2,gapPct:5,volumeBars:20,noReactionZ:1});
/** P-006: how the last bar reacted compared with this stock's own recent behaviour: return z-score, opening gap, volume ratio. Price-based only (credit and options reactions are not available). */
export function reactionAudit(prices:Price[],p=REACTION_PARAMS){
 const n=prices.length;if(n<p.minBars)return null;
 const t=n-1,rets:number[]=[];
 for(let i=t-p.baselineBars;i<t;i++){const a=prices[i-1]?.close,b=prices[i]?.close;if(!(a>0)||!(b>0))return null;rets.push(b/a-1);}
 const prev=prices[t-1],cur=prices[t];if(!(prev.close>0)||!(cur.close>0)||!(cur.open>0))return null;
 const mean=rets.reduce((s,x)=>s+x,0)/rets.length,sd=Math.sqrt(rets.reduce((s,x)=>s+(x-mean)**2,0)/rets.length);
 const ret=cur.close/prev.close-1,z=sd>0?(ret-mean)/sd:null,gap=100*(cur.open/prev.close-1);
 const vols=prices.slice(t-p.volumeBars,t).map(x=>x.volume),va=vols.reduce((s,x)=>s+x,0)/vols.length;
 const abnormal=(z!==null&&Math.abs(z)>=p.abnormalZ)||Math.abs(gap)>=p.gapPct;
 return {date:cur.date,returnPct:100*ret,zScore:z,gapPct:gap,volumeRatio:va>0?cur.volume/va:null,baselineMeanPct:100*mean,baselineSdPct:100*sd,abnormal,
  band:{lowPct:100*(mean-p.abnormalZ*sd),highPct:100*(mean+p.abnormalZ*sd)}};
}
/** Compares an observed reaction with the direction a hypothesis expected: as_expected, opposite, or no_reaction when the move is within one sd. */
export function reactionVsExpected(zScore:number|null,expected:1|-1){
 if(!fin(zScore))return 'unknown' as const;
 if(Math.abs(zScore)<REACTION_PARAMS.noReactionZ)return 'no_reaction' as const;
 return (Math.sign(zScore)===expected?'as_expected':'opposite') as 'as_expected'|'opposite';
}

export type CausalNode={id:string;label:string;kind:'macro'|'input'|'pricing'|'demand'|'result'|'cash'|'valuation'};
export type CausalEdge={from:string;to:string;sign:1|-1;lagMin:number;lagMax:number;mechanism:string;data:string};
export const CAUSAL_NODES:CausalNode[]=[
 {id:'fed_funds',label:'سعر الفائدة الأمريكي',kind:'macro'},{id:'brent',label:'سعر النفط (برنت)',kind:'macro'},{id:'cpi',label:'التضخم',kind:'macro'},
 {id:'inputs',label:'تكلفة المدخلات',kind:'input'},{id:'pricing',label:'قوة التسعير',kind:'pricing'},{id:'demand',label:'الطلب',kind:'demand'},
 {id:'revenue',label:'الإيرادات',kind:'result'},{id:'cost',label:'التكلفة',kind:'result'},{id:'margin',label:'الهامش',kind:'result'},
 {id:'cash',label:'التدفق النقدي',kind:'cash'},{id:'discount_rate',label:'معدل الخصم',kind:'valuation'},{id:'valuation',label:'القيمة',kind:'valuation'},
];
/** Declared hypotheses, one mechanism each; lags in days. `data` names what would test the edge (FRED/Yahoo series, company statements). */
export const CAUSAL_EDGES:CausalEdge[]=[
 {from:'brent',to:'inputs',sign:1,lagMin:0,lagMax:60,mechanism:'ارتفاع النفط يرفع تكلفة الطاقة والنقل والبتروكيماويات',data:'DCOILBRENTEU أو BZ=F'},
 {from:'cpi',to:'pricing',sign:1,lagMin:30,lagMax:180,mechanism:'التضخم المرتفع يسمح بزيادة أسعار البيع لمن يملك قوة تسعير',data:'CPIAUCSL وبيانات الأسعار'},
 {from:'fed_funds',to:'discount_rate',sign:1,lagMin:0,lagMax:30,mechanism:'رفع الفائدة يرفع معدل الخصم المطلوب',data:'FEDFUNDS وDGS10'},
 {from:'inputs',to:'cost',sign:1,lagMin:0,lagMax:90,mechanism:'المدخلات الأعلى تكلفة ترفع تكلفة المبيعات',data:'تكلفة المبيعات من القوائم المالية'},
 {from:'inputs',to:'pricing',sign:1,lagMin:30,lagMax:180,mechanism:'تمرير جزء من التكلفة إلى سعر البيع',data:'أسعار المنتج وهامش إجمالي'},
 {from:'pricing',to:'revenue',sign:1,lagMin:0,lagMax:30,mechanism:'سعر أعلى يرفع الإيراد لكل وحدة',data:'الإيرادات'},
 {from:'demand',to:'revenue',sign:1,lagMin:0,lagMax:30,mechanism:'طلب أعلى يرفع الكمية المباعة',data:'الإيرادات وحجم المبيعات'},
 {from:'cost',to:'margin',sign:-1,lagMin:0,lagMax:0,mechanism:'التكلفة الأعلى تخفض الهامش',data:'الهامش التشغيلي'},
 {from:'revenue',to:'margin',sign:1,lagMin:0,lagMax:0,mechanism:'الإيراد الأعلى مع تكلفة ثابتة يرفع الهامش',data:'الهامش التشغيلي'},
 {from:'margin',to:'cash',sign:1,lagMin:0,lagMax:90,mechanism:'هامش أعلى يعني نقدًا أعلى بعد تحصيل الذمم',data:'التدفق النقدي التشغيلي'},
 {from:'cash',to:'valuation',sign:1,lagMin:0,lagMax:0,mechanism:'نقد متوقع أعلى يرفع القيمة',data:'خصم التدفقات'},
 {from:'discount_rate',to:'valuation',sign:-1,lagMin:0,lagMax:0,mechanism:'معدل خصم أعلى يخفض القيمة الحالية',data:'خصم التدفقات'},
];
/** P-024: cycles are allowed only if every edge on the cycle has a lag >= 1 day (time separation). Returns the offending cycles; empty means valid. */
export function validateGraph(edges:CausalEdge[]=CAUSAL_EDGES){
 const adj=new Map<string,CausalEdge[]>();for(const e of edges){if(!adj.has(e.from))adj.set(e.from,[]);adj.get(e.from)!.push(e);}
 const issues:string[][]=[];
 const walk=(start:string,node:string,path:CausalEdge[],seen:Set<string>)=>{
  for(const e of adj.get(node)||[]){
   if(e.to===start){const cyc=[...path,e];if(cyc.some(x=>x.lagMin<1))issues.push(cyc.map(x=>x.from));continue;}
   if(seen.has(e.to))continue;seen.add(e.to);walk(start,e.to,[...path,e],seen);seen.delete(e.to);
  }
 };
 for(const n of adj.keys())walk(n,n,[],new Set([n]));
 return issues;
}
export type Reached={node:string;sign:-1|0|1;ambiguous:boolean;lagMin:number;lagMax:number;paths:{nodes:string[];sign:-1|1;lagMin:number;lagMax:number}[]};
/** P-005: what the map expects downstream of one shock. Every simple path is listed; if paths disagree in sign the node is "ambiguous" (sign 0), never forced. */
export function propagate(shockNode:string,shockSign:1|-1,edges:CausalEdge[]=CAUSAL_EDGES):Reached[]{
 const adj=new Map<string,CausalEdge[]>();for(const e of edges){if(!adj.has(e.from))adj.set(e.from,[]);adj.get(e.from)!.push(e);}
 const found=new Map<string,Reached['paths']>();
 const walk=(node:string,nodes:string[],sign:-1|1,lo:number,hi:number)=>{
  for(const e of adj.get(node)||[]){
   if(nodes.includes(e.to))continue;
   const s=(sign*e.sign) as -1|1,np=[...nodes,e.to],l=lo+e.lagMin,h=hi+e.lagMax;
   if(!found.has(e.to))found.set(e.to,[]);found.get(e.to)!.push({nodes:np,sign:s,lagMin:l,lagMax:h});
   walk(e.to,np,s,l,h);
  }
 };
 walk(shockNode,[shockNode],shockSign,0,0);
 return [...found.entries()].map(([node,paths])=>{
  const signs=new Set(paths.map(p=>p.sign)),amb=signs.size>1;
  return {node,sign:(amb?0:paths[0].sign) as -1|0|1,ambiguous:amb,lagMin:Math.min(...paths.map(p=>p.lagMin)),lagMax:Math.max(...paths.map(p=>p.lagMax)),paths};
 });
}
/** Compares the map's expectation with signed observations per node: match, mismatch, or not_observed/ambiguous (no verdict). */
export function transmissionCheck(expected:Reached[],observed:Record<string,-1|0|1>){
 return expected.map(x=>{
  const o=observed[x.node];
  const verdict=x.ambiguous?'ambiguous' as const:o===undefined||o===0?'not_observed' as const:o===x.sign?'match' as const:'mismatch' as const;
  return {node:x.node,expected:x.sign,observed:o??null,verdict};
 });
}
