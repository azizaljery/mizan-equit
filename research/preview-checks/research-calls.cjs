// Read-only visitor probe (no sign-in, no writes). Attributes each GET /api/research to a mounted ResearchWorkspace instance.
// Scenarios: (1) initial load with analysis: expected 1 GET per mounted instance (instance A before the report, B after);
// (2) same-symbol re-analysis keeps instance B mounted and changes analysisTime: expected +1 GET WITHOUT the gate, 0 WITH it;
// (3) focus: expected +1 WITH the gate (re-check), 0 without (no listener).
const {chromium}=require('playwright');const fs=require('fs');
const [host,label,outFile]=process.argv.slice(2);const BASE='https://'+host;
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({locale:'ar-SA'})).newPage();const ev=[];const t0=Date.now();const T=()=>Date.now()-t0;
 p.on('response',r=>{const u=r.url().replace(BASE,'');if(u.startsWith('/api/research')&&r.request().method()==='GET')ev.push({t:T(),kind:'GET',status:r.status()})});
 await p.exposeFunction('__mount',(k)=>ev.push({t:T(),kind:k}));
 await p.addInitScript(()=>{const seen=new WeakSet();const scan=()=>{document.querySelectorAll('#paper-portfolio').forEach(el=>{if(!seen.has(el)){seen.add(el);window.__mount('MOUNT')}});};
  new MutationObserver(m=>{for(const r of m)for(const n of r.removedNodes)if(n.nodeType===1&&(n.id==='paper-portfolio'||n.querySelector?.('#paper-portfolio')))window.__mount('UNMOUNT');scan();}).observe(document,{childList:true,subtree:true});});
 const out={host,label,scenarios:{}};
 await p.goto(BASE+'/?symbol=1120.SR',{waitUntil:'domcontentloaded',timeout:60000});
 let panel=false;try{await p.waitForSelector('.forecast-panel',{timeout:120000});panel=true}catch{}
 await p.waitForTimeout(8000);
 const cut1=ev.length;out.scenarios.initial={panel,events:ev.slice(0,cut1),gets:ev.slice(0,cut1).filter(e=>e.kind==='GET').length,mounts:ev.slice(0,cut1).filter(e=>e.kind==='MOUNT').length};
 // scenario 2: same-symbol re-analysis through the search box
 let triggered=false;
 try{const btn=p.locator('button:has-text("إعادة جلب بيانات الشركة")').first();await btn.waitFor({state:'attached',timeout:20000});
  await btn.evaluate(el=>{for(let e=el;e;e=e.parentElement)if(e.tagName==='DETAILS')e.open=true;el.scrollIntoView()});
  ev.push({t:T(),kind:'CLICK_REFETCH_SAME_COMPANY'});await btn.click({timeout:15000,force:true});triggered=true;
  await p.waitForTimeout(50000);}catch(e){out.scenarios.reanalysisError=String(e).slice(0,200)}
 const cut2=ev.length;const s2=ev.slice(cut1,cut2);out.scenarios.reanalysis={triggered,events:s2,gets:s2.filter(e=>e.kind==='GET').length,mounts:s2.filter(e=>e.kind==='MOUNT').length,unmounts:s2.filter(e=>e.kind==='UNMOUNT').length};
 await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(5000);
 const s3=ev.slice(cut2);out.scenarios.focus={events:s3,gets:s3.filter(e=>e.kind==='GET').length};
 fs.writeFileSync(outFile,JSON.stringify(out,null,1));console.log(JSON.stringify({label,initial:{gets:out.scenarios.initial.gets,mounts:out.scenarios.initial.mounts},reanalysis:{triggered,gets:out.scenarios.reanalysis.gets,mounts:out.scenarios.reanalysis.mounts},focus:out.scenarios.focus.gets}));await b.close();})().catch(e=>{console.error(e);process.exitCode=1});
