import { fetchCompany, fetchLiveQuote, type Company } from '../lib/market-data';
import { configuredReader } from '../lib/source-status';
import { readSettings } from '../lib/site-settings';
import { eligibleSaudiCompanies } from '../lib/saudi-directory';
import { eligibleUSCompanies } from '../lib/us-directory';
import { recordAnalysis } from '../lib/forecast-journal';
import { MAINTENANCE_SLOT_CRON, slotJob } from '../lib/jobs/cron-slots';
import {DAILY_ARCHIVE_CRON,runDailyArchive} from '../lib/jobs/daily-forecast-archive.mjs';
import { tryAcquireLock, releaseLock, withResolutionTimeout } from './scheduled';
import { pickRoundRobin } from '../lib/jobs/round-robin';
import { assertCurrentInstrument, listingRestriction, LISTING_POLICY } from '../lib/listing-lifecycle';

// Own invocation: MAINTENANCE_SLOT_CRON at 00/06/12/18:30 UTC (see lib/jobs/cron-slots.ts).
export const MARKET_COLLECTION_CRON = MAINTENANCE_SLOT_CRON;
export const FORECAST_SEED_CRON = DAILY_ARCHIVE_CRON;
export const MARKET_COLLECTION_STATE_ID = 'job:market-collector:last';
export const FORECAST_SEED_STATE_ID = 'job:forecast-seed:last';
const MARKET_ROTATION_ID = 'job:market-collector:rotation';
const MARKET_LOCK_ID = 'cron:market-collector:v1';
const FORECAST_LOCK_ID = 'cron:forecast-seed:v1';
const MARKET_LOCK_MS = 12 * 60 * 1000;
// 5-minute cron; runDailyArchive caps work at 150 s, so a killed run must not block ~4 later runs.
const FORECAST_LOCK_MS = 3 * 60 * 1000;
const QUOTES_PER_MARKET = 6;

