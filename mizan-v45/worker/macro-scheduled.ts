/** Daily macro-data refresh. Own invocation: MAINTENANCE_SLOT_CRON at 03:30 UTC. Descriptive data only; nothing here feeds a score or decision. */
import {MAINTENANCE_SLOT_CRON,slotJob} from '../lib/jobs/cron-slots';
import {tryAcquireLock,releaseLock} from './scheduled';
import {collectMacro,type MacroSummary} from '../lib/macro/collect';

export const MACRO_CRON=MAINTENANCE_SLOT_CRON;
export const MACRO_STATE_ID='job:macro:last';
const LOCK_ID='cron:macro:v1',LOCK_MS=5*60*1000;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);
const http=async(url:string)=>{const r=await fetch(url,{headers:{'user-agent':'mizan-macro/1.0'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('http_'+r.status);return r.text();};

export async function runMacro(db:any,options:{now?:number;fetchText?:(u:string)=>Promise<string>}={}){
 const start=Date.now(),now=options.now??start,res:{status:'completed'|'partial'|'failed'|'locked';summary:MacroSummary|null;errors:string[]}={status:'completed',summary:null,errors:[]};
 let token:string|null=null;
 try{
  token=await tryAcquireLock(db,LOCK_ID,LOCK_MS);
  if(!token){res.status='locked';return res;}
  res.summary=await collectMacro(db,now,options.fetchText??http);
  for(const s of res.summary.series)if(s.error){res.errors.push(`${s.id}: ${s.error}`);res.status='partial';}
 }catch(e){res.status='failed';res.errors.push(errorText(e));}
 finally{
  if(token||res.status==='failed'){try{await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(MACRO_STATE_ID,JSON.stringify({...res,at:new Date().toISOString(),durationMs:Date.now()-start}),new Date().toISOString()).run();}catch(e){console.error('[mizan-macro]','save-state',errorText(e));}}
  if(token)await releaseLock(db,LOCK_ID,token);
 }
 return res;
}
export async function scheduledMacro(controller:{cron:string;scheduledTime?:number},env:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string}){
 if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==MACRO_CRON||slotJob(controller)!=='macro')return;
 const r=await runMacro(env.DB,{now:Number.isFinite(controller.scheduledTime)?Number(controller.scheduledTime):undefined});
 console.log('[mizan-macro]',JSON.stringify({status:r.status,inserted:r.summary?.inserted,errors:r.errors}));
 return r;
}
