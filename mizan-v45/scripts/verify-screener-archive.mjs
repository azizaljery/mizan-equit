#!/usr/bin/env node
/** Real source data only. Never manufacture future outcomes in production. */
import {mkdir,writeFile} from 'node:fs/promises';
import {SITE} from './verify-deployment.mjs';
const checks=[],report={checkedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,checks,scope:'Live two-symbol capture/replay and fixed cohort; future maturity tested only with labelled local fixtures.'};
const check=(name,ok,detail)=>checks.push({name,ok,detail});
async function post(body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150000);try{const r=await fetch(SITE+'/api/screener',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:controller.signal});const text=await r.text();if(text.length>2000000)throw Error('large');return {status:r.status,data:JSON.parse(text)};}finally{clearTimeout(timer);}}
try{
 const p=await post({action:'plan',archive:true,market:'both',horizonSessions:5,resultCount:10,scanLimit:200,symbols:['2222.SR','AAPL']});
 check('durable two-market plan created',p.status===200&&!!p.data.runId&&!!p.data.runToken,{status:p.status});
 if(p.status!==200)throw Error('no-plan');
 const handle={runId:p.data.runId,runToken:p.data.runToken};report.runId=p.data.runId;
 const batches=[];for(let i=0;i<Math.ceil(p.data.symbols.length/p.data.batchSize);i++)batches.push(await post({action:'archive-batch',...handle,batchIndex:i}));
 const batchOk=batches.every(x=>x.status===200&&x.data.scanned>=1&&x.data.analyzed+x.data.failed===x.data.scanned);
 check('live batches processed through persistence',batchOk&&batches.reduce((n,x)=>n+x.data.scanned,0)===2&&batches.reduce((n,x)=>n+x.data.analyzed,0)===2,{statuses:batches.map(x=>x.status),analyzed:batches.reduce((n,x)=>n+(x.data?.analyzed||0),0),failures:batches.flatMap(x=>x.data?.failures||[])});
 const batch=batches[0];
 const finished=await post({action:'complete',...handle});
 check('final cohort sealed with fingerprint',finished.status===200&&finished.data.status==='complete'&&finished.data.integrity===true,{status:finished.status,runStatus:finished.data.status});
 const repeat=await post({action:'archive-batch',...handle,batchIndex:0});
 check('retry does not recalculate forecasts',repeat.status===200&&repeat.data.reused===true&&JSON.stringify(repeat.data.candidates)===JSON.stringify(batch.data.candidates),{reused:repeat.data.reused});
 const second=await post({action:'complete',...handle});
 check('sealing twice preserves immutable cohort',second.status===200&&second.data.fingerprint===finished.data.fingerprint&&JSON.stringify(second.data.frozen)===JSON.stringify(finished.data.frozen),{status:second.status});
 const read=await post({action:'archive-status',...handle});
 check('independent status request reads saved data',read.status===200&&read.data.integrity===true&&read.data.runId===p.data.runId,{status:read.status});
 check('only saved qualified rows are candidates',read.status===200&&read.data.frozen?.result.candidates.every(c=>!!c.forecastId&&!!c.forecastIssuedAt)&&read.data.picks.length===read.data.frozen.result.candidates.length,{picks:read.data.picks?.length,note:'Zero qualifying candidates is retained honestly.'});
 check('per-market future result not invented',read.status===200&&read.data.byMarket.every(m=>m.complete===0&&m.performance.directionAccuracy===null),{markets:read.data.byMarket?.map(m=>({market:m.market,selected:m.selected,pending:m.pending,completed:m.complete}))});
 const wrong=await post({action:'archive-status',runId:p.data.runId,runToken:'0'.repeat(64)});
 check('wrong run capability cannot read history',wrong.status!==200,{status:wrong.status});
 const owner=await fetch(SITE+'/api/admin/screener-history',{redirect:'manual'});
 check('owner-wide history requires existing admin authentication',owner.status===401||owner.status===403,{status:owner.status});
 report.archive=read.data; // No run token or private provider credential in artifacts.
}catch{check('archive verification',false,'request-or-schema-failed');}
report.status=checks.every(c=>c.ok)?'passed':'failed';
await mkdir('verify-out',{recursive:true});await writeFile('verify-out/screener-archive-verification.json',JSON.stringify(report,null,2)+'\n');
console.log('MIZAN_SCREENER_ARCHIVE='+JSON.stringify({status:report.status,runId:report.runId,checks}));
if(report.status!=='passed')process.exitCode=1;
