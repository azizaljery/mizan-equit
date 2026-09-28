import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m=await import(process.env.MIZAN_TEST_MODULE);

function fixture(){
 const sqlite=new DatabaseSync(':memory:'),sqls=[];
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,values=[])=>({bind(...v){return prepare(sql,v)},execute(){sqls.push(sql);return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}},async run(){return this.execute()},async first(){sqls.push(sql);return sqlite.prepare(sql).get(...values)},async all(){sqls.push(sql);return {results:sqlite.prepare(sql).all(...values)}}});
 const db={prepare,async batch(rows){sqlite.exec('BEGIN');try{const result=rows.map(r=>r.execute());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 return {db,sqlite,sqls};
}
const observation=(id,currency='USD',state='complete')=>({id,symbol:'AAPL',model:'m1',horizon:5,currency,state,reason:null,anchorDate:'2026-01-01',actualDate:state==='complete'?'2026-01-08':null,directionCorrect:state==='complete',rangeHit:state==='complete',absoluteError:state==='complete'?2:null,relativeErrorPct:state==='complete'?1.5:null,netAssetReturn:state==='complete'?-0.02:null,netBenchmarkReturn:state==='complete'?-0.01:null});
function run(runId,model='m1',minSessions=200,observations=[observation(runId)]){
 const config={runId,symbols:['AAPL'],startDate:'2026-01-01',endDate:'2026-06-01',horizons:[5],costs:{commissionBps:5,slippageBps:10,doubleSided:true},minSessions,model};
 return {kind:'mizan-issued-forecast-audit-v1',runId,startedAt:'2026-06-02T00:00:00.000Z',completedAt:'2026-06-02T00:00:01.000Z',config,byHorizon:m.summarizeBacktest(observations,[5]),observations,symbolsFailed:[],symbolsSucceeded:1,symbols:[],limitations:[],persisted:true,reused:false};
}

test('Aggregate uses the live summarizer contract, complete configuration signature and metric denominators',()=>{
 const first=run('one','m1',200,[observation('usd'),observation('pending','USD','pending')]);
 const differentModel=run('two','m2',200,[observation('sar','SAR')]);
 const differentMinimum=run('three','m1',201,[observation('usd2')]);
 const duplicate={...run('four','m1',200,[observation('ignored')]),completedAt:'2026-06-01T00:00:00.000Z'};
 const aggregate=m.aggregateBacktests([first,differentModel,differentMinimum,duplicate],{summarizeFn:r=>({byHorizon:m.summarizeBacktest(r.observations,r.config.horizons)})});
 assert.equal(aggregate.runsUsed,3);assert.equal(aggregate.duplicatesSkipped,1);assert.equal(aggregate.duplicateReasons['same-signature'],1);
 const h=aggregate.byHorizon[0];assert.equal(h.totalSamples,4);assert.equal(h.totalPending,1);assert.equal(h.directionCount,3);assert.equal(h.rangeCount,3);assert.equal(h.pointCount,3);assert.equal(h.returnCount,3);assert.equal(h.benchmarkCount,3);
 assert.equal(h.maeByCurrency.USD.pointCount,2);assert.equal(h.maeByCurrency.USD.weightedMae,2);assert.equal(h.maeByCurrency.SAR.pointCount,1);
 assert.equal(h.meanRelativeErrorPct.count,3);assert.match(aggregate.notes.join(' '),/لا يثبت استقلال المشاهدات/);
 assert.throws(()=>m.aggregateBacktests([first],{summarizeFn:m.summarizeBacktest}),/byHorizon/);
});

test('Backtest exports keep numeric negatives numeric, protect formula text and emit real currency counts',()=>{
 const source=run('run/unsafe');source.symbolsFailed=[{symbol:'BAD',reason:'  =HYPERLINK("x")'}];
 source.byHorizon[0].meanReturn=-2;
 const sections=m.backtestToSections(source),currency=sections.find(s=>s.name==='currency_mae'),failed=sections.find(s=>s.name==='failed_symbols');
 assert.deepEqual(currency.header,['run_id','horizon','currency','point_count','mae']);assert.deepEqual(currency.rows[0].slice(2),['USD',1,2]);
 const horizonCsv=m.backtestToCsv(source);assert.ok(horizonCsv.startsWith('\uFEFF'));assert.ok(horizonCsv.includes('"-2"'));assert.ok(!horizonCsv.includes('"\'-2"'));
 const failedCsv=m.renderSectionCsv(failed);assert.ok(failedCsv.includes("'  =HYPERLINK"));assert.ok(!failedCsv.includes('[object Object]'));
 assert.equal(m.suggestedFileName(source,'currency/mae','csv'),'run_unsafe__currency_mae.csv');
});

test('Retention preview is read-only, counts malformed JSON and validates bounds',async()=>{
 const {db,sqlite,sqls}=fixture();try{
  for(let i=0;i<2;i++){
   const id='forecast-'+i,snapshot='snapshot-'+i;
   sqlite.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').run(snapshot,'AAPL','2019-01-01','{}');
   sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,snapshot,'AAPL','2019-01-01',5,'m1','us','tech','low',1,'{}');
   sqlite.prepare('INSERT INTO forecast_outcomes VALUES(?,?,?)').run(id,'2020-01-0'+(i+1),i?'{bad':JSON.stringify({state:'complete'}));
  }
  for(let i=0;i<12;i++)sqlite.prepare('INSERT INTO backtest_runs VALUES(?,?,?,?)').run('run-'+String(i).padStart(2,'0'),'AAPL','2020-01-'+String(i+1).padStart(2,'0'),i===0?'{bad':JSON.stringify({symbolsSucceeded:i}));
  const before={outcomes:sqlite.prepare('SELECT * FROM forecast_outcomes ORDER BY id').all(),runs:sqlite.prepare('SELECT * FROM backtest_runs ORDER BY id').all()};sqls.length=0;
  const preview=await m.previewRetention(db,{days:90,keepRuns:10});
  assert.equal(preview.outcomes.totalCandidates,2);assert.equal(preview.outcomes.invalidJson,1);assert.equal(preview.outcomes.samples[1].jsonValid,false);
  assert.equal(preview.backtests.totalCandidates,2);assert.equal(preview.backtests.invalidJson,1);assert.equal(preview.backtests.samples[0].jsonValid,false);
  assert.deepEqual(sqlite.prepare('SELECT * FROM forecast_outcomes ORDER BY id').all(),before.outcomes);assert.deepEqual(sqlite.prepare('SELECT * FROM backtest_runs ORDER BY id').all(),before.runs);
  assert.ok(sqls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|DROP)/i.test(sql)));
  for(const options of [{days:NaN},{days:6},{days:7.5},{keepRuns:9},{keepRuns:Infinity},{unknown:1}])await assert.rejects(m.previewRetention(db,options));
 }finally{sqlite.close()}
});

