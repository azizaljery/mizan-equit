import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const Q=(await import(process.env.MIZAN_TEST_MODULE)).botQueries;
// Minimal D1 shim over node:sqlite (prepare/bind/all/first/run/batch).
function shim(raw){return {prepare(sql){const st=raw.prepare(sql);return {bind(...a){return {all:async()=>({results:st.all(...a)}),first:async()=>st.get(...a)??null,run:async()=>st.run(...a)};}};},
  async batch(list){raw.exec('BEGIN');try{for(const s of list)await s.run();raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}}};}
function make({signals=false}={}){const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE forecast_records(id TEXT PRIMARY KEY);');raw.exec(readFileSync('drizzle/0018_paper_bot.sql','utf8'));
  if(signals)raw.exec(`CREATE TABLE bot_signals(id INTEGER PRIMARY KEY,signal_key TEXT UNIQUE,source TEXT,source_version TEXT,market TEXT,symbol TEXT,horizon INTEGER,direction TEXT,confidence TEXT,strength INTEGER,issued_at TEXT,forecast_id TEXT,basis_json TEXT,recorded_at TEXT);
   CREATE TABLE bot_signal_outcomes(signal_id INTEGER UNIQUE,resolved_at TEXT,start_price REAL,end_price REAL,up INTEGER,horizon_sessions INTEGER);`);
  return {raw,db:shim(raw)};}
const NOW=new Date('2026-11-12T10:00:00Z');

test('create: defaults pin the frozen v1 strategy and per-market capital; customised risk makes a NEW dated version; bad input and duplicates are refused',async()=>{
  const {raw,db}=make();
  const a=await Q.createExperiment(db,{name:'us-test-1',market:'us',mode:'dry_run'},NOW);
  assert.equal(a.strategyVersion,'bot-strategy-2');assert.equal(a.status,'running');
  const sa=await Q.createExperiment(db,{name:'sa-test-1',market:'sa',mode:'paper',start:false},NOW);
  const rows=await Q.listExperiments(db);assert.equal(rows.length,2);
  assert.equal(rows.find(r=>r.market==='us').initialCash,1_000_000);assert.equal(rows.find(r=>r.market==='sa').initialCash,3_750_000);assert.equal(rows.find(r=>r.market==='sa').currency,'SAR');assert.equal(sa.status,'paused');
  const c=await Q.createExperiment(db,{name:'us-test-2',market:'us',mode:'dry_run',positionPct:1},NOW);
  assert.match(c.strategyVersion,/^bot-strategy-2\+[0-9a-f]{8}$/);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM bot_strategies').get().n,2);
  const stored=JSON.parse(raw.prepare('SELECT config_json FROM bot_strategies WHERE version=?').get(c.strategyVersion).config_json);assert.equal(stored.sizing.positionPctOfEquity,1);assert.equal(stored.entry.minVotes,2);
  await assert.rejects(()=>Q.createExperiment(db,{name:'us-test-1',market:'us',mode:'dry_run'},NOW),/مستخدم/);
  for(const bad of [{name:'x',market:'us',mode:'paper'},{name:'abc',market:'eu',mode:'paper'},{name:'abc',market:'us',mode:'live'},{name:'abc',market:'us',mode:'paper',positionPct:50},{name:'abc',market:'us',mode:'paper',maxPositionsPerHorizon:2.5},{name:'abc',market:'us',mode:'paper',initialCash:-1}])
    await assert.rejects(()=>Q.createExperiment(db,bad,NOW),e=>e instanceof Q.BotInputError);
});

test('lifecycle: pause/resume record when; stopped is final',async()=>{
  const {db}=make();const {id}=await Q.createExperiment(db,{name:'life-1',market:'us',mode:'paper'},NOW);
  await Q.setExperimentStatus(db,id,'pause',new Date('2026-11-12T11:00:00Z'));assert.equal((await Q.listExperiments(db))[0].status,'paused');
  await Q.setExperimentStatus(db,id,'start',new Date('2026-11-12T12:00:00Z'));
  let e=(await Q.listExperiments(db))[0];assert.equal(e.status,'running');assert.equal(JSON.parse(e.statusJson).resumedAt,'2026-11-12T12:00:00.000Z');
  await Q.setExperimentStatus(db,id,'stop',new Date('2026-11-12T13:00:00Z'));e=(await Q.listExperiments(db))[0];assert.equal(e.status,'stopped');assert.ok(e.stoppedAt);
  await assert.rejects(()=>Q.setExperimentStatus(db,id,'start'),/نهائيًا/);await assert.rejects(()=>Q.setExperimentStatus(db,'nope','pause'),/غير موجودة/);
});

