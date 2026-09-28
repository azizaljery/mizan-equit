// Real network diagnostic. Uses the application's reader, parsers and source_status.
// Uses synthetic forecasts in local SQLite only, with real prices. Never targets production.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ProxyAgent,fetch as networkFetch} from 'undici';

const temp=mkdtempSync(join(tmpdir(),'mizan-live-sources-'));
for(const [entry,name] of [['tests/export.ts','current'],['lib/sources/integration.ts','integration']]){
 const build=spawnSync('node_modules/.bin/esbuild',[entry,'--bundle','--jsx=automatic',
  '--banner:js=import {createRequire} from "node:module"; const require=createRequire(import.meta.url);',
  '--alias:cloudflare:workers=./tests/runtime-env.ts','--platform=node','--format=esm',`--outfile=${join(temp,name+'.mjs')}`],{stdio:'inherit'});
 if(build.status!==0){rmSync(temp,{recursive:true,force:true});throw Error('Diagnostic build failed');}
}
const m=await import(pathToFileURL(join(temp,'current.mjs')).href);
const {fetchViaSources}=await import(pathToFileURL(join(temp,'integration.mjs')).href);

const sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
const prepare=(sql,values=[])=>({bind(...v){return prepare(sql,v)},async first(){return sqlite.prepare(sql).get(...values)},async all(){return {results:sqlite.prepare(sql).all(...values)}},execute(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}},async run(){return this.execute()}});
const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const agent=proxy?new ProxyAgent(proxy):null;
const originalFetch=globalThis.fetch;
const network=[];
globalThis.fetch=async(url,init={})=>{
  const at=Date.now();
  try{const r=await networkFetch(url,{...init,...(agent?{dispatcher:agent}:{})});network.push({url:String(url),status:r.status,durationMs:Date.now()-at});return r;}
  catch(e){network.push({url:String(url),error:e.message,cause:e.cause?.message,durationMs:Date.now()-at});throw e;}
};
const output={testedAt:new Date().toISOString(),environment:'Real provider HTTP through configuredReader; local SQLite; runtime default source settings; no network mocks',symbols:{},network};
const seed=(report,horizon,anchor)=>{
 const id=crypto.randomUUID(),snapshot=crypto.randomUUID(),createdAt=anchor.date+'T23:59:59Z';
 sqlite.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').run(snapshot,report.company.symbol,createdAt,'{"syntheticForecast":true}');
 sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,snapshot,report.company.symbol,createdAt,horizon,'synthetic-live-transport-test',report.currency==='SAR'?'sa':'us','fixture','منخفض',1,
  JSON.stringify({synthetic:true,recordClass:'prospective-public',createdAt,model:'synthetic-live-transport-test',anchorDate:anchor.date,price:anchor.close,predictedPrice:anchor.close*1.01,range:[anchor.close*.98,anchor.close*1.03],direction:'صاعد',currency:report.currency,evaluationPolicy:m.EVALUATION_POLICY}));
 return id;
};
let notDueId;
try{
 for(const [symbol,market] of [['AAPL','us'],...(process.env.MIZAN_LIVE_AUDIT==='true'?[['MSFT','us']]:[]),['2222.SR','sa']]){
  const read=await m.configuredReader(db),entry={types:{}};
  output.symbols[symbol]=entry;
  try{
   const report=await m.fetchCompany(symbol,read);
   entry.fetchCompany={state:'ok',symbol:report.company.symbol,currency:report.currency,prices:report.prices.length,quoteTime:report.quoteTime,sourceLayer:report.sourceLayer,checks:report.checks,
    benchmark:report.context?.market?{symbol:report.context.market.symbol,sessions:report.context.market.prices.length,first:report.context.market.prices[0]?.date,last:report.context.market.prices.at(-1)?.date}:null};
   if(report.prices.length>=12)entry.syntheticDueId=seed(report,5,report.prices.at(-12));
   if(!notDueId)notDueId=seed(report,252,report.prices.at(-1));
  }catch(e){entry.fetchCompany={state:'failed',error:e.message};}
  // CIK comes only from URLs emitted by the existing getRegulatory path.
  const cik=read.sourceAttempts.flatMap(a=>a.url.match(/\/CIK(\d{10})\.json/)?.[1]??[])[0];
  entry.cik=cik??null;
  for(const type of ['price','history','financials','filings']){
   const r=await fetchViaSources(symbol,type,market,{cik,reader:read});
   entry.types[type]={state:r.result.state,quality:r.quality,attempts:r.result.attempts,
    fallback:r.result.attempts.length>1,
    ...(r.result.state==='ok'?{provenance:r.result.provenance,
     value:type==='price'?r.result.value:type==='history'?{sessions:r.result.value.prices.length,last:r.result.value.prices.at(-1)}:
      type==='financials'?{lines:r.result.value.lines.length,withPublication:r.result.value.lines.filter(l=>l.filedAt!==null).length}: {filings:r.result.value.filings.length}
    }:{reason:r.result.reason})};
   console.log(symbol,type,JSON.stringify({state:r.result.state,source:r.result.state==='ok'?r.result.provenance.source:null,attempts:r.result.attempts.length}));
  }
  entry.readerAttempts=[...read.sourceAttempts];
 }
 const count=()=>sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n;
 const originals=sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all();
 const before=count();
 const first=await m.scheduledResolution({cron:m.RESOLUTION_CRON,scheduledTime:Date.now()},{DB:db,MIZAN_BACKGROUND_CRON_ENABLED:'true'});
 const afterFirst=count();
 const second=await m.scheduledResolution({cron:m.RESOLUTION_CRON,scheduledTime:Date.now()},{DB:db,MIZAN_BACKGROUND_CRON_ENABLED:'true'});
 const afterSecond=count();
 output.isolatedEvaluation={environment:'Node invocation of existing scheduledResolution -> fetchCompany(configuredReader) -> resolveForecasts; real network, three synthetic forecasts; NOT Wrangler or production',before,first,afterFirst,second,afterSecond,
  notDueExcluded:!sqlite.prepare('SELECT id FROM forecast_outcomes WHERE id=?').get(notDueId),
  originalsUnchanged:JSON.stringify(originals)===JSON.stringify(sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all()),
  research_state:sqlite.prepare("SELECT * FROM research_state WHERE id='job:evaluate-due:last'").get()};
 output.source_status=sqlite.prepare('SELECT * FROM source_status ORDER BY id').all();
 output.forecast_outcomes=count();
 // Missing benchmark coverage legitimately leaves a matured candidate pending.
 // Do not force a result merely because two synthetic candidates were seeded.
 assert.equal(afterFirst-before,first.evaluationsSaved);assert.ok(afterFirst<=Object.keys(output.symbols).length);
 assert.equal(afterSecond-afterFirst,second.evaluationsSaved);
 assert.equal(first.integrity.outcomesDuplicates,0);assert.equal(second.integrity.outcomesDuplicates,0);
 assert.equal(output.isolatedEvaluation.notDueExcluded,true);assert.equal(output.isolatedEvaluation.originalsUnchanged,true);
 if(process.env.MIZAN_LIVE_AUDIT==='true'){
   const anchor=originals.map(r=>JSON.parse(r.data).anchorDate).sort()[0];
   const config={runId:'synthetic-live-audit-'+Date.now(),symbols:['AAPL','MSFT','2222.SR'],startDate:anchor,endDate:new Date(Date.parse(new Date().toISOString().slice(0,10))-864e5).toISOString().slice(0,10),horizons:[5],minSessions:200,costs:{commissionBps:5,slippageBps:10,doubleSided:true}};
   const firstAudit=await m.auditBacktest(db,config),secondAudit=await m.auditBacktest(db,config);
   output.batchAudit={environment:'Actual provider prices + SYNTHETIC local forecast journal; not production accuracy',first:firstAudit,secondReused:secondAudit.reused,backtestRows:sqlite.prepare('SELECT COUNT(*) n FROM backtest_runs').get().n,outcomesUnchanged:count()===afterSecond};
   assert.equal(secondAudit.reused,true);assert.equal(output.batchAudit.backtestRows,1);assert.equal(output.batchAudit.outcomesUnchanged,true);
 }
 console.log('ISOLATED_LIVE_EVALUATION',JSON.stringify({before,afterFirst,afterSecond,firstSaved:first.evaluationsSaved,secondSaved:second.evaluationsSaved}));
}finally{
 writeFileSync(process.env.MIZAN_LIVE_QA_REPORT||'docs/qa/sources-live-2026-09-12.json',JSON.stringify(output,null,2)+'\n');
 globalThis.fetch=originalFetch;
 if(agent)await agent.destroy();
 sqlite.close();
 rmSync(temp,{recursive:true,force:true});
}
