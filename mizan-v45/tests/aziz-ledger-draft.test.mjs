// Integrated contract test for research/drafts/0017_aziz_issue_ledger.DRAFT.sql (phase 4 of the 2026-10-21 spec).
// Runs the draft DDL in an in-memory SQLite (same engine family as D1). Covers the owner's review of 2026-10-23:
// early/foreign-session outcomes, price-basis mismatch, broken correction chains, half intervals, abstentions with
// bounds, and inputs appended after issue — each must be REFUSED by the database itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const DDL=readFileSync(new URL('../../research/drafts/0017_aziz_issue_ledger.DRAFT.sql',import.meta.url),'utf8').split('\n').filter(l=>!l.includes('@@DRAFT-GUARD@@')).join('\n');
const PRICE="INSERT INTO aziz_price_revisions(id,symbol_id,provider,session_date,revision,opened,high,low,closed,price_basis,observed_at,received_at,availability_basis,dataset_id,raw_hash,created_at) VALUES(?,?,'twelve_data',?,?,25,26,24,?,?,?,?,'retrieval_time_only','ds1','h',?)";
function db(){
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');
 d.exec("CREATE TABLE aziz_symbols(id TEXT PRIMARY KEY, market TEXT, symbol TEXT); INSERT INTO aziz_symbols VALUES('aziz-sa-2222','sa','2222.SR'),('aziz-sa-1120','sa','1120.SR');");
 d.exec("CREATE TABLE aziz_market_datasets(id TEXT PRIMARY KEY); INSERT INTO aziz_market_datasets VALUES('ds1'),('ds2');");
 d.exec(DDL);
 const p=d.prepare(PRICE);
 p.run('p-in','aziz-sa-2222','2026-09-30',1,25.0,'split_adjusted','2026-09-30T12:00:00Z','2026-09-30T13:00:00Z','2026-09-30T13:00:00Z');   // issue input
 p.run('p-t1','aziz-sa-2222','2026-10-08',1,25.5,'split_adjusted','2026-10-08T12:00:00Z','2026-10-08T12:30:00Z','2026-10-08T12:30:00Z');   // target close v1
 p.run('p-t2','aziz-sa-2222','2026-10-08',2,25.4,'split_adjusted','2026-10-08T12:00:00Z','2026-10-09T09:00:00Z','2026-10-09T09:00:00Z');   // target close v2 (restated)
 p.run('p-early','aziz-sa-2222','2026-10-02',1,25.1,'split_adjusted','2026-10-02T12:00:00Z','2026-10-02T12:30:00Z','2026-10-02T12:30:00Z'); // a session before the target
 p.run('p-tr','aziz-sa-2222','2026-10-08',3,26.0,'total_return','2026-10-08T12:00:00Z','2026-10-08T12:30:00Z','2026-10-08T12:30:00Z');   // other price basis
 p.run('p-other','aziz-sa-1120','2026-10-08',1,90.0,'split_adjusted','2026-10-08T12:00:00Z','2026-10-08T12:30:00Z','2026-10-08T12:30:00Z'); // other instrument
 return d;
}
const ISSUE={id:'f1',issue_type:'direct',market:'sa',symbol:'2222.SR',instrument_id:'SA-2222',currency:'SAR',price_basis:'split_adjusted',issued_at:'2026-10-01T12:30:00Z',target_session:'2026-10-08',initial_horizon:5,elapsed_sessions:0,remaining_sessions:5,calendar_id:'TADAWUL-CALENDAR',calendar_version:'proxy-2222-1120-2010',input_hash:'h-in',artifact_id:'art-1',artifact_hash:'h-art',policy_hash:'h-pol',feature_schema_version:'fs-1',model_version:'test-v1',ref_price:25.0,ref_price_session:'2026-09-30',source_id:'twelve_data',data_revision:1,data_as_of:'2026-10-01T12:30:00Z',predicted_log_return:0.01,point_price:25.25,mode:'SHADOW',recorded:1,inputs_count:1,payload_hash:'h',created_at:'2026-10-01T12:30:00Z'};
const ins=(d,table,r)=>{const cols=Object.keys(r);d.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>r[c]));};
function insertIssue(d,o,inputs=['p-in']){const r={...ISSUE,...o};ins(d,'aziz_forecast_issues',r);for(const x of (r.recorded?inputs:[]))ins(d,'aziz_issue_inputs',{forecast_id:r.id,price_revision_id:x,role:'reference_price'});}
function insertOutcome(d,o){ins(d,'aziz_forecast_outcomes',{id:'o1',forecast_id:'f1',outcome_revision:1,event_key:'f1:2026-10-08:1',observed_at:'2026-10-08',available_at:'2026-10-08T13:00:00Z',evaluated_at:'2026-10-08T13:05:00Z',actual_price:25.5,price_revision_id:'p-t1',price_basis:'split_adjusted',source_id:'twelve_data',data_revision:1,point_loss:0.0098,direction_outcome:1,payload_hash:'h',created_at:'2026-10-08T13:05:00Z',...o});}
const CORR={id:'o2',outcome_revision:2,event_key:'f1:2026-10-08:2',actual_price:25.4,price_revision_id:'p-t2',data_revision:2,supersedes_revision:1,correction_reason:'provider restated close',available_at:'2026-10-09T10:00:00Z',evaluated_at:'2026-10-09T10:00:00Z',created_at:'2026-10-09T10:00:00Z'};
const count=(d,sql)=>d.prepare(sql).get().n;
const SAMPLE='SELECT COUNT(*) n FROM aziz_scored_outcomes';

