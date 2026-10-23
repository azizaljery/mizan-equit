// Write-layer semantics over the draft DDL (in-memory SQLite, D1-shaped adapter).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {recordIssue,recordOutcome,SCORED_AS_OF_SQL,type LedgerDB,type IssueRow,type OutcomeRow} from '../lib/aziz/ledger';

const DDL=readFileSync(new URL('../../research/drafts/0017_aziz_issue_ledger.DRAFT.sql',import.meta.url),'utf8').split('\n').filter(l=>!l.includes('@@DRAFT-GUARD@@')).join('\n');
function make(){
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');
 d.exec("CREATE TABLE aziz_symbols(id TEXT PRIMARY KEY, market TEXT, symbol TEXT); INSERT INTO aziz_symbols VALUES('aziz-sa-2222','sa','2222.SR'); CREATE TABLE aziz_market_datasets(id TEXT PRIMARY KEY); INSERT INTO aziz_market_datasets VALUES('ds1');");
 d.exec(DDL);
 const price=d.prepare("INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES(?,'aziz-sa-2222','twelve_data',?,1,25,26,24,25,'split_adjusted',?,?,'retrieval_time_only','ds1','h',?)");
 price.run('p-old','2026-09-30','2026-09-30T12:00:00Z','2026-09-30T13:00:00Z','2026-09-30T13:00:00Z');   // known before issue
 price.run('p-late','2026-10-01','2026-10-01T12:00:00Z','2026-10-02T09:00:00Z','2026-10-02T09:00:00Z'); // received after issue
 d.prepare("INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES(?,'aziz-sa-2222','twelve_data','2026-10-08',?,25,26,24,?,'split_adjusted','2026-10-08T12:00:00Z',?,'retrieval_time_only','ds1','h',?)").run('p-t1',1,25.5,'2026-10-08T12:30:00Z','2026-10-08T12:30:00Z');
 d.prepare("INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES(?,'aziz-sa-2222','twelve_data','2026-10-08',?,25,26,24,?,'split_adjusted','2026-10-08T12:00:00Z',?,'retrieval_time_only','ds1','h',?)").run('p-t2',2,25.4,'2026-10-09T09:00:00Z','2026-10-09T09:00:00Z');
 const stmt=(sql:string,args:unknown[]=[])=>({first:async()=>(d.prepare(sql).get(...(args as any[])) as any)??null,run:async()=>d.prepare(sql).run(...(args as any[])),sql,args});
 const DB:LedgerDB={prepare:(sql)=>({bind:(...v)=>stmt(sql,v)}),
  batch:async(list:any[])=>{d.exec('BEGIN');try{for(const s of list)d.prepare(s.sql).run(...s.args);d.exec('COMMIT');}catch(e){d.exec('ROLLBACK');throw e;}}};
 return {d,DB};
}
const ISSUE:IssueRow={id:'f1',issue_type:'direct',market:'sa',symbol:'2222.SR',instrument_id:'SA-2222',currency:'SAR',price_basis:'split_adjusted',issued_at:'2026-10-01T12:30:00Z',target_session:'2026-10-08',initial_horizon:5,elapsed_sessions:0,remaining_sessions:5,calendar_id:'TADAWUL-CALENDAR',calendar_version:'proxy-1',input_hash:'h-in',artifact_id:'art-1',artifact_hash:'h-art',policy_hash:'h-pol',feature_schema_version:'fs-1',model_version:'test-v1',ref_price:25,ref_price_session:'2026-09-30',source_id:'twelve_data',data_revision:1,data_as_of:'2026-10-01T12:30:00Z',predicted_log_return:0.01,point_price:25.25,mode:'SHADOW',recorded:1,created_at:'2026-10-01T12:30:00Z'};
const OUT:OutcomeRow={id:'o1',forecast_id:'f1',outcome_revision:1,event_key:'f1:2026-10-08:1',observed_at:'2026-10-08',available_at:'2026-10-08T13:00:00Z',evaluated_at:'2026-10-08T13:05:00Z',actual_price:25.5,price_revision_id:'p-t1',price_basis:'split_adjusted',source_id:'twelve_data',data_revision:1,point_loss:0.0098,direction_outcome:1,created_at:'2026-10-08T13:05:00Z'};
const n=(d:DatabaseSync,sql:string)=>(d.prepare(sql).get() as any).n;
const inputs=[{price_revision_id:'p-old',role:'reference_price' as const}];

test('identical resend = success no-op returning the stored row; no new row',async()=>{
 const {d,DB}=make();
 assert.equal((await recordIssue(DB,ISSUE,inputs)).status,'created');
 const again=await recordIssue(DB,{...ISSUE,created_at:'2026-10-01T12:31:00Z'},inputs);   // redelivery: only bookkeeping differs
 assert.equal(again.status,'unchanged');assert.equal((again as any).row.id,'f1');
 assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_issue_inputs'),1);
 assert.equal((await recordOutcome(DB,OUT)).status,'created');
 const o2=await recordOutcome(DB,{...OUT,created_at:'2026-10-08T14:00:00Z'});
 assert.equal(o2.status,'unchanged');assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_outcomes'),1);
});

