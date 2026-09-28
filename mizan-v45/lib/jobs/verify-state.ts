/** Read-only observations over the existing job journal; never runs a job. */
import {readStateField} from './read-state';
import {EVALUATE_DUE_CRON, EVALUATE_DUE_CRON_STATE_ID, EVALUATE_DUE_STATE_ID} from './schedule';
import {checkResolutionIntegrity} from '../../worker/scheduled';
import {readArrival,readEvaluation} from './heartbeat';

export type VerifyCronResult = {
  ok:boolean; reason:string; keyExists:boolean; updatedAt:string|null;
  ageMinutes:number|null; fields:Record<string,unknown>|null;
  status:'missing'|'invalid'|'stale'|'partial'|'failed'|'completed'|'not_manual';
};
export type VerifyManualResult = VerifyCronResult;
const FIELDS=['runId','triggeredBy','cron','scheduledTime','startedAt','finishedAt','durationMs','lockAcquired','stateSaved','status','fatalError','symbolsScanned','symbolsResolved','symbolsSkipped','symbolsFailed','evaluationsSaved'];
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

async function verifyRun(db:any,kind:'cron'|'manual',now:number):Promise<VerifyCronResult>{
  const fields=await readStateField(db,kind==='cron'?EVALUATE_DUE_CRON_STATE_ID:EVALUATE_DUE_STATE_ID,FIELDS);
  const base={ok:false,keyExists:!!fields,updatedAt:typeof fields?._updatedAt==='string'?fields._updatedAt:null,ageMinutes:null as number|null,fields};
  if(!fields)return {...base,status:'missing',reason:kind==='cron'?'لا يوجد سجل محفوظ لتشغيل مجدول؛ تسجيل Trigger نفسه غير متحقق.':'لا يوجد آخر تشغيل محفوظ؛ لم نثبت تشغيلًا يدويًا.'};
  const end=Date.parse(String(fields.finishedAt)),start=Date.parse(String(fields.startedAt));
  if(fields._invalidJson||fields._omittedFields||!Number.isFinite(now)||!Number.isFinite(end)||!Number.isFinite(start)||new Date(start).toISOString()!==fields.startedAt||new Date(end).toISOString()!==fields.finishedAt||start>end||end>now||base.updatedAt!==fields.finishedAt)
    return {...base,status:'invalid',reason:'تواريخ التشغيل أو محتوى السجل غير صالح للتحقق؛ لا يُعتبر نجاحًا.'};
  base.ageMinutes=Math.floor((now-end)/60000);
  if(kind==='manual'&&fields.triggeredBy==='cron')return {...base,status:'not_manual',reason:'مفتاح آخر تشغيل يحتوي دورة Cron، وليس دليلًا على ضغط زر يدوي.'};
  if(fields.triggeredBy!==kind||fields.lockAcquired!==true||fields.stateSaved!==true||typeof fields.runId!=='string'||!fields.runId.length||!integer(fields.durationMs)||fields.durationMs!==end-start)
    return {...base,status:'invalid',reason:'هوية التشغيل أو قفله أو تأكيد حفظه غير مكتمل.'};
  if(kind==='cron'){
    const scheduled=fields.scheduledTime;
    if(fields.cron!==EVALUATE_DUE_CRON||!integer(scheduled)||scheduled>start||start-scheduled>3600000||scheduled%21600000!==0)
      return {...base,status:'invalid',reason:'لا تطابق بين موعد التشغيل المسجل والجدولة المطلوبة.'};
  }
  const counts=['symbolsScanned','symbolsResolved','symbolsSkipped','symbolsFailed','evaluationsSaved'];
  if(counts.some(k=>!integer(fields[k]))||Number(fields.symbolsResolved)+Number(fields.symbolsSkipped)+Number(fields.symbolsFailed)!==fields.symbolsScanned)
    return {...base,status:'invalid',reason:'عدادات الدورة ناقصة أو غير متسقة؛ لا نفترض الصفر.'};
  if(fields.status==='failed'||fields.fatalError)return {...base,status:'failed',reason:'سجل التشغيل يبين فشل الدورة؛ وجود المفتاح لا يثبت نجاحها.'};
  if(!['completed','partial'].includes(String(fields.status)))return {...base,status:'invalid',reason:'لم تُسجل دورة مكتملة أو جزئية صالحة.'};
  if(kind==='cron'&&now-end>420*60000)return {...base,status:'stale',reason:`آخر دورة قبل ${base.ageMinutes} دقيقة؛ تجاوزت حد المتابعة 7 ساعات لجدولة كل 6 ساعات.`};
  if(fields.status==='partial'||Number(fields.symbolsFailed)>0||Number(fields.symbolsSkipped)>0)return {...base,status:'partial',reason:`الدورة جزئية؛ فشل ${fields.symbolsFailed} رمز وتُرك ${fields.symbolsSkipped} دون تقييم جديد. لا تُصنف ناجحة بالكامل.`};
  return {...base,ok:true,status:'completed',reason:`دورة ${kind==='cron'?'مجدولة':'يدوية'} محفوظة قبل ${base.ageMinutes} دقيقة؛ فُحص ${fields.symbolsScanned} رمز وحُفظ ${fields.evaluationsSaved} تقييم. ${kind==='cron'?'هذا دليل من سجل التطبيق، وليس قراءة لإعدادات Trigger لدى الاستضافة.':''}`};
}
export const verifyCronState=(db:any,now=Date.now())=>verifyRun(db,'cron',now);
export const verifyManualState=(db:any,now=Date.now())=>verifyRun(db,'manual',now);