function seedTrades(raw,id){
  raw.exec(`INSERT INTO bot_decisions VALUES('d1','${id}','k1','2026-11-12T10:00:00Z','AAA',5,'buy','entry_up_call','f1','2026-11-12T09:00:00Z','m','bot-strategy-1','{}');
   INSERT INTO bot_decisions VALUES('d2','${id}','k2','2026-11-12T10:00:00Z','BBB',5,'abstain','no_prospective_call',NULL,NULL,NULL,'bot-strategy-1','{}');
   INSERT INTO bot_decisions VALUES('d3','${id}','k3','2026-11-12T10:00:00Z','CCC',1,'abstain','no_prospective_call',NULL,NULL,NULL,'bot-strategy-1','{}');
   INSERT INTO bot_decisions VALUES('d4','${id}','k4','2026-11-13T10:00:00Z','AAA',5,'sell','horizon_end','f1','2026-11-12T09:00:00Z','m','bot-strategy-1','{}');
   INSERT INTO bot_orders VALUES('o1','${id}','d1','ok1','2026-11-12T10:00:00Z','2026-11-16T10:00:00Z','AAA',5,'buy',100,'filled','filled','2026-11-12T14:31:00Z','f1',0,'{}');
   INSERT INTO bot_orders VALUES('o2','${id}','d4','ok2','2026-11-13T10:00:00Z','2026-11-17T10:00:00Z','AAA',5,'sell',100,'filled','filled','2026-11-13T14:31:00Z','f1',0,'{}');
   INSERT INTO bot_fills VALUES('x1','${id}','o1','2026-11-12T14:31:00Z','AAA',5,'buy',100,100,100.1,1,2,1,'USD','2026-11-12T14:30:30Z',30,'fixture','f1','{}');
   INSERT INTO bot_fills VALUES('x2','${id}','o2','2026-11-13T14:31:00Z','AAA',5,'sell',100,110,109.9,1,2,1,'USD','2026-11-13T14:30:30Z',30,'fixture','f1','{}');
   INSERT INTO bot_equity_snapshots VALUES('${id}','2026-11-12','2026-11-12T21:00:00Z',989990,10010,1000000,100,'SPY','{}');
   INSERT INTO bot_equity_snapshots VALUES('${id}','2026-11-13','2026-11-13T21:00:00Z',1000970,0,1000970,101,'SPY','{}');`);}

test('dashboard: cash, realized P&L and performance come from fills/snapshots; counts, reasons and tolerance of missing signal tables',async()=>{
  const {raw,db}=make();const {id}=await Q.createExperiment(db,{name:'dash-1',market:'us',mode:'paper'},NOW);seedTrades(raw,id);
  const d=await Q.experimentDashboard(db,id);
  assert.equal(d.positions.length,0);assert.equal(d.ledgerError,null);
  const cash=1_000_000-(100*100.1+1)+(100*109.9-1);assert.ok(Math.abs(d.cash-cash)<1e-6);assert.ok(Math.abs(d.realized-(cash-1_000_000))<1e-6);
  assert.equal(d.performance.closedTrades,1);assert.equal(d.performance.winRatePct,100);assert.ok(Math.abs(d.performance.returnPct-0.097)<1e-6);assert.ok(Math.abs(d.performance.benchmarkReturnPct-1)<1e-9);
  assert.deepEqual(d.orderCounts,{filled:2});assert.deepEqual(d.decisionCounts,{buy:1,sell:1,abstain:2});assert.equal(d.abstainReasons[0].reason,'no_prospective_call');assert.equal(d.abstainReasons[0].n,2);
  assert.ok(Math.abs(d.totalCosts-8)<1e-9);assert.equal(d.equity,1000970);
  assert.equal((await Q.listOrders(db,id)).length,2);assert.equal((await Q.listFills(db,id))[0].symbol,'AAA');assert.equal((await Q.listDecisions(db,id)).length,4);
  assert.deepEqual(await Q.sourceScorecard(db),[]);assert.deepEqual(await Q.listSignals(db),[]);   // signal tables absent: "no data", not an error
  assert.equal(await Q.experimentDashboard(db,'missing'),null);
});

