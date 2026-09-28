import test from 'node:test';
import assert from 'node:assert/strict';
import {FOLLOWUP_DEFAULT,validateFollowupConfig,periodicSlot,summarizeSelectedForecasts,makeAgentWorkPlan} from '../lib/screener-operations-core.ts';
import {executeFollowup} from '../lib/screener-followup-core.ts';
const cfg={...FOLLOWUP_DEFAULT,scanPerMarket:20};
function fake(options={}){
 const plans=[],batchCalls=[],saved=[];let clock=Date.parse('2026-09-25T19:00:00Z');
 const deps={now:()=>clock,create:async input=>{plans.push(input);return {runId:input.market,runToken:'private-token-'+input.market,symbols:Array.from({length:input.scanLimit},(_,i)=>input.market+i),batchSize:5};},
 batch:async(id,token,index)=>{batchCalls.push([id,index]);assert.ok(token.startsWith('private-token-'));if(options.fail===id)throw Error('provider');clock+=options.cost??100;return {scanned:5,analyzed:5,failed:0,eligible:0};},
 finish:async id=>({status:'complete',integrity:true,runId:id,picks:[],fingerprint:'hash-'+id}),save:async p=>{if(options.failSave)throw Error('db-down');saved.push(JSON.parse(JSON.stringify(p)));}};
 return {plans,batchCalls,saved,deps};
}
test('periodic screener remains off until a verified activation',()=>{assert.equal(FOLLOWUP_DEFAULT.enabled,false);assert.equal(FOLLOWUP_DEFAULT.scanPerMarket,200);assert.equal(FOLLOWUP_DEFAULT.resultCount,10);});
test('accept exact safe followup limits',()=>{for(const n of [20,40,100,200])assert.equal(validateFollowupConfig({...cfg,scanPerMarket:n}).scanPerMarket,n);});
test('reject arbitrary markets, extra symbols, URLs and expensive counts',()=>{for(const change of [{symbols:['AAPL']},{url:'https://elsewhere'},{scanPerMarket:10000},{intervalHours:1},{resultCount:11},{horizonSessions:9},{enabled:'true'}])assert.throws(()=>validateFollowupConfig({...cfg,...change}));});
test('UTC cadence slots do not create duplicate six-hour retries',()=>{const t=Date.parse('2026-09-25T00:01:00Z');assert.equal(periodicSlot(t,cfg),periodicSlot(t+18*3600000,cfg));assert.notEqual(periodicSlot(t,cfg),periodicSlot(t+24*3600000,cfg));});
test('reject invalid clocks',()=>{assert.throws(()=>periodicSlot(NaN,cfg));assert.throws(()=>periodicSlot(-1,cfg));});
test('200 per market means two canonical cohorts of 200, not 200 split in half',async()=>{const f=fake();const r=await executeFollowup({...cfg,scanPerMarket:200},f.deps);assert.deepEqual(f.plans.map(p=>[p.market,p.scanLimit]),[['sa',200],['us',200]]);assert.equal(f.batchCalls.length,80);assert.equal(r.markets.sa.scanned,200);assert.equal(r.markets.us.scanned,200);assert.equal(r.status,'completed');});
test('markets alternate and no token is persisted or returned',async()=>{const f=fake();const r=await executeFollowup(cfg,f.deps);assert.deepEqual(f.batchCalls.slice(0,4),[['sa',0],['us',0],['sa',1],['us',1]]);assert.equal(JSON.stringify([r,f.saved]).includes('private-token'),false);});
test('zero qualifying stocks remain a complete scan, not invented picks',async()=>{const f=fake();const r=await executeFollowup(cfg,f.deps);assert.equal(r.markets.sa.selected,0);assert.equal(r.markets.us.selected,0);assert.equal(r.status,'completed');});
test('one market failure is visible without starving the other market',async()=>{const f=fake({fail:'sa'});const r=await executeFollowup(cfg,f.deps);assert.equal(r.status,'partial');assert.equal(r.markets.sa.state,'failed');assert.equal(r.markets.us.state,'complete');assert.equal(r.markets.us.scanned,20);});
test('deadline preserves partial result without sealing or inventing completion',async()=>{const f=fake({cost:700});const r=await executeFollowup(cfg,f.deps,1000);assert.equal(r.status,'partial');assert.equal(r.markets.sa.state,'incomplete');assert.equal(r.markets.us.state,'incomplete');assert.equal(r.markets.sa.scanned,5);});
test('database persistence failures throw rather than report success',async()=>{const f=fake({failSave:true});await assert.rejects(()=>executeFollowup(cfg,f.deps),/db-down/);assert.equal(f.batchCalls.length,0);});
test('failed archive integrity cannot become a completed cycle',async()=>{const f=fake();f.deps.finish=async()=>({status:'complete',integrity:false,picks:[]});const r=await executeFollowup(cfg,f.deps);assert.equal(r.status,'partial');});
test('missing or inconsistent counters fail closed',async()=>{const f=fake();f.deps.batch=async()=>({scanned:5,analyzed:2,failed:0,eligible:5});assert.equal((await executeFollowup(cfg,f.deps)).status,'partial');});
test('invalid budget is rejected before network calls',async()=>{const f=fake();await assert.rejects(()=>executeFollowup(cfg,f.deps,1000000));assert.equal(f.plans.length,0);});
const forecast=(id,market='sa',horizon=5,model='v1',policy='p1')=>({id,market,horizon,model,recordClass:'prospective-public',evaluationPolicy:policy,available:1,outcome:null});
const summarize=items=>({total:items.length,completed:items.filter(x=>x.outcome?.state==='complete').length,independent:0,directionCount:0,directionAccuracy:null,rangeCoverage:null,meanPriceError:null});
test('pending data never becomes zero percent accuracy',()=>{const r=summarizeSelectedForecasts([forecast('1')],summarize);assert.equal(r.cells[0].pending,1);assert.equal(r.cells[0].metrics.directionAccuracyPct,null);});
test('market horizon model and evaluation policy each define separate cells',()=>{const r=summarizeSelectedForecasts([forecast('1'),forecast('2','us'),forecast('3','sa',21),forecast('4','sa',5,'v2'),forecast('5','sa',5,'v1','p2')],summarize);assert.equal(r.cells.length,5);});
test('repeated membership does not duplicate measurements',()=>{let count;const r=summarizeSelectedForecasts([forecast('1'),forecast('1')],rows=>{count=rows.length;return summarize(rows);});assert.equal(count,1);assert.equal(r.duplicateMemberships,1);assert.equal(r.uniqueForecasts,1);});
test('invalid and excluded outcomes remain visible',()=>{const rows=[{...forecast('1'),outcome:{state:'excluded'}},{...forecast('2'),outcomeParseError:true}];const r=summarizeSelectedForecasts(rows,summarize);assert.equal(r.cells[0].excluded,1);assert.equal(r.cells[0].invalidOutcomes,1);assert.equal(r.cells[0].pending,0);});
test('legacy invalid identities are counted but do not contaminate metrics',()=>{const r=summarizeSelectedForecasts([{...forecast('1'),recordClass:'private-input'},forecast('2')],summarize);assert.equal(r.invalidRows,1);assert.equal(r.uniqueForecasts,1);});
test('work manifest assigns evidence-backed tasks without claiming completion',()=>{const p=makeAgentWorkPlan({asOf:'2026-09-25'});assert.equal(p.tasks.length,7);assert.ok(p.tasks.every(t=>t.state==='assigned'&&t.evidenceRefs.length));assert.match(p.scope,/no autonomous trading/);assert.equal(new Set(p.tasks.map(t=>t.id)).size,7);});