export async function verifyHeartbeatState(db:any){
  const [arrival,evaluation]=await Promise.all([readArrival(db),readEvaluation(db)]);
  const evidence={arrival,evaluation};
  if(arrival.status==='read-failed'||evaluation.status==='read-failed')return {ok:false,status:'unavailable',reason:'تعذرت قراءة سجل النبضة؛ لا يُعامل ذلك كغياب للسجل.',evidence};
  if(arrival.status==='missing'||evaluation.status==='missing')return {ok:false,status:'missing',reason:'لم تكتمل نبضة الوصول والتقييم؛ لا يوجد دليل إضافي على الدورة.',evidence};
  if(arrival.status!=='ok'||evaluation.status!=='ok')return {ok:false,status:'invalid',reason:'محتوى سجل النبضة غير صالح للتحقق.',evidence};
  const detail=evaluation.record.evaluation;
  if(arrival.record.event!=='arrival'||evaluation.record.event!=='evaluation'||arrival.record.runId!==evaluation.record.runId||arrival.record.at>evaluation.record.at||arrival.updatedAt!==arrival.record.at||evaluation.updatedAt!==evaluation.record.at||!detail)
    return {ok:false,status:'invalid',reason:'نبضتا الوصول والتقييم غير متطابقتين أو لم يتأكد حفظهما.',evidence};
  if(detail.state!=='completed'||detail.stateSaved!==true)return {ok:false,status:detail.state,reason:`وصلت المهمة وسُجلت نتيجة ${detail.state}؛ النبضة لا تحول التشغيل الجزئي أو الفاشل إلى نجاح.`,evidence};
  return {ok:true,status:'completed',reason:'تطابقت نبضتا الوصول والتقييم وتأكد حفظهما. هذا دليل من التطبيق، لا إثبات مستقل لتسجيل Trigger لدى الاستضافة.',evidence};
}

export async function verifyForecastSnapshot(db:any){
  // Categories are exclusive: an outcome is not necessarily a completed evaluation.
  const row=await db.prepare(`WITH classified AS (
    SELECT CASE WHEN f.available=0 THEN 'unavailable'
      WHEN o.id IS NULL THEN 'pending'
      WHEN json_valid(o.data)=0 THEN 'invalid'
      WHEN json_extract(o.data,'$.state')='complete' THEN 'evaluated'
      WHEN json_extract(o.data,'$.state')='excluded' THEN 'excluded' ELSE 'invalid' END AS state,
      o.evaluated_at FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id)
    SELECT COUNT(*) AS total, COALESCE(SUM(state='evaluated'),0) AS evaluated,
      COALESCE(SUM(state='pending'),0) AS pending, COALESCE(SUM(state='unavailable'),0) AS unavailable,
      COALESCE(SUM(state='excluded'),0) AS excluded, COALESCE(SUM(state='invalid'),0) AS invalid,
      MAX(evaluated_at) AS lastUpdated FROM classified`).first();
  if(!row||!integer(row.total))throw Error('snapshot-unavailable');
  const byStatus:Record<string,number>={};
  for(const k of ['evaluated','pending','unavailable','excluded','invalid']){if(!integer(row[k]))throw Error('snapshot-invalid');byStatus[k]=row[k];}
  return {total:row.total as number,byStatus,lastUpdated:row.lastUpdated as string|null};
}
export type VerifySnapshotResult=Awaited<ReturnType<typeof verifyForecastSnapshot>>;

