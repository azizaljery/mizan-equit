import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GET} from '../app/api/aziz/readiness/route';
for(const [market,symbol] of [['sa','2222.SR'],['us','AAPL']])test(`read-only not-ready response for ${market}`,async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected network request')};
 try{for(let i=0;i<2;i++){const r=await GET(new Request(`https://example.test/api/aziz/readiness?market=${market}&symbol=${symbol}`));assert.equal(r.status,200);assert.match(r.headers.get('cache-control')||'',/no-store/);const d=await r.json();assert.equal(d.company.symbol,symbol);assert.equal(d.canForecast,false);assert.equal(d.recorded,false);assert.equal(d.forecast,null);assert.equal(d.modelVersion,null);assert.equal(d.dataEligibility,'not_checked');assert.ok(d.reasons.some((x:any)=>x.code==='approved_model_not_connected'));}}finally{globalThis.fetch=old;}
});
test('invalid identity is rejected without forecast fallback',async()=>{
 for(const [q,status] of [['market=sa&symbol=AAPL',404],['market=us&symbol=2222.SR',404],['market=xx&symbol=AAPL',400],['market=us&symbol=',400]])assert.equal((await GET(new Request('https://example.test/?'+q))).status,status);
});
test('button and readiness route cannot import or invoke forecast persistence',()=>{
 const panel=readFileSync('app/aziz/request-panel.tsx','utf8'),route=readFileSync('app/api/aziz/readiness/route.ts','utf8');
 assert.ok(panel.includes('/api/aziz/readiness?'));assert.ok(panel.includes('فحص جاهزية عزيز'));
 assert.doesNotMatch(panel,/\/api\/company\/analyze|method:\s*['"]POST/);
 assert.doesNotMatch(route,/cloudflare:workers|recordAnalysis|fetchCompany|forecast-journal|\.batch\(|\.prepare\(/);
});
