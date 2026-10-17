import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runDailyArchive,marketClock,makeDailyPlan,currentSessionEvidence,claimedJournal,readDailyArchiveStatus,DAILY_ARCHIVE_CRON} from '../lib/jobs/daily-forecast-archive.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE research_state(id TEXT PRIMARY KEY,data TEXT,updated_at TEXT); CREATE TABLE analysis_snapshots(id TEXT PRIMARY KEY,data TEXT,created_at TEXT); CREATE TABLE forecast_records(id TEXT PRIMARY KEY,snapshot_id TEXT,horizon INTEGER,available INTEGER);');
 const db={prepare(query){return {bind(...args){return {query,args,async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return sql.prepare(query).run(...args)}}},async all(){return {results:sql.prepare(query).all()}}}},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>sql.prepare(s.query).run(...s.args));sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 let now=Date.parse('2026-09-28T20:45:00Z');
 const settings={enabledMarkets:['sa','us'],periods:Object.fromEntries([1,5,21,63,126,252].map(h=>[h,{enabled:false}]))};
 const deps={now:()=>now,acquire:async()=> 'lease',release:async()=>{},owns:async()=>true,settings:async()=>settings,
 listingEvidence:()=>({eligibilityPolicy:'mizan-known-listing-events-1',excludedKnownInactive:['1090.SR']}),
 universe:m=>Array.from({length:45},(_,i)=>({symbol:m+i,name:m+i})),
 fetch:async symbol=>{const market=symbol.startsWith('sa')?'sa':'us',date=marketClock(market,now).date;return {company:{symbol},retrievedAt:new Date(now).toISOString(),prices:[{date,close:100}],context:{market:{symbol:market==='sa'?'^TASI.SR':'SPY',prices:[{date,close:100}]}},priceSource:'test-fixture'}},
 record:async(journal,report,archiveSettings)=>{assert.equal(archiveSettings.periods[252].enabled,true);const id=crypto.randomUUID();await journal.batch([journal.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?)').bind(id,JSON.stringify(report),new Date(now).toISOString()),...[1,5,21,63,126,252].map(h=>journal.prepare('INSERT INTO forecast_records VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,h,1))]);return {recorded:true,createdAt:new Date(now).toISOString()}}};
 return {sql,db,deps,settings,setNow:v=>now=Date.parse(v),run:()=>runDailyArchive(db,deps,{cron:DAILY_ARCHIVE_CRON,scheduledTime:now})};
}
test('market dates, weekends and DST use local clocks',()=>{
 assert.equal(marketClock('sa',Date.parse('2026-09-26T21:15Z')).date,'2026-09-27');
 assert.equal(marketClock('sa',Date.parse('2026-09-27T13:00Z')).weekend,false);
 assert.equal(marketClock('us',Date.parse('2026-09-27T13:00Z')).weekend,true);
 assert.equal(marketClock('us',Date.parse('2026-01-05T21:29Z')).afterClose,false);
 assert.equal(marketClock('us',Date.parse('2026-07-06T20:30Z')).afterClose,true);
});
test('selection is unique, fixed, bounded and preserves a short universe',()=>{
 const companies=Array.from({length:40},(_,i)=>({symbol:String(i)}));
 const a=makeDailyPlan('us','2026-09-28',companies,'a');
 assert.equal(a.items.length,30);assert.equal(new Set(a.items.map(x=>x.symbol)).size,30);
 assert.deepEqual(a.items,makeDailyPlan('us','2026-09-28',companies.reverse(),'b').items);
 assert.equal(makeDailyPlan('us','2026-09-28',[{symbol:'A'},{symbol:'A'}],'a').items.length,1);
});
test('30 each market are archived once; six original horizons and previous data survive',async()=>{
 const f=fixture();f.sql.exec("INSERT INTO analysis_snapshots VALUES('old','{}','2020-01-01')");
 for(let i=0;i<35;i++)await f.run();
 const status=await readDailyArchiveStatus(f.db);
 for(const market of ['sa','us']){const plan=status.recent.find(r=>r.id===`job:daily-forecast:${market}:2026-09-28`).data;assert.equal(plan.items.filter(x=>x.state==='recorded').length,30);assert.ok(plan.items.every(x=>x.savedHorizons.length===6));}
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM analysis_snapshots').get().n,61);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM forecast_records').get().n,360);
 assert.equal(f.settings.periods[252].enabled,false);
 assert.ok(status.recent.some(r=>r.id==='job:daily-forecast:last-cron'));
 const seed=JSON.parse(f.sql.prepare("SELECT data FROM research_state WHERE id='job:forecast-seed:last'").get().data);
 assert.equal(seed.eligibilityPolicy,'mizan-known-listing-events-1');
 assert.deepEqual(seed.excludedKnownInactive,['1090.SR']);
});
test('atomic claim aborts all competing inserts',async()=>{
 const f=fixture();const statement=id=>f.db.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?)').bind(id,'{}','now');
 await claimedJournal(f.db,'same',{},Date.now()).batch([statement('one')]);
 await assert.rejects(claimedJournal(f.db,'same',{},Date.now()).batch([statement('two')]));
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM analysis_snapshots').get().n,1);
 await assert.rejects(claimedJournal(f.db,'rollback',{},Date.now()).batch([statement('one')]));
 assert.equal(f.sql.prepare("SELECT count(*) AS n FROM research_state WHERE id='claim:rollback'").get().n,0);
});
test('post-commit crash recovers without inserting another forecast',async()=>{
 const f=fixture();f.settings.enabledMarkets=['us'];const record=f.deps.record;
 f.deps.record=async(...args)=>{await record(...args);throw Error('post-commit crash')};
 await f.run();const row=f.sql.prepare("SELECT data FROM research_state WHERE id='job:daily-forecast:us:2026-09-28'").get();const plan=JSON.parse(row.data);plan.items=plan.items.slice(0,1);plan.items[0].attempts=3;
 f.sql.prepare("UPDATE research_state SET data=? WHERE id='job:daily-forecast:us:2026-09-28'").run(JSON.stringify(plan));
 const result=await f.run();assert.equal(result.skippedAlreadyRecorded,1);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM analysis_snapshots').get().n,1);
});
test('fresh benchmark and instrument bars are both required',async()=>{
 const f=fixture(),r=await f.deps.fetch('us1');assert.equal(currentSessionEvidence(r,'us','2026-09-28',f.deps.now()),true);
 r.context.market.prices[0].date='2026-09-25';assert.equal(currentSessionEvidence(r,'us','2026-09-28',f.deps.now()),false);
 f.deps.fetch=async()=>r;f.settings.enabledMarkets=['us'];await f.run();assert.equal(f.sql.prepare('SELECT count(*) AS n FROM forecast_records').get().n,0);
});
test('a stale instrument retries at most three times without replacing the cohort',async()=>{
 const f=fixture();f.settings.enabledMarkets=['us'];f.deps.universe=()=>[{symbol:'us1'}];const fetch=f.deps.fetch;f.deps.fetch=async s=>{const r=await fetch(s);r.prices[0].date='2026-09-25';return r};
 for(let i=0;i<5;i++)await f.run();const p=(await readDailyArchiveStatus(f.db)).recent.find(r=>r.id.includes(':us:')).data;
 assert.equal(p.items[0].attempts,3);assert.equal(p.items[0].state,'failed');assert.equal(p.items.length,1);
});
test('closed sessions and lost lease never write forecasts',async()=>{
 const f=fixture();f.setNow('2026-09-26T20:45Z');await f.run();assert.equal(f.sql.prepare('SELECT count(*) AS n FROM forecast_records').get().n,0);
 f.setNow('2026-09-28T20:45Z');f.deps.owns=async()=>false;await f.run();assert.equal(f.sql.prepare('SELECT count(*) AS n FROM forecast_records').get().n,0);
});
test('an invocation killed during fetch still counts the attempt, so one symbol cannot kill every run',async()=>{
 const f=fixture();f.settings.enabledMarkets=['us'];f.deps.universe=()=>[{symbol:'us1'}];
 const planOf=()=>JSON.parse(f.sql.prepare("SELECT data FROM research_state WHERE id='job:daily-forecast:us:2026-09-28'").get().data);
 // A hung fetch models the Worker being killed mid-fetch: catch/finally never run.
 let fetches=0;f.deps.fetch=async()=>{fetches++;return new Promise(()=>{});};
 for(let i=1;i<=3;i++){f.run();await new Promise(r=>setTimeout(r,5));assert.equal(planOf().items[0].attempts,i,'attempt '+i+' persisted before fetch');}
 const result=await f.run();
 assert.equal(fetches,3,'no 4th fetch');assert.equal(planOf().items[0].state,'failed');assert.equal(planOf().items[0].attempts,3);assert.equal(result.markets.us.state,'active');
});
test('waiting for session evidence is not counted as a failed attempt',async()=>{
 const f=fixture();f.settings.enabledMarkets=['us'];f.deps.universe=()=>[{symbol:'us1'}];const fetch=f.deps.fetch;
 f.deps.fetch=async s=>{const r=await fetch(s);r.context.market.prices[0].date='2026-09-25';return r};
 await f.run();const p=JSON.parse(f.sql.prepare("SELECT data FROM research_state WHERE id='job:daily-forecast:us:2026-09-28'").get().data);
 assert.equal(p.items[0].attempts,0);assert.equal(p.items[0].state,'pending');assert.ok(p.nextCheckAt);
});
