#!/usr/bin/env node
/** Bounded integration trial of the DEPLOYED canonical jobs. No alternate models,
 * no direct INSERTs, no trade orders. Reports are private Actions artifacts.
 */
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {SITE,auditRuntime} from './verify-deployment.mjs';
const OUT='verify-out';
const token=process.env.MIZAN_INTERNAL_AUTOMATION_TOKEN;
const commit=process.env.GITHUB_SHA;
const run=String(process.env.GITHUB_RUN_ID||'local');
const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
const report={startedAt:new Date().toISOString(),commit,checks:[],actions:{},overallStatus:'running',scope:'Operational role execution, not independent-provider consensus, security sign-off or forecast accuracy.'};
const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});};
async function request(body,auth=token){
  const headers={'Content-Type':'application/json'};
  if(auth)headers.Authorization=`Bearer ${auth}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),210000);
  try{
    const response=await fetch(SITE+'/api/internal/automation',{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:controller.signal});
    const reader=response.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
    if(!reader)throw new Error('invalid-response');
    try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>500000)throw new Error('oversized-response');text+=decoder.decode(p.value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
    let data;try{data=JSON.parse(text);}catch{throw new Error('invalid-response');}
    return {status:response.status,data};
  }finally{clearTimeout(timer);}
}
async function action(name,extra={}){
  try{
    const r=await request({action:name,...extra});
    if(r.status!==200){check(name+' HTTP',false,`HTTP ${r.status}`);return null;}
    report.actions[name]=r.data;return r.data;
  }catch{check(name+' transport',false,'timeout-or-invalid-response');return null;}
}
async function main(){
  await mkdir(OUT,{recursive:true});
  if(!/^[a-f0-9]{40}$/.test(commit||'')||!/^\d+$/.test(attempt)||!/^\d+$/.test(run)||!/^[-A-Za-z0-9_]{32,256}$/.test(token||''))throw new Error('invalid-config');
  report.before=await auditRuntime();
  const unauth=await request({action:'status'},null),wrong=await request({action:'status'},'0'.repeat(64));
  check('internal endpoint rejects missing credential',unauth.status===401,`HTTP ${unauth.status}`);
  check('internal endpoint rejects wrong credential',wrong.status===401,`HTTP ${wrong.status}`);
  const collect=await action('collect');
  check('Data Center cycle persisted',!!collect?.stateSaved&&['completed','partial'].includes(collect?.status),collect?.status??'unavailable');
  for(const market of ['sa','us'])check(`Data Center ${market}`,Number(collect?.markets?.[market]?.saved)>0,collect?.markets?.[market]??null);
  const seed=await action('seed');
  const existing=report.before.sections?.forecastRecords?.data??[];
  const archiveStates=seed?.markets??{};
  const completePlans=['sa','us'].every(m=>{
    const p=archiveStates[m];
    return p?.state==='weekend'||(p?.state==='finished'&&p.selected>0&&p.recorded===p.selected&&p.failed===0&&p.pending===0);
  });
  const existingBothMarkets=['sa','us'].every(m=>[5,21,63,126,252].every(h=>existing.some(r=>r.market===m&&r.horizon===h&&r.total_records>0)));
  const idempotentComplete=seed?.symbolsAttempted===0&&Object.values(archiveStates).some(p=>p?.state==='finished')&&completePlans&&existingBothMarkets;
  check('canonical forecasts persisted',!!seed?.stateSaved&&seed?.status==='completed'&&!(seed?.errors?.length)&&(
    Number(seed?.analysesRecorded)+Number(seed?.skippedAlreadyRecorded)>0||idempotentComplete
  ),{status:seed?.status??'unavailable',idempotentComplete,markets:archiveStates});
  const resolve=await action('resolve');
  check('mature-outcome resolver completed',!!resolve?.stateSaved&&resolve?.status==='completed',resolve?.evaluationsSaved===0?'No matured outcomes saved; not an accuracy claim.':resolve?.status??'unavailable');
  const councilRequest={requestKey:`trial:${run}:${attempt}`,includeReports:true,task:'نفذ مراجعة تشغيلية تجريبية لميزان الأسهم اعتمادًا على Data Center وQuant المرفقين. للسوق السعودي والأمريكي معًا: بيّن الفجوات الفعلية، وضع عملَي إصلاح محددين باختبارات قبول لكل منهما. ميّز الوقت والمصدر والتغطية والآفاق ونتائج المعايرة، ولا تدّع تنفيذ تعديل أو اختبار غير وارد في الأدلة. أعط ملخصًا مهنيًا لا سلسلة تفكير. تبقى موافقة المالك مطلوبة ولا أوامر تداول.'};
  const council=await action('council',councilRequest);
  check('council run persisted',!!council?.id&&council?.stateSaved===true,council?.status??'unavailable');
  for(const role of ['rdManager','developer','securityReviewer']){
    const a=council?.agents?.[role];
    check(`${role} completed its assigned task`,a?.taskCompleted===true,{provider:a?.provider??null,keyConfigured:a?.keyConfigured??false,diagnostic:a?.diagnostic??null});
  }
  const roleIds={rdManager:'rd-manager',developer:'developer',securityReviewer:'security-reviewer'};
  check('approved OpenAI-only routing',council?.providerPolicy?.mode==='openai-only'&&Object.entries(roleIds).every(([key,role])=>council?.agents?.[key]?.provider==='openai'&&council?.agents?.[key]?.role===role),council?.providerPolicy??null);
  check('single-provider limitation and human review remain explicit',council?.providerPolicy?.independentProviderReview===false&&council?.humanDecisionRequired===true&&council?.automaticActionsExecuted===false,'Separate roles on one provider are not independent-provider verification.');
  check('all model roles completed execution',council?.executionStatus==='completed',council?.executionStatus??'unknown');
  if(council?.id){
    const repeated=await request({action:'council',...councilRequest,includeReports:false});
    check('same request does not call paid models twice',repeated.status===200&&repeated.data.id===council.id&&repeated.data.reused===true,{sameId:repeated.data.id===council.id,reused:repeated.data.reused===true});
  }
  report.after=await auditRuntime();
  check('read-only production inventory',report.after.status==='ok',report.after.status);
  const counts=report.after.sections?.forecastRecords?.data??[];
  for(const market of ['sa','us'])for(const horizon of [5,21,63,126,252])check(`saved forecast ${market}/${horizon}`,counts.some(r=>r.market===market&&r.horizon===horizon&&r.total_records>0),'Saved record, not measured forecast accuracy.');
  report.overallStatus=report.checks.every(c=>c.ok)?'passed':'partial';
}
try{await main();}catch{check('trial runner',false,'configuration-or-transport-failure');report.overallStatus='failed';}
report.finishedAt=new Date().toISOString();
await mkdir(OUT,{recursive:true});
await writeFile(`${OUT}/agent-trial.json`,JSON.stringify(report,null,2)+'\n');
const council=report.actions.council;
const lines=['# Mizan agent trial',`Commit: ${commit}`,`Status: ${report.overallStatus}`,'',...report.checks.map(c=>`${c.ok?'PASS':'BLOCKED'}: ${c.name}`)];
await writeFile(`${OUT}/agent-trial.md`,lines.join('\n')+'\n');
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log('MIZAN_AGENT_TRIAL='+JSON.stringify({commit,status:report.overallStatus,checks:report.checks,collection:report.actions.collect,seed:report.actions.seed,resolution:report.actions.resolve,council:council?{id:council.id,status:council.status,executionStatus:council.executionStatus,providerPolicy:council.providerPolicy,agents:council.agents,securityDecision:council.securityDecision}:null}));
// Deployment success is not agent acceptance. A missing/failed required role is visible.
if(report.overallStatus!=='passed')process.exitCode=1;
