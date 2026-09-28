#!/usr/bin/env node
/** Read-only directory plans plus a two-symbol LIVE batch. No LLM requests,
 * no private recommendation access, no synthetic prices, no journal INSERTs.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {SITE} from './verify-deployment.mjs';
const checks=[],report={checkedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,checks,scope:'200-symbol plan/selection and a two-symbol live model batch, not a completed 200-symbol live scan.'};
const check=(name,ok,detail)=>checks.push({name,ok,detail});
async function post(body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150000);
 try{
  const r=await fetch(SITE+'/api/screener',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'manual'});
  const text=await r.text();if(text.length>300000)throw Error('large-response');
  return {status:r.status,data:JSON.parse(text)};
 }finally{clearTimeout(timer);}
}
try{
 for(const resultCount of [5,6,7,8,9,10]){
  const r=await post({action:'plan',market:'both',horizonSessions:5,resultCount,scanLimit:200});
  check(`plan top ${resultCount} per market from 200`,r.status===200&&r.data.resultCount===resultCount&&r.data.symbols?.length===200&&new Set(r.data.symbols).size===200,{status:r.status,planned:r.data.symbols?.length});
  if(resultCount===10)report.plan=r.data;
 }
 for(const horizonSessions of [1,5,21,63,126,252]){
  const r=await post({action:'plan',market:'sa',horizonSessions,resultCount:5,scanLimit:20});
  check(`horizon ${horizonSessions}`,r.status===200&&r.data.horizonSessions===horizonSessions,{status:r.status});
 }
 for(const market of ['sa','us']){
  const r=await post({action:'plan',market,horizonSessions:5,resultCount:5,scanLimit:200});
  check(`${market} bounded plan`,r.status===200&&r.data.symbols?.length===200&&r.data.symbols.every(s=>market==='sa'?s.endsWith('.SR'):!s.endsWith('.SR')),{status:r.status,count:r.data.symbols?.length});
 }
 const bad=await post({action:'plan',market:'sa',horizonSessions:5,resultCount:11,scanLimit:200});
 check('top 11 rejected',bad.status===400,{status:bad.status});
 const big=await post({action:'plan',market:'sa',horizonSessions:5,resultCount:10,scanLimit:201});
 check('scan 201 rejected',big.status===400,{status:big.status});
 const b=await post({action:'batch',market:'both',horizonSessions:5,resultCount:10,scanLimit:200,expectedVersion:report.plan?.modelVersion,symbols:['2222.SR','AAPL']});
 report.liveBatch=b.data;
 check('two-market live batch returns current model result',b.status===200&&b.data.scanned===2&&b.data.analyzed===2&&b.data.modelVersion===report.plan?.modelVersion,{status:b.status,analyzed:b.data.analyzed,failures:b.data.failures});
 check('requested results are a per-market cap, not fabricated rows',b.status===200&&b.data.requestedResultCount===10&&b.data.returned===b.data.candidates?.length&&b.data.returned<=20&&b.data.missingCount===20-b.data.returned,{returned:b.data.returned,excluded:b.data.excluded,exclusionCounts:b.data.exclusionCounts});
 check('every returned row meets the declared conditions',b.status===200&&b.data.candidates?.every(c=>c.available&&c.direction==='صاعد'&&['متوسط','مرتفع'].includes(c.confidence)&&Array.isArray(c.range)&&c.range.length===2&&c.range.every(Number.isFinite)&&c.range[0]>0&&c.range[1]>c.range[0]&&c.predictedPrice>c.price&&c.priceTime&&Array.isArray(c.basis)),{returned:b.data.returned,note:'An empty list is valid when no candidates qualify.'});
 const html=await fetch(SITE+'/screener',{redirect:'manual'});const text=await html.text();
 check('published page shows independent selectors',html.status===200&&text.includes('عدد النتائج المطلوبة')&&text.includes('عدد الأسهم المفحوصة')&&text.includes('السعودية وأمريكا معًا'),{status:html.status});
}catch{check('verification transport',false,'request-failed-or-invalid-response');}
report.status=checks.every(c=>c.ok)?'passed':'failed';
await mkdir('verify-out',{recursive:true});await writeFile('verify-out/screener-verification.json',JSON.stringify(report,null,2)+'\n');
console.log('MIZAN_SCREENER_VERIFICATION='+JSON.stringify(report));
if(report.status!=='passed')process.exitCode=1;
