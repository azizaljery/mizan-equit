import { TIER_SCORE } from './registry';
import type { ConflictValue, ConflictResult, SourceCandidate } from './types';

export type Equality<T> = (a:T,b:T)=>boolean;

export function detectConflict<T>(values:ConflictValue<T>[],equal:Equality<T>):ConflictResult<T>{
  if(!values.length)return {hasConflict:false,values:[],resolved:null,reason:'لا قيم.'};
  if(values.length===1)return {hasConflict:false,values,resolved:values[0],reason:null};
  const first=values[0].value;
  const allEqual=values.every(v=>equal(first,v.value));
  return {
    hasConflict:!allEqual,
    values,
    resolved:allEqual?values[0]:null,
    reason:allEqual?null:`قيم متنافسة من ${values.length} مصدر.`,
  };
}

export function resolveByTier<T>(
  values:ConflictValue<T>[],
  equal:Equality<T>,
  tierOf:(sourceId:string)=>SourceCandidate['tier'],
):ConflictResult<T>{
  if(!values.length)return {hasConflict:false,values:[],resolved:null,reason:'لا قيم.'};
  const sorted=[...values].sort((a,b)=>{
    const at=TIER_SCORE[tierOf(a.provenance.source)]??0;
    const bt=TIER_SCORE[tierOf(b.provenance.source)]??0;
    if(at!==bt)return bt-at;
    return a.provenance.source.localeCompare(b.provenance.source);
  });
  const top=TIER_SCORE[tierOf(sorted[0].provenance.source)]??0;
  const peers=sorted.filter(v=>(TIER_SCORE[tierOf(v.provenance.source)]??0)===top);
  const first=peers[0].value;
  const agree=peers.every(v=>equal(first,v.value));
  if(!agree)return {hasConflict:true,values:sorted,resolved:null,reason:`تعارض بين ${peers.length} مصدر في نفس الرتبة العليا.`};
  return {hasConflict:false,values:sorted,resolved:sorted[0],reason:null};
}

export function numericEqual(tolerancePct=0.5):Equality<number>{
  return (a,b)=>{
    if(!Number.isFinite(a)||!Number.isFinite(b))return false;
    const ref=Math.max(Math.abs(a),Math.abs(b),1);
    return Math.abs(a-b)/ref*100<=tolerancePct;
  };
}
export const strictStringEqual:Equality<string>=(a,b)=>a.trim()===b.trim();
export const dateOnlyEqual:Equality<string>=(a,b)=>a.slice(0,10)===b.slice(0,10);
