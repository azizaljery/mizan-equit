import {Badge} from '@/components/ui/badge';
import {evidenceStatement,EVIDENCE_CONCLUSION,EVIDENCE_INSUFFICIENT,EVIDENCE_PROTOCOL,EVIDENCE_EVALUATION_DATE} from '@/lib/forecast-evidence';

/** Engine-derived internal label. Neutral tone on purpose: colour must not suggest proven accuracy. */
export function EngineConfidenceBadge({value}:{value:string|null|undefined}){
 const text=String(value??'').trim()||'غير محددة';
 return <Badge variant="outline" data-engine-label="internal" className="whitespace-normal text-start">تصنيف المحرك الداخلي: {text} <small>(غير معاير؛ ليس احتمال نجاح)</small></Badge>;
}
/** Single sentence used wherever a screen shows engine-derived direction/centre/range. */
export function UnprovenEdgeNote({sessions}:{sessions?:number}){
 const text=sessions===undefined?EVIDENCE_CONCLUSION+'. في الآفاق من 21 جلسة فأكثر: '+EVIDENCE_INSUFFICIENT+'. التقييم الاتجاهي الوصفي المضاف لاحقًا ليس إثباتًا تأكيديًا.':evidenceStatement(sessions);
 return <p className="muted unproven-note" role="note">{text} المرجع: <bdi dir="ltr">{EVIDENCE_PROTOCOL}</bdi> بتاريخ <bdi dir="ltr">{EVIDENCE_EVALUATION_DATE}</bdi>. الأرقام هنا مراكز سيناريو لا توصيات شراء.</p>;
}
