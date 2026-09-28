import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const site='https://mizan-equity.aljeryabod.workers.dev';
const report={commit:process.env.GITHUB_SHA,checks:[],checkedAt:new Date().toISOString()};
const release=await (await fetch(site+'/mizan-deployment.json?aziz='+Date.now())).json();assert.equal(release.commit,report.commit);
for(const [market,symbol] of [['sa','2222.SR'],['us','AAPL']]){
 for(let i=0;i<2;i++){
 const r=await fetch(site+`/api/aziz/readiness?market=${market}&symbol=${symbol}`,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const d=await r.json();
 assert.equal(d.company.symbol,symbol);assert.equal(d.engine,'aziz');assert.equal(d.canForecast,false);assert.equal(d.recorded,false);assert.equal(d.forecast,null);assert.equal(d.dataEligibility,'not_checked');
 report.checks.push({market,symbol,repeat:i,status:d.status,recorded:d.recorded});
 }
}
const post=await fetch(site+'/api/aziz/readiness',{method:'POST'});assert.equal(post.status,405);
const page=await(await fetch(site+'/aziz')).text();assert.ok(page.includes('فحص جاهزية عزيز'));
await mkdir('verify-out',{recursive:true});await writeFile('verify-out/aziz-readiness.json',JSON.stringify(report,null,2));
console.log('AZIZ_READINESS_VERIFIED='+JSON.stringify(report));