test('same identity with different content = explicit conflict; nothing written',async()=>{
 const {d,DB}=make();await recordIssue(DB,ISSUE,inputs);await recordOutcome(DB,OUT);
 const c1=await recordIssue(DB,{...ISSUE,point_price:26},inputs);assert.equal(c1.status,'conflict');assert.equal((c1 as any).code,'issue_conflict');
 const c2=await recordOutcome(DB,{...OUT,actual_price:25.4});assert.equal(c2.status,'conflict');assert.equal((c2 as any).code,'outcome_conflict');
 const c3=await recordOutcome(DB,{...OUT,id:'o-new',event_key:'other-key',actual_price:25.4});assert.equal(c3.status,'conflict');   // same (forecast,revision)
 const slot=await recordIssue(DB,{...ISSUE,id:'f1-other'},inputs);assert.equal(slot.status,'conflict');assert.equal((slot as any).code,'slot_already_issued');
 assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_outcomes'),1);
 assert.equal((d.prepare("SELECT actual_price FROM aziz_forecast_outcomes").get() as any).actual_price,25.5);
});

test('leakage: every input price revision must be received at or before the issue knowledge time',async()=>{
 const {d,DB}=make();
 const r=await recordIssue(DB,ISSUE,[{price_revision_id:'p-late',role:'feature'}]);
 assert.equal(r.status,'rejected');assert.equal((r as any).code,'input_after_knowledge_time');
 assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),0);
 assert.equal((await recordIssue(DB,ISSUE,[])).status,'rejected');                       // recorded issue without inputs
 // the database trigger is a second line of defence if the write layer is bypassed
 const B={...ISSUE,inputs_count:1,payload_hash:'x'};d.prepare(`INSERT INTO aziz_forecast_issues(${Object.keys(B).join(',')}) VALUES(${Object.keys(B).map(()=>'?').join(',')})`).run(...(Object.values(B) as any[]));
 assert.throws(()=>d.prepare("INSERT INTO aziz_issue_inputs VALUES('f1','p-late','feature')").run(),/received after/);
 // atomicity: a failing input rolls back the whole issue
 const {d:d2,DB:DB2}=make();d2.exec("CREATE TRIGGER t_fail BEFORE INSERT ON aziz_issue_inputs BEGIN SELECT RAISE(ABORT,'boom'); END;");
 const r2=await recordIssue(DB2,ISSUE,inputs);assert.notEqual(r2.status,'created');assert.equal(n(d2,'SELECT COUNT(*) n FROM aziz_forecast_issues'),0);
});

test('scoring policy: one outcome per issue at a cutoff; corrections never inflate the sample',async()=>{
 const {d,DB}=make();await recordIssue(DB,ISSUE,inputs);await recordOutcome(DB,OUT);
 await recordOutcome(DB,{...OUT,id:'o2',outcome_revision:2,event_key:'f1:2026-10-08:2',actual_price:25.4,price_revision_id:'p-t2',data_revision:2,supersedes_revision:1,correction_reason:'restated',available_at:'2026-10-09T10:00:00Z',evaluated_at:'2026-10-09T10:05:00Z',created_at:'2026-10-09T10:05:00Z'});
 const at=(c:string)=>d.prepare(SCORED_AS_OF_SQL).all(c) as any[];
 assert.equal(at('2026-10-08T12:00:00Z').length,0);                                    // nothing matured yet
 const before=at('2026-10-08T20:00:00Z');assert.equal(before.length,1);assert.equal(before[0].actual_price,25.5);
 const after=at('2026-10-10T00:00:00Z');assert.equal(after.length,1);assert.equal(after[0].actual_price,25.4);
 assert.equal((d.prepare('SELECT COUNT(*) n FROM aziz_scored_outcomes').get() as any).n,1);
 assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_outcomes'),2);                  // both revisions stored
});

test('REVIEW via write layer: early, foreign-basis, chain-breaking and half-interval writes are rejected, nothing stored',async()=>{
 const {d,DB}=make();await recordIssue(DB,ISSUE,inputs);
 for(const bad of [{observed_at:'2026-10-02'},{price_basis:'total_return'},{actual_price:30},{available_at:'2026-10-08T12:10:00Z',evaluated_at:'2026-10-08T12:15:00Z'}]){
  const r=await recordOutcome(DB,{...OUT,...bad} as OutcomeRow);assert.equal(r.status,'rejected',JSON.stringify(bad));
 }
 const r9=await recordOutcome(DB,{...OUT,id:'o9',outcome_revision:9,event_key:'k9',supersedes_revision:8,correction_reason:'x',price_revision_id:'p-t2',actual_price:25.4});
 assert.equal(r9.status,'rejected');
 const half=await recordIssue(DB,{...ISSUE,id:'f2',target_session:'2026-10-09',interval_low:24,calibration_version:'c1'},inputs);
 assert.notEqual(half.status,'created');
 assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_outcomes'),0);assert.equal(n(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);
});