export async function verifyIdempotency(db:any){
  const [counts,integrity]=await Promise.all([
    db.prepare('SELECT (SELECT COUNT(*) FROM forecast_outcomes) AS outcomeCount, (SELECT COUNT(*) FROM evaluation_revisions) AS revisionCount').first(),
    checkResolutionIntegrity(db),
  ]);
  if(!integer(counts?.outcomeCount)||!integer(counts?.revisionCount))throw Error('counts-unavailable');
  const observed=[integrity.outcomesDuplicates,integrity.consecutiveRevisionDuplicates,integrity.revisionNumberDuplicates];
  const integrityOk=observed.some(n=>n<0)?null:observed.every(n=>n===0);
  return {ok:false,proven:false,integrityOk,outcomeCount:counts.outcomeCount as number,revisionCount:counts.revisionCount as number,integrity,
    reason:integrityOk===null?'تعذر بعض فحوص الاتساق؛ عدم التكرار غير مثبت.':integrityOk===false?'رُصد تكرار يحتاج مراجعة؛ لم تُحذف سجلات.':'لم يُرصد تكرار بنيوي أو إصدار متطابق متتالٍ. إثبات عدم التكرار يحتاج تشغيلين مضبوطين بنفس المدخلات، وليس قراءة العدد وحده.'};
}

export async function verifyProductionState(db:any,now=Date.now()){
  // Preserve the successful checks when another read fails; never fabricate zero counts.
  const failed=()=>({ok:false,label:'تعذرت القراءة',details:'لم تتأكد الحالة من قاعدة البيانات.',status:'unavailable'});
  const [cron,manual,heartbeat,snapshot,idempotency]=await Promise.allSettled([verifyCronState(db,now),verifyManualState(db,now),verifyHeartbeatState(db),verifyForecastSnapshot(db),verifyIdempotency(db)]);
  const run=(r:typeof cron,kind:string)=>r.status==='fulfilled'?{...r.value,label:`${kind}: ${r.value.ok?'دورة ناجحة موثقة':'يحتاج تحققًا'}`,details:r.value.reason}:failed();
  const checks={cron:run(cron,'Cron'),manual:run(manual,'التشغيل اليدوي'),
    heartbeat:heartbeat.status==='fulfilled'?{...heartbeat.value,label:`النبضة: ${heartbeat.value.ok?'مكتملة':'غير مكتملة'}`,details:heartbeat.value.reason}:failed(),
    forecasts:snapshot.status==='fulfilled'?{...snapshot.value,ok:snapshot.value.total>0&&snapshot.value.byStatus.invalid===0,label:`التوقعات المحفوظة: ${snapshot.value.total}`,details:'هذه أعداد السجلات، وليست نسبة دقة أو إثبات ظهورها في الواجهة.'}:failed(),
    idempotency:idempotency.status==='fulfilled'?{...idempotency.value,label:'عدم التكرار: غير مثبت بهذه القراءة',details:idempotency.value.reason}:failed()};
  return {overall:[cron,manual,heartbeat,snapshot,idempotency].some(r=>r.status==='rejected')?'fail':'partial',timestamp:new Date(now).toISOString(),readOnly:true,
    scope:'قراءة تشغيلية فقط؛ لا تُشغّل المهام ولا تختبر التوصية أو المتصفح ولا تُثبت الجاهزية الكاملة.',checks};
}
