const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:430,height:900}});
await p.goto('file:///tmp/claude-0/shot/out.html');
await p.screenshot({path:'top.png',clip:{x:0,y:0,width:430,height:900}});
const cards=await p.$$('.forecast-card');
await cards[1].screenshot({path:'card-week.png'});await cards[5].screenshot({path:'card-year.png'});
await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
const last=await p.$('section.forecast-panel > details:last-of-type');if(last)await last.screenshot({path:'method.png'});
console.log((await p.innerText('.forecast-panel')).slice(0,1800));await b.close()})();
