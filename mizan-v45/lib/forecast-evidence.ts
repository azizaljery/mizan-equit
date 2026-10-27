/** Client-safe, pure. Evidence registry from PROTOCOL-FCST-0001 (research/REPORT-FCST-0001.md).
 *  A horizon is "proven" only if its cell passed the frozen acceptance rule. No cell did (primary rejected; no secondary survived Holm),
 *  so every horizon shows the honest label. Changing a value here requires a new protocol/AMEND — never edit to improve appearance. */
export const NO_EDGE_LABEL='لا توجد أفضلية اتجاهية مثبتة لهذا الأفق';
export const EVIDENCE_PROTOCOL='PROTOCOL-FCST-0001';
export const EVIDENCE_EVALUATION_DATE='2026-10-27';
export const SCENARIO_CENTER_LABEL='مركز سيناريو غير معتمد تنبؤيًا';
export const UNPROVEN_STATUS_LABEL='سيناريو غير معتمد تنبؤيًا';
/** Three separate facts, never merged: market-data date, engine version, evaluation date. */
export function provenanceLines(v:{priceTime?:string;version?:string;createdAt?:string}):[string,string][]{
 return [['تاريخ بيانات السوق (آخر سعر)',v.priceTime||'غير متاح'],['نسخة المحرك',v.version||'غير متاحة'],['تاريخ التقييم خارج العينة',EVIDENCE_EVALUATION_DATE+' · '+EVIDENCE_PROTOCOL],['وقت إصدار هذا التوقع',v.createdAt||'غير متاح']];
}
const PROVEN_SESSIONS:readonly number[]=[];
export function directionalEdgeProven(sessions:number):boolean{return PROVEN_SESSIONS.includes(sessions);}
type RowView={available?:boolean;sessions?:number;expectedChangePct?:number|null;neutralThresholdPct?:number|null;range?:[number,number]|null;price?:number|null;direction?:string};
/** Separates "weak signal" from "wide uncertainty"; never an invented direction or a probability. */
export function signalVsUncertainty(row:RowView):{signal:'low'|'above-threshold'|'unknown';uncertainty:'high'|'moderate'|'unknown';note:string}{
 const chg=row.expectedChangePct,thr=row.neutralThresholdPct,r=row.range,p=row.price;
 if(row.available!==true||typeof chg!=='number'||!Number.isFinite(chg)||typeof thr!=='number'||!Number.isFinite(thr))return{signal:'unknown',uncertainty:'unknown',note:''};
 const signal=Math.abs(chg)<thr?'low':'above-threshold';
 let uncertainty:'high'|'moderate'|'unknown'='unknown',ratio:number|null=null;
 if(r&&p&&p>0&&r[1]>r[0]){const half=(r[1]-r[0])/2/p*100;ratio=half/Math.max(Math.abs(chg),1e-9);uncertainty=half>=Math.max(5*thr,5)?'high':'moderate';}
 const parts=[signal==='low'?'الإشارة منخفضة: الحركة المركزية أقل من حد الحياد.':'الحركة المركزية فوق حد الحياد لكن دون أفضلية مثبتة.'];
 if(uncertainty==='high')parts.push('عدم اليقين مرتفع: نصف عرض النطاق أكبر بكثير من الحركة المركزية'+(ratio&&Number.isFinite(ratio)?' (≈'+Math.round(ratio)+' ضعفًا)':'')+'.');
 return{signal,uncertainty,note:parts.join(' ')};
}