test('issue -> outcome -> correction revision; duplicates refused by the database; sample never double counts',()=>{
 const d=db();insertIssue(d,{});
 insertOutcome(d,{});assert.equal(count(d,SAMPLE),1);
 assert.throws(()=>insertOutcome(d,{id:'o1-dup'}),/UNIQUE/);
 assert.throws(()=>insertOutcome(d,{id:'o1-dup2',event_key:'other'}),/UNIQUE/);assert.equal(count(d,SAMPLE),1);
 insertOutcome(d,CORR);
 assert.equal(count(d,"SELECT COUNT(*) n FROM aziz_forecast_outcomes WHERE forecast_id='f1'"),2);assert.equal(count(d,SAMPLE),1);
 assert.equal(d.prepare('SELECT actual_price FROM aziz_scored_outcomes').get().actual_price,25.4);
 assert.throws(()=>insertOutcome(d,{...CORR,id:'o3',outcome_revision:3,event_key:'k3',supersedes_revision:1}),/CHECK/);
 assert.throws(()=>insertOutcome(d,{...CORR,id:'o3',outcome_revision:3,event_key:'k3',supersedes_revision:2,correction_reason:null}),/CHECK/);
});

test('REVIEW: outcome before maturity / for another session is refused (2 Oct outcome for an 8 Oct target)',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>insertOutcome(d,{observed_at:'2026-10-02',available_at:'2026-10-02T13:00:00Z',evaluated_at:'2026-10-02T13:05:00Z',actual_price:25.1,price_revision_id:'p-early'}),/target session/);
 assert.throws(()=>insertOutcome(d,{price_revision_id:'p-early',actual_price:25.1}),/target session/);         // right date label, wrong price version
 assert.throws(()=>insertOutcome(d,{available_at:'2026-10-08T12:10:00Z',evaluated_at:'2026-10-08T12:15:00Z'}),/target session/); // available before the price was received
 assert.equal(count(d,SAMPLE),0);
});

test('REVIEW: price basis and instrument must match the issue',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>insertOutcome(d,{price_basis:'total_return',price_revision_id:'p-tr',actual_price:26.0}),/price basis/);
 assert.throws(()=>insertOutcome(d,{price_revision_id:'p-tr',actual_price:26.0}),/price basis/);              // outcome says split, version is total_return
 assert.throws(()=>insertOutcome(d,{price_revision_id:'p-other',actual_price:90.0}),/same instrument/);       // another stock's close
 assert.throws(()=>insertOutcome(d,{actual_price:30.0}),/target session/);                                    // price differs from the version it cites
 assert.equal(count(d,SAMPLE),0);
});

