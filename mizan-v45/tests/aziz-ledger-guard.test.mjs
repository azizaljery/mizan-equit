// The draft ledger DDL must not be applicable by accident (owner review 2026-10-22).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const ROOT=new URL('../../',import.meta.url);
const DRAFT=readFileSync(new URL('research/drafts/0017_aziz_issue_ledger.DRAFT.sql',ROOT),'utf8');
test('running the draft as-is fails on its first statement and creates nothing',()=>{
 const d=new DatabaseSync(':memory:');
 assert.throws(()=>d.exec(DRAFT),/__aziz_draft_not_approved_do_not_apply__/);
 assert.equal(d.prepare("SELECT COUNT(*) n FROM sqlite_master").get().n,0);
 const first=DRAFT.split('\n').find(l=>l.trim()&&!l.trim().startsWith('--'));assert.match(first,/@@DRAFT-GUARD@@/);
});
test('no migration in drizzle/ creates the ledger tables, and no workflow references the drafts folder',()=>{
 for(const f of readdirSync(new URL('mizan-v45/drizzle/',ROOT)).filter(f=>f.endsWith('.sql')))
  assert.doesNotMatch(readFileSync(new URL('mizan-v45/drizzle/'+f,ROOT),'utf8'),/aziz_forecast_issues|aziz_forecast_outcomes|aziz_price_revisions|aziz_issue_inputs/,f);
 for(const f of readdirSync(new URL('.github/workflows/',ROOT)))
  assert.doesNotMatch(readFileSync(new URL('.github/workflows/'+f,ROOT),'utf8'),/research\/drafts/,f);
});
