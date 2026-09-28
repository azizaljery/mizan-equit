import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, LEGACY_SITE, QUERIES, checkSite, auditRuntime, summarizeBindings, requestText } from '../scripts/verify-deployment.mjs';
const sha = 'a'.repeat(40), db = 'e95b74e8-81d6-4beb-8ea2-ad59c863d21d';
const html = text => new Response(text, { headers: { 'Content-Type': 'text/html' } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const goodFetch = async (url, init) => {
  assert.equal(init.headers.Authorization, undefined); assert.equal(init.redirect, 'manual');
  const path = new URL(url).pathname;
  if (path === '/') return html('<a href="/screener">فرز الأسهم</a>');
  if (path === '/screener') return html('<h1>فرز توقعات الأسهم</h1>');
  if (path === '/api/screener') { assert.equal(init.body, '{}'); return json({ error: 'السوق غير مدعوم.' }, 400); }
  return json({ worker: 'mizan-equity', commit: sha });
};
test('checks exact release, both pages and non-mutating API validation', async () => { const r=await checkSite(SITE,sha,goodFetch);assert.equal(r.ok,true);assert.equal(r.checks.length,4); });
test('404 is a failed deployment even when marker exists', async () => { const r=await checkSite(SITE,sha,(u,i)=>new URL(u).pathname==='/screener'?Promise.resolve(new Response('not found',{status:404,headers:{'Content-Type':'text/html'}})):goodFetch(u,i));assert.equal(r.ok,false); });
test('old release marker is rejected', async () => { const r=await checkSite(SITE,sha,(u,i)=>u.includes('mizan-deployment.json')?Promise.resolve(json({worker:'mizan-equity',commit:'b'.repeat(40)})):goodFetch(u,i));assert.equal(r.ok,false); });
test('redirect is not followed or counted as success', async () => { const r=await checkSite(SITE,sha,async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.test'}}));assert.equal(r.ok,false); });
test('legacy origin tested separately without starting a screener', async () => { const r=await checkSite(LEGACY_SITE,sha,goodFetch);assert.equal(r.checks.length,3); });
test('arbitrary origins and partial commit identifiers are rejected', async () => { await assert.rejects(checkSite('https://untrusted.test',sha,goodFetch));await assert.rejects(checkSite(SITE,'abc',goodFetch)); });
test('network exceptions do not leak their message', async () => { const r=await checkSite(SITE,sha,async()=>{throw new Error('secret-example')});assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes('secret-example'),false); });
test('oversized response is bounded', async () => { await assert.rejects(requestText(SITE,{},async()=>new Response('large',{headers:{'content-length':'3000000'}})),/response-too-large/); });
test('audit exposes provider presence only, never secret values', () => {
  const r=summarizeBindings({bindings:[
    {name:'DB',type:'d1',id:db},
    {name:'MIZAN_BACKGROUND_CRON_ENABLED',type:'plain_text',text:'true'},
    {name:'OPENAI_API_KEY',type:'secret_text',text:'top-secret-openai'},
    {name:'ANTHROPIC_API_KEY',type:'secret_text',text:'top-secret-anthropic'},
    {name:'MIZAN_INTERNAL_AUTOMATION_TOKEN',type:'secret_text',text:'top-secret-token'},
  ]});
  assert.equal(r.databaseBindingMatches,true);assert.equal(r.backgroundCronFlag,'enabled');
  assert.deepEqual(r.councilProviders,{openai:true,anthropic:true,deepseek:false});
  assert.equal(r.internalAutomationConfigured,true);
  assert.equal(JSON.stringify(r).includes('top-secret'),false);
});
test('missing and disabled gates remain distinct', () => {
  assert.equal(summarizeBindings({bindings:[]}).backgroundCronFlag,'missing');
  assert.equal(summarizeBindings({bindings:[{name:'MIZAN_BACKGROUND_CRON_ENABLED',type:'plain_text',text:'false'}]}).backgroundCronFlag,'disabled');
});
test('runtime inventory only issues fixed SELECTs and GETs on Cloudflare', async () => {
  let selects=0;
  const audit=await auditRuntime({CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CLOUDFLARE_API_TOKEN:'mock-token'},async(u,i)=>{
    assert.equal(new URL(u).hostname,'api.cloudflare.com');assert.equal(i.redirect,'manual');assert.equal(i.headers.Authorization,'Bearer mock-token');
    if(i.method==='POST'){const body=JSON.parse(i.body);assert.ok(Object.values(QUERIES).includes(body.sql));assert.match(body.sql,/^SELECT /);assert.equal(body.sql.includes(';'),false);selects++;return json({success:true,result:[{success:true,results:[],meta:{rows_written:0}}]});}
    assert.equal(i.method,'GET');return json({success:true,result:u.endsWith('/settings')?{bindings:[]}:{schedules:[{cron:'0 */6 * * *'}]}});
  });
  assert.equal(audit.status,'ok');assert.equal(selects,Object.keys(QUERIES).length);
});
test('audit failures are not reported as zero observations', async () => {
  const audit=await auditRuntime({CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CLOUDFLARE_API_TOKEN:'mock-token'},async()=>json({success:false,errors:[{message:'secret-example'}]},403));
  assert.equal(audit.status,'partial');assert.equal(audit.sections.observations.status,'unavailable');assert.equal(JSON.stringify(audit).includes('secret-example'),false);
});
test('missing token does not perform any network call', async () => { const audit=await auditRuntime({},async()=>{throw new Error('unexpected fetch')});assert.equal(audit.status,'unavailable'); });
