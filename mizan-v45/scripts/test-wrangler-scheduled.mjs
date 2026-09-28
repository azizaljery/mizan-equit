// Local-only verification. Inherits the built schedule; creates no production trigger.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const dir=resolve('.sites-runtime/qa/state-wrangler-'+Date.now());mkdirSync(dir,{recursive:true});
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
config.main=resolve('dist/server/index.js');
// Wrangler's local assets facade doesn't forward test-scheduled with this no_bundle output.
// Keep the production generated config untouched; test only the built worker handler here.
delete config.assets;config.vars={...config.vars,MIZAN_BACKGROUND_CRON_ENABLED:'true'};
const configPath=join(dir,'wrangler.json');writeFileSync(configPath,JSON.stringify(config,null,2));
let sql=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync('drizzle/'+f,'utf8')).join('\n');
for(const symbol of ['MZWRA','MZWRB']){
 const snapshot=crypto.randomUUID(),id=crypto.randomUUID(),data=JSON.stringify({anchorDate:'2026-07-10',price:100,predictedPrice:110,range:[108,112],direction:'صاعد',currency:'USD',evaluationPolicy:'mizan-end-close-v2'});
 sql+=`\nINSERT INTO analysis_snapshots VALUES('${snapshot}','${symbol}','2026-07-11T00:00:00Z','{}');\nINSERT INTO forecast_records VALUES('${id}','${snapshot}','${symbol}','2026-07-11T00:00:00Z',5,'synthetic-wrangler','us','fixture','low',1,'${data}');`;
}
const fixture=join(dir,'fixture.sql');writeFileSync(fixture,sql);
const persist=join(dir,'state'),args=['--config',configPath,'--persist-to',persist];
let log='';
function command(argv){return new Promise(resolve=>{const p=spawn('npx',['wrangler',...argv],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});p.stdout.on('data',v=>log+=v);p.stderr.on('data',v=>log+=v);p.on('close',code=>resolve(code));});}
assert.equal(await command(['d1','execute','DB','--local',...args,'--file',fixture]),0,'Local D1 setup failed');
const dev=spawn('npx',['wrangler','dev','--test-scheduled',...args,'--ip','127.0.0.1','--port','8791','--inspector-port','9241'],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},detached:true});
dev.stdout.on('data',v=>log+=v);dev.stderr.on('data',v=>log+=v);
const files=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]);
const report={testedAt:new Date().toISOString(),environment:'Wrangler local built handler; synthetic journal; real provider transport (may fail); NOT production',command:'npx wrangler dev --test-scheduled --config <test-only-derived-config> --ip 127.0.0.1 --port 8791 --inspector-port 9241',runs:[]};
let sqlite;
try{
 const until=Date.now()+30000;
 while(!log.includes('Ready on')&&Date.now()<until&&dev.exitCode===null)await new Promise(r=>setTimeout(r,200));
 assert.ok(log.includes('Ready on'),'Wrangler did not become ready');
 const dbPath=files(persist).find(f=>f.endsWith('.sqlite')&&!f.endsWith('/metadata.sqlite'));assert.ok(dbPath);
 sqlite=new DatabaseSync(dbPath,{readOnly:true});
 const count=()=>sqlite.prepare('SELECT COUNT(*) AS n FROM forecast_outcomes').get().n;
 const originals=sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all();report.before=count();
 for(let i=0;i<2;i++){
  const response=await fetch('http://127.0.0.1:8791/cdn-cgi/handler/scheduled?cron='+encodeURIComponent(config.triggers.crons[0]),{signal:AbortSignal.timeout(180000)});
  const text=await response.text();
  const row=sqlite.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last-cron'").get();
  report.runs.push({httpStatus:response.status,response:text.slice(0,200),summary:row?JSON.parse(row.data):null,outcomes:count()});
  assert.equal(response.status,200);assert.ok(row);console.log('WRANGLER_RUN',i+1,JSON.stringify({scanned:report.runs[i].summary.symbolsScanned,saved:report.runs[i].summary.evaluationsSaved,failed:report.runs[i].summary.symbolsFailed,outcomes:count()}));
 }
 report.duplicates=sqlite.prepare('SELECT id FROM forecast_outcomes GROUP BY id HAVING COUNT(*)>1').all().length;
 report.originalsUnchanged=JSON.stringify(originals)===JSON.stringify(sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all());
 assert.equal(report.duplicates,0);assert.equal(report.originalsUnchanged,true);
 assert.equal(report.runs[1].outcomes-report.runs[0].outcomes,report.runs[1].summary.evaluationsSaved);
}catch(error){report.error=error.message;process.exitCode=1;}
finally{sqlite?.close();try{process.kill(-dev.pid,'SIGTERM');}catch{}writeFileSync(join(dir,'wrangler.log'),log);writeFileSync('docs/qa/state-wrangler-2026-09-13.json',JSON.stringify(report,null,2)+'\n');}
