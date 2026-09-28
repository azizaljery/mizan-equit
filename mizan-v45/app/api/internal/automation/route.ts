import {readDailyArchiveStatus} from '@/lib/jobs/daily-forecast-archive.mjs';
import {env} from 'cloudflare:workers';
import deploymentIdentity from '@/lib/deployment-identity.json';
import {FOLLOWUP_STEP_VERSION} from '@/lib/screener-followup-step-core';
import {runMarketCollectionCycle,runForecastSeedCycle} from '@/worker/market-collector';
import {runResolutionCycle} from '@/worker/scheduled';
import {runCouncil,councilStatus,summarizeCouncil} from '@/lib/agents/council';
import {councilFollowupTask} from '@/lib/agents/followup-work';
import {readScreenerOperations} from '@/lib/screener-operations';
import {acceptFollowupProof,runScreenerFollowup,runScreenerFollowupStep,startScreenerFollowupAcceptance,readScreenerFollowupAcceptance} from '@/worker/screener-followup';

const headers={'Cache-Control':'no-store, private'};
async function equalSecret(a:string,b:string){
  if(!a||!b)return false;
  const enc=new TextEncoder(),[x,y]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(a)),
    crypto.subtle.digest('SHA-256',enc.encode(b)),
  ]);
  const aa=new Uint8Array(x),bb=new Uint8Array(y);let diff=aa.length^bb.length;
  for(let i=0;i<Math.min(aa.length,bb.length);i++)diff|=aa[i]^bb[i];
  return diff===0;
}
async function authorized(req:Request){
  const runtime=env as any,expected=String(runtime.MIZAN_INTERNAL_AUTOMATION_TOKEN||'');
  const supplied=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1]||'';
  return equalSecret(supplied,expected);
}
export async function POST(req:Request){
  if(!await authorized(req))return Response.json({error:'غير مصرح.'},{status:401,headers});
  try{
    const raw=await req.text();if(raw.length>10000)throw new Error('request-too-large');
    const body=raw?JSON.parse(raw):{},runtime=env as any,action=String(body?.action||'');
    if(action==='daily-archive-status')return Response.json(await readDailyArchiveStatus(runtime.DB),{headers});
    if(action==='status')return Response.json(await councilStatus(runtime.DB,runtime),{headers});
    if(action==='screener-operations')return Response.json(await readScreenerOperations(runtime.DB),{headers});
    if(runtime.MIZAN_BACKGROUND_CRON_ENABLED!=='true')return Response.json({error:'المهام متوقفة من الإعدادات.'},{status:503,headers});
    if(action==='runtime-ready')return Response.json({status:'ready',backgroundCronEnabled:true,followupVersion:FOLLOWUP_STEP_VERSION,worker:deploymentIdentity.worker,commit:deploymentIdentity.commit},{headers});
    if(action==='followup-acceptance-status')return Response.json({status:'ok',acceptance:await readScreenerFollowupAcceptance(runtime.DB)},{headers});
    if(action==='followup-acceptance-start')return Response.json({status:'ok',acceptance:await startScreenerFollowupAcceptance(runtime.DB,body.config,deploymentIdentity.commit)},{headers});
    if(action==='followup-run')return Response.json(await runScreenerFollowup(runtime.DB,{trigger:'manual',requestKey:body.requestKey,config:body.config}),{headers});
    if(action==='followup-step')return Response.json(await runScreenerFollowupStep(runtime.DB,{trigger:'manual',requestKey:body.requestKey,config:body.config}),{headers});
    if(action==='followup-accept')return Response.json(await acceptFollowupProof(runtime.DB,body.runIds,body.config,body.enable===true),{headers});
    if(action==='collect'){
      const result=await runMarketCollectionCycle(runtime.DB,{cron:'manual',scheduledTime:Date.now()});
      return Response.json({action,status:result.status,stateSaved:result.stateSaved,symbolsAttempted:result.symbolsAttempted,observationsSaved:result.observationsSaved,markets:result.markets,errors:result.errors},{headers});
    }
    if(action==='seed'){
      const result=await runForecastSeedCycle(runtime.DB,{cron:'manual',scheduledTime:Date.now()});
      return Response.json({action,status:result.status,stateSaved:result.stateSaved,symbolsAttempted:result.symbolsAttempted,analysesRecorded:result.analysesRecorded,forecastRowsSaved:result.forecastRowsSaved,availableForecastRows:result.availableForecastRows,skippedAlreadyRecorded:result.skippedAlreadyRecorded,markets:result.markets,errors:result.errors},{headers});
    }
    if(action==='resolve'){
      const result=await runResolutionCycle(runtime.DB,{limit:2,triggeredBy:'manual'});
      return Response.json({action,status:result.status,stateSaved:result.stateSaved,symbolsScanned:result.symbolsScanned,symbolsResolved:result.symbolsResolved,symbolsSkipped:result.symbolsSkipped,symbolsFailed:result.symbolsFailed,evaluationsSaved:result.evaluationsSaved,errors:result.errors,integrity:result.integrity},{headers});
    }
    if(action==='council'){
      const task=typeof body?.task==='string'&&body.task.trim()?body.task:'راجع جاهزية منظومة ميزان بعد النشر الأخير، وجودة بيانات السوق السعودي والأمريكي، وسلامة مسار التوقع والقياس، ثم أعد تقريرًا للمالك دون أي إجراء تلقائي.';
      const key=body.requestKey??`manual:${crypto.randomUUID()}`;
      const work=await councilFollowupTask(runtime.DB,key,task);
      const result=await runCouncil(runtime.DB,runtime,{task:work.task,trigger:'deployment',requestKey:key});
      const reports=body.includeReports===true?{rdManager:result.rdManager?.text??null,developer:result.developer?.text??null,securityReviewer:result.securityReviewer?.decision?.report??null}:undefined;
      return Response.json({action,...summarizeCouncil(result),reports,workKey:work.key,assignedTaskIds:work.taskIds,
        quant:result.quant?{byMarketHorizonModel:result.quant.byMarketHorizonModel,accuracyRows:result.quant.accuracyRows,calibrationNote:result.quant.calibrationNote}:null},{headers});
    }
    return Response.json({error:'إجراء غير معروف.'},{status:400,headers});
  }catch{return Response.json({error:'تعذر تشغيل الإجراء الداخلي.'},{status:500,headers});}
}