test('Heartbeat confirms writes and distinguishes missing, invalid JSON and read failure',async()=>{
 const {db,sqlite}=fixture();try{
  assert.deepEqual(await m.readArrival(db),{status:'missing'});
  const saved=await m.pingArrival(db,true,'run-heartbeat');assert.equal(saved.ok,true);
  const read=await m.readArrival(db);assert.equal(read.status,'ok');assert.equal(read.record.runId,'run-heartbeat');
  sqlite.prepare('UPDATE research_state SET data=? WHERE id=?').run('{bad',m.HEARTBEAT_ARRIVAL_ID);assert.equal((await m.readArrival(db)).status,'invalid');
  const unavailable={prepare(){throw Error('secret')}};assert.deepEqual(await m.readArrival(unavailable),{status:'read-failed'});
  assert.equal((await m.pingArrival(db,true,'run-heartbeat')).ok,true);
  assert.equal((await m.pingEvaluation(db,'run-heartbeat',true,{state:'partial',symbolsScanned:2,symbolsResolved:1,symbolsSkipped:0,symbolsFailed:1,evaluationsSaved:1,durationMs:20,stateSaved:true})).ok,true);
  assert.equal((await m.verifyHeartbeatState(db)).status,'partial');
 }finally{sqlite.close()}
});
