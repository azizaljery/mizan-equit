// Integrated contract test for research/drafts/0017_aziz_issue_ledger.DRAFT.sql (phase 4 of the 2026-10-21 spec).
// Runs the draft DDL in an in-memory SQLite (same engine family as D1) and proves:
//   issue saved -> outcome at maturity -> correction stored as a NEW revision -> resend does not grow the sample ->
//   issues/outcomes/prices cannot be updated or deleted -> abstentions never enter accuracy -> as-of reads use received_at.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const DDL=readFileSync(new URL('../../research/drafts/0017_aziz_issue_ledger.DRAFT.sql',import.meta.url),'utf8');
function db(){
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');
 d.exec("CREATE TABLE aziz_symbols(id TEXT PRIMARY KEY, market TEXT, symbol TEXT); INSERT INTO aziz_symbols VALUES('aziz-sa-2222','sa','2222.SR');");
 d.exec("CREATE TABLE aziz_market_datasets(id TEXT PRIMARY KEY); INSERT INTO aziz_market_datasets VALUES('ds1'),('ds2');");
 d.exec(DDL);return d;
}
const ISSUE={id:'f1',issue_type:'direct',market:'sa',symbol:'2222.SR',instrument_id:'SA-2222',currency:'SAR',price_basis:'split_adjusted',issued_at:'2026-10-01T12:30:00Z',target_session:'2026-10-08',initial_horizon:5,elapsed_sessions:0,remaining_sessions:5,calendar_id:'TADAWUL-CALENDAR',calendar_version:'proxy-2222-1120-2010',input_hash:'h-in',artifact_id:'art-1',artifact_hash:'h-art',policy_hash:'h-pol',feature_schema_version:'fs-1',model_version:'test-v1',ref_price:25.0,ref_price_session:'2026-10-01',source_id:'yahoo',data_revision:1,data_as_of:'2026-10-01T12:30:00Z',predicted_log_return:0.01,point_price:25.25,mode:'SHADOW',recorded:1,created_at:'2026-10-01T12:30:00Z'};
function insertIssue(d,o){const r={...ISSUE,...o};const cols=Object.keys(r);d.prepare(`INSERT INTO aziz_forecast_issues(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>r[c]));}
function insertOutcome(d,o){const r={id:'o1',forecast_id:'f1',outcome_revision:1,event_key:'f1:2026-10-08:1',observed_at:'2026-10-08',available_at:'2026-10-08T13:00:00Z',evaluated_at:'2026-10-08T13:05:00Z',actual_price:25.5,price_basis:'split_adjusted',source_id:'yahoo',data_revision:1,point_loss:0.0098,direction_outcome:1,created_at:'2026-10-08T13:05:00Z',...o};const cols=Object.keys(r);d.prepare(`INSERT INTO aziz_forecast_outcomes(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>r[c]));}
const count=(d,sql)=>d.prepare(sql).get().n;
const SAMPLE="SELECT COUNT(*) n FROM aziz_forecast_issues i JOIN aziz_forecast_outcomes o ON o.forecast_id=i.id WHERE i.recorded=1 AND o.outcome_revision=(SELECT MAX(outcome_revision) FROM aziz_forecast_outcomes WHERE forecast_id=i.id)";

test('issue -> outcome -> correction revision -> resend is a no-op; sample never double counts',()=>{
 const d=db();insertIssue(d,{});
 insertOutcome(d,{});assert.equal(count(d,SAMPLE),1);
 // resend of the same outcome (same event key) is rejected, sample unchanged
 assert.throws(()=>insertOutcome(d,{id:'o1-dup'}),/UNIQUE/);assert.equal(count(d,SAMPLE),1);
 // resend with a new delivery id but same revision is also rejected
 assert.throws(()=>insertOutcome(d,{id:'o1-dup2',event_key:'other'}),/UNIQUE/);assert.equal(count(d,SAMPLE),1);
 // source correction = new revision, old one kept, latest wins, sample still 1
 insertOutcome(d,{id:'o2',outcome_revision:2,event_key:'f1:2026-10-08:2',actual_price:25.4,data_revision:2,supersedes_revision:1,correction_reason:'provider restated close',created_at:'2026-10-09T10:00:00Z',evaluated_at:'2026-10-09T10:00:00Z'});
 assert.equal(count(d,"SELECT COUNT(*) n FROM aziz_forecast_outcomes WHERE forecast_id='f1'"),2);assert.equal(count(d,SAMPLE),1);
 assert.equal(d.prepare("SELECT actual_price FROM aziz_forecast_outcomes WHERE forecast_id='f1' ORDER BY outcome_revision DESC LIMIT 1").get().actual_price,25.4);
 // a correction must say what it supersedes and why
 assert.throws(()=>insertOutcome(d,{id:'o3',outcome_revision:3,event_key:'f1:2026-10-08:3',supersedes_revision:1,correction_reason:'x'}),/CHECK/);
 assert.throws(()=>insertOutcome(d,{id:'o3',outcome_revision:3,event_key:'f1:2026-10-08:3',supersedes_revision:2}),/CHECK/);
});

