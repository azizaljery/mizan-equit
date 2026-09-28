import {readStateField} from './read-state';
export const EVALUATE_DUE_CRON='0 */6 * * *';
export const EVALUATE_DUE_STATE_ID='job:evaluate-due:last';
export const EVALUATE_DUE_CRON_STATE_ID='job:evaluate-due:last-cron';

/** Only a persisted scheduled invocation is evidence; manual runs do not prove Cron. */
export async function forecastSchedulerStatus(db:any){
  const base={configured:false,codeConfigured:true,cron:EVALUATE_DUE_CRON,timezone:'UTC',lastRunAt:null as string|null};
  try{
    const run=await readStateField(db,EVALUATE_DUE_CRON_STATE_ID,['triggeredBy','cron','lockAcquired','stateSaved','status','fatalError','scheduledTime','finishedAt','symbolsScanned','symbolsFailed','evaluationsSaved']);
    const valid=run?.triggeredBy==='cron'&&run.cron===EVALUATE_DUE_CRON&&run.lockAcquired===true&&run.stateSaved===true
      &&typeof run.status==='string'&&['completed','partial'].includes(run.status)&&!run.fatalError&&Number.isFinite(run.scheduledTime)
      &&typeof run.finishedAt==='string'&&Number.isFinite(Date.parse(run.finishedAt))&&run._updatedAt===run.finishedAt;
    if(!valid)return {...base,message:'الكود مهيأ؛ لم يُسجل تشغيل Cron ناجح يمكن التحقق منه.'};
    return {...base,configured:true,lastRunAt:run.finishedAt,lastResult:{status:run.status,symbolsScanned:run.symbolsScanned,
      symbolsFailed:run.symbolsFailed,evaluationsSaved:run.evaluationsSaved},
      message:'رُصد تشغيل فعلي للمجدول في '+run.finishedAt+'؛ حالة آخر دورة: '+run.status};
  }catch{return {...base,message:'تعذرت قراءة سجل المجدول؛ حالة التشغيل غير متحققة.'};}
}
