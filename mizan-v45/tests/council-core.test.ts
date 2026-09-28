import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODELS,normalizeCouncilTask,parseSecurityDecision,providerPresence,callCouncilProvider,classifyProviderError,summarizeAgent} from '../lib/agents/council-core';
const env={OPENAI_API_KEY:'test-openai-not-a-real-key',ANTHROPIC_API_KEY:'test-anthropic-not-a-real-key',DEEPSEEK_API_KEY:'test-deepseek-not-a-real-key'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('provider presence exposes booleans only, not proof of connection',()=>{
  const p=providerPresence({...env,ANTHROPIC_API_KEY:'   '});
  assert.deepEqual(p,{openai:true,anthropic:false,deepseek:true});assert.equal(JSON.stringify(p).includes('test-openai'),false);
});
test('security decision parser accepts valid VETO',()=>{
  const p=parseSecurityDecision(JSON.stringify({decision:'VETO',blockers:['a','b'],report:'r'}));
  assert.equal(p.decision,'VETO');assert.deepEqual(p.blockers,['a','b']);
});
test('malformed or incomplete security output cannot PASS',()=>{
  for(const raw of [null,[],{decision:'PASS'},{decision:'PASS',blockers:[],report:''},{decision:'PASS',blockers:[1],report:'r'},{decision:'UNKNOWN',blockers:[],report:'r'}])assert.equal(parseSecurityDecision(JSON.stringify(raw)).decision,'REVIEW');
  assert.equal(parseSecurityDecision('not-json').decision,'REVIEW');
});
test('PASS with blockers is downgraded without hiding blockers',()=>{
  const p=parseSecurityDecision(JSON.stringify({decision:'PASS',blockers:['unsafe'],report:'r'}));assert.equal(p.decision,'REVIEW');assert.deepEqual(p.blockers,['unsafe']);
});
test('complete PASS contract remains valid',()=>{
  assert.equal(parseSecurityDecision(JSON.stringify({decision:'PASS',blockers:[],report:'Verified checks.'})).decision,'PASS');
});
test('oversized security contract cannot silently truncate into PASS',()=>{
  assert.equal(parseSecurityDecision(JSON.stringify({decision:'PASS',blockers:[],report:'r'.repeat(12001)})).decision,'REVIEW');
});
test('council task is required and bounded',()=>{
  assert.equal(normalizeCouncilTask('  hello  '),'hello');assert.throws(()=>normalizeCouncilTask(''));assert.throws(()=>normalizeCouncilTask('x'.repeat(6001)));
});
test('provider defaults stay unchanged',()=>{assert.deepEqual(DEFAULT_MODELS,{openai:'gpt-5.6-sol',anthropic:'claude-sonnet-5',deepseek:'deepseek-v4-pro'});});
for(const [status,body,code] of [
  [401,{error:{code:'invalid_api_key'}},'authentication_failed'],
  [403,{error:{type:'permission_error'}},'access_denied'],
  [402,{},'quota_or_billing'],
  [429,{error:{type:'insufficient_quota'}},'quota_or_billing'],
  [429,{error:{code:'project_spend_limit_exceeded'}},'quota_or_billing'],
  [429,{error:{code:'credit_balance_exhausted'}},'quota_or_billing'],
  [429,{error:{code:'rate_limit_exceeded'}},'rate_limited'],
  [404,{error:{code:'model_not_found'}},'model_unavailable'],
  [400,{},'invalid_request'],[503,{},'provider_unavailable'],
] as const)test(`diagnostic HTTP ${status} => ${code}`,()=>assert.equal(classifyProviderError(status,body).code,code));
test('unrecognized error content is never retained',()=>{
  const d=classifyProviderError(400,{error:{code:'sensitive-value',message:env.OPENAI_API_KEY}});assert.equal(d.providerCode,null);assert.equal(JSON.stringify(d).includes('sensitive'),false);
});
for(const provider of ['openai','anthropic','deepseek'] as const)test(`${provider} completes only after valid provider output`,async()=>{
  const f=(async(url:any,init:any)=>{
    const expected={openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages',deepseek:'https://api.deepseek.com/chat/completions'};
    assert.equal(url,expected[provider]);assert.equal(init.redirect,'manual');assert.equal(init.method,'POST');
    const b=JSON.parse(init.body);assert.equal(b.model,DEFAULT_MODELS[provider]);
    if(provider==='openai'){assert.equal(b.store,false);assert.equal(b.max_output_tokens,3200);assert.equal(b.reasoning.effort,'low');return json({status:'completed',output:[{content:[{type:'output_text',text:'report'}]}],usage:{input_tokens:10,output_tokens:20}});}
    if(provider==='anthropic')return json({stop_reason:'end_turn',content:[{type:'text',text:'report'}]});
    return json({choices:[{finish_reason:'stop',message:{content:'report'}}]});
  }) as typeof fetch;
  const r=await callCouncilProvider(provider,env,'system','{}',f);assert.equal(r.status,'ok');assert.equal(r.text,'report');assert.equal(r.diagnostic.attempts,1);
});
test('missing key makes zero network calls',async()=>{
  const r=await callCouncilProvider('openai',{},'system','{}',(async()=>{throw new Error('unexpected');}) as typeof fetch);assert.equal(r.status,'missing');assert.equal(r.diagnostic.attempts,0);
});
test('quota failure never retries and never exposes provider error message',async()=>{
  let calls=0;const r=await callCouncilProvider('openai',env,'system','{}',(async()=>{calls++;return json({error:{type:'insufficient_quota',message:env.OPENAI_API_KEY}},429);}) as typeof fetch);
  assert.equal(calls,1);assert.equal(r.keyConfigured,true);assert.equal(r.status,'failed');assert.equal(r.diagnostic.code,'quota_or_billing');assert.equal(JSON.stringify(r).includes(env.OPENAI_API_KEY),false);
});
for(const [provider,body] of [
  ['openai',{status:'incomplete',output_text:'partial report'}],
  ['anthropic',{stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]}],
  ['deepseek',{choices:[{finish_reason:'length',message:{content:'partial'}}]}],
] as const)test(`${provider} truncated response is not a completed task`,async()=>{
  const r=await callCouncilProvider(provider,env,'system','{}',(async()=>json(body)) as typeof fetch);assert.equal(r.status,'failed');assert.equal(r.text,null);assert.equal(r.diagnostic.code,'incomplete_output');
});
test('invalid JSON is not success',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>new Response('not-json')) as typeof fetch);assert.equal(r.diagnostic.code,'invalid_response');
});
test('network exceptions are sanitized',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>{throw new Error(env.OPENAI_API_KEY);}) as typeof fetch);assert.equal(r.diagnostic.code,'network_or_timeout');assert.equal(JSON.stringify(r).includes(env.OPENAI_API_KEY),false);
});
test('oversized response body is rejected',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>new Response('large',{headers:{'content-length':'1000001'}})) as typeof fetch);assert.equal(r.diagnostic.code,'response_too_large');
});
test('oversized input does not produce a paid call',async()=>{
  const r=await callCouncilProvider('openai',env,'system','x'.repeat(48001),(async()=>{throw new Error('unexpected');}) as typeof fetch);assert.equal(r.diagnostic.code,'input_too_large');assert.equal(r.diagnostic.attempts,0);
});
test('blank completed output is not a successful task',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>json({status:'completed',output:[]})) as typeof fetch);assert.equal(r.diagnostic.code,'empty_output');
});
test('operational summaries omit model report text',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>json({status:'completed',output_text:'private-report'})) as typeof fetch);
  const s=summarizeAgent(r);assert.equal(s.taskCompleted,true);assert.equal(s.outputCharacters,14);assert.equal('text' in s,false);assert.equal(JSON.stringify(s).includes('private-report'),false);
});