test('resume after interruption cannot re-issue the same forecast',()=>{
 const d=db();insertIssue(d,{});assert.throws(()=>insertIssue(d,{id:'f1-again'}),/UNIQUE/);
 assert.equal(count(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);
});

test('issues, outcomes and price revisions are append-only (no UPDATE, no DELETE)',()=>{
 const d=db();insertIssue(d,{});insertOutcome(d,{});
 d.prepare("INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES('p1','aziz-sa-2222','twelve_data','2026-10-08',1,25,26,24.5,25.5,'split_adjusted','2026-10-08T12:00:00Z','2026-10-08T13:00:00Z','retrieval_time_only','ds1','h1','2026-10-08T13:00:00Z')").run();
 for(const sql of ["UPDATE aziz_forecast_issues SET point_price=30 WHERE id='f1'","DELETE FROM aziz_forecast_issues WHERE id='f1'","UPDATE aziz_forecast_outcomes SET actual_price=1 WHERE id='o1'","DELETE FROM aziz_forecast_outcomes WHERE id='o1'","UPDATE aziz_price_revisions SET closed=1 WHERE id='p1'","DELETE FROM aziz_price_revisions WHERE id='p1'"])assert.throws(()=>d.exec(sql),/append-only/,sql);
});

test('abstention is stored with a code, has no point, and can never receive an outcome',()=>{
 const d=db();insertIssue(d,{id:'a1',recorded:0,predicted_log_return:null,point_price:null,abstention_code:'missing_kalman_state',abstention_message:'no state'});
 assert.throws(()=>insertIssue(d,{id:'a2',recorded:0,abstention_code:'x',target_session:'2026-10-09'}),/CHECK/);           // abstention with a point
 assert.throws(()=>insertIssue(d,{id:'a3',recorded:1,predicted_log_return:null,point_price:null,target_session:'2026-10-10'}),/CHECK/); // recorded without a point
 assert.throws(()=>insertOutcome(d,{id:'oa',forecast_id:'a1',event_key:'a1:x:1'}),/recorded/);
 assert.equal(count(d,SAMPLE),0);
 assert.equal(count(d,"SELECT COUNT(*) n FROM aziz_forecast_issues"),1);                                                  // issue rate denominator keeps the abstention
});

test('brier/interval metrics are only allowed when the issue carried a probability/interval',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>insertOutcome(d,{brier:0.2}),/metric without/);
 assert.throws(()=>insertOutcome(d,{interval_hit:1}),/metric without/);
 insertIssue(d,{id:'f2',target_session:'2026-10-09',probability_up:0.6,interval_low:24,interval_high:27,calibration_version:'cal-1'});
 insertOutcome(d,{id:'o2',forecast_id:'f2',event_key:'f2:2026-10-09:1',brier:0.16,interval_hit:1,interval_score:3.0});
});

test('as-of reads use received_at: a price imported today is unknown for any earlier t',()=>{
 const d=db();
 const ins=d.prepare("INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES(?,?,?,?,?,25,26,24,?,'split_adjusted',?,?,'retrieval_time_only',?,?,?)");
 ins.run('p1','aziz-sa-2222','twelve_data','2021-03-01',1,20.0,'2021-03-01T12:00:00Z','2026-10-22T00:00:00Z','ds1','h1','2026-10-22T00:00:00Z');
 ins.run('p2','aziz-sa-2222','twelve_data','2021-03-01',2,20.5,'2021-03-01T12:00:00Z','2026-10-23T00:00:00Z','ds2','h2','2026-10-23T00:00:00Z');
 const asOf=t=>d.prepare("SELECT closed FROM aziz_price_revisions WHERE symbol_id='aziz-sa-2222' AND session_date='2021-03-01' AND received_at<=? ORDER BY revision DESC LIMIT 1").get(t);
 assert.equal(asOf('2021-03-02T00:00:00Z'),undefined);   // old session, but the system did not know it then
 assert.equal(asOf('2024-09-04T00:00:00Z'),undefined);
 assert.equal(asOf('2026-10-22T12:00:00Z').closed,20.0); // first version known
 assert.equal(asOf('2026-10-24T00:00:00Z').closed,20.5); // later correction, old version still stored
 assert.equal(count(d,"SELECT COUNT(*) n FROM aziz_price_revisions"),2);
 assert.throws(()=>ins.run('p3','aziz-sa-2222','twelve_data','2021-03-01',2,21,'2021-03-01T12:00:00Z','2026-10-24T00:00:00Z','ds2','h3','2026-10-24T00:00:00Z'),/UNIQUE/); // same revision twice
 assert.throws(()=>ins.run('p4','aziz-sa-2222','twelve_data','2021-03-01',3,21,'2021-03-01T12:00:00Z','2020-01-01T00:00:00Z','ds2','h4','2020-01-01T00:00:00Z'),/CHECK/); // received before observed
});

test('issue inputs cannot claim knowledge after issue time',()=>{
 const d=db();assert.throws(()=>insertIssue(d,{data_as_of:'2026-10-02T00:00:00Z'}),/CHECK/);
});
