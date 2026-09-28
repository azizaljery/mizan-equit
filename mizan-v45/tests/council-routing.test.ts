import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COUNCIL_POLICY,COUNCIL_ROLE_PROVIDERS,callCouncilRole,parseSecurityDecision,securityDecisionIsValid,type CouncilRole} from '../lib/agents/council-core';
const roles:CouncilRole[]=['rd-manager','developer','security-reviewer'];
// Deliberately populate disabled-provider keys: routing must still use OpenAI only.
const env={OPENAI_API_KEY:'test-openai-key',ANTHROPIC_API_KEY:'unused-anthropic-key',DEEPSEEK_API_KEY:'unused-deepseek-key'};
const verdict={decision:'REVIEW',blockers:['Evidence is incomplete.'],report:'Owner review remains required.'};
const response=(text:string)=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:20}}),{headers:{'content-type':'application/json'}});

test('approved policy routes all roles to OpenAI with an explicit independence limit',()=>{
  assert.equal(COUNCIL_POLICY.mode,'openai-only');
  assert.deepEqual(COUNCIL_POLICY.activeProviders,['openai']);
  assert.deepEqual(COUNCIL_POLICY.disabledProviders,['anthropic','deepseek']);
  assert.equal(COUNCIL_POLICY.independentProviderReview,false);
  assert.equal(COUNCIL_POLICY.humanDecisionRequired,true);
  assert.equal(COUNCIL_POLICY.maximumProviderCallsPerRun,3);
  assert.ok(Object.isFrozen(COUNCIL_ROLE_PROVIDERS));
});
for(const role of roles)test(`${role} keeps its identity and sends only the OpenAI credential`,async()=>{
  let calls=0;
  const f=(async(url:any,init:any)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization,'Bearer test-openai-key');
    assert.equal(init.headers['x-api-key'],undefined);
    assert.equal(init.redirect,'manual');
    const b=JSON.parse(init.body);assert.ok(b.instructions.startsWith(role+' instructions'));
    assert.equal(b.store,false);assert.equal(b.max_output_tokens,3200);
    assert.equal(b.tools,undefined);assert.equal(b.previous_response_id,undefined);
    assert.ok(!init.body.includes('unused-anthropic-key'));assert.ok(!init.body.includes('unused-deepseek-key'));
    if(role==='security-reviewer'){
      assert.equal(b.text.format.type,'json_schema');assert.equal(b.text.format.strict,true);
      assert.deepEqual(b.text.format.schema.required,['decision','blockers','report']);
      assert.equal(b.text.format.schema.additionalProperties,false);
      return response(JSON.stringify(verdict));
    }
    assert.equal(b.text,undefined);return response(role+' report');
  }) as typeof fetch;
  const r=await callCouncilRole(role,env,role+' instructions','{}',f);
  assert.equal(calls,1);assert.equal(r.role,role);assert.equal(r.provider,'openai');
  assert.equal(r.status,'ok');assert.equal(r.diagnostic.attempts,1);
});
test('missing OpenAI key never falls back to another provider',async()=>{
  let calls=0;
  for(const role of roles){
    const r=await callCouncilRole(role,{...env,OPENAI_API_KEY:''},role,'{}',(async()=>{calls++;throw Error('unexpected');}) as typeof fetch);
    assert.equal(r.status,'missing');assert.equal(r.provider,'openai');assert.equal(r.role,role);
  }
  assert.equal(calls,0);
});
test('OpenAI authentication error does not use populated disabled-provider keys',async()=>{
  let calls=0;
  const r=await callCouncilRole('developer',env,'developer','{}',(async()=>{calls++;return new Response(JSON.stringify({error:{code:'invalid_api_key'}}),{status:401});}) as typeof fetch);
  assert.equal(calls,1);assert.equal(r.status,'failed');assert.equal(r.diagnostic.code,'authentication_failed');assert.equal(r.provider,'openai');
});
test('security role rejects HTTP-success responses that violate its contract',async()=>{
  for(const text of ['ordinary report',JSON.stringify({decision:'PASS'}),JSON.stringify({...verdict,execute:'deploy'}),JSON.stringify({...verdict,report:''})]){
    const r=await callCouncilRole('security-reviewer',env,'security','{}',(async()=>response(text)) as typeof fetch);
    assert.equal(r.status,'failed');assert.equal(r.diagnostic.code,'invalid_response');assert.equal(r.text,null);
  }
});
test('valid VETO is completed review, not permission to execute',async()=>{
  const text=JSON.stringify({...verdict,decision:'VETO'});
  const r=await callCouncilRole('security-reviewer',env,'security','{}',(async()=>response(text)) as typeof fetch);
  assert.equal(r.status,'ok');assert.equal(parseSecurityDecision(r.text!).decision,'VETO');
  assert.equal(COUNCIL_POLICY.humanDecisionRequired,true);
});
test('security PASS with blockers remains REVIEW',async()=>{
  const text=JSON.stringify({...verdict,decision:'PASS'});
  const r=await callCouncilRole('security-reviewer',env,'security','{}',(async()=>response(text)) as typeof fetch);
  assert.equal(r.status,'ok');assert.equal(parseSecurityDecision(r.text!).decision,'REVIEW');
});
test('security contract validator rejects arrays and unrelated extra fields',()=>{
  assert.equal(securityDecisionIsValid('[]'),false);
  assert.equal(securityDecisionIsValid(JSON.stringify({...verdict,extra:true})),false);
  assert.equal(securityDecisionIsValid(JSON.stringify(verdict)),true);
});
test('unknown role is rejected before any provider request',async()=>{
  let calls=0;
  await assert.rejects(callCouncilRole('unknown' as CouncilRole,env,'s','{}',(async()=>{calls++;throw Error('unexpected');}) as typeof fetch));
  assert.equal(calls,0);
});
test('existing council uses role routing and preserves read-only agent authority',()=>{
  const src=readFileSync(new URL('../lib/agents/council.ts',import.meta.url),'utf8');
  for(const role of roles)assert.ok(src.includes(`callCouncilRole('${role}',`));
  assert.ok(!src.includes('callCouncilProvider('));
  assert.ok(src.includes('providerPolicy:COUNCIL_POLICY'));
  assert.ok(src.includes('ownerApproval:false'));
  assert.ok(src.includes('automaticActionsExecuted:false'));
  assert.ok(src.includes('${COUNCIL_VERSION}|${options.trigger}|${requestKey}|${task}'));
});