test('credentials containing Unicode or embedded line breaks never enter request headers',async()=>{
  for(const key of ['test-key\nother','test-key-سر','test key with spaces']){
    let calls=0;
    const r=await callCouncilProvider('openai',{OPENAI_API_KEY:key},'system','{}',(async()=>{calls++;throw new Error('unexpected')}) as typeof fetch);
    assert.equal(calls,0);assert.equal(r.diagnostic.code,'invalid_key_format');
  }
});
test('manual redirect policy never forwards authorization to a new location',async()=>{
  let calls=0;
  const r=await callCouncilProvider('openai',env,'system','{}',(async(_u:any,init:any)=>{
    calls++;assert.equal(init.redirect,'manual');
    return new Response(null,{status:307,headers:{location:'https://untrusted.test'}});
  }) as typeof fetch);
  assert.equal(calls,1);assert.equal(r.diagnostic.code,'redirect_refused');assert.equal(r.text,null);
});
test('unsupported redirect errors are identified without remote error text',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>{throw new TypeError('Invalid redirect value, must be one of follow or manual');}) as typeof fetch);
  assert.equal(r.diagnostic.code,'unsupported_redirect');assert.equal(r.diagnostic.errorName,'TypeError');
});
test('invalid runtime receiver is distinct from DNS or timeout',async()=>{
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>{throw new TypeError('Illegal invocation: function called with incorrect this reference');}) as typeof fetch);
  assert.equal(r.diagnostic.code,'invalid_runtime_receiver');
});
test('constructor-only redirect capability is recorded without another API call',async()=>{
  let calls=0;
  const r=await callCouncilProvider('openai',env,'system','{}',(async()=>{calls++;return json({status:'completed',output_text:'report'});}) as typeof fetch);
  assert.equal(calls,1);assert.equal(typeof r.diagnostic.errorRedirectSupported,'boolean');assert.equal(r.diagnostic.redirectPolicy,'manual-reject');
});
