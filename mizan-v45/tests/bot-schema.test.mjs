import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
function db(){const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE forecast_records(id TEXT PRIMARY KEY);');d.exec(readFileSync('drizzle/0018_paper_bot.sql','utf8'));
  d.exec(`INSERT INTO bot_strategies VALUES('s1','bot-strategy-1','2026-11-12T00:00:00Z','{}','fp','');
   INSERT INTO bot_experiments VALUES('e1','us-1','us','USD',1000000,'s1','dry_run','running','2026-11-12T00:00:00Z','2026-11-12T00:00:00Z',NULL,'{}');
   INSERT INTO bot_decisions VALUES('d1','e1','e1|AAA|5|f1|buy|2026-11-12','2026-11-12T10:00:00Z','AAA',5,'buy','entry_up_call','f1','2026-11-12T09:00:00Z','m','bot-strategy-1','{}');
   INSERT INTO bot_orders VALUES('o1','e1','d1','e1|AAA|5|f1|buy','2026-11-12T10:00:00Z','2026-11-16T10:00:00Z','AAA',5,'buy',200,'pending','','2026-11-12T10:00:00Z','f1',0,'{}');`);return d;}
test('bot records are append-only; strategies, decisions, fills and snapshots cannot be edited or deleted',()=>{
  const d=db();
  for(const sql of ["DELETE FROM bot_strategies","UPDATE bot_strategies SET note='x'","DELETE FROM bot_decisions","UPDATE bot_decisions SET reason='x'","DELETE FROM bot_orders","DELETE FROM bot_experiments",
    "UPDATE bot_experiments SET initial_cash=5","UPDATE bot_experiments SET strategy_id='s2'","UPDATE bot_orders SET quantity=1","UPDATE bot_orders SET symbol='BBB'"])assert.throws(()=>d.exec(sql),/append_only|immutable|final_or_identity/);
  d.close();
});
test('a repeated step cannot duplicate a decision, an order or a fill; an order settles exactly once',()=>{
  const d=db();
  assert.throws(()=>d.exec("INSERT INTO bot_decisions VALUES('d2','e1','e1|AAA|5|f1|buy|2026-11-12','2026-11-12T10:05:00Z','AAA',5,'buy','entry_up_call','f1',NULL,'m','bot-strategy-1','{}')"),/UNIQUE/);
  d.exec("INSERT INTO bot_decisions VALUES('d3','e1','k3','2026-11-12T10:05:00Z','AAA',5,'buy','entry_up_call','f1',NULL,'m','bot-strategy-1','{}')");
  assert.throws(()=>d.exec("INSERT INTO bot_orders VALUES('o2','e1','d3','e1|AAA|5|f1|buy','2026-11-12T10:05:00Z','2026-11-16T10:00:00Z','AAA',5,'buy',200,'pending','','2026-11-12T10:05:00Z','f1',0,'{}')"),/UNIQUE/);
  d.exec("UPDATE bot_orders SET attempts=1,last_attempt_json='{\"reason\":\"market_closed\"}' WHERE id='o1'");                       // attempts may be recorded while pending
  d.exec("INSERT INTO bot_fills VALUES('x1','e1','o1','2026-11-12T14:31:00Z','AAA',5,'buy',200,100,100.03,2,4,2,'USD','2026-11-12T14:30:30Z',30,'fixture','f1','{}')");
  d.exec("UPDATE bot_orders SET status='filled',status_reason='filled',status_at='2026-11-12T14:31:00Z' WHERE id='o1' AND status='pending'");
  assert.throws(()=>d.exec("INSERT INTO bot_fills VALUES('x2','e1','o1','2026-11-12T14:32:00Z','AAA',5,'buy',200,100,100.03,2,4,2,'USD','2026-11-12T14:30:30Z',30,'fixture','f1','{}')"),/UNIQUE/);
  assert.throws(()=>d.exec("UPDATE bot_orders SET status='cancelled' WHERE id='o1'"),/final_or_identity/);
  assert.throws(()=>d.exec("UPDATE bot_fills SET fill_price=1"),/immutable/);
  d.exec("INSERT INTO bot_equity_snapshots VALUES('e1','2026-11-12','2026-11-12T21:00:00Z',979990,20006,999996,100,'SPY','{}')");
  assert.throws(()=>d.exec("INSERT INTO bot_equity_snapshots VALUES('e1','2026-11-12','2026-11-12T22:00:00Z',1,1,2,NULL,'','{}')"),/UNIQUE|PRIMARY/);
  d.exec("UPDATE bot_experiments SET status='stopped',stopped_at='2026-11-13T00:00:00Z' WHERE id='e1'");
  assert.throws(()=>d.exec("UPDATE bot_experiments SET status='running' WHERE id='e1'"),/immutable/);
  d.close();
});