test('REVIEW: correction chain must be unbroken (revision 9 without 1-8 is refused)',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>insertOutcome(d,{...CORR,id:'o9',outcome_revision:9,event_key:'k9',supersedes_revision:8}),/chain broken/);
 insertOutcome(d,{});
 assert.throws(()=>insertOutcome(d,{...CORR,id:'o3',outcome_revision:3,event_key:'k3',supersedes_revision:2}),/chain broken/);
 insertOutcome(d,CORR);assert.equal(count(d,"SELECT COUNT(*) n FROM aziz_forecast_outcomes"),2);
});

test('REVIEW: interval needs both positive ordered bounds with a calibration version; abstention carries no bound',()=>{
 const d=db();let n=0;const slot=()=>({id:'x'+(++n),target_session:'2026-11-'+String(n).padStart(2,'0')});
 assert.throws(()=>insertIssue(d,{...slot(),interval_low:24,calibration_version:'c1'}),/CHECK/);                   // lower only
 assert.throws(()=>insertIssue(d,{...slot(),interval_high:27,calibration_version:'c1'}),/CHECK/);                  // upper only
 assert.throws(()=>insertIssue(d,{...slot(),interval_low:27,interval_high:24,calibration_version:'c1'}),/CHECK/);  // reversed
 assert.throws(()=>insertIssue(d,{...slot(),interval_low:0,interval_high:24,calibration_version:'c1'}),/CHECK/);   // non-positive
 assert.throws(()=>insertIssue(d,{...slot(),interval_low:24,interval_high:27}),/CHECK/);                           // no calibration
 assert.throws(()=>insertIssue(d,{...slot(),probability_up:0.6}),/CHECK/);                                          // probability without calibration
 const ab={recorded:0,inputs_count:0,predicted_log_return:null,point_price:null,abstention_code:'missing_kalman_state'};
 assert.throws(()=>insertIssue(d,{...slot(),...ab,interval_high:27}),/CHECK/);                                      // abstention with an upper bound
 assert.throws(()=>insertIssue(d,{...slot(),...ab,interval_low:24}),/CHECK/);
 assert.throws(()=>insertIssue(d,{...slot(),...ab,calibration_version:'c1'}),/CHECK/);
 insertIssue(d,{...slot(),...ab});
 insertIssue(d,{...slot(),interval_low:24,interval_high:27,probability_up:0.6,calibration_version:'c1'});
 assert.equal(count(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),2);
});

test('REVIEW: input list is closed at issue time (no later append); outcome requires the declared list complete',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>d.prepare("INSERT INTO aziz_issue_inputs VALUES('f1','p-t1','feature')").run(),/closed/);       // append after issue
 // a partially written list (declared 2, only 1 present) cannot receive an outcome
 insertIssue(d,{id:'f2',target_session:'2026-10-09',inputs_count:2},['p-in']);
 d.prepare(PRICE).run('p-t9','aziz-sa-2222','2026-10-09',1,25.6,'split_adjusted','2026-10-09T12:00:00Z','2026-10-09T12:30:00Z','2026-10-09T12:30:00Z');
 assert.throws(()=>insertOutcome(d,{id:'oo',forecast_id:'f2',event_key:'f2:1',observed_at:'2026-10-09',available_at:'2026-10-09T13:00:00Z',evaluated_at:'2026-10-09T13:05:00Z',actual_price:25.6,price_revision_id:'p-t9'}),/incomplete/);
 // once an outcome exists no input can be added, even below the declared count
 insertOutcome(d,{});
 assert.throws(()=>d.prepare("INSERT INTO aziz_issue_inputs VALUES('f1','p-early','feature')").run(),/closed|received after/);
 assert.throws(()=>insertIssue(d,{id:'f3',target_session:'2026-10-10',inputs_count:0}),/CHECK/);                 // recorded issue with no inputs
});

