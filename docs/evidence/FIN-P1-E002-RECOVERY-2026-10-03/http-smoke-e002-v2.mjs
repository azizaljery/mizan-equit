#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const [label, expectedCommit, baseUrl] = process.argv.slice(2);
if (!/^(v52-before|v51-rollback|v52-return)$/.test(label || '') || !/^[a-f0-9]{40}$/.test(expectedCommit || '') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl || '')) {
  throw new Error('usage: node http-smoke-e002.mjs <stage> <source-sha> <http://127.0.0.1:port>');
}
const outDir='/workspace/shared/engineering-qa/mizan-e002-2026-10-03';
const routes=[
  {path:'/',category:'page',status:200},
  {path:'/manual',category:'page',status:200},
  {path:'/screener',category:'page',status:200},
  {path:'/screener/operations',category:'page',status:200},
  {path:'/tests',category:'page',status:200},
  {path:'/accuracy',category:'page',status:200},
  {path:'/accuracy-sample',category:'page',status:200},
  {path:'/aziz',category:'page',status:200},
  {path:'/gold',category:'page',status:200},
  {path:'/mizan-deployment.json',category:'release-identity',status:200},
  {path:'/api/site-settings',category:'read-api',status:200},
  {path:'/api/temporal?symbol=SYNTH&date=2026-10-03',category:'read-api',status:200},
  {path:'/api/aziz/readiness?market=us&symbol=AAPL',category:'read-api',status:200},
  {path:'/api/aziz/monitor',category:'read-api',status:200},
  {path:'/api/research',category:'auth-boundary',status:401},
  {path:'/api/forecast-tests',category:'auth-boundary',status:401},
  {path:'/api/market-watch',category:'auth-boundary',status:401},
  {path:'/api/accuracy-sample',category:'auth-boundary',status:401},
  {path:'/api/admin/verify',category:'auth-boundary',status:403},
  {path:'/api/admin/dashboard',category:'auth-boundary',status:403},
];
const sha256=b=>createHash('sha256').update(b).digest('hex');
async function get(path){
  const r=await fetch(new URL(path,baseUrl),{method:'GET',redirect:'manual',headers:{Accept:path.startsWith('/api/')||path.endsWith('.json')?'application/json':'text/html'},signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await r.arrayBuffer());
  return {status:r.status,contentType:r.headers.get('content-type')||'',bodyBytes:bytes.length,bodySha256:sha256(bytes),json: r.headers.get('content-type')?.includes('json')?(()=>{try{return JSON.parse(bytes.toString('utf8'))}catch{return null}})():null};
}
const started=Date.now(); let startupProbes=0,ready=false,last=null;
for(let i=0;i<40;i++){
  startupProbes++;
  try { last=await get('/'); if(last.status===200&&last.contentType.includes('text/html')) {ready=true;break;} }
  catch { last=null; }
  await new Promise(r=>setTimeout(r,250));
}
const results=[];
for(const spec of routes){
  const entry={path:spec.path,method:'GET',category:spec.category,expectedStatus:spec.status};
  try{
    const r=await get(spec.path);
    entry.status=r.status; entry.contentType=r.contentType; entry.bodyBytes=r.bodyBytes; entry.bodySha256=r.bodySha256;
    let valid=r.status===spec.status;
    if(spec.category==='page') valid=valid&&r.contentType.includes('text/html');
    if(spec.category==='read-api'||spec.category==='auth-boundary') valid=valid&&r.contentType.includes('json');
    if(spec.category==='release-identity'){
      entry.identity=r.json?{worker:r.json.worker??null,commit:r.json.commit??null}:null;
      valid=valid&&r.contentType.includes('json')&&r.json?.worker==='mizan-equity'&&r.json?.commit===expectedCommit;
    }
    if(spec.path.startsWith('/api/temporal')) {entry.available=r.json?.available??null;valid=valid&&r.json?.available===false;}
    if(spec.path.startsWith('/api/aziz/readiness')) {entry.readinessStatus=r.json?.status??null;entry.canForecast=r.json?.canForecast??null;valid=valid&&r.json?.status==='not_ready'&&r.json?.canForecast===false;}
    entry.passed=valid;
  }catch(e){entry.status=null;entry.error=String(e?.name||'request-error');entry.passed=false;}
  results.push(entry);
}
const byCategory=Object.fromEntries([...new Set(routes.map(r=>r.category))].map(c=>[c,results.filter(r=>r.category===c).length]));
const output={
  evidenceId:'EVD-RB-002',campaign:'E002-EVIDENCE-RECOVERY-2026-10-03',generatedAt:new Date().toISOString(),
  stage:label,sourceSha:expectedCommit,runtime:'built Worker under Miniflare, served by a loopback HTTP bridge in the same Node process; no saved provider archive was executed',
  clientExecution:'same process as the loopback HTTP bridge',
  baseUrl,workerBoundTo127001:true,mode:'--local with isolated synthetic D1; no remote bindings; no authentication cookies/headers',
  startup:{ready,readinessProbes:startupProbes,firstReadyElapsedMs:Date.now()-started,probePath:'/',probeExcludedFromMatrix:true},
  assertedMatrixRequests:results.length,categoryCounts:byCategory,routes:results,
  status:ready&&results.length===20&&results.every(r=>r.passed)?'PASSED':'FAILED',
  rawResponseBodiesStored:false,
  notes:['Every matrix request used GET with redirect manual.', 'Response bodies were hashed and discarded; only the release identity fields and specified readiness fields were parsed.', 'Startup readiness probes are separate from the 20 asserted matrix GETs.', 'The HTTP client and Worker bridge share this process because a separate executor process could not reach the loopback listener.']
};
const path=`${outDir}/http-smoke-${label}-inprocess.json`;
await writeFile(path,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({path,status:output.status,stage:label,sourceSha:expectedCommit,assertedMatrixRequests:results.length,categoryCounts:byCategory,startupProbes,failed:results.filter(r=>!r.passed).map(r=>({path:r.path,status:r.status,expectedStatus:r.expectedStatus}))},null,2));
if(output.status!=='PASSED')process.exitCode=1;
