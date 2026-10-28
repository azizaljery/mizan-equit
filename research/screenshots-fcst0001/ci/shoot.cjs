const {chromium}=require('playwright');const dir=process.argv[2];
(async()=>{const b=await chromium.launch();
for(const [name,vp] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
 const p=await b.newPage({viewport:vp,deviceScaleFactor:name==='mobile'?2:1});
 await p.goto('file://'+dir+'/page.html');await p.waitForTimeout(500);
 await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>{if(!d.closest('[data-shot=notice]'))d.open=false}));
 for(const s of ['available','abstention','accuracy','notice']){const el=await p.$(`[data-shot=${s}]`);await el.screenshot({path:`${dir}/${name}-${s}.png`});}
 await p.close();}
await b.close();})();
