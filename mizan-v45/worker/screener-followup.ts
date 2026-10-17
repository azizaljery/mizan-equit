/** Resumable screener followup. Existing long-run entry remains for compatibility/tests. */
import {createScreenerArchive,archivedScreenerBatch,finishScreenerArchive,createServerScreenerArchive,serverScreenerBatch,finishServerScreenerArchive} from '../lib/screener-archive';
import {readFollowupConfig,FOLLOWUP_LAST_ID} from '../lib/screener-operations';
import {validateFollowupConfig,periodicSlot,type FollowupConfig} from '../lib/screener-operations-core';
import {executeFollowup} from '../lib/screener-followup-core';
import {executeFollowupStep,FOLLOWUP_STEP_VERSION,type StepProgress} from '../lib/screener-followup-step-core';
import {SCREENER_FOLLOWUP_CRON} from '../lib/jobs/screener-followup-schedule';
import {tryAcquireLock,releaseLock} from './scheduled';
const LOCK='cron:screener-followup:v1',STEP_LOCK='cron:screener-followup-step:v2',ACTIVE_ID='job:screener-followup:active:v3';
export const FOLLOWUP_ACCEPTANCE_ID='job:screener-followup:acceptance:v1';
export const FOLLOWUP_ACCEPTANCE_VERSION='screener-followup-acceptance-v1';
const ACTIVE_MAX_AGE=36*60*60*1000,STEP_BATCHES_TOTAL=2;
async function write(db:any,key:string,value:any){const at=new Date().toISOString();const saved=await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),at).run();if(saved?.success===false)throw Error('followup-state-save-failed');}
async function read(db:any,key:string){const row=await db.prepare('SELECT data,updated_at FROM research_state WHERE id=?').bind(key).first();if(!row)return null;try{return {data:JSON.parse(row.data),updatedAt:row.updated_at};}catch{throw Error('followup-state-invalid');}}
function sameConfig(a:any,b:FollowupConfig){return !!a&&a.enabled===b.enabled&&a.intervalHours===b.intervalHours&&a.scanPerMarket===b.scanPerMarket&&a.resultCount===b.resultCount&&a.horizonSessions===b.horizonSessions;}
const validRelease=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);

export async function runScreenerFollowup(db:any,options:{trigger:'cron'|'manual';scheduledTime?:number;requestKey?:string;config?:FollowupConfig}){
 const configured=await readFollowupConfig(db),config=options.config?validateFollowupConfig(options.config):configured.config;
 if(options.trigger==='cron'&&!config.enabled)return {status:'disabled',stateSaved:false};
 if(options.trigger==='cron'&&options.config)throw Error('scheduled-config-override-refused');
 if(options.trigger==='manual'&&(!options.requestKey||!/^[A-Za-z0-9:._-]{1,120}$/.test(options.requestKey)))throw Error('manual-request-key-required');
 const at=options.scheduledTime??Date.now(),slot=periodicSlot(at,config);
 const key=options.trigger==='cron'?`screener:followup:cycle:${configured.updatedAt??'default'}:${slot}`:`screener:followup:manual:${options.requestKey}`;
 const lease=await tryAcquireLock(db,LOCK,13*60000);if(!lease)return {status:'locked',stateSaved:false};
 try{
  const existing=await db.prepare('SELECT data FROM research_state WHERE id=?').bind(key).first();
  if(existing)return {...JSON.parse(existing.data),reused:true};
  return await executeFollowup(config,{create:input=>createScreenerArchive(db,input),batch:(id,token,index)=>archivedScreenerBatch(db,id,token,index),finish:(id,token)=>finishScreenerArchive(db,id,token),now:()=>Date.now(),
   save:async progress=>{const record={...progress,cycleKey:key,trigger:options.trigger,scheduledTime:options.scheduledTime??null,config,sessionNote:'إصدار توقع لكل رمز أثناء الدورة؛ لا نمثل القائمة كلقطة أسعار متزامنة.'};await write(db,key,record);await write(db,FOLLOWUP_LAST_ID,record);},
  });
 }finally{await releaseLock(db,LOCK,lease);}
}

