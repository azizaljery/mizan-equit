import {ACCURACY_SAMPLE_CRON} from '../lib/jobs/accuracy-schedule';
import {runCouncil,summarizeCouncil} from '../lib/agents/council';
import {councilFollowupTask} from '../lib/agents/followup-work';
export const COUNCIL_CRON=ACCURACY_SAMPLE_CRON;
export async function scheduledCouncil(controller:{cron:string;scheduledTime:number},runtime:any){
  if(runtime.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==COUNCIL_CRON)return;
  const requestKey=`cron:${controller.scheduledTime}`;
  const work=await councilFollowupTask(runtime.DB,requestKey,'راجع جودة المصادر، اكتمال مسوح السوقين، الأرشيف والنتائج الناضجة، ثم قدم إصلاحات محدودة واختبارات قبول. لا تنفذ Merge أو Deploy.');
  // runCouncil owns the shared lease for cron, manual and deployment calls.
  const result=await runCouncil(runtime.DB,runtime,{
    trigger:'cron',requestKey,
    task:work.task,
  });
  console.log('[mizan-council]',JSON.stringify({...summarizeCouncil(result),workKey:work.key,assignedTasks:work.taskIds}));
  if(result.status==='failed')throw new Error('Council run failed; inspect council_runs.');
  return result;
}
