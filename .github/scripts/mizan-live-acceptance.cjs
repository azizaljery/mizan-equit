/* Live browser acceptance; no trades, synthetic prices, saved credentials or HAR. */
const fs=require('node:fs/promises'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {chromium,devices}=createRequire(path.join(process.env.PW_ROOT,'package.json'))('playwright');
const SITE='https://mizan-equity.aljeryabod.workers.dev',OUT='mizan-v45/verify-out';
const report={startedAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA,checks:[],batches:[],requests:[],pageErrors:[],releaseProbes:[],scope:'Live browser and original archived forecasts; this does not measure investment returns.'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|cookie|authorization/i.test(k)).map(([k,x])=>[k,clean(x)])):v;
const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});console.log(JSON.stringify({name,ok,detail}));};
async function write(){await fs.mkdir(OUT,{recursive:true});await fs.writeFile(path.join(OUT,'live-acceptance.json'),JSON.stringify(clean(report),null,2)+'\n');}
async function releaseReady(){
 for(let i=0;i<30;i++){
  try{
   const r=await fetch(SITE+'/mizan-deployment.json?deployment='+process.env.GITHUB_SHA,{redirect:'manual',signal:AbortSignal.timeout(10000)}),m=await r.json();
   const probe={status:r.status,commit:m.commit??null};report.releaseProbes.push(probe);
   if(r.status===200&&m.worker==='mizan-equity'&&/^[a-f0-9]{40}$/.test(m.commit)){
    let identical=false;try{execFileSync('git',['diff','--quiet',m.commit,'HEAD','--','mizan-v45','.github/workflows/deploy-mizan-equity.yml'],{stdio:'ignore'});identical=true;}catch{}
    if(m.commit===process.env.GITHUB_SHA||identical){report.deployedCommit=m.commit;check('exact deployed app source verified',true,{deployed:m.commit,test:process.env.GITHUB_SHA});return;}
   }
  }catch{report.releaseProbes.push({status:'unavailable'});}
  await write();await sleep(10000);
 }
 throw Error('Release identity did not match; no stock scan started.');
}
async function post(request,body){const r=await request.post(SITE+'/api/screener',{data:body,timeout:120000});return {status:r.status(),data:await r.json()};}
let browser,context,page,handle,plan,finished,failure;const pending=[];
(async()=>{
 try{
  await write();await releaseReady();browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1365,height:900},locale:'ar-SA'});page=await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push(String(e.message).slice(0,500)));
  page.on('requestfailed',req=>{if(new URL(req.url()).pathname==='/api/screener')failure={kind:'transport',error:req.failure()?.errorText??'failed'};});
  page.on('response',resp=>{
   if(new URL(resp.url()).pathname!=='/api/screener'||resp.request().method()!=='POST')return;
   const task=(async()=>{
    let body;try{body=resp.request().postDataJSON();}catch{return;}
    const meta={action:body.action,status:resp.status(),type:resp.headers()['content-type']??null,index:body.batchIndex??null};report.requests.push(meta);
    let data;try{data=await resp.json();}catch{failure={...meta,kind:'non-json-response'};await write();return;}
    if(resp.status()>=400){if(resp.status()!==429)failure={...meta,error:data.error};await write();return;}
    if(body.action==='plan'&&body.archive===true){plan=data;handle={runId:data.runId,runToken:data.runToken};report.plan=clean(data);}
    if(body.action==='archive-batch')report.batches.push({index:body.batchIndex,...clean(data)});
    if(body.action==='complete'){finished=data;report.archive=clean(data);}
    await write();
   })();pending.push(task.catch(()=>{failure={kind:'response-processing'};}));
  });
  await page.goto(SITE+'/screener',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'فرز توقعات الأسهم',exact:true}).waitFor();
  await page.getByLabel('السوق',{exact:true}).selectOption('both');await page.getByLabel('المدة',{exact:true}).selectOption('5');
  await page.getByLabel('عدد النتائج المطلوبة',{exact:true}).selectOption('10');await page.getByLabel('عدد الأسهم المفحوصة',{exact:true}).selectOption('200');
  check('browser selectors accept both markets, week, ten and 200',true,{});
  await page.screenshot({path:path.join(OUT,'screener-before.png'),fullPage:true});
  await page.getByRole('button',{name:'ابحث عن الشركات المتوقع صعودها',exact:true}).click();
  const start=Date.now(),deadline=start+18*60000;
  while(!finished&&!failure&&Date.now()<deadline){
   const alerts=await page.getByRole('alert').allTextContents();if(alerts.some(t=>t.trim())){failure={kind:'visible-error',messages:alerts};break;}
   if(!plan&&Date.now()-start>30000){failure={kind:'plan-timeout'};break;}
   if(plan&&!report.batches.length&&Date.now()-start>150000){failure={kind:'first-batch-timeout'};break;}
   await sleep(2000);
  }
  await Promise.allSettled(pending);report.failure=failure??null;
  check('200-symbol browser scan completes',!!finished&&plan?.symbols?.length===200,{planned:plan?.symbols?.length??0,batches:report.batches.length,failure:failure??null});
  if(plan)check('balanced unique sample',plan.selectedCount?.sa===100&&plan.selectedCount?.us===100&&new Set(plan.symbols).size===200,plan.selectedCount);
  await page.screenshot({path:path.join(OUT,'screener-outcome.png'),fullPage:true});
  if(!finished){const stop=page.getByRole('button',{name:'إيقاف المسح',exact:true});if(await stop.count())await stop.click();}
  if(finished){
   const r=finished.frozen.result;report.dataCoverage={analyzed:r.analyzed,failed:r.failed,scanned:r.scanned};
   check('40 ordered batches with full accounting',report.batches.length===40&&report.batches.every((b,i)=>b.index===i)&&r.scanned===200&&r.analyzed+r.failed===200&&r.eligible+r.excluded===r.analyzed,{scanned:r.scanned,analyzed:r.analyzed,failed:r.failed});
   check('no padding and no cross-market substitution',new Set(r.candidates.map(c=>c.symbol)).size===r.candidates.length&&['sa','us'].every(m=>r.candidates.filter(c=>c.market===m).length<=10)&&r.candidates.every(c=>c.available&&c.direction==='صاعد'&&['متوسط','مرتفع'].includes(c.confidence)&&c.forecastId),{returned:r.returned});
   check('immutable archive fingerprint',finished.status==='complete'&&finished.integrity===true,{integrity:finished.integrity});
   const replay=await post(context.request,{action:'archive-batch',...handle,batchIndex:0}),read=await post(context.request,{action:'archive-status',...handle});
   check('replay preserves the original',replay.data.reused===true&&read.data.fingerprint===finished.fingerprint,{reused:replay.data.reused});
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'تحديث نتيجة المسح المحفوظ',exact:true}).click();await page.getByText(handle.runId,{exact:true}).waitFor();
   check('archive restored after browser reload',(await page.locator('body').innerText()).includes('مطابقة'),{runId:handle.runId});
   await page.screenshot({path:path.join(OUT,'archive-after-reload.png'),fullPage:true});
  }
  const owner=await context.request.get(SITE+'/api/admin/screener-history');check('owner data needs login',[401,403].includes(owner.status()),{status:owner.status(),authorizedOwnerTest:'not performed'});
  if(handle){const denied=await post(context.request,{action:'archive-status',runId:handle.runId,runToken:'0'.repeat(64)});check('wrong archive token denied',denied.status>=400&&!denied.data.frozen,{status:denied.status});}
  const mobile=await browser.newContext({...devices['iPhone 13'],locale:'ar-SA'}),mp=await mobile.newPage();await mp.goto(SITE+'/screener',{waitUntil:'domcontentloaded'});
  await mp.getByLabel('السوق',{exact:true}).waitFor();const layout=await mp.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));check('mobile layout fits viewport',layout.scroll<=layout.width+2,layout);await mp.screenshot({path:path.join(OUT,'screener-mobile.png'),fullPage:true});await mobile.close();
  for(const symbol of ['2222.SR','AAPL']){
   const responses=[],listener=resp=>{if(new URL(resp.url()).pathname==='/api/company/analyze')try{if(resp.request().postDataJSON().symbol===symbol)responses.push(resp);}catch{}};
   page.on('response',listener);await page.goto(SITE+'/?symbol='+encodeURIComponent(symbol),{waitUntil:'domcontentloaded',timeout:60000});
   const end=Date.now()+70000;while(!responses.length&&Date.now()<end)await sleep(1000);
   let data;try{data=await responses[0]?.json();}catch{}
   check('deep-link analysis '+symbol,responses.length===1&&data?.company?.symbol===symbol&&data.currency===(symbol.endsWith('.SR')?'SAR':'USD'),{requests:responses.length,status:responses[0]?.status()??null,symbol:data?.company?.symbol,currency:data?.currency});
   if(data?.company?.symbol===symbol){await page.locator('.stock-symbol-badge').filter({hasText:symbol}).waitFor();check('rendered company '+symbol,true,{});}
   await page.screenshot({path:path.join(OUT,'deep-link-'+symbol.replace('.','-')+'.png'),fullPage:true});page.off('response',listener);
  }
  check('no uncaught browser exceptions',report.pageErrors.length===0,{errors:report.pageErrors});
 }catch(e){check('acceptance runner',false,String(e.message).slice(0,600));}
 finally{
  if(page)try{await page.screenshot({path:path.join(OUT,'last-page.png'),fullPage:true});}catch{}
  if(browser)await browser.close();report.finishedAt=new Date().toISOString();report.status=report.checks.every(c=>c.ok)?'passed':'needs-repair';await write();
  console.log('MIZAN_LIVE_ACCEPTANCE='+JSON.stringify({status:report.status,checks:report.checks}));if(report.status!=='passed')process.exitCode=1;
 }
})();
