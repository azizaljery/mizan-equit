/**
 * محاكاة تاريخية — runner for the pre-registered specification mizan-sim-1 (lib/simulation/spec.ts). Pure, deterministic, point-in-time:
 * every feature at a decision date is computed from bars dated on or before it; outcomes are read only for scoring. Feeds no forecast, score, decision or bot.
 */
import type {Price} from '../analysis';
import {buildAudit} from '../audit-view';
import {SIM_SPEC as S,SIM_LABEL,SIM_SPEC_VERSION} from './spec';

export type Market='sa'|'us';
/** `engine` = replayed live-model expectedChangePct (percent) per decision date and horizon, produced elsewhere on price history ending at that date. */
export type Series={symbol:string;market:Market;prices:Price[];engine?:Record<string,Partial<Record<'5'|'21',number|null>>>};
export type Rec={market:Market;date:string;symbol:string;mom:number;vol:number;ma:number;audit:string;e5:number|null;e21:number|null;up5:0|1|null;up21:0|1|null};
export type ArmId='baseline'|'engine_current'|'mom126_5'|'audit_up'|'composite';
const rngf=(seed:number)=>{let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};};

/** Calendar of a market: dates present for at least 80% of its stocks. */
function calendar(series:Series[]){
 const cnt=new Map<string,number>();for(const s of series)for(const p of s.prices)cnt.set(p.date,(cnt.get(p.date)||0)+1);
 return [...cnt].filter(([,c])=>c>=0.8*series.length).map(([d])=>d).sort();
}
export function buildRecords(all:Series[]):Rec[]{
 const out:Rec[]=[];
 for(const market of ['sa','us'] as Market[]){
  const series=all.filter(s=>s.market===market);if(!series.length)continue;
  const cal=calendar(series),decisions:string[]=[];
  for(let k=S.minHistorySessions;k<cal.length;k+=S.decisionEverySessions)decisions.push(cal[k]);
  for(const s of series){
   const idx=new Map(s.prices.map((p,i)=>[p.date,i])),c=s.prices.map(p=>p.close);
   for(const d of decisions){
    const i=idx.get(d);if(i===undefined||i<S.minHistorySessions)continue;
    if(!(c[i]>0)||!(c[i-5]>0)||!(c[i-131]>0))continue;
    let sum=0,ok=true;for(let k=i-199;k<=i;k++){if(!(c[k]>0)){ok=false;break;}sum+=c[k];}if(!ok)continue;
    const r:number[]=[];for(let k=i-59;k<=i;k++){if(!(c[k-1]>0)){ok=false;break;}r.push(c[k]/c[k-1]-1);}if(!ok)continue;
    const m=r.reduce((a,b)=>a+b,0)/r.length,vol=Math.sqrt(r.reduce((a,b)=>a+(b-m)**2,0)/r.length);
    const up=(h:number):0|1|null=>i+h<c.length&&c[i+h]>0?(c[i+h]>c[i]?1:0):null;
    let audit='NA';try{audit=String((buildAudit(s.prices.slice(0,i+1),d) as any).decision.state);}catch{}
    const en=s.engine?.[d];
    out.push({market,date:d,symbol:s.symbol,mom:c[i-5]/c[i-131]-1,vol,ma:c[i]/(sum/200)-1,audit,e5:en?.['5']??null,e21:en?.['21']??null,up5:up(5),up21:up(21)});
   }
  }
 }
 return out;
}

