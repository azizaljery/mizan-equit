/**
 * Pulse components and decision states as AUDIT rules (book P-003, P-018, P-036..P-040).
 * Pure functions over given numbers; thresholds are declared up front, frozen and uncalibrated (research only). They feed no score or decision.
 */
export const PULSE_PARAMS=Object.freeze({
 window:20,minDiffs:10,           // prior differences used as the baseline
 surpriseZ:2,                     // |z| >= 2 flags a surprise
 minEvidence:1,                   // total evidence weight below this -> ABSTAIN
 contradictionFloor:0.8,          // both sides at least this weight -> CONTRADICTION
 sensitivityMargin:0.2,           // |support-against|/total below this -> ABSTAIN
 conflictRelative:0.01,           // two values differing by more than 1% are a conflict
});
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** P-018: the pulse of one variable as components. Needs at least minDiffs+2 consecutive finite values ending at the latest point; otherwise null (never guessed). */
export function pulseComponents(values:(number|null)[],opts:{window?:number;minDiffs?:number;surpriseZ?:number}={}){
 const w=opts.window??PULSE_PARAMS.window,minD=opts.minDiffs??PULSE_PARAMS.minDiffs,sz=opts.surpriseZ??PULSE_PARAMS.surpriseZ;
 let start=values.length;while(start>0&&fin(values[start-1]))start--;
 const v=values.slice(start) as number[];
 if(v.length<minD+2)return null;
 const d:number[]=[];for(let i=1;i<v.length;i++)d.push(v[i]-v[i-1]);
 const last=d[d.length-1],prior=d.slice(Math.max(0,d.length-1-w),d.length-1);
 const mean=prior.reduce((s,x)=>s+x,0)/prior.length,sd=Math.sqrt(prior.reduce((s,x)=>s+(x-mean)**2,0)/prior.length);
 const z=sd>0?(last-mean)/sd:null;
 const dir=Math.sign(last) as -1|0|1;
 let run=0;for(let i=d.length-1;i>=0&&Math.sign(d[i])===dir&&dir!==0;i--)run++;
 let age=1;for(let i=v.length-1;i>0&&v[i]===v[i-1];i--)age++;
 return {direction:dir,change:last,standardizedChange:z,acceleration:d.length>=2?last-d[d.length-2]:null,surprise:z===null?null:Math.abs(z)>=sz,persistence:run,ageSameValueBars:age,baselineDiffs:prior.length};
}

export type Evidence={id:string;direction:-1|0|1;weight:number;source?:string};
export type VetoRule={id:string;reason:string;active:boolean};
export type DecisionState={state:'VETO'|'ABSTAIN'|'CONTRADICTION'|'UP'|'DOWN';reason:string;support:number;against:number;margin:number|null;vetoes:string[];
 hypotheses?:{up:{weight:number;items:string[]};down:{weight:number;items:string[]}};dataConflicts:number;confidenceReduced:boolean};
/** P-036/038/039: first matching rule wins — active VETO, insufficient evidence, CONTRADICTION (both sides heavy, both hypotheses shown), edge below sensitivity, else a direction with its margin. */
export function decisionState(items:Evidence[],opts:{vetoes?:VetoRule[];dataConflicts?:number}={}):DecisionState{
 const ok=items.filter(x=>fin(x.weight)&&x.weight>0&&(x.direction===1||x.direction===-1));
 const up=ok.filter(x=>x.direction===1),dn=ok.filter(x=>x.direction===-1);
 const sum=(a:Evidence[])=>a.reduce((s,x)=>s+x.weight,0),support=sum(up),against=sum(dn),total=support+against;
 const conflicts=opts.dataConflicts??0,base={support,against,dataConflicts:conflicts,confidenceReduced:conflicts>0};
 const active=(opts.vetoes||[]).filter(v=>v.active).map(v=>v.id);
 if(active.length)return {state:'VETO',reason:'veto_active',margin:null,vetoes:active,...base};
 if(total<PULSE_PARAMS.minEvidence)return {state:'ABSTAIN',reason:'insufficient_evidence',margin:null,vetoes:[],...base};
 if(support>=PULSE_PARAMS.contradictionFloor&&against>=PULSE_PARAMS.contradictionFloor)
  return {state:'CONTRADICTION',reason:'both_sides_heavy',margin:null,vetoes:[],hypotheses:{up:{weight:support,items:up.map(x=>x.id)},down:{weight:against,items:dn.map(x=>x.id)}},...base};
 const margin=Math.abs(support-against)/total;
 if(margin<PULSE_PARAMS.sensitivityMargin)return {state:'ABSTAIN',reason:'edge_below_sensitivity',margin,vetoes:[],...base};
 return {state:support>against?'UP':'DOWN',reason:'direction',margin,vetoes:[],...base};
}

export type Reading={value:number;unit?:string;period?:string;source?:string};
/** P-037: two readings of the same field. A conflict is a relative gap above 1% or a different unit; unit and period differences are named so the cause is checkable. */
export function dataConflict(a:Reading,b:Reading){
 if(!fin(a.value)||!fin(b.value))return null;
 const gap=Math.max(Math.abs(a.value),Math.abs(b.value))>0?Math.abs(a.value-b.value)/Math.max(Math.abs(a.value),Math.abs(b.value)):0;
 const unitDiffers=!!a.unit&&!!b.unit&&a.unit!==b.unit,periodDiffers=!!a.period&&!!b.period&&a.period!==b.period;
 return {conflict:gap>PULSE_PARAMS.conflictRelative||unitDiffers,relativeGap:gap,unitDiffers,periodDiffers};
}

/** P-040: an experimental rule must carry sample, period, test method and generalisation limits; the missing ones are listed. */
export function experimentalLabel(l:{sample?:string;period?:string;method?:string;limits?:string}){
 const missing=(['sample','period','method','limits'] as const).filter(k=>!l[k]||!String(l[k]).trim());
 return {complete:missing.length===0,missing};
}
