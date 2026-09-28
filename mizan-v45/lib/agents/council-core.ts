/** Shared contracts and bounded provider calls for the existing native council. */
export const COUNCIL_VERSION = 'mizan-native-council-v2.2-openai-only';
export const DEFAULT_MODELS = {
  openai: 'gpt-5.6-sol', anthropic: 'claude-sonnet-5', deepseek: 'deepseek-v4-pro',
} as const;
export type Provider = keyof typeof DEFAULT_MODELS;
export type ProviderPresence = Record<Provider, boolean>;
export type CouncilRole = 'rd-manager'|'developer'|'security-reviewer';
/** Owner decision, 2026-09-25: no Anthropic or DeepSeek calls or key requirements. */
export const COUNCIL_ROLE_PROVIDERS = Object.freeze({
  'rd-manager':'openai','developer':'openai','security-reviewer':'openai',
} as const);
export const COUNCIL_POLICY = Object.freeze({
  mode:'openai-only',activeProviders:Object.freeze(['openai']),
  disabledProviders:Object.freeze(['anthropic','deepseek']),
  roleProviders:COUNCIL_ROLE_PROVIDERS,independentProviderReview:false,
  humanDecisionRequired:true,maximumProviderCallsPerRun:3,
  note:'أدوار منفصلة لدى مزود ونموذج واحد؛ ليست مراجعة مستقلة من عدة مزودين ولا اعتمادًا تلقائيًا.',
});
const SECURITY_FORMAT = {
  type:'json_schema',name:'mizan_security_review',strict:true,
  schema:{type:'object',additionalProperties:false,
    properties:{decision:{type:'string',enum:['PASS','VETO','REVIEW']},
      blockers:{type:'array',items:{type:'string'}},report:{type:'string'}},
    required:['decision','blockers','report']},
} as const;
const KEY_NAMES = {openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',deepseek:'DEEPSEEK_API_KEY'} as const;
const MODEL_NAMES = {openai:'MIZAN_OPENAI_MODEL',anthropic:'MIZAN_ANTHROPIC_MODEL',deepseek:'MIZAN_DEEPSEEK_MODEL'} as const;
const ENDPOINTS = {openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages',deepseek:'https://api.deepseek.com/chat/completions'} as const;
const ROLES = {openai:'rd-manager',anthropic:'developer',deepseek:'security-reviewer'} as const;
const textValue = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export function providerPresence(env: Record<string, unknown>): ProviderPresence {
  return {openai:textValue(env.OPENAI_API_KEY).length>8,anthropic:textValue(env.ANTHROPIC_API_KEY).length>8,deepseek:textValue(env.DEEPSEEK_API_KEY).length>8};
}
export type SecurityDecision = {decision:'PASS'|'VETO'|'REVIEW';blockers:string[];report:string};
const invalidDecision = (): SecurityDecision => ({decision:'REVIEW',blockers:['نتيجة المراجع الأمني لا تستوفي عقد التحقق.'],report:'يلزم تقرير مكتمل قبل اعتماد أي نتيجة.'});
function validSecurityShape(raw:any):raw is SecurityDecision {
  return !!raw && !Array.isArray(raw) && typeof raw==='object' &&
    Object.keys(raw).length===3 && ['PASS','VETO','REVIEW'].includes(raw.decision) &&
    Array.isArray(raw.blockers) && raw.blockers.length<=12 &&
    raw.blockers.every((v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=500) &&
    typeof raw.report==='string' && raw.report.trim().length>0 && raw.report.length<=12000;
}
export function securityDecisionIsValid(value:string):boolean {
  try{return validSecurityShape(JSON.parse(value));}catch{return false;}
}
export function parseSecurityDecision(value: string): SecurityDecision {
  try {
    const raw = JSON.parse(value);
    if (!validSecurityShape(raw)) return invalidDecision();
    const blockers = raw.blockers.map((v:string)=>v.trim());
    return {decision:raw.decision==='PASS'&&blockers.length?'REVIEW':raw.decision,blockers,report:raw.report.trim()};
  } catch { return invalidDecision(); }
}
export function normalizeCouncilTask(value:unknown):string {
  if(typeof value!=='string')throw new Error('task-required');
  const task=value.trim();if(!task||task.length>6000)throw new Error('task-length');return task;
}
export type DiagnosticCode = 'ok'|'missing_key'|'authentication_failed'|'access_denied'|'quota_or_billing'|'rate_limited'|'model_unavailable'|'invalid_request'|'provider_unavailable'|'provider_error'|'network_or_timeout'|'invalid_response'|'response_too_large'|'incomplete_output'|'empty_output'|'input_too_large'|'invalid_key_format'|'redirect_refused'|'unsupported_redirect'|'invalid_request_headers'|'invalid_runtime_receiver';
export type AgentResult = {
  role:'rd-manager'|'developer'|'security-reviewer';provider:Provider;model:string;
  status:'ok'|'missing'|'failed';text:string|null;keyConfigured:boolean;
  diagnostic:{code:DiagnosticCode;httpStatus:number|null;providerCode:string|null;attempts:number;durationMs:number;checkedAt:string;retryAfterSeconds:number|null;errorName:string|null;redirectPolicy:'manual-reject';errorRedirectSupported:boolean|null};
  usage:{inputTokens:number|null;outputTokens:number|null}|null;
};
const SAFE_CODES = new Set(['invalid_api_key','authentication_error','permission_error','permission_denied','model_not_found','not_found_error','insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','rate_limit_exceeded','rate_limit_error','slow_down','invalid_request_error','invalid_request','invalid_format','overloaded_error','server_is_overloaded','service_unavailable_error','billing_error']);
/** Never retain a remote error message, request headers, or arbitrary error code. */
export function classifyProviderError(status:number, body:any):{code:DiagnosticCode;providerCode:string|null} {
  const values=[body?.error?.code,body?.error?.type];
  const providerCode=values.find(v=>typeof v==='string'&&SAFE_CODES.has(v))??null;
  if(status===401)return {code:'authentication_failed',providerCode};
  if(status===403)return {code:'access_denied',providerCode};
  if(status===402||values.some(v=>['insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','billing_error'].includes(v)))return {code:'quota_or_billing',providerCode};
  if(status===429)return {code:'rate_limited',providerCode};
  if(status===404||values.includes('model_not_found'))return {code:'model_unavailable',providerCode};
  if(status===400||status===422)return {code:'invalid_request',providerCode};
  if(status>=500)return {code:'provider_unavailable',providerCode};
  return {code:'provider_error',providerCode};
}
function tokenCount(value:unknown):number|null {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
function extractText(provider:Provider, body:any):string {
  if(provider==='openai'){
    if(body?.status!=='completed')throw new Error('incomplete_output');
    const parts=Array.isArray(body.output)?body.output.flatMap((v:any)=>Array.isArray(v?.content)?v.content:[]):[];
    return parts.filter((v:any)=>v?.type==='output_text'&&typeof v.text==='string').map((v:any)=>v.text).join('\n') || textValue(body.output_text);
  }
  if(provider==='anthropic'){
    if(body?.stop_reason!=='end_turn')throw new Error('incomplete_output');
    return (Array.isArray(body.content)?body.content:[]).filter((v:any)=>v?.type==='text'&&typeof v.text==='string').map((v:any)=>v.text).join('\n');
  }
  if(body?.choices?.[0]?.finish_reason!=='stop')throw new Error('incomplete_output');
  return textValue(body?.choices?.[0]?.message?.content);
}
async function readBounded(response:Response):Promise<unknown> {
  const MAX=1_000_000;
  if(Number(response.headers.get('content-length'))>MAX){await response.body?.cancel().catch(()=>{});throw new Error('response_too_large');}
  const reader=response.body?.getReader();if(!reader)throw new Error('invalid_response');
  let text='',size=0;const decoder=new TextDecoder();
  try {
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX)throw new Error('response_too_large');text+=decoder.decode(part.value,{stream:true});}
    text+=decoder.decode();
  } finally {await reader.cancel().catch(()=>{});}
  try{return JSON.parse(text);}catch{throw new Error('invalid_response');}
}
/** Fixed endpoints; one bounded attempt per role, no billing/permission retries. */
export async function callCouncilProvider(provider:Provider,env:Record<string,unknown>,system:string,input:string,fetcher:typeof fetch=(url,init)=>globalThis.fetch(url,init),role:CouncilRole=ROLES[provider]):Promise<AgentResult> {
  const started=Date.now(),key=textValue(env[KEY_NAMES[provider]]);
  const model=textValue(env[MODEL_NAMES[provider]])||DEFAULT_MODELS[provider];
  const result:AgentResult={role,provider,model,status:'failed',text:null,keyConfigured:key.length>8,usage:null,
    diagnostic:{code:'provider_error',httpStatus:null,providerCode:null,attempts:0,durationMs:0,checkedAt:new Date().toISOString(),retryAfterSeconds:null,errorName:null,redirectPolicy:'manual-reject',errorRedirectSupported:null}};
  const done=()=>{result.diagnostic.durationMs=Date.now()-started;result.diagnostic.checkedAt=new Date().toISOString();return result;};
  if(!result.keyConfigured){result.status='missing';result.diagnostic.code='missing_key';return done();}
  if(!/^[\x21-\x7E]+$/.test(key)){result.diagnostic.code='invalid_key_format';return done();}
  // A constructor-only capability probe sends no request and contains no credentials.
  try{new Request(ENDPOINTS[provider],{redirect:'error'});result.diagnostic.errorRedirectSupported=true;}
  catch{result.diagnostic.errorRedirectSupported=false;}
  if(system.length>10000||input.length>48000){result.diagnostic.code='input_too_large';return done();}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),provider==='openai'?90000:45000);
  try {
    const headers:Record<string,string>={'Content-Type':'application/json'};let body:unknown;
    if(provider==='openai'){
      headers.Authorization=`Bearer ${key}`;
      const formatInstruction=role==='security-reviewer'
        ? '\nأعد JSON فقط وفق العقد المحدد. اجعل report موجزًا، وblockers بحد أقصى 12 عنصرًا، وكل عنصر دون 500 محرف. لا تدع تنفيذ اختبارات أو امتلاك صلاحية نشر.'
        : '\nأخرج تقريرًا لا يتجاوز 350 كلمة، مع الحقائق والفجوات وعملي إصلاح واختبارات قبول مقترحة. لا تدع تنفيذ الاختبارات.';
      body={model,store:false,instructions:system+formatInstruction,input,
        max_output_tokens:3200,reasoning:{effort:'low'},
        ...(role==='security-reviewer'?{text:{format:SECURITY_FORMAT}}:{})};
    }else if(provider==='anthropic'){
      headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
      body={model,max_tokens:1800,system,messages:[{role:'user',content:input}]};
    }else{
      headers.Authorization=`Bearer ${key}`;
      body={model,max_tokens:1800,thinking:{type:'disabled'},response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:input}]};
    }
    result.diagnostic.attempts=1;
    const response=await fetcher(ENDPOINTS[provider],{method:'POST',headers,body:JSON.stringify(body),redirect:'manual',signal:controller.signal});
    result.diagnostic.httpStatus=response.status;
    if(response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});result.diagnostic.code='redirect_refused';return done();}
    const retry=Number(response.headers.get('retry-after'));
    if(response.headers.has('retry-after')&&Number.isFinite(retry)&&retry>=0&&retry<=86400)result.diagnostic.retryAfterSeconds=retry;
    let parsed:any;
    try{parsed=await readBounded(response);}catch(e){
      if(!response.ok){Object.assign(result.diagnostic,classifyProviderError(response.status,null));return done();}
      throw e;
    }
    if(!response.ok){Object.assign(result.diagnostic,classifyProviderError(response.status,parsed));return done();}
    result.usage={inputTokens:tokenCount(parsed?.usage?.input_tokens??parsed?.usage?.prompt_tokens),outputTokens:tokenCount(parsed?.usage?.output_tokens??parsed?.usage?.completion_tokens)};
    const text=extractText(provider,parsed).trim();
    if(!text)throw new Error('empty_output');
    if(text.length>12000)throw new Error('incomplete_output');
    result.status='ok';result.text=text;result.diagnostic.code='ok';return done();
  }catch(e){
    const code=e instanceof Error?e.message:'';
    const errorName=e instanceof Error?e.name:'';
    result.diagnostic.errorName=['Error','TypeError','RangeError','AbortError','TimeoutError'].includes(errorName)?errorName:'OtherError';
    if(['incomplete_output','empty_output','invalid_response','response_too_large'].includes(code))result.diagnostic.code=code as DiagnosticCode;
    else if(/redirect/i.test(code)&&/invalid|unsupported|not support|must be one of/i.test(code))result.diagnostic.code='unsupported_redirect';
    else if(/illegal invocation|incorrect.*this.*reference/i.test(code))result.diagnostic.code='invalid_runtime_receiver';
    else if(/ByteString|ISO-8859-1|invalid.*header|header.*invalid/i.test(code))result.diagnostic.code='invalid_request_headers';
    else result.diagnostic.code='network_or_timeout';
    return done();
  }finally{clearTimeout(timer);}
}
/** The production council calls this role router, not a fallback provider chain.
 * A missing or failing OpenAI key never causes a request to a disabled provider.
 */
export async function callCouncilRole(role:CouncilRole,env:Record<string,unknown>,system:string,input:string,fetcher:typeof fetch=(url,init)=>globalThis.fetch(url,init)):Promise<AgentResult> {
  if(!Object.prototype.hasOwnProperty.call(COUNCIL_ROLE_PROVIDERS,role))throw new Error('invalid-council-role');
  const agent=await callCouncilProvider(COUNCIL_ROLE_PROVIDERS[role],env,system,input,fetcher,role);
  if(role==='security-reviewer'&&agent.status==='ok'&&!securityDecisionIsValid(agent.text||'')){
    return {...agent,status:'failed',text:null,diagnostic:{...agent.diagnostic,code:'invalid_response'}};
  }
  return agent;
}
/** Safe operational summary. Model text remains in the authenticated council report. */
export function summarizeAgent(agent:AgentResult){const {text,...summary}=agent;return {...summary,outputCharacters:text?.length??0,taskCompleted:agent.status==='ok'};}