type Triple={picks:number;hits:number;exp:number};
const byDate=(recs:Rec[])=>{const m=new Map<string,Rec[]>();for(const r of recs){(m.get(r.date)||m.set(r.date,[]).get(r.date)!).push(r);}return m;};
const upOf=(r:Rec,h:number)=>h===5?r.up5:r.up21;
const engOf=(r:Rec,h:number)=>h===5?r.e5:r.e21;
function ranks(vals:number[],desc:boolean){const o=vals.map((v,i)=>[v,i] as const).sort((a,b)=>desc?b[0]-a[0]:a[0]-b[0]||a[1]-b[1]);const r=Array(vals.length).fill(0);o.forEach(([,i],k)=>{r[i]=k;});return r;}
/** Picks of one arm on one date among records that have a resolved outcome for the horizon. */
export function pick(arm:ArmId,rows:Rec[],h:number,f:number):Rec[]{
 const R=rows.filter(r=>upOf(r,h)!==null).sort((a,b)=>a.symbol<b.symbol?-1:1);
 if(arm==='baseline')return R;
 if(arm==='engine_current')return R.filter(r=>{const e=engOf(r,h);return e!==null&&e>=S.noSignalPct;});
 if(arm==='audit_up')return R.filter(r=>r.audit==='UP');
 const n=R.length,k=Math.ceil(f*n);if(!n)return [];
 if(arm==='mom126_5'){return [...R].sort((a,b)=>b.mom-a.mom||(a.symbol<b.symbol?-1:1)).slice(0,k);}
 const a=ranks(R.map(r=>r.mom),true),b=ranks(R.map(r=>r.vol),false),c=ranks(R.map(r=>r.ma),true);
 return R.map((r,i)=>({r,s:a[i]+b[i]+c[i]})).sort((x,y)=>x.s-y.s||(x.r.symbol<y.r.symbol?-1:1)).slice(0,k).map(x=>x.r);
}
function triples(groups:Map<string,Rec[]>,dates:string[],arm:ArmId,h:number,f:number):Map<string,Triple>{
 const out=new Map<string,Triple>();
 for(const d of dates){
  const rows=groups.get(d)||[],uni=pick('baseline',rows,h,f);if(!uni.length)continue;
  const baseRate=uni.reduce((s,r)=>s+(upOf(r,h) as number),0)/uni.length,p=pick(arm,rows,h,f);
  out.set(d,{picks:p.length,hits:p.reduce((s,r)=>s+(upOf(r,h) as number),0),exp:p.length*baseRate});
 }
 return out;
}
const liftOf=(ts:Triple[])=>{const p=ts.reduce((s,t)=>s+t.picks,0);return p?(ts.reduce((s,t)=>s+t.hits,0)-ts.reduce((s,t)=>s+t.exp,0))/p:null;};
export type Ci={est:number|null;lo:number|null;hi:number|null};
function bootstrap(dates:string[],stat:(sample:string[])=>number|null,seed:number):Ci{
 const est=stat(dates);if(est===null||dates.length<2)return {est,lo:null,hi:null};
 const rand=rngf(seed),B=S.criteria.bootstrap.iterations,bl=S.criteria.bootstrap.blockDates,n=dates.length,vals:number[]=[];
 for(let b=0;b<B;b++){const sample:string[]=[];while(sample.length<n){const st=Math.floor(rand()*n);for(let k=0;k<bl&&sample.length<n;k++)sample.push(dates[(st+k)%n]);}const v=stat(sample);if(v!==null)vals.push(v);}
 vals.sort((a,b)=>a-b);if(vals.length<B*0.5)return {est,lo:null,hi:null};
 return {est,lo:vals[Math.floor(0.025*vals.length)],hi:vals[Math.min(vals.length-1,Math.ceil(0.975*vals.length)-1)]};
}
export type Period='development'|'validation'|'holdout';
export function splitDates(dates:string[],h:number){
 const n=dates.length,a=Math.floor(S.split.development*n),b=Math.floor((S.split.development+S.split.validation)*n),g=Math.ceil(h/S.decisionEverySessions);
 return {development:dates.slice(0,Math.max(0,a-g)),validation:dates.slice(a,Math.max(a,b-g)),holdout:dates.slice(b)};
}
export type ResultRow={market:Market;horizon:number;arm:ArmId;period:Period;topFraction:number|null;picks:number;hits:number;hitRate:number|null;baseRate:number|null;lift:Ci;vsEngine:Ci|null;dates:number;independentDates:number;verdict:string};
export type SimResult={label:typeof SIM_LABEL;specVersion:typeof SIM_SPEC_VERSION;generatedAt:string;
 markets:Record<string,{decisionDates:number;stocks:number;periods:Record<number,Record<Period,number>>}>;
 choices:{market:Market;horizon:number;arm:'mom126_5'|'composite';topFraction:number;basis:string}[];rows:ResultRow[];notes:string[]};