test('resume after interruption cannot re-issue the same forecast slot',()=>{
 const d=db();insertIssue(d,{});assert.throws(()=>insertIssue(d,{id:'f1-again'}),/UNIQUE/);
 assert.equal(count(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);
});

test('issues, outcomes, inputs and price revisions are append-only (no UPDATE, no DELETE)',()=>{
 const d=db();insertIssue(d,{});insertOutcome(d,{});
 for(const sql of ["UPDATE aziz_forecast_issues SET point_price=30 WHERE id='f1'","DELETE FROM aziz_forecast_issues WHERE id='f1'","UPDATE aziz_forecast_outcomes SET actual_price=1 WHERE id='o1'","DELETE FROM aziz_forecast_outcomes WHERE id='o1'","UPDATE aziz_price_revisions SET closed=1 WHERE id='p-t1'","DELETE FROM aziz_price_revisions WHERE id='p-t1'","UPDATE aziz_issue_inputs SET role='feature'","DELETE FROM aziz_issue_inputs"])assert.throws(()=>d.exec(sql),/append-only/,sql);
});

test('abstention is stored with a code, has no point, never receives an outcome, stays in the issue-rate denominator',()=>{
 const d=db();insertIssue(d,{id:'a1',recorded:0,inputs_count:0,predicted_log_return:null,point_price:null,abstention_code:'missing_kalman_state',abstention_message:'no state'});
 assert.throws(()=>insertIssue(d,{id:'a2',recorded:0,inputs_count:0,abstention_code:'x',target_session:'2026-10-09'}),/CHECK/);
 assert.throws(()=>insertOutcome(d,{id:'oa',forecast_id:'a1',event_key:'a1:x:1'}),/recorded/);
 assert.equal(count(d,SAMPLE),0);assert.equal(count(d,'SELECT COUNT(*) n FROM aziz_forecast_issues'),1);
});

test('brier/interval metrics only when the issue carried a probability/interval',()=>{
 const d=db();insertIssue(d,{});
 assert.throws(()=>insertOutcome(d,{brier:0.2}),/metric without/);
 assert.throws(()=>insertOutcome(d,{interval_hit:1}),/metric without/);
});

test('as-of reads use received_at: a price imported today is unknown for any earlier t',()=>{
 const d=db();const p=d.prepare(PRICE);
 p.run('h1','aziz-sa-2222','2021-03-01',1,20.0,'split_adjusted','2021-03-01T12:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z');
 p.run('h2','aziz-sa-2222','2021-03-01',2,20.5,'split_adjusted','2021-03-01T12:00:00Z','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z');
 const asOf=t=>d.prepare("SELECT closed FROM aziz_price_revisions WHERE symbol_id='aziz-sa-2222' AND session_date='2021-03-01' AND received_at<=? ORDER BY revision DESC LIMIT 1").get(t);
 assert.equal(asOf('2021-03-02T00:00:00Z'),undefined);assert.equal(asOf('2024-09-04T00:00:00Z'),undefined);
 assert.equal(asOf('2026-10-22T12:00:00Z').closed,20.0);assert.equal(asOf('2026-10-24T00:00:00Z').closed,20.5);
 assert.throws(()=>p.run('h3','aziz-sa-2222','2021-03-01',2,21,'split_adjusted','2021-03-01T12:00:00Z','2026-10-24T00:00:00Z','2026-10-24T00:00:00Z'),/UNIQUE/);
 assert.throws(()=>p.run('h4','aziz-sa-2222','2021-03-01',3,21,'split_adjusted','2021-03-01T12:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'),/CHECK/);
});

test('issue inputs cannot claim knowledge after issue time',()=>{
 const d=db();assert.throws(()=>insertIssue(d,{data_as_of:'2026-10-02T00:00:00Z'}),/CHECK/);
 const d2=db();ins(d2,'aziz_forecast_issues',{...ISSUE});
 assert.throws(()=>ins(d2,'aziz_issue_inputs',{forecast_id:'f1',price_revision_id:'p-t1',role:'feature'}),/received after/);
});
