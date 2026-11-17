/** Daily macro-data refresh. Own invocation: MAINTENANCE_SLOT_CRON at 03:30 UTC. Descriptive data only; nothing here feeds a score or decision. */
import {MAINTENANCE_SLOT_CRON,slotJob} from '../lib/jobs/cron-slots';
import {tryAcquireLock,releaseLock} from './scheduled';
import {collectMacro,type MacroSummary} from '../lib/macro/collect';
import {configuredReader} from '../lib/source-status';
import {FRED_API_URL} from '../lib/macro/series';
import {fredApiToCsv} from '../lib/macro/parse';

export const MACRO_CRON=MAINTENANCE_SLOT_CRON;
export const MACRO_STATE_ID='job:macro:last';
const LOCK_ID='cron:macro:v1',LOCK_MS=5*60*1000;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,200);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** Up to 3 attempts (1 s, 2 s pause) on timeouts and 5xx; browser-like headers because some hosts reject unknown clients. 4xx is not retried. */
const http=async(url:string)=>{
 let last='';
 for(let a=0;a<3;a++){
  if(a)await sleep(1000*a);
  try{
   const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; mizan-macro/1.1)','accept':'text/csv,application/json;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
   if(r.ok)return r.text();
   last='http_'+r.status;if(r.status<500)break;
  }catch(e){last=errorText(e);}
 }
 throw new Error(last);
};

export async function runMacro(db:any,options:{now?:number;fetchText?:(u:string)=>Promise<string>;fredApiKey?:string}={}){
 const start=Date.now(),now=options.now??start,res:{status:'completed'|'partial'|'failed'|'locked';summary:MacroSummary|null;errors:string[]}={status:'completed',summary:null,errors:[]};
 let token:string|null=null;
 try{
  token=await tryAcquireLock(db,LOCK_ID,LOCK_MS);
  if(!token){res.status='locked';return res;}
  let fetchText=options.fetchText;
  if(!fetchText){
   // Yahoo goes through the site's configured reader (same source rules, pauses and headers as prices); FRED and the World Bank use plain fetch.
   const read=await configuredReader(db);
   const key=options.fredApiKey;
   fetchText=async(url:string)=>{
    if(url.includes('finance.yahoo.com'))return JSON.stringify(await read(url,true,300000));
    // With a key, FRED series go through the official API; the stored source URL stays the keyless one (the key is never saved).
    const m=key?url.match(/fredgraph\.csv\?id=([^&]+)/):null;
    if(m&&key){const id=decodeURIComponent(m[1]);return fredApiToCsv(JSON.parse(await http(FRED_API_URL(id,key,'2024-01-01'))),id);}
    return http(url);
   };
  }
  res.summary=await collectMacro(db,now,fetchText);
  for(const s of res.summary.series)if(s.error){res.errors.push(`${s.id}: ${s.error}`);res.status='partial';}
 }catch(e){res.status='failed';res.errors.push(errorText(e));}
 finally{
  if(token||res.status==='failed'){try{await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(MACRO_STATE_ID,JSON.stringify({...res,at:new Date().toISOString(),durationMs:Date.now()-start}),new Date().toISOString()).run();}catch(e){console.error('[mizan-macro]','save-state',errorText(e));}}
  if(token)await releaseLock(db,LOCK_ID,token);
 }
 return res;
}
export async function scheduledMacro(controller:{cron:string;scheduledTime?:number},env:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string;FRED_API_KEY?:string}){
 if(env.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==MACRO_CRON||slotJob(controller)!=='macro')return;
 const r=await runMacro(env.DB,{now:Number.isFinite(controller.scheduledTime)?Number(controller.scheduledTime):undefined,fredApiKey:env.FRED_API_KEY||undefined});
 console.log('[mizan-macro]',JSON.stringify({status:r.status,inserted:r.summary?.inserted,errors:r.errors}));
 return r;
}
