import test from 'node:test';
import assert from 'node:assert/strict';
import {withVerifiedIdentity} from '../worker/owner-identity';
// Separate file (= separate process): module-level cert cache starts empty.
const team='rotation-test.cloudflareaccess.com',aud='aud-rotation',env={ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud};
const b64u=(v:ArrayBuffer|string)=>Buffer.from(typeof v==='string'?v:new Uint8Array(v)).toString('base64url');
const gen=()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const k1=await gen(),k2=await gen();
const jwk=async(pair:CryptoKeyPair,kid:string)=>({...(await crypto.subtle.exportKey('jwk',pair.publicKey)),kid,alg:'RS256',use:'sig'});
let served:any[]=[await jwk(k1,'k1')],fetches:Array<{signal:unknown}>=[],clock=Date.parse('2026-10-17T00:00:00Z'),hang=false;
const realFetch=globalThis.fetch,realNow=Date.now;
globalThis.fetch=(async(input:any,init?:RequestInit)=>{
 const url=String(input?.url??input);if(url!==`https://${team}/cdn-cgi/access/certs`)throw new Error('unexpected fetch '+url);
 fetches.push({signal:init?.signal});
 if(hang)return new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal!.reason)));
 return Response.json({keys:served});
}) as typeof fetch;
Date.now=()=>clock;
test.after(()=>{globalThis.fetch=realFetch;Date.now=realNow;});
async function jwt(pair:CryptoKeyPair,kid:string){
 const now=Math.floor(clock/1000);
 const head=b64u(JSON.stringify({alg:'RS256',kid})),body=b64u(JSON.stringify({iss:`https://${team}`,aud:[aud],exp:now+300,iat:now,email:'owner@example.test',sub:'sub-rot'}));
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(`${head}.${body}`));
 return `${head}.${body}.${b64u(sig)}`;
}
const id=async(token:string)=>(await withVerifiedIdentity(new Request('https://mizan.test/x',{headers:{'cf-access-jwt-assertion':token}}),env)).headers.get('oai-authenticated-user-id');

test('certificate fetch carries an abort signal (bounded wait)',async()=>{
 assert.equal(await id(await jwt(k1,'k1')),'sub-rot');
 assert.equal(fetches.length,1);assert.ok(fetches[0].signal instanceof AbortSignal);
});
test('unknown kid within 60 s of the last fetch does not refetch (rate limit)',async()=>{
 served=[await jwk(k1,'k1'),await jwk(k2,'k2')];clock+=30_000;
 assert.equal(await id(await jwt(k2,'k2')),null);assert.equal(fetches.length,1);
});
test('rotated key is accepted after one refetch instead of waiting up to an hour',async()=>{
 clock+=31_000;
 assert.equal(await id(await jwt(k2,'k2')),'sub-rot');assert.equal(fetches.length,2);
 assert.equal(await id(await jwt(k1,'k1')),'sub-rot');assert.equal(fetches.length,2,'cached after refresh');
});
test('a still-unknown kid refetches at most once per minute',async()=>{
 const k3=await gen();clock+=61_000;
 assert.equal(await id(await jwt(k3,'k3')),null);assert.equal(fetches.length,3);
 for(let i=0;i<5;i++){clock+=5_000;assert.equal(await id(await jwt(k3,'k3')),null);}
 assert.equal(fetches.length,3);
 clock+=61_000;assert.equal(await id(await jwt(k3,'k3')),null);assert.equal(fetches.length,4);
});
test('a hung certificate endpoint is aborted and yields no identity',async()=>{
 clock+=3_700_000;hang=true;// cache expired; AbortSignal.timeout uses real timers, not Date.now
 const keepAlive=setInterval(()=>{},250);// Node unrefs AbortSignal.timeout timers
 try{
  const started=performance.now();
  assert.equal(await id(await jwt(k1,'k1')),null);
  assert.ok(performance.now()-started<10_000);
 }finally{hang=false;clearInterval(keepAlive);}
});
