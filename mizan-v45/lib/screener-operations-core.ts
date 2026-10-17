/** Operational summaries, not an alternative forecast/return model. */
export const FOLLOWUP_VERSION = 'screener-followup-v1';
export const FOLLOWUP_DEFAULT = Object.freeze({enabled:false,intervalHours:24,scanPerMarket:200,resultCount:10,horizonSessions:5});
export type FollowupConfig = {enabled:boolean;intervalHours:number;scanPerMarket:number;resultCount:number;horizonSessions:number};
export function validateFollowupConfig(value:unknown):FollowupConfig{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('إعداد المتابعة غير صالح.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!Object.hasOwn(FOLLOWUP_DEFAULT,k)))throw Error('حقول متابعة غير مدعومة.');
 if(typeof v.enabled!=='boolean'||![6,24,168].includes(v.intervalHours as number)||![20,40,100,200].includes(v.scanPerMarket as number)||!Number.isInteger(v.resultCount)||Number(v.resultCount)<5||Number(v.resultCount)>10||![1,5,21,63,126,252].includes(v.horizonSessions as number))throw Error('إعداد المتابعة خارج الحدود المعتمدة.');
 return {enabled:v.enabled,intervalHours:Number(v.intervalHours),scanPerMarket:Number(v.scanPerMarket),resultCount:Number(v.resultCount),horizonSessions:Number(v.horizonSessions)};
}
export function periodicSlot(time:number,config:FollowupConfig):number{
 if(!Number.isFinite(time)||time<0)throw Error('invalid-clock');
 return Math.floor(time/(config.intervalHours*3600000));
}
export function compactPerformance(p:any){
 const safe=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n:null;
 return {total:safe(p.total),completed:safe(p.completed),nonOverlapping:safe(p.independent),directionCount:safe(p.directionCount),directionAccuracyPct:safe(p.directionAccuracy),rangeCount:safe(p.rangeCount),rangeCoveragePct:safe(p.rangeCoverage),pointCount:safe(p.pointCount),meanRelativePriceErrorPct:safe(p.meanPriceError),baselinePairedCount:safe(p.pairedCount),meanUnchangedPriceErrorPct:safe(p.meanBaselineError),pairedMeanRelativePriceErrorPct:safe(p.pairedMeanPriceError)};
}
/** Count cohort memberships separately; never inflate measured samples by reusing a forecast ID. */
export function summarizeSelectedForecasts(rows:any[],summarize:(rows:any[])=>any){
 const unique=new Map<string,any>();let invalid=0;
 for(const row of rows){
  if(typeof row.id!=='string'||!['sa','us'].includes(row.market)||!Number.isInteger(row.horizon)||typeof row.model!=='string'||!row.model||row.recordClass!=='prospective-public'){invalid++;continue;}
  if(!unique.has(row.id))unique.set(row.id,row);
 }
 const cells=new Map<string,any[]>();
 for(const row of unique.values()){
  const key=JSON.stringify([row.market,row.horizon,row.model,row.evaluationPolicy||'legacy-unverified']);
  const cell=cells.get(key);if(cell)cell.push(row);else cells.set(key,[row]);
 }
 return {memberships:rows.length,uniqueForecasts:unique.size,duplicateMemberships:rows.length-invalid-unique.size,invalidRows:invalid,
  cells:[...cells.entries()].map(([key,items])=>{
   const [market,horizon,model,evaluationPolicy]=JSON.parse(key);
   const complete=items.filter(r=>r.outcome?.state==='complete').length,excluded=items.filter(r=>r.outcome?.state==='excluded').length,invalidOutcomes=items.filter(r=>r.outcomeParseError||r.outcome&& !['complete','excluded'].includes(r.outcome.state)).length;
   return {market,horizon,model,evaluationPolicy,selected:items.length,complete,excluded,invalidOutcomes,pending:items.length-complete-excluded-invalidOutcomes,metrics:compactPerformance(summarize(items.filter(r=>!r.outcomeParseError)))};
  }).sort((a,b)=>a.market.localeCompare(b.market)||a.horizon-b.horizon||a.model.localeCompare(b.model))};
}
export function makeAgentWorkPlan(evidence:any){
 const tasks=[
  {id:'DATA-01',owner:'data-center',title:'هوية الإدراج وحداثة المصادر',acceptance:'افصل سعر الإغلاق عن اللحظي؛ وثق المصدر ووقت السعر والإدراج لكل فشل. لا تستبدل الرموز تلقائيًا.'},
  {id:'OPS-01',owner:'developer',title:'اكتمال مسح 200 سهم لكل سوق',acceptance:'خطة سعودية 200 وخطة أمريكية 200، وحفظ كل دفعة؛ لا يُعتمد المسح الجزئي ولا تخفف شروط الترشيح.'},
  {id:'QA-01',owner:'developer',title:'استرجاع الأرشيف وزر التحليل',acceptance:'اختبار المتصفح بعد إعادة التحميل، وثبات البصمة، وفتح الشركة الصحيحة، ورفض الوصول غير المصرح.'},
  {id:'QUANT-01',owner:'quant',title:'قياس نتائج الترشيحات الناضجة',acceptance:'استخدم performanceStats وforecastMetrics الموجودتين. افصل السوق والأفق ونسخة النموذج والسياسة، والمعلّق والمستبعد.'},
  {id:'RD-01',owner:'rd-manager',title:'ذاكرة إخفاقات مبنية على الأدلة',acceptance:'اربط كل فرضية بمعرف سجل أو مصدر؛ فرق السبب المثبت عن الفرضية، ولا تعتبر نقص النتائج المستحقة فشل دقة.'},
  {id:'RD-02',owner:'rd-manager',title:'مقارنة تحسين مع النسخة الحالية',acceptance:'حدد اختبارًا خارج عينة التطوير وحدود التكاليف، ولا تعلن تفوقًا بلا بيانات. لا تغيّر الأوزان أو تعيد حساب الماضي.'},
  {id:'SEC-01',owner:'security-reviewer',title:'نزاهة الحفظ والجدولة والتكلفة',acceptance:'راجع عدم التكرار والقفل وحدود التشغيل والسرية وثبات الأصل. PASS مراجعة محدودة لا موافقة نشر أو تداول.'},
 ];
 return {version:FOLLOWUP_VERSION,asOf:evidence.asOf,scope:'Saudi + US; OpenAI-only model roles; no autonomous trading or model promotion',tasks:tasks.map(t=>({...t,state:'assigned',evidenceRefs:['screener_runs','screener_picks','forecast_outcomes','job:screener-followup:last']})),
  instructions:'كل مهمة تكليف وليست إنجازًا. أنجز في التقرير أهم مهمتين لدورك وسم الباقي pending. لا تدّع تعديل ملفات أو اختبار متصفح لم تنفذه. المقارنة المرجعية الحالية ضد ثبات السعر وليست عائد مؤشر أو محفظة.'};
}
