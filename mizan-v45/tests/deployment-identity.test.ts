import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentIdentityResponse} from '../lib/deployment-identity';
const sample={worker:'mizan-equity',commit:'a'.repeat(40),generatedAt:'2026-09-25T18:00:00.000Z'};
test('release route returns the exact stamped commit without extra fields',async()=>{
 const r=deploymentIdentityResponse({...sample,OPENAI_API_KEY:'not-a-real-secret'});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),sample);assert.match(r.headers.get('cache-control')!,/no-store/);
});
for(const invalid of [null,{}, {...sample,commit:null},{...sample,commit:'abc'},{...sample,worker:'another-worker'},{...sample,generatedAt:'invalid'}])
 test('unstamped or invalid build is not certified '+JSON.stringify(invalid),()=>assert.equal(deploymentIdentityResponse(invalid).status,503));
