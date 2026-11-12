/**
 * BOT-0001 paper-trading step. Own invocation: MAINTENANCE_SLOT_CRON at 09:30 and 16:30 UTC (mid-session for Tadawul and the US market).
 * Paper money only; the step reads saved public forecasts and live quotes, writes append-only decisions/orders/fills, and never contacts a broker.
 * Lock + state follow the daily-picks pattern; the budget stays inside the 5-minute lease.
 */
import {MAINTENANCE_SLOT_CRON,slotJob} from '../lib/jobs/cron-slots';
import {configuredReader} from '../lib/source-status';
import {readSettings} from '../lib/site-settings';
import {tryAcquireLock,releaseLock} from './scheduled';
import {runBotStep,type BotSignal,type BotStepSummary} from '../lib/bot/runner';
import {recordedSignals,resolveSignalOutcomes,liveFetchers} from '../lib/bot/data';

export const PAPER_BOT_CRON=MAINTENANCE_SLOT_CRON;
export const PAPER_BOT_STATE_ID='job:paper-bot:last';
const LOCK_ID='cron:paper-bot:v1';
const LOCK_MS=5*60*1000;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);
export type PaperBotSummary={runId:string;startedAt:string;finishedAt:string;durationMs:number;triggeredBy:'cron'|'manual';status:'completed'|'partial'|'failed'|'locked';
 step:BotStepSummary|null;errors:string[];stateSaved:boolean};

export async function runPaperBot(db:any,options:{triggeredBy:'cron'|'manual';now?:number;experimentId?:string;maxFetches?:number;read?:any;collectSignals?:(db:any,market:'sa'|'us',now:number)=>Promise<BotSignal[]>}):Promise<PaperBotSummary>{
 const start=Date.now(),now=options.now??start,s:PaperBotSummary={runId:crypto.randomUUID(),startedAt:new Date(start).toISOString(),finishedAt:'',durationMs:0,triggeredBy:options.triggeredBy,status:'completed',step:null,errors:[],stateSaved:false};
 let token:string|null=null;
 try{
  token=await tryAcquireLock(db,LOCK_ID,LOCK_MS);
  if(!token){s.status='locked';s.finishedAt=new Date().toISOString();s.durationMs=Date.now()-start;return s;}
  const read=options.read??await configuredReader(db,await readSettings(db)),f=liveFetchers(read,new Date(now).toISOString().slice(0,10));
  s.step=await runBotStep(db,now,{experimentId:options.experimentId,maxFetches:options.maxFetches,collectSignals:options.collectSignals??((d,m,n)=>recordedSignals(d,m,n)),fetchQuote:f.fetchQuote,fetchBars:f.fetchBars});
  try{for(const m of ['sa','us'] as const)await resolveSignalOutcomes(db,m,f.fetchBars);}catch(e){s.errors.push('outcomes: '+errorText(e));}
  for(const e of s.step.experiments)if(e.error){s.errors.push(`${e.id}: ${e.error}`);s.status='partial';}
 }catch(e){console.error('[mizan-paper-bot]','cycle',errorText(e));s.status='failed';s.errors.push(errorText(e));}
 finally{
  if(token||s.status==='failed'){
   s.finishedAt=new Date().toISOString();s.durationMs=Date.parse(s.finishedAt)-start;s.stateSaved=true;
   try{await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(PAPER_BOT_STATE_ID,JSON.stringify(s),s.finishedAt).run();}
   catch(e){s.stateSaved=false;console.error('[mizan-paper-bot]','save-state',errorText(e));}
  }
  if(token)await releaseLock(db,LOCK_ID,token);
 }
 return s;
}

export async function scheduledPaperBot(controller:{cron:string;scheduledTime?:number},env:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string}){
 if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==PAPER_BOT_CRON||slotJob(controller)!=='paper-bot')return;
 const r=await runPaperBot(env.DB,{triggeredBy:'cron',now:Number.isFinite(controller.scheduledTime)?Number(controller.scheduledTime):undefined});
 console.log('[mizan-paper-bot]',JSON.stringify({status:r.status,durationMs:r.durationMs,experiments:(r.step?.experiments||[]).map(e=>({id:e.id,decisions:e.decisions,orders:e.orders,fills:e.fills,fetches:e.fetches,budget:e.budgetExhausted,error:e.error})),errors:r.errors.length}));
 return r;
}
