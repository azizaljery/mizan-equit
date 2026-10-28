// Post-deploy read-only verification of the LIVE site (no sign-in, no writes, no button that triggers scans). Output: results.json + PNGs.
const {chromium,webkit}=require('playwright');const fs=require('fs');
const BASE='https://mizan-aziz.aljeryabod.workers.dev',OUT=process.argv[2];const res={base:BASE,checks:[],shots:[]};
const must=['مركز سيناريو غير معتمد تنبؤيًا','لا توجد أفضلية اتجاهية مثبتة لهذا الأفق','تاريخ بيانات السوق','نسخة المحرك','تاريخ التقييم خارج العينة','لم تثبت أفضلية ضمن البيانات والتقييم المتاحين'];
const add=(name,ok,detail)=>{res.checks.push({name,ok,detail});console.log(ok?'PASS':'FAIL',name,detail||'');};
async function page(browser,vp,url,tag){const ctx=await browser.newContext({viewport:vp,deviceScaleFactor:vp.width<500?2:1,locale:'ar-SA'});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,200)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
 let status=null;try{const r=await p.goto(BASE+url,{waitUntil:'domcontentloaded',timeout:60000});status=r&&r.status();}catch(e){errs.push('goto '+String(e).slice(0,150));}
 return {ctx,p,errs,status};}
async function shot(p,name){const f=`${OUT}/${name}.png`;try{await p.screenshot({path:f,fullPage:true});res.shots.push(name+'.png');}catch(e){}}
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 const cr=await chromium.launch(),wk=await webkit.launch();
 for(const [eng,br] of [['chromium',cr],['webkit',wk]]){
  for(const [dev,vp] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
   if(eng==='webkit'&&dev==='desktop')continue;
   const tag=`${eng}-${dev}`;
   // 1) analysis page for a stock (available forecast)
   const a=await page(br,vp,'/?symbol=1120.SR',tag);
   let ok=false;try{await a.p.waitForSelector('.forecast-panel',{timeout:110000});ok=true;}catch(e){}
   const txt=ok?await a.p.innerText('.forecast-panel'):await a.p.innerText('body').catch(()=>'');
   add(`${tag} analysis loads forecast panel`,ok,`status=${a.status} url=${a.p.url()}`);
   if(ok){for(const m of must)add(`${tag} analysis shows «${m}»`,txt.includes(m)||(m.startsWith('لم تثبت')&&txt.includes('لم تثبت أفضلية')),'');
    add(`${tag} analysis hides confidence row`,!/درجة الثقة/.test(txt)&&!/احتمال السيناريو:/.test(txt),'');
    add(`${tag} no buy wording in forecast panel`,!/نوصي|اشترِ/.test(txt),'');
    const rows=await a.p.$$('.forecast-card');add(`${tag} six horizon cards`,rows.length===6,String(rows.length));}
   add(`${tag} analysis no page errors`,a.errs.length===0,a.errs.slice(0,3).join(' | '));
   await shot(a.p,`${tag}-analysis`);await a.ctx.close();
   // 2) abstention hunt (recent listings; read-only analysis pages)
   if(eng==='chromium'){let found=null;for(const s of ['RDDT','ARM','CART','KVYO','RBRK','ALAB']){const b=await page(br,vp,'/?symbol='+s,tag);try{await b.p.waitForSelector('.forecast-panel',{timeout:70000});const t=await b.p.innerText('.forecast-panel');if(/لم يصدر توقع/.test(t)){found=s;add(`${tag} abstention state (${s})`,!/مركز سيناريو غير معتمد تنبؤيًا\s*\n?\s*\d/.test(t)&&/لم يصدر توقع/.test(t),'');await shot(b.p,`${tag}-abstention-${s}`);await b.ctx.close();break;}}catch(e){}await b.ctx.close();}
    if(!found)add(`${tag} abstention state`,null,'NOT TESTED live: none of the probe symbols abstained');}
   // 3) picks / screener / history pages
   for(const [name,url,needles] of [['picks','/picks',['ترشيحات المحرك','لم تثبت أفضلية ضمن البيانات والتقييم المتاحين']],['screener','/screener',['ترشيحات المحرك']],['tests','/tests',[]],['accuracy-sample','/accuracy-sample',[]]]){
    const c=await page(br,vp,url,tag);await c.p.waitForTimeout(6000);const bt=await c.p.innerText('body').catch(()=>'');
    const gated=/Access|sign in|تسجيل الدخول|signin/i.test(c.p.url()+bt.slice(0,300));
    add(`${tag} ${name} reachable`,c.status&&c.status<400&&!gated,`status=${c.status} url=${c.p.url()} gated=${gated}`);
    for(const n of needles)add(`${tag} ${name} shows «${n}»`,bt.includes(n),'');
    add(`${tag} ${name} no stale labels`,!/الأرجح صعودًا|المركزي المتوقع|الشركات المتوقع صعودها/.test(bt),'');
    add(`${tag} ${name} no page errors`,c.errs.length===0,c.errs.slice(0,2).join(' | '));
    await shot(c.p,`${tag}-${name}`);await c.ctx.close();}
  }}
 // 4) old records intact (read-only API)
 try{const r=await fetch(BASE+'/api/picks?market=sa&horizon=5&count=3');const j=await r.json();add('api/picks ok with stored records',r.ok&&Array.isArray(j.picks),`status=${r.status} picks=${(j.picks||[]).length} considered=${j.considered} since=${j.since}`);
  const l=await fetch(BASE+'/api/picks/ledger');add('api/picks/ledger ok',l.ok,`status=${l.status}`);}catch(e){add('api reads',false,String(e).slice(0,150));}
 fs.writeFileSync(OUT+'/results.json',JSON.stringify(res,null,1));await cr.close();await wk.close();})();
