import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWithRetry,backoffDelay,abortableSleep,RETRYABLE_STATUS,type RetryEvent} from '../lib/fetch-retry';

const res=(status:number)=>new Response(JSON.stringify({status}),{status});
/** Scripted fetch: each entry is a status number or an Error to throw (last entry repeats). */
function script(steps:(number|Error)[]){
 const calls:{url:string;init?:RequestInit}[]=[];
 const fetchFn=async(url:string,init?:RequestInit)=>{calls.push({url,init});const s=steps[Math.min(calls.length-1,steps.length-1)];if(s instanceof Error)throw s;return res(s);};
 return {calls,fetchFn};
}
function harness(extra:Record<string,unknown>={}){
 const sleeps:number[]=[],events:RetryEvent[]=[];
 return {sleeps,events,opts:{sleep:async(ms:number)=>{sleeps.push(ms);},random:()=>0,onRetry:(e:RetryEvent)=>events.push(e),...extra}};
}

test('only 502/503/504 are retryable statuses',()=>{assert.deepEqual([...RETRYABLE_STATUS].sort(),[502,503,504]);});

test('retries 503 and returns the first success',async()=>{
 const s=script([503,503,200]),h=harness();
 const r=await fetchWithRetry('/api/screener',{method:'POST',body:'{}'},{...h.opts,fetchFn:s.fetchFn});
 assert.equal(r.status,200);assert.equal(s.calls.length,3);
 assert.deepEqual(h.events.map(e=>[e.attempt,e.maxRetries,e.reason]),[[1,3,503],[2,3,503]]);
});
for(const status of [502,504])test(`retries ${status}`,async()=>{
 const s=script([status,200]),h=harness();
 assert.equal((await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn})).status,200);assert.equal(s.calls.length,2);
});
for(const status of [200,201,400,401,403,404,409,413,415,429,500])test(`does not retry ${status}`,async()=>{
 const s=script([status,200]),h=harness();
 const r=await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn});
 assert.equal(r.status,status);assert.equal(s.calls.length,1);assert.deepEqual(h.sleeps,[]);assert.equal(h.events.length,0);
});

test('stops after max retries and returns the last response',async()=>{
 const s=script([503,503,503,503,200]),h=harness();
 const r=await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn});
 assert.equal(r.status,503);assert.equal(s.calls.length,4);assert.equal(h.sleeps.length,3);
 assert.deepEqual(await r.json(),{status:503},'last response body is still readable by the caller');
});
test('maxRetries is configurable (0 disables retry)',async()=>{
 const s=script([503,200]);
 assert.equal((await fetchWithRetry('/x',{},{...harness().opts,maxRetries:0,fetchFn:s.fetchFn})).status,503);assert.equal(s.calls.length,1);
});

test('network errors are retried, then succeed',async()=>{
 const s=script([new TypeError('Failed to fetch'),new TypeError('Failed to fetch'),200]),h=harness();
 const r=await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn});
 assert.equal(r.status,200);assert.equal(s.calls.length,3);assert.deepEqual(h.events.map(e=>e.reason),['network','network']);
});
test('persistent network error is rethrown after max retries',async()=>{
 const err=new TypeError('Failed to fetch'),s=script([err]),h=harness();
 await assert.rejects(fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn}),e=>e===err);
 assert.equal(s.calls.length,4);assert.equal(h.sleeps.length,3);
});

test('backoff sequence is 1s,2s,4s with injected sleep (no jitter)',async()=>{
 const s=script([503]),h=harness();
 await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn});
 assert.deepEqual(h.sleeps,[1000,2000,4000]);assert.deepEqual(h.events.map(e=>e.delayMs),[1000,2000,4000]);
});
test('jitter is bounded to [exp, exp*1.25]',()=>{
 for(const [i,exp] of [[0,1000],[1,2000],[2,4000]] as const){
  assert.equal(backoffDelay(i,1000,0.25,()=>0),exp);
  assert.equal(backoffDelay(i,1000,0.25,()=>1),exp*1.25);
  assert.equal(backoffDelay(i,1000,0.25,()=>0.5),exp*1.125);
  assert.equal(backoffDelay(i,1000,0.25,()=>5),exp*1.25,'out-of-range random is clamped');
  assert.equal(backoffDelay(i,1000,0.25,()=>-3),exp);
 }
 for(let n=0;n<200;n++){const d=backoffDelay(1);assert.ok(d>=2000&&d<=2500);}
});
test('delay is capped by maxDelayMs',()=>{assert.equal(backoffDelay(10,1000,0.25,()=>1,10000),10000);});
test('jitter is applied to the injected sleep',async()=>{
 const s=script([503]),h=harness({random:()=>1});
 await fetchWithRetry('/x',{},{...h.opts,fetchFn:s.fetchFn});
 assert.deepEqual(h.sleeps,[1250,2500,5000]);
});

test('already-aborted signal makes no request',async()=>{
 const c=new AbortController();c.abort();const s=script([200]);
 await assert.rejects(fetchWithRetry('/x',{},{...harness().opts,signal:c.signal,fetchFn:s.fetchFn}),e=>(e as Error).name==='AbortError');
 assert.equal(s.calls.length,0);
});
test('abort during backoff stops further attempts',async()=>{
 const c=new AbortController(),s=script([503,200]);
 const sleep=async()=>{c.abort();}; // user cancels while waiting; sleep resolves anyway
 await assert.rejects(fetchWithRetry('/x',{},{...harness().opts,sleep,signal:c.signal,fetchFn:s.fetchFn}),e=>(e as Error).name==='AbortError');
 assert.equal(s.calls.length,1);
});
test('abort during a real backoff sleep rejects promptly',async()=>{
 const c=new AbortController(),s=script([503]),t0=Date.now();
 const p=fetchWithRetry('/x',{},{signal:c.signal,fetchFn:s.fetchFn,random:()=>0});
 setTimeout(()=>c.abort(),20);
 await assert.rejects(p,e=>(e as Error).name==='AbortError');
 assert.ok(Date.now()-t0<800);assert.equal(s.calls.length,1);
});
test('fetch failing because of abort is not retried',async()=>{
 const c=new AbortController(),abortErr=new DOMException('x','AbortError');let n=0;
 const fetchFn=async()=>{n++;c.abort();throw abortErr;};
 await assert.rejects(fetchWithRetry('/x',{},{...harness().opts,signal:c.signal,fetchFn}),e=>(e as Error).name==='AbortError');
 assert.equal(n,1);
});
test('signal from init is honoured and forwarded to fetch',async()=>{
 const c=new AbortController(),s=script([200]);
 await fetchWithRetry('/x',{method:'POST',signal:c.signal},{...harness().opts,fetchFn:s.fetchFn});
 assert.equal(s.calls[0].init?.signal,c.signal);assert.equal(s.calls[0].init?.method,'POST');
});
test('every retry replays the identical request',async()=>{
 const s=script([503,503,200]),body=JSON.stringify({action:'archive-batch',runId:'r',runToken:'t',batchIndex:2});
 await fetchWithRetry('/api/screener',{method:'POST',body},{...harness().opts,fetchFn:s.fetchFn});
 assert.equal(new Set(s.calls.map(c=>c.url+'|'+c.init?.method+'|'+c.init?.body)).size,1);
});
test('abortableSleep resolves after the delay',async()=>{await abortableSleep(5);});