type Market = 'sa' | 'us';
type Rotation = { sa: number; us: number };
type RunState = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cron: string;
  scheduledTime: number;
  status: 'completed' | 'partial' | 'failed' | 'locked';
  stateSaved: boolean;
  errors: Array<{symbol:string; error:string; stage?:string}>;
  eligibilityPolicy: string;
  excludedKnownInactive: string[];
};
function excludedKnownInactive(){
  return eligibleSaudiCompanies().filter(c=>listingRestriction(c.symbol)!==null).map(c=>c.symbol);
}
async function readRotation(db:any,id:string):Promise<Rotation>{
  try{
    const row=await db.prepare('SELECT data FROM research_state WHERE id=?').bind(id).first();
    if(!row?.data)return {sa:0,us:0};
    const parsed=JSON.parse(row.data);
    return {
      sa:Number.isSafeInteger(parsed?.sa)&&parsed.sa>=0?parsed.sa:0,
      us:Number.isSafeInteger(parsed?.us)&&parsed.us>=0?parsed.us:0,
    };
  }catch(error){console.error('[mizan-data-center] market-collection','read-rotation',id,(error instanceof Error?error.message:String(error)).slice(0,200));return {sa:0,us:0};}
}
async function writeState(db:any,id:string,data:unknown,at:string){
  await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
    .bind(id,JSON.stringify(data),at).run();
}
function universe(market:Market):Company[]{
  return market==='sa'?eligibleSaudiCompanies('current'):eligibleUSCompanies();
}
function changeCount(result:any){
  return Number(result?.meta?.changes??result?.changes??0);
}
export async function runMarketCollectionCycle(db:any,controller:{cron:string;scheduledTime:number}){
  const start=Date.now(), startedAt=new Date(start).toISOString();
  const summary:RunState & {symbolsAttempted:number; observationsSaved:number; markets:Record<Market,{attempted:number;saved:number;nextCursor:number}>}={
    startedAt,finishedAt:'',durationMs:0,cron:controller.cron,scheduledTime:controller.scheduledTime,
    status:'completed',stateSaved:false,errors:[],symbolsAttempted:0,observationsSaved:0,
    eligibilityPolicy:LISTING_POLICY,excludedKnownInactive:excludedKnownInactive(),
    markets:{sa:{attempted:0,saved:0,nextCursor:0},us:{attempted:0,saved:0,nextCursor:0}},
  };
  let token:string|null=null;
  try{
    token=await tryAcquireLock(db,MARKET_LOCK_ID,MARKET_LOCK_MS);
    if(!token){summary.status='locked';return summary;}
    const settings=await readSettings(db),read=await configuredReader(db,settings);
    const rotation=await readRotation(db,MARKET_ROTATION_ID);
    const next:Rotation={...rotation};
    for(const market of ['sa','us'] as const){
      if(!settings.enabledMarkets.includes(market))continue;
      const picked=pickRoundRobin(universe(market),rotation[market],QUOTES_PER_MARKET);
      next[market]=picked.next;
      summary.markets[market].nextCursor=picked.next;
      for(const company of picked.items){
        summary.symbolsAttempted++;summary.markets[market].attempted++;
        let stage='eligibility';
        try{
          assertCurrentInstrument(company.symbol);
          stage='fetch-quote';
          const q=await fetchLiveQuote(company.symbol,read);
          const observedAt=q.quoteTime||q.retrievedAt||new Date().toISOString();
          const data={
            recordClass:'market-observation',
            collector:'mizan-data-center-v1',
            symbol:company.symbol,market,name:company.name,
            price:q.price,currency:q.currency,changePct:q.changePct,
            quoteTime:q.quoteTime,retrievedAt:q.retrievedAt,isOpen:q.isOpen,
            delayed:q.delayed,ageSeconds:q.ageSeconds,source:q.source,coverage:q.coverage,
          };
          stage='persist-observation';
          const result=await db.prepare('INSERT OR IGNORE INTO market_observations(id,symbol,market,observed_at,source,data) VALUES(?,?,?,?,?,?)')
            .bind(crypto.randomUUID(),company.symbol,market,observedAt,q.source,JSON.stringify(data)).run();
          if(changeCount(result)>0){summary.observationsSaved++;summary.markets[market].saved++;}
        }catch(error){
          console.error('[mizan-data-center] market-collection',stage,company.symbol,(error instanceof Error?error.message:String(error)).slice(0,200));
          if(summary.errors.length<20)summary.errors.push({symbol:company.symbol,stage,error:'تعذر جلب سعر موثوق أو حفظه في هذه الدورة.'});
        }
      }
    }
    await writeState(db,MARKET_ROTATION_ID,next,new Date().toISOString());
    if(summary.errors.length)summary.status='partial';
  }catch(error){
    console.error('[mizan-data-center] market-collection','cycle','*',(error instanceof Error?error.message:String(error)).slice(0,200));
    summary.status='failed';
    summary.errors.push({symbol:'*',error:'تعذر تشغيل جامع بيانات السوق.'});
  }finally{
    summary.finishedAt=new Date().toISOString();
    summary.durationMs=Date.parse(summary.finishedAt)-Date.parse(summary.startedAt);
    if(token||summary.status==='failed'){
      try{await writeState(db,MARKET_COLLECTION_STATE_ID,{...summary,stateSaved:true},summary.finishedAt);summary.stateSaved=true;}
      catch(error){console.error('[mizan-data-center] market-collection','save-state','*',(error instanceof Error?error.message:String(error)).slice(0,200));summary.stateSaved=false;if(summary.status!=='failed')summary.status='partial';}
    }
    if(token)await releaseLock(db,MARKET_LOCK_ID,token);
  }
  return summary;
}
export async function runForecastSeedCycle(db:any,controller:{cron:string;scheduledTime:number}){
 return runDailyArchive(db,{
  now:()=>Date.now(),
  acquire:()=>tryAcquireLock(db,FORECAST_LOCK_ID,FORECAST_LOCK_MS),
  release:(token:string)=>releaseLock(db,FORECAST_LOCK_ID,token),
  owns:async(token:string)=>!!await db.prepare('SELECT token FROM research_locks WHERE id=? AND token=? AND until_ms>?').bind(FORECAST_LOCK_ID,token,Date.now()).first(),
  settings:()=>readSettings(db),universe,
  listingEvidence:()=>({eligibilityPolicy:LISTING_POLICY,excludedKnownInactive:excludedKnownInactive()}),
  fetch:async(symbol:string,settings:any)=>{
   assertCurrentInstrument(symbol);
   return withResolutionTimeout(fetchCompany(symbol,await configuredReader(db,settings),true),60000);
  },
  record:(journal:any,report:any,settings:any)=>recordAnalysis(journal,report,settings,null),
 },controller);
}
export async function scheduledMarketCollection(controller:{cron:string;scheduledTime:number},runtime:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string}){
  if(runtime.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==MARKET_COLLECTION_CRON||slotJob(controller)!=='market-collection')return;
  const result=await runMarketCollectionCycle(runtime.DB,controller);
  console.log('[mizan-data-center] market-collection',JSON.stringify(result));
  if(result.status==='failed'||!result.stateSaved&&result.status!=='locked')throw new Error('Market collection failed; inspect owner-only state.');
  return result;
}
export async function scheduledForecastSeed(controller:{cron:string;scheduledTime:number},runtime:{DB:any;MIZAN_BACKGROUND_CRON_ENABLED?:string}){
  if(runtime.MIZAN_BACKGROUND_CRON_ENABLED!=='true'||controller.cron!==FORECAST_SEED_CRON)return;
  const result=await runForecastSeedCycle(runtime.DB,controller);
  console.log('[mizan-data-center] forecast-seed',JSON.stringify(result));
  if(result.status==='failed'||!result.stateSaved&&result.status!=='locked')throw new Error('Forecast seed failed; inspect owner-only state.');
  return result;
}
