import {mkdir,writeFile} from 'node:fs/promises';
const site='https://mizan-equity.aljeryabod.workers.dev';
const token=process.env.MIZAN_INTERNAL_AUTOMATION_TOKEN;
const started=Date.now();
const report={commit:process.env.GITHUB_SHA,startedAt:new Date(started).toISOString(),status:'checking',scope:'Operational cron and durable daily selection; no training or accuracy claim.'};
async function request(action){
 const response=await fetch(site+'/api/internal/automation',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw Error('internal-http-'+response.status);return response.json();
}
try{
 if(!token)throw Error('missing-internal-token');
 const ready=await request('runtime-ready');
 if(!ready.backgroundCronEnabled||ready.commit!==report.commit)throw Error('release-or-runtime-mismatch');
 report.initial=await request('seed');
 if(!['completed','partial','locked'].includes(report.initial.status))throw Error('initial-run-failed');
 while(Date.now()-started<420000){
  report.archive=await request('daily-archive-status');
  if(report.archive.version!=='mizan-daily-archive/1'||report.archive.targetPerMarket!==30||JSON.stringify(report.archive.requiredHorizons)!=='[1,5,21,252]')throw Error('archive-contract-mismatch');
  const cron=report.archive.recent.find(x=>x.id==='job:daily-forecast:last-cron')?.data;
  if(cron?.triggeredBy==='cron'&&cron.cron==='*/5 * * * *'&&Date.parse(cron.startedAt)>=started&&cron.stateSaved&&['completed','partial'].includes(cron.status)){
   report.cron=cron;report.status='active-cron-observed';break;
  }
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 if(report.status!=='active-cron-observed')throw Error('no-current-scheduled-heartbeat-observed');
}catch(e){report.status='unverified';report.error=e.message;process.exitCode=1;}
report.finishedAt=new Date().toISOString();
await mkdir('verify-out',{recursive:true});await writeFile('verify-out/daily-archive-activation.json',JSON.stringify(report,null,2));
console.log('MIZAN_DAILY_ARCHIVE='+JSON.stringify(report));
