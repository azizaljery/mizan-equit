#!/usr/bin/env node
/** Stage a production-cron acceptance cycle for the full 200+200 screener.
 * Deployment verifies release identity, the gated runtime, and durable acceptance state.
 * The registered five-minute cron advances the real server-owned cohorts afterward.
 * This is operational acceptance only, never a forecast-accuracy claim.
 */
import {mkdir,writeFile} from 'node:fs/promises';
const SITE='https://mizan-equity.aljeryabod.workers.dev',TOKEN=process.env.MIZAN_INTERNAL_AUTOMATION_TOKEN,SHA=process.env.GITHUB_SHA;
const config={enabled:false,intervalHours:24,scanPerMarket:200,resultCount:10,horizonSessions:5};
const report={startedAt:new Date().toISOString(),commit:SHA,status:'running',scope:'Stage full 200 Saudi + 200 US immutable acceptance for the real scheduled Worker path; no predictive-accuracy claim.',config,checks:[]};
const check=(name,ok,detail)=>report.checks.push({name,ok,detail});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function save(){await mkdir('verify-out',{recursive:true});await writeFile('verify-out/screener-followup-trial.json',JSON.stringify(report,null,2)+'\n');}
async function request(path,body,internal=false,timeout=60000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const headers={'Accept':'application/json','Cache-Control':'no-cache'};
  if(body){headers['Content-Type']='application/json';headers.Origin=SITE;}
  if(internal)headers.Authorization='Bearer '+TOKEN;
  const r=await fetch(SITE+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:controller.signal});
  const text=await r.text();let data=null;try{data=JSON.parse(text);}catch{}
  if(r.status!==200){
   const safe=data&&typeof data.error==='string'?data.error.slice(0,120):r.headers.get('content-type')?.includes('json')?'json':'nonjson';
   throw Error('HTTP-'+r.status+'-'+safe);
  }
  if(!data||typeof data!=='object')throw Error('invalid-json');return data;
 }finally{clearTimeout(timer);}
}
const internal=body=>request('/api/internal/automation',body,true);
try{
 if(!/^[a-f0-9]{40}$/.test(SHA||'')||!/^[-A-Za-z0-9_]{32,256}$/.test(TOKEN||''))throw Error('missing-config');
 const release=await request('/mizan-deployment.json?deployment='+SHA,null,false,30000);
 if(release.commit!==SHA||release.worker!=='mizan-equity')throw Error('release-mismatch');
 check('same published release',true,SHA);
 let ready=null;
 for(let i=0;i<3;i++){
  ready=await internal({action:'runtime-ready'});
  if(ready.status!=='ready'||ready.commit!==SHA||ready.backgroundCronEnabled!==true||ready.followupVersion!=='screener-followup-step-v3')throw Error('runtime-not-ready');
  if(i<2)await sleep(5000);
 }
 check('authenticated runtime stable on current release',true,{commit:ready.commit,followupVersion:ready.followupVersion});
 const before=await internal({action:'screener-operations'});
 if(before.settings.config.enabled){
  report.status='already-enabled';
  check('periodic followup already enabled by a previously accepted full cohort',true,before.settings.config);
 }else{
  const started=await internal({action:'followup-acceptance-start',config});
  const a=started.acceptance;
  const ok=started.status==='ok'&&a&&a.release===SHA&&a.state==='running'&&a.config?.scanPerMarket===200&&a.config?.resultCount===10&&a.config?.horizonSessions===5;
  check('full market acceptance staged for production cron',ok,{state:a?.state??null,id:a?.id??null,reused:a?.reused===true,release:a?.release??null});
  const status=await internal({action:'followup-acceptance-status'});
  report.acceptance=status.acceptance??null;
  check('staged acceptance persisted',status.status==='ok'&&status.acceptance?.id===a?.id&&status.acceptance?.state==='running',{state:status.acceptance?.state??null});
  report.status=report.checks.every(c=>c.ok)?'staged':'partial';
 }
 report.after=await internal({action:'screener-operations'});
}catch(e){report.status='blocked';check('staging acceptance',false,e instanceof Error?e.message.slice(0,180):'transport-or-server-error');try{report.after=await internal({action:'screener-operations'});}catch{}}
report.finishedAt=new Date().toISOString();await save();
console.log('MIZAN_FOLLOWUP_ACCEPTANCE='+JSON.stringify({status:report.status,commit:SHA,acceptance:report.acceptance??null,checks:report.checks}));
if(!['staged','already-enabled'].includes(report.status))process.exitCode=1;