/** Short bounded step that can resume the same server-owned cohorts across invocations. */
export async function runScreenerFollowupStep(db:any,options:{trigger:'cron'|'manual';scheduledTime?:number;requestKey?:string;config?:FollowupConfig}){
 const configured=await readFollowupConfig(db),config=options.config?validateFollowupConfig(options.config):configured.config;
 if(options.trigger==='cron'&&!config.enabled)return {status:'disabled',stateSaved:false,version:FOLLOWUP_STEP_VERSION};
 if(options.trigger==='cron'&&options.config)throw Error('scheduled-config-override-refused');
 if(options.trigger==='manual'&&(!options.requestKey||!/^[A-Za-z0-9:._-]{1,120}$/.test(options.requestKey)))throw Error('manual-request-key-required');
 const now=options.scheduledTime??Date.now();
 const lease=await tryAcquireLock(db,STEP_LOCK,3*60*1000);if(!lease)return {status:'locked',stateSaved:false,version:FOLLOWUP_STEP_VERSION};
 try{
  let key:string,previous:StepProgress|null=null;
  if(options.trigger==='manual'){
   key=`screener:followup:step:manual:${options.requestKey}`;
   previous=(await read(db,key))?.data??null;
  }else{
   const active=await read(db,ACTIVE_ID),p=active?.data as any;
   const age=p?.startedAt?Date.now()-Date.parse(p.startedAt):Infinity;
   if(p&&p.version===FOLLOWUP_STEP_VERSION&&sameConfig(p.config,config)&&p.status!=='completed'&&p.status!=='failed'&&age<=ACTIVE_MAX_AGE){
    key=String(p.cycleKey);previous=p;
   }else if(p&&p.version===FOLLOWUP_STEP_VERSION&&sameConfig(p.config,config)&&(p.status==='completed'||p.status==='failed')&&Number.isFinite(Date.parse(p.finishedAt))&&Date.now()-Date.parse(p.startedAt)<config.intervalHours*3600000){
    return {...p,reused:true,stateSaved:true};
   }else{
    key=`screener:followup:step:cron:${now}`;previous=null;
   }
  }
  const save=async(progress:StepProgress)=>{
   const record={...progress,cycleKey:key,trigger:options.trigger,scheduledTime:options.scheduledTime??null,config,
    sessionNote:'المتابعة تُجزّأ إلى دفعات قصيرة قابلة للاستئناف؛ التوقع الأصلي لا يُعاد توليده ولا تُخزن رموز صلاحية عامة.'};
   await write(db,key,record);await write(db,FOLLOWUP_LAST_ID,record);if(options.trigger==='cron')await write(db,ACTIVE_ID,record);
  };
  return await executeFollowupStep(config,previous,{create:input=>createServerScreenerArchive(db,input),batch:(id,index)=>serverScreenerBatch(db,id,index),finish:id=>finishServerScreenerArchive(db,id),save,now:()=>Date.now()},STEP_BATCHES_TOTAL);
 }finally{await releaseLock(db,STEP_LOCK,lease);}
}
export async function readScreenerFollowupAcceptance(db:any){
 const row=await read(db,FOLLOWUP_ACCEPTANCE_ID);
 return row?{...row.data,updatedAt:row.updatedAt}:null;
}
export async function startScreenerFollowupAcceptance(db:any,input:unknown,release:unknown){
 const base=(input&&typeof input==='object'&&!Array.isArray(input))?input as Record<string,unknown>:{};
 const config=validateFollowupConfig({...base,enabled:false});
 if(!validRelease(release))throw Error('invalid-acceptance-release');
 const existing=await readScreenerFollowupAcceptance(db);
 if(existing&&existing.version===FOLLOWUP_ACCEPTANCE_VERSION&&existing.state==='running'&&sameConfig(existing.config,config)&&existing.release===release)return {...existing,reused:true};
 const now=new Date().toISOString();
 const record={version:FOLLOWUP_ACCEPTANCE_VERSION,id:crypto.randomUUID(),state:'running',release,config,requestedAt:now,updatedAt:now,activateOnComplete:true,progress:null,proof:null,error:null};
 await write(db,FOLLOWUP_ACCEPTANCE_ID,record);return {...record,reused:false};
}
export const ACCEPTANCE_MAX_AGE_MS=72*3600*1000;
async function advanceAcceptance(db:any,scheduledTime:number){
 const acceptance=await readScreenerFollowupAcceptance(db);
 if(!acceptance||acceptance.version!==FOLLOWUP_ACCEPTANCE_VERSION||acceptance.state!=='running')return {status:'disabled',acceptanceState:acceptance?.state??'none'};
 // Its cohort runs expire on the server after SERVER_MAX_RUN_AGE (36 h); past that every step fails with
 // batch-or-seal-failed and the 5-minute cron retried forever (observed: running since 2026-09-27). Close it honestly.
 if(Date.now()-Date.parse(acceptance.requestedAt)>ACCEPTANCE_MAX_AGE_MS){
  const record={...acceptance,state:'failed',error:'acceptance-run-expired',updatedAt:new Date().toISOString(),completedAt:new Date().toISOString(),lastScheduledTime:scheduledTime};
  await write(db,FOLLOWUP_ACCEPTANCE_ID,record);
  return {status:'failed',acceptanceState:'failed',stateSaved:true,progress:acceptance.progress??null,proof:null};
 }
 const result=await runScreenerFollowupStep(db,{trigger:'manual',requestKey:'acceptance.'+acceptance.id,config:acceptance.config});
 const summary={version:result.version,status:result.status,stateSaved:result.stateSaved,markets:Object.fromEntries(['sa','us'].map(m=>[m,{state:result.markets?.[m]?.state??null,runId:result.markets?.[m]?.runId??null,planned:result.markets?.[m]?.planned??0,scanned:result.markets?.[m]?.scanned??0,analyzed:result.markets?.[m]?.analyzed??0,failed:result.markets?.[m]?.failed??0,nextBatch:result.markets?.[m]?.nextBatch??0,fingerprint:result.markets?.[m]?.fingerprint??null}]))};
 const record:any={...acceptance,updatedAt:new Date().toISOString(),lastScheduledTime:scheduledTime,progress:summary};
 if(result.status==='completed'){
  const ids=['sa','us'].map(m=>(result.markets as any)?.[m]?.runId).filter(Boolean);
  try{const proof=await acceptFollowupProof(db,ids,acceptance.config,true);Object.assign(record,{state:'accepted',proof,error:null,completedAt:new Date().toISOString()});}
  catch(error){console.error('[mizan-screener-followup]','acceptance-gate',acceptance.id,(error instanceof Error?error.message:String(error)).slice(0,200));Object.assign(record,{state:'failed',error:'cohort-acceptance-gate-failed',completedAt:new Date().toISOString()});}
 }else if(result.status==='failed'){
  // A market batch exhausted its attempts (see MAX_BATCH_ATTEMPTS); the cohort cannot be sealed.
  Object.assign(record,{state:'failed',error:'cohort-batch-attempts-exhausted',completedAt:new Date().toISOString()});
 }
 await write(db,FOLLOWUP_ACCEPTANCE_ID,record);
 return {status:result.status,acceptanceState:record.state,stateSaved:result.stateSaved,progress:summary,proof:record.proof??null};
}
export async function scheduledScreenerFollowup(controller:{cron:string;scheduledTime:number},env:any){
 if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==SCREENER_FOLLOWUP_CRON)return;
 const configured=await readFollowupConfig(env.DB);
 const result=configured.config.enabled
  ?await runScreenerFollowupStep(env.DB,{trigger:'cron',scheduledTime:controller.scheduledTime})
  :await advanceAcceptance(env.DB,controller.scheduledTime);
 console.log('[mizan-screener-followup]',JSON.stringify({version:(result as any).version??FOLLOWUP_STEP_VERSION,status:result.status,stateSaved:(result as any).stateSaved===true,reused:(result as any).reused===true,acceptanceState:(result as any).acceptanceState??null}));
 return result;
}
/** Accept only cohorts re-read from the server, never submitted prices or winners. */
export async function acceptFollowupProof(db:any,ids:unknown,input:unknown,enable=false){
 if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||ids.some(x=>typeof x!=='string'||!/^[a-f0-9-]{36}$/.test(x)))throw Error('invalid-cohort-ids');
 const config=validateFollowupConfig(input);
 const {readScreenerArchiveForOwner}=await import('../lib/screener-archive');
 const {saveFollowupConfig}=await import('../lib/screener-operations');
 const archives=await Promise.all(ids.map(id=>readScreenerArchiveForOwner(db,id))),markets:any={},versions=new Set();
 for(const a of archives){const r=a.frozen?.result;
  if(a.status!=='complete'||a.integrity!==true||!r||!['sa','us'].includes(r.market)||markets[r.market]||r.scanned!==config.scanPerMarket||r.failed!==0||r.horizonSessions!==config.horizonSessions||r.requestedResultCount!==config.resultCount||!Number.isFinite(Date.parse(a.nominatedAt))||Date.parse(a.nominatedAt)>Date.now()||Date.now()-Date.parse(a.nominatedAt)>2*3600000)throw Error('cohort-not-acceptable');
  versions.add(r.modelVersion);markets[r.market]={state:'complete',runId:a.runId,planned:r.scanned,scanned:r.scanned,analyzed:r.analyzed,failed:r.failed,eligible:r.eligible,selected:r.returned,fingerprint:a.fingerprint};
 }
 if(versions.size!==1||!markets.sa||!markets.us)throw Error('inconsistent-cohort-proof');
 const result={status:'completed',trigger:'manual',stateSaved:true,config,markets,startedAt:archives.map(a=>a.createdAt).sort()[0],finishedAt:new Date().toISOString(),acceptance:'complete-source-collection; not predictive accuracy or investment approval'};
 const proofKey='screener:followup:accepted:'+ids.join(':');await write(db,proofKey,result);await write(db,FOLLOWUP_LAST_ID,result);
 if(enable)await saveFollowupConfig(db,{...config,enabled:true});
 return {status:'accepted',enabled:enable,proofKey,markets};
}
