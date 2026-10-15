import test from 'node:test';
import assert from 'node:assert/strict';
import {withVerifiedIdentity} from '../worker/owner-identity';
const team='mizan-test.cloudflareaccess.com',aud='aud-tag-fixture',env={ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud};
const b64u=(v:ArrayBuffer|string)=>Buffer.from(typeof v==='string'?v:new Uint8Array(v)).toString('base64url');
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwks={keys:[{...(await crypto.subtle.exportKey('jwk',pair.publicKey)),kid:'k1',alg:'RS256',use:'sig'}]};
let certFetches=0;
const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:any)=>{const url=String(input?.url??input);if(url!==`https://${team}/cdn-cgi/access/certs`)throw new Error('unexpected fetch '+url);certFetches++;return Response.json(jwks);}) as typeof fetch;
test.after(()=>{globalThis.fetch=realFetch;});
const now=()=>Math.floor(Date.now()/1000);
async function jwt(claims:Record<string,unknown>,{key=pair.privateKey,kid='k1'}={}){
 const head=b64u(JSON.stringify({alg:'RS256',kid})),body=b64u(JSON.stringify(claims));
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(`${head}.${body}`));
 return `${head}.${body}.${b64u(sig)}`;
}
const good=(extra:Record<string,unknown>={})=>({iss:`https://${team}`,aud:[aud],exp:now()+300,iat:now(),email:'Owner@Example.test',sub:'sub-fixture-123',...extra});
const forged={'cf-access-authenticated-user-email':'evil@example.test','oai-authenticated-user-email':'evil@example.test','oai-authenticated-user-full-name':'Evil','oai-authenticated-user-full-name-encoding':'plain','oai-authenticated-user-id':'victim-account'};
const run=async(headers:Record<string,string>,e:any=env)=>(await withVerifiedIdentity(new Request('https://mizan.test/api/market-watch',{headers}),e)).headers;
const hex=async(v:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('hex');

test('forged identity headers are stripped when there is no JWT',async()=>{
 const h=await run(forged);
 for(const name of Object.keys(forged))assert.equal(h.get(name),null,name);
});
test('forged identity headers are stripped when Access is not configured',async()=>{
 const h=await run({...forged,'cf-access-jwt-assertion':await jwt(good())},{});
 for(const name of Object.keys(forged))assert.equal(h.get(name),null,name);
});
const invalid:[string,()=>Promise<string>][]=[
 ['malformed token',async()=>'not.a.jwt.at.all'],
 ['bad signature (other key)',()=>jwt(good(),{key:other.privateKey})],
 ['unknown kid',()=>jwt(good(),{kid:'missing'})],
 ['tampered payload',async()=>{const [a,,c]=(await jwt(good())).split('.');return `${a}.${b64u(JSON.stringify(good({email:'admin@example.test',sub:'admin'})))}.${c}`;}],
 ['wrong audience',()=>jwt(good({aud:['another-app']}))],
 ['expired',()=>jwt(good({exp:now()-10}))],
 ['not yet valid',()=>jwt(good({nbf:now()+3600}))],
 ['wrong issuer',()=>jwt(good({iss:'https://evil.cloudflareaccess.com'}))],
 ['wrong team domain',async()=>jwt(good())],
 ['missing email',()=>jwt(good({email:undefined}))],
];
for(const [name,make] of invalid)test('invalid JWT yields no identity headers: '+name,async()=>{
 const token=await make();
 const h=await run({...forged,'cf-access-jwt-assertion':token},name==='wrong team domain'?{ACCESS_TEAM_DOMAIN:'other.cloudflareaccess.com',ACCESS_AUD:aud}:env);
 for(const header of Object.keys(forged))assert.equal(h.get(header),null,header);
});
test('valid JWT sets the id from sub and overwrites forged headers',async()=>{
 const h=await run({...forged,'cf-access-jwt-assertion':await jwt(good())});
 assert.equal(h.get('oai-authenticated-user-id'),'sub-fixture-123');
 assert.equal(h.get('oai-authenticated-user-email'),'owner@example.test');
 assert.equal(h.get('cf-access-authenticated-user-email'),'owner@example.test');
 assert.equal(h.get('oai-authenticated-user-full-name'),null);
 assert.equal(h.get('oai-authenticated-user-full-name-encoding'),null);
});
test('valid JWT in the CF_Authorization cookie is accepted',async()=>{
 const h=await run({cookie:`a=b; CF_Authorization=${await jwt(good())}`,'oai-authenticated-user-id':'victim-account'});
 assert.equal(h.get('oai-authenticated-user-id'),'sub-fixture-123');
});
test('id falls back to SHA-256 of the verified lowercase email when sub is missing or empty',async()=>{
 const expected=await hex('owner@example.test');
 for(const sub of [undefined,'',42]){
  const h=await run({...forged,'cf-access-jwt-assertion':await jwt(good({sub}))});
  assert.equal(h.get('oai-authenticated-user-id'),expected);
  assert.match(expected,/^[0-9a-f]{64}$/);
 }
});
test('id is stable across requests and differs between accounts',async()=>{
 const a1=(await run({'cf-access-jwt-assertion':await jwt(good())})).get('oai-authenticated-user-id');
 const a2=(await run({'cf-access-jwt-assertion':await jwt(good())})).get('oai-authenticated-user-id');
 const b=(await run({'cf-access-jwt-assertion':await jwt(good({sub:'sub-other',email:'b@example.test'}))})).get('oai-authenticated-user-id');
 assert.equal(a1,a2);assert.notEqual(a1,b);
});
test('signing certificates are cached across requests',async()=>{
 await run({'cf-access-jwt-assertion':await jwt(good())});const before=certFetches;
 await run({'cf-access-jwt-assertion':await jwt(good())});assert.equal(certFetches,before);
});
test('no JWT means no certificate fetch',async()=>{
 const before=certFetches;await run({});assert.equal(certFetches,before);
});
