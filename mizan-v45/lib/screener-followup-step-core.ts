import {validateFollowupConfig,type FollowupConfig} from './screener-operations-core';

export const FOLLOWUP_STEP_VERSION='screener-followup-step-v3';
/** A batch whose invocation is killed (CPU/wall limit) never reaches catch; the attempt is
 * persisted BEFORE deps.batch so the same batch cannot kill every later invocation forever. */
export const MAX_BATCH_ATTEMPTS=3;
export type StepMarketState={
 state:'pending'|'scanning'|'retryable'|'complete'|'failed';
 runId:string|null;planned:number;batchSize:number;nextBatch:number;
 scanned:number;analyzed:number;failed:number;eligible:number;
 selected?:number;fingerprint?:string;lastError?:string;
 /** Attempts already started for batch `attemptBatch` (persisted before each try). */
 attemptBatch?:number;batchAttempts?:number;
};
export type StepProgress={
 version:string;status:'running'|'partial'|'completed'|'failed';startedAt:string;updatedAt:string;finishedAt:string|null;
 config:FollowupConfig;markets:{sa:StepMarketState;us:StepMarketState};nextMarket:'sa'|'us';stateSaved:boolean;
};
export type StepDeps={
 create:(input:any)=>Promise<{runId:string;symbols:any[];batchSize:number}>;
 batch:(runId:string,index:number)=>Promise<any>;
 finish:(runId:string)=>Promise<any>;
 save:(progress:StepProgress)=>Promise<void>;
 now:()=>number;
};
const freshMarket=():StepMarketState=>({state:'pending',runId:null,planned:0,batchSize:0,nextBatch:0,scanned:0,analyzed:0,failed:0,eligible:0});
function sameConfig(a:FollowupConfig,b:FollowupConfig){return a.enabled===b.enabled&&a.intervalHours===b.intervalHours&&a.scanPerMarket===b.scanPerMarket&&a.resultCount===b.resultCount&&a.horizonSessions===b.horizonSessions;}
function validPrevious(p:any,config:FollowupConfig):p is StepProgress{
 return !!p&&p.version===FOLLOWUP_STEP_VERSION&&p.config&&sameConfig(p.config,config)&&p.markets?.sa&&p.markets?.us&&['sa','us'].includes(p.nextMarket);
}
function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value));}
export async function executeFollowupStep(config:FollowupConfig,previous:unknown,deps:StepDeps,maxBatchesTotal=1):Promise<StepProgress>{
 validateFollowupConfig(config);
 if(!Number.isInteger(maxBatchesTotal)||maxBatchesTotal<1||maxBatchesTotal>10)throw Error('invalid-step-batch-count');
 const now=deps.now();
 let progress:StepProgress;
 if(previous==null)progress={version:FOLLOWUP_STEP_VERSION,status:'running',startedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),finishedAt:null,config:clone(config),markets:{sa:freshMarket(),us:freshMarket()},nextMarket:'sa',stateSaved:false};
 else if(validPrevious(previous,config))progress=clone(previous);
 else throw Error('followup-state-mismatch');
 if(progress.status==='completed'||progress.status==='failed')return {...progress,stateSaved:true};
 const save=async()=>{progress.updatedAt=new Date(deps.now()).toISOString();await deps.save(clone({...progress,stateSaved:true}));progress.stateSaved=true;};
 const hadError=new Set<'sa'|'us'>();
 for(const market of ['sa','us'] as const){
  const m=progress.markets[market];
  if(m.state==='complete'||m.state==='failed')continue;
  if(m.state==='retryable')m.state='scanning';
  if(!m.runId){
   try{
    const h=await deps.create({market,scanLimit:config.scanPerMarket,resultCount:config.resultCount,horizonSessions:config.horizonSessions});
    if(!h?.runId||!Array.isArray(h.symbols)||h.symbols.length!==config.scanPerMarket||!Number.isInteger(h.batchSize)||h.batchSize<1)throw Error('invalid-server-plan');
    Object.assign(m,{state:'scanning',runId:h.runId,planned:h.symbols.length,batchSize:h.batchSize,nextBatch:0,scanned:0,analyzed:0,failed:0,eligible:0,lastError:undefined});
   }catch{m.state='retryable';m.lastError='plan-failed';hadError.add(market);}
   await save();
  }
 }
 let processed=0;
 while(processed<maxBatchesTotal){
  const preferred=progress.nextMarket,other=preferred==='sa'?'us':'sa';
  let market:'sa'|'us'|null=null;
  for(const candidate of [preferred,other] as const){
   const m=progress.markets[candidate];
   if(m.state==='scanning'&&!hadError.has(candidate)&&m.runId&&m.nextBatch<Math.ceil(m.planned/m.batchSize)){market=candidate;break;}
  }
  if(!market)break;
  const m=progress.markets[market],expected=Math.ceil(m.planned/m.batchSize);
  const attempts=m.attemptBatch===m.nextBatch?(m.batchAttempts??0):0;
  if(attempts>=MAX_BATCH_ATTEMPTS){
   // Server batches are strictly ordered, so a poisoned batch cannot be skipped; close this
   // market's cohort as failed (honestly, unsealed) and let the other market continue.
   m.state='failed';m.lastError='batch-attempts-exhausted';hadError.add(market);progress.nextMarket=market==='sa'?'us':'sa';
   await save();continue;
  }
  m.attemptBatch=m.nextBatch;m.batchAttempts=attempts+1;
  await save();
  try{
   const b=await deps.batch(m.runId!,m.nextBatch);
   const expectedScanned=Math.min(m.batchSize,m.planned-m.scanned);
   if(!['scanned','analyzed','failed','eligible'].every(k=>Number.isInteger(b?.[k])&&b[k]>=0)||b.scanned!==expectedScanned||b.analyzed+b.failed!==b.scanned||b.eligible>b.analyzed)throw Error('invalid-batch-counters');
   m.scanned+=b.scanned;m.analyzed+=b.analyzed;m.failed+=b.failed;m.eligible+=b.eligible;m.nextBatch++;m.lastError=undefined;m.batchAttempts=0;m.attemptBatch=m.nextBatch;
   if(m.nextBatch===expected){
    const end=await deps.finish(m.runId!);
    if(end?.status!=='complete'||end?.integrity!==true)throw Error('unsealed-server-archive');
    m.state='complete';m.selected=Array.isArray(end.picks)?end.picks.length:0;m.fingerprint=end.fingerprint;
   }
   progress.nextMarket=market==='sa'?'us':'sa';processed++;
  }catch{m.state='retryable';m.lastError='batch-or-seal-failed';hadError.add(market);progress.nextMarket=market==='sa'?'us':'sa';}
  await save();
 }
 const complete=Object.values(progress.markets).every(m=>m.state==='complete');
 const terminal=Object.values(progress.markets).every(m=>m.state==='complete'||m.state==='failed');
 progress.status=complete?'completed':terminal?'failed':hadError.size?'partial':'running';
 if(terminal)progress.finishedAt=new Date(deps.now()).toISOString();
 await save();
 return progress;
}
