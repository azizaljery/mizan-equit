// Durable, bounded collection of original Mizan forecasts. No Aziz predictions.
export const DAILY_ARCHIVE_VERSION='mizan-daily-archive/1';
export const DAILY_ARCHIVE_CRON='*/5 * * * *';
export const DAILY_ARCHIVE_TARGET=30;
export const DAILY_ARCHIVE_HORIZONS=[1,5,21,252];
const MAX_ATTEMPTS=3;
const PREFIX='job:daily-forecast:';
export function marketClock(market,now=Date.now()){
 if(!['sa','us'].includes(market))throw Error('invalid-market');
 const zone=market==='sa'?'Asia/Riyadh':'America/New_York';
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const date=`${p.year}-${p.month}-${p.day}`,day=new Date(date+'T12:00:00Z').getUTCDay();
 const weekend=market==='sa'?[5,6].includes(day):[0,6].includes(day);
 const minutes=Number(p.hour)*60+Number(p.minute);
 return {date,zone,weekend,afterClose:minutes>=(market==='sa'?15*60+45:16*60+30)};
}
export function makeDailyPlan(market,date,companies,at){
 const unique=[...new Map(companies.map(c=>[c.symbol,c])).values()].sort((a,b)=>a.symbol.localeCompare(b.symbol,'en',{numeric:true}));
 // A deterministic daily rotation is fixed before any source requests or results.
 const day=Math.floor(Date.parse(date+'T12:00:00Z')/86400000);
 const offset=unique.length?(day*DAILY_ARCHIVE_TARGET)%unique.length:0;
 const selected=Array.from({length:Math.min(DAILY_ARCHIVE_TARGET,unique.length)},(_,i)=>unique[(offset+i)%unique.length]);
 return {version:DAILY_ARCHIVE_VERSION,market,date,createdAt:at,target:DAILY_ARCHIVE_TARGET,selection:'daily-directory-rotation',universeCount:unique.length,
  nextCheckAt:null,items:selected.map(c=>({symbol:c.symbol,name:c.name,state:'pending',attempts:0,errors:[]}))};
}
export function dailyCounts(plan){
 return {date:plan.date,target:plan.target,selected:plan.items.length,recorded:plan.items.filter(x=>x.state==='recorded').length,
  failed:plan.items.filter(x=>x.state==='failed').length,pending:plan.items.filter(x=>x.state==='pending').length,
  completeRequiredHorizons:plan.items.filter(x=>x.state==='recorded'&&DAILY_ARCHIVE_HORIZONS.every(h=>x.availableHorizons?.includes(h))).length,
  availableForecastRows:plan.items.reduce((n,x)=>n+(x.availableHorizons?.length||0),0)};
}
export function currentSessionEvidence(report,market,date,now){
 const price=report.prices?.at(-1),benchmark=report.context?.market;
 // TADAWUL-CALENDAR = dated session bars of liquid large caps, used when the provider's ^TASI.SR history is a single point.
 const expected=market==='sa'?['^TASI.SR','TADAWUL-CALENDAR']:['SPY'];
 // No holiday list is guessed: require actual dated bars for both instrument and index.
 if(!expected.includes(benchmark?.symbol)||benchmark.prices?.at(-1)?.date!==date||price?.date!==date||!(price.close>0))return false;
 const fetched=Date.parse(report.retrievedAt);
 return Number.isFinite(fetched)&&fetched<=now+60000&&now-fetched<30*60000;
}
async function readState(db,id){const row=await db.prepare('SELECT data FROM research_state WHERE id=?').bind(id).first();return row?JSON.parse(row.data):null;}
async function saveState(db,id,data,now){await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(id,JSON.stringify(data),new Date(now).toISOString()).run();}
async function storedForecast(db,key){
 const claim=await readState(db,'claim:'+key);if(!claim)return null;
 const snapshot=await db.prepare("SELECT id FROM analysis_snapshots WHERE json_extract(data,'$.dailyArchive.key')=? ORDER BY created_at LIMIT 1").bind(key).first();
 if(!snapshot)throw Error('archive-claim-without-snapshot');
 const rows=await db.prepare('SELECT id,horizon,available FROM forecast_records WHERE snapshot_id=? ORDER BY horizon').bind(snapshot.id).all();
 if(!rows.results?.length)throw Error('archive-snapshot-without-forecasts');
 return {snapshotId:snapshot.id,forecastIds:rows.results.map(r=>r.id),savedHorizons:rows.results.map(r=>r.horizon),availableHorizons:rows.results.filter(r=>r.available===1).map(r=>r.horizon)};
}
// The claim and the ORIGINAL journal inserts commit in one D1 transaction.
// A crash after commit is recovered by storedForecast; competing claims abort
// the whole batch, rather than creating a second forecast for the same cohort.
export function claimedJournal(db,key,metadata,now){
 let committed=false;
 return {prepare:db.prepare.bind(db),batch:async statements=>{
  if(committed)return db.batch(statements);
  const result=await db.batch([db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?)').bind('claim:'+key,JSON.stringify(metadata),new Date(now).toISOString()),...statements]);
  committed=true;return result.slice(1);
 }};
}
export async function runDailyArchive(db,deps,controller){
 const start=deps.now(),at=new Date(start).toISOString();
 const listingEvidence=deps.listingEvidence?.()??{eligibilityPolicy:null,excludedKnownInactive:[]};
 const result={version:DAILY_ARCHIVE_VERSION,runId:crypto.randomUUID(),startedAt:at,finishedAt:null,cron:controller.cron,
  scheduledTime:controller.scheduledTime,triggeredBy:controller.cron===DAILY_ARCHIVE_CRON?'cron':'manual',status:'completed',stateSaved:false,
  eligibilityPolicy:listingEvidence.eligibilityPolicy,excludedKnownInactive:listingEvidence.excludedKnownInactive,
  symbolsAttempted:0,analysesRecorded:0,forecastRowsSaved:0,availableForecastRows:0,skippedAlreadyRecorded:0,markets:{},errors:[]};
 const token=await deps.acquire();if(!token)return {...result,status:'locked'};
 try{
  const settings=await deps.settings();
  // Honor the owner's required archive horizons without changing site settings.
  const archiveSettings={...settings,periods:{...settings.periods}};
  for(const h of DAILY_ARCHIVE_HORIZONS)archiveSettings.periods[h]={...settings.periods[h],enabled:true};
  for(const market of ['sa','us']){
   const clock=marketClock(market,deps.now()),planId=PREFIX+market+':'+clock.date;
   if(!settings.enabledMarkets.includes(market)){result.markets[market]={state:'market-disabled',target:30};continue;}
   if(clock.weekend){result.markets[market]={state:'weekend',date:clock.date,target:30};continue;}
   let plan=await readState(db,planId);
   if(!plan){plan=makeDailyPlan(market,clock.date,deps.universe(market),at);await saveState(db,planId,plan,deps.now());}
   if(plan.version!==DAILY_ARCHIVE_VERSION||plan.market!==market||plan.date!==clock.date||plan.items.length>30)throw Error('invalid-daily-plan');
   const state=(s)=>{result.markets[market]={...dailyCounts(plan),state:s};};
   if(!clock.afterClose){state('waiting-for-session-close');continue;}
   if(plan.nextCheckAt&&Date.parse(plan.nextCheckAt)>deps.now()){state('waiting-for-session-evidence');continue;}
   if(deps.now()-start>100000){state('waiting-next-batch');continue;}
   const item=plan.items.filter(x=>x.state==='pending').sort((a,b)=>a.attempts-b.attempts)[0];
   if(!item){state('finished');continue;}
   const key=planId+':'+item.symbol;
   let stage='recover';
   try{
    const saved=await storedForecast(db,key);
    if(saved){Object.assign(item,saved,{state:'recorded'});result.skippedAlreadyRecorded++;}
    else if(item.attempts>=MAX_ATTEMPTS){item.state='failed';}
    else{
     stage='fetch-company';result.symbolsAttempted++;
     // Fetch has no writes; timing out cannot leave a late journal write running.
     const report=await deps.fetch(item.symbol,settings);
     stage='validate-session';
     if(report.company?.symbol!==item.symbol)throw Error('identity-mismatch');
     if(!currentSessionEvidence(report,market,clock.date,deps.now())){
      const benchmark=report.context?.market;
      if((market==='sa'?['^TASI.SR','TADAWUL-CALENDAR']:['SPY']).includes(benchmark?.symbol)&&benchmark.prices?.at(-1)?.date===clock.date)throw Error('instrument-session-unavailable');
      plan.nextCheckAt=new Date(deps.now()+30*60000).toISOString();
      item.lastReason='current-session-price-or-benchmark-unavailable';
      await saveState(db,planId,plan,deps.now());state('waiting-for-session-evidence');continue;
     }
     // Never cross a market date or outlive the original lock while persisting.
     if(marketClock(market,deps.now()).date!==clock.date||deps.now()-start>150000)throw Error('batch-window-expired');
     if(!await deps.owns(token))throw Error('lease-lost');
     stage='persist-forecast';item.attempts++;
     report.dailyArchive={key,version:DAILY_ARCHIVE_VERSION,market,sessionDate:clock.date,selectedAt:plan.createdAt,
      observedThrough:report.prices.at(-1).date,availableAt:report.retrievedAt,source:report.priceSource,priceBasis:report.priceAdjustment||null};
     const projection=await deps.record(claimedJournal(db,key,report.dailyArchive,deps.now()),report,archiveSettings);
     if(!projection.recorded)throw Error('journal-not-recorded');
     const verified=await storedForecast(db,key);if(!verified)throw Error('journal-not-found');
     Object.assign(item,verified,{state:'recorded',recordedAt:projection.createdAt});
     result.analysesRecorded++;result.forecastRowsSaved+=verified.savedHorizons.length;
     result.availableForecastRows+=verified.availableHorizons.length;
    }
   }catch{
    if(stage!=='persist-forecast'&&stage!=='recover')item.attempts++;
    item.errors.push({at:new Date(deps.now()).toISOString(),stage});
    if(item.attempts>=MAX_ATTEMPTS&&stage!=='persist-forecast'&&stage!=='recover')item.state='failed';
    result.errors.push({symbol:item.symbol,stage,error:'لم يتأكد الحفظ؛ تبقى الشركة نفسها في العينة.'});result.status='partial';
   }
   await saveState(db,planId,plan,deps.now());state('active');
  }
 }catch{result.status='failed';result.errors.push({symbol:'*',stage:'daily-plan',error:'تعذر إكمال الدورة أو حفظ حالتها.'});}
 finally{
  result.finishedAt=new Date(deps.now()).toISOString();
  try{result.stateSaved=true;await saveState(db,'job:forecast-seed:last',result,deps.now());
   if(result.triggeredBy==='cron')await saveState(db,'job:daily-forecast:last-cron',result,deps.now());
  }catch{result.stateSaved=false;result.status='failed';}
  await deps.release(token);
 }
 return result;
}
export async function readDailyArchiveStatus(db){
 const recent=await db.prepare("SELECT id,data,updated_at FROM research_state WHERE id LIKE 'job:daily-forecast:%' ORDER BY updated_at DESC LIMIT 16").all();
 return {version:DAILY_ARCHIVE_VERSION,cron:DAILY_ARCHIVE_CRON,targetPerMarket:30,requiredHorizons:DAILY_ARCHIVE_HORIZONS,
  recent:(recent.results||[]).map(r=>({...r,data:JSON.parse(r.data)}))};
}