test('open positions are valued at the last execution price; an experiment with no activity is empty but valid',async()=>{
  const {raw,db}=make();const {id}=await Q.createExperiment(db,{name:'open-1',market:'sa',mode:'dry_run'},NOW);
  let d=await Q.experimentDashboard(db,id);assert.equal(d.cash,3_750_000);assert.equal(d.equity,3_750_000);assert.deepEqual(d.positions,[]);assert.equal(d.performance.winRatePct,null);
  raw.exec(`INSERT INTO bot_decisions VALUES('d1','${id}','k1','2026-11-12T10:00:00Z','2222.SR',5,'buy','entry_up_call','f1',NULL,'m','bot-strategy-1','{}');
   INSERT INTO bot_orders VALUES('o1','${id}','d1','ok1','2026-11-12T10:00:00Z','2026-11-16T10:00:00Z','2222.SR',5,'buy',1000,'filled','filled','2026-11-12T08:00:00Z','f1',0,'{}');
   INSERT INTO bot_fills VALUES('x1','${id}','o1','2026-11-12T08:00:00Z','2222.SR',5,'buy',1000,30,30.02,5,5,2,'SAR','2026-11-12T07:59:00Z',20,'fixture','f1','{}');`);
  d=await Q.experimentDashboard(db,id);assert.equal(d.positions.length,1);assert.equal(d.positions[0].quantity,1000);assert.ok(d.cash<3_750_000-30020);
});

test('scorecard: every source/version/market/horizon is scored separately against the same-market baseline',async()=>{
  const {raw,db}=make({signals:true});
  const ins=raw.prepare('INSERT INTO bot_signals(id,signal_key,source,source_version,market,symbol,horizon,direction,issued_at) VALUES(?,?,?,?,?,?,?,?,?)'),out=raw.prepare('INSERT INTO bot_signal_outcomes VALUES(?,?,?,?,?,?)');
  const rows=[[1,'mizan-direction-v1','us','AAA','up',1],[2,'mizan-direction-v1','us','BBB','up',0],[3,'mizan-direction-v1','us','CCC','up',1],[4,'screener','us','AAA','up',1],[5,'screener','us','BBB','up',null],[6,'mizan-direction-v1','us','DDD','down',0]];
  for(const [i,src,m,sym,dir,up] of rows){ins.run(i,'k'+i,src,'v1',m,sym,5,dir,'2026-11-01T00:00:00Z');if(up!==null)out.run(i,'2026-11-08T00:00:00Z',100,up?105:95,up,5);}
  const sc=await Q.sourceScorecard(db);const miz=sc.find(s=>s.source==='mizan-direction-v1'),scr=sc.find(s=>s.source==='screener');
  assert.equal(sc.length,2);assert.equal(miz.signals,4);assert.equal(miz.upCalls,3);assert.equal(miz.resolved,3);assert.ok(Math.abs(miz.hitRatePct-200/3)<1e-9);
  assert.equal(scr.signals,2);assert.equal(scr.resolved,1);assert.equal(scr.hitRatePct,100);
  assert.ok(Math.abs(miz.baselineUpPct-60)<1e-9);                   // 3 of the 5 resolved outcomes (same market+horizon) rose
  assert.ok(Math.abs(miz.edgePct-(200/3-60))<1e-9);assert.equal((await Q.listSignals(db)).length,6);
});

test('CSV: UTF-8 BOM, quoting, formula neutralisation; per-experiment tables need an experiment',async()=>{
  const csv=Q.toCsv([{a:'سهم, "x"',b:'=SUM(A1)',c:-5,d:{k:1}}]);
  assert.ok(csv.startsWith('﻿"a","b","c","d"\r\n'));assert.ok(csv.includes('"سهم, ""x"""'));assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"-5"'));assert.ok(csv.includes('"{""k"":1}"'));
  const {db}=make();await assert.rejects(()=>Q.exportRows(db,'orders'),/experiment_required/);assert.deepEqual(await Q.exportRows(db,'scorecard'),[]);
  for(const t of Q.EXPORT_TABLES)assert.ok(typeof t==='string');
});
