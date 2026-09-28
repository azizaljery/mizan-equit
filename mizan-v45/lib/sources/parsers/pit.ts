import type { ParsedFinancials } from './types';
import {validDate} from '../../analysis';

const hasPublication=(l:ParsedFinancials['lines'][number])=>
  typeof l.filedAt==='string'&&validDate(l.filedAt)&&validDate(l.periodEnd)&&l.filedAt>=l.periodEnd;

export function pitSafe(f:ParsedFinancials):ParsedFinancials{
  const safe=f.lines.filter(hasPublication);
  if(!safe.length)throw new Error('لا بنود مالية ذات تاريخ إفصاح موثوق (PIT)؛ لا يمكن استخدام هذه البيانات في مسار يعتمد على التوقيت.');
  return {...f,lines:safe};
}
export function hasPitSafeLines(f:ParsedFinancials):boolean{
  return f.lines.some(hasPublication);
}
export function filterPitSafe(lines:ParsedFinancials['lines'],asOf?:string){
 if(asOf!==undefined&&!validDate(asOf))throw Error('تاريخ تقييم غير صالح.');
 return lines.filter(l=>hasPublication(l)&&(!asOf||l.filedAt!<=asOf));
}
export function isPitSafe(lines:ParsedFinancials['lines'],asOf?:string){return lines.length>0&&filterPitSafe(lines,asOf).length===lines.length;}
export function pitReason(lines:ParsedFinancials['lines'],asOf?:string){
 const safe=filterPitSafe(lines,asOf).length;
 return lines.length===0?'لا بنود مالية.':safe===lines.length?'تواريخ النشر صالحة ضمن تاريخ القطع المحدد إن وُجد.':`${lines.length-safe} من ${lines.length} بند بلا تاريخ نشر صالح ضمن تاريخ القطع.`;
}