export function runSimulation(series:Series[],now=new Date().toISOString()):SimResult{
 const recs=buildRecords(series),rows:ResultRow[]=[],choices:SimResult['choices']=[],markets:SimResult['markets']={};
 for(const market of ['sa','us'] as Market[]){
  const mr=recs.filter(r=>r.market===market);if(!mr.length)continue;
  const groups=byDate(mr),dates=[...groups.keys()].sort();
  markets[market]={decisionDates:dates.length,stocks:series.filter(s=>s.market===market).length,periods:{}};
  for(const h of S.horizons){
   const sp=splitDates(dates,h);markets[market].periods[h]={development:sp.development.length,validation:sp.validation.length,holdout:sp.holdout.length};
   // choices use development+validation only; the holdout is not read here
   const frac:Partial<Record<ArmId,number>>={};
   for(const arm of ['mom126_5','composite'] as const){
    let best=S.defaultTopFraction as number,bestLift=-Infinity,basis='افتراضي: بيانات التحقق غير كافية';
    for(const f of S.topFractionGrid){const t=[...triples(groups,sp.validation,arm,h,f).values()],p=t.reduce((s,x)=>s+x.picks,0),l=liftOf(t);if(l!==null&&p>=30&&(l>bestLift+1e-12||(Math.abs(l-bestLift)<=1e-12&&f===S.defaultTopFraction))){best=f;bestLift=l;basis=`أعلى فرق تحقق ${(l*100).toFixed(1)} نقطة على التحقق فقط`;}}
    frac[arm]=best;choices.push({market,horizon:h,arm,topFraction:best,basis});
   }
   for(const period of ['development','validation','holdout'] as Period[]){
    const ds=sp[period];
    const tr:Partial<Record<ArmId,Map<string,Triple>>>={};
    const arms:ArmId[]=['engine_current','mom126_5','audit_up','composite'];
    for(const arm of arms)tr[arm]=triples(groups,ds,arm,h,frac[arm]??S.defaultTopFraction);
    for(const arm of arms){
     const m=tr[arm]!,all=[...m.values()],picks=all.reduce((s,t)=>s+t.picks,0),hits=all.reduce((s,t)=>s+t.hits,0),exp=all.reduce((s,t)=>s+t.exp,0);
     const stat=(sample:string[])=>liftOf(sample.map(d=>m.get(d)).filter(Boolean) as Triple[]);
     const lift=bootstrap([...m.keys()],stat,S.criteria.bootstrap.seed+h);
     let vs:Ci|null=null;
     if(arm!=='engine_current'){
      const e=tr.engine_current!;
      vs=bootstrap([...m.keys()],sample=>{const a=liftOf(sample.map(d=>m.get(d)).filter(Boolean) as Triple[]),b=liftOf(sample.map(d=>e.get(d)).filter(Boolean) as Triple[]);return a===null||b===null?null:a-b;},S.criteria.bootstrap.seed+h+1);
     }
     const indep=Math.floor(ds.length*S.decisionEverySessions/h);
     let verdict='—';
     if(period==='holdout'){
      if(indep<S.criteria.minIndependentDates||picks<S.criteria.minResolvedPicks)verdict='غير كافٍ';
      else if(lift.lo!==null&&lift.lo>0&&(arm==='engine_current'||(vs?.lo!==null&&vs!==null&&(vs.lo??-1)>0)))verdict='تفوّق';
      else verdict='لا تفوّق';
     }
     rows.push({market,horizon:h,arm,period,topFraction:arm==='mom126_5'||arm==='composite'?(frac[arm]??null):null,picks,hits,hitRate:picks?hits/picks:null,baseRate:picks?exp/picks:null,lift,vsEngine:vs,dates:m.size,independentDates:indep,verdict});
    }
   }
  }
 }
 return {label:SIM_LABEL,specVersion:SIM_SPEC_VERSION,generatedAt:now,markets,choices,rows,notes:[
  'محاكاة تاريخية: لا تمثل توقعات صدرت فعلًا ولا تُخزَّن معها.',
  'لا تُحتسب تكاليف ولا توزيعات؛ النجاح = إغلاق بعد الأفق أعلى من إغلاق يوم القرار.',
  'محرك التوقع يُعاد تشغيله على أسعار فقط (دون قوائم مالية ولا مؤشر السوق).',
 ]};
}
