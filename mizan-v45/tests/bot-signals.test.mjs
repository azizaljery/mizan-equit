import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const m=await import(process.env.MIZAN_TEST_MODULE),S=m.botSignals;
const NOW=Date.parse('2026-11-12T10:00:00Z'),iso=ms=>new Date(ms).toISOString();
function d1(raw){return {prepare(sql){const st=raw.prepare(sql);return {bind:(...v)=>({all:async()=>({results:st.all(...v)}),first:async()=>st.get(...v)??null,run:async()=>({meta:{changes:Number(st.run(...v).changes)}})})};}};}
function setup(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE forecast_records(id TEXT PRIMARY KEY,snapshot_id TEXT,symbol TEXT,created_at TEXT,horizon INTEGER,model TEXT,market TEXT,sector TEXT,confidence TEXT,available INTEGER,data TEXT);
   CREATE TABLE daily_picks(id TEXT PRIMARY KEY,pick_date TEXT,market TEXT,horizon INTEGER,symbol TEXT,rank INTEGER,universe_size INTEGER,percentile REAL,mom126_5 REAL,in_top INTEGER,ref_price REAL,ref_price_date TEXT,currency TEXT,mizan_predicted_price REAL,mizan_forecast_id TEXT,model_version TEXT,protocol_commit TEXT,created_at TEXT);
   CREATE TABLE screener_picks(run_id TEXT,market TEXT,rank INTEGER,forecast_id TEXT);
   CREATE TABLE aziz_monitor_records(id TEXT PRIMARY KEY,symbol TEXT,market TEXT,issued_at TEXT,available_at TEXT,horizon INTEGER,base_price REAL,currency TEXT,status TEXT,data TEXT);`);
  raw.exec(readFileSync('drizzle/0018_paper_bot.sql','utf8'));raw.exec(readFileSync('drizzle/0019_bot_signals.sql','utf8'));
  return {raw,db:d1(raw)};
}
const call=(direction,votes,extra={})=>({policy:'mizan-direction-v1',direction,strength:'متوسطة',votes,components:[],typicalMovePct:2,targetPrice:103,experimental:true,...extra});
function addForecast(raw,id,symbol,horizon,ageMs,callObj,o={}){raw.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'snap',symbol,iso(NOW-ageMs),horizon,'m',o.market??'us','s',o.confidence??'منخفض',o.available??1,
  JSON.stringify({recordClass:o.recordClass??'prospective-public',price:100,predictedPrice:100.1,model:'m',...(callObj?{call:callObj}:{})}));}

test('signalKey is deterministic and signal ids are stable',()=>{
  const s={source:'a',sourceVersion:'v1',market:'us',symbol:'AAA',horizon:5,issuedAt:'2026-11-12T09:00:00Z',forecastId:'f1'};
  assert.equal(S.signalKey(s),'a|v1|us|AAA|5|f1');assert.equal(S.signalKey({...s,forecastId:null}),'a|v1|us|AAA|5|2026-11-12T09:00:00Z');
  assert.equal(S.signalId(S.signalKey(s)),S.signalId(S.signalKey(s)));assert.notEqual(S.signalId('x'),S.signalId('y'));
});
test('agreement: single source, agree, disagree; one vote per source (the latest wins); neutral against up disagrees',()=>{
  const g=(source,direction,issuedAt='2026-11-12T09:00:00Z')=>({source,direction,issuedAt});
  assert.equal(S.agreement([]),'single');assert.equal(S.agreement([g('a','up')]),'single');
  assert.equal(S.agreement([g('a','up'),g('a','down','2026-11-12T10:00:00Z')]),'single');
  assert.equal(S.agreement([g('a','up'),g('b','up')]),'agree');assert.equal(S.agreement([g('a','up'),g('b','down')]),'disagree');
  assert.equal(S.agreement([g('a','up'),g('b','neutral')]),'disagree');
  assert.equal(S.agreement([g('a','down'),g('a','up','2026-11-12T10:00:00Z'),g('b','up')]),'agree');
});
test('evaluateSignal: reference close on/before issue date, end close `horizon` sessions later, null until the horizon has elapsed',()=>{
  const px=[['2026-11-02',100],['2026-11-03',101],['2026-11-04',102],['2026-11-05',103],['2026-11-06',104],['2026-11-09',99],['2026-11-10',98]].map(([date,close])=>({date,close}));
  const o=S.evaluateSignal({issuedAt:'2026-11-03T15:00:00Z',horizon:5},px);
  assert.deepEqual([o.startPrice,o.endPrice,o.up,o.resolvedAt,o.horizonSessions],[101,98,0,'2026-11-10',5]);
  assert.ok(Math.abs(o.changePct-(98/101-1)*100)<1e-9);
  assert.equal(S.evaluateSignal({issuedAt:'2026-11-04T15:00:00Z',horizon:5},px),null);                    // horizon not elapsed yet
  assert.equal(S.evaluateSignal({issuedAt:'2026-11-01T00:00:00Z',horizon:1},px),null);                    // no reference close before issue date
  assert.equal(S.evaluateSignal({issuedAt:'2026-11-02T00:00:00Z',horizon:1},px).up,1);
  assert.equal(S.evaluateSignal({issuedAt:'2026-11-02T00:00:00Z',horizon:1},[{date:'2026-11-02',close:100},{date:'2026-11-03',close:100}]).up,0); // flat is not up
});
test('Mizan adapter: only public prospective available forecasts with a call, latest per symbol+horizon, fresh enough; text maps to a direction',()=>{
  const {raw,db}=setup();
  addForecast(raw,'f-old','AAA',5,3*3600000,call('هابط',-2));addForecast(raw,'f-new','AAA',5,3600000,call('صاعد',3));          // same key: latest wins
  addForecast(raw,'f-h1','AAA',1,3600000,call('صاعد',0));
  addForecast(raw,'f-stale','BBB',5,30*3600000,call('صاعد',4));addForecast(raw,'f-unavail','CCC',5,3600000,call('صاعد',4),{available:0});
  addForecast(raw,'f-priv','DDD',5,3600000,call('صاعد',4),{recordClass:'private'});addForecast(raw,'f-nocall','EEE',5,3600000,null);
  addForecast(raw,'f-sa','1060.SR',5,3600000,call('صاعد',4),{market:'sa'});addForecast(raw,'f-neu','NNN',5,3600000,call('محايد',0));
  return S.collectMizanSignals(db,'us',NOW).then(sig=>{
    const by=Object.fromEntries(sig.map(s=>[s.symbol+'|'+s.horizon,s]));
    assert.deepEqual(Object.keys(by).sort(),['AAA|1','AAA|5','NNN|5']);
    const a=by['AAA|5'];assert.equal(a.direction,'up');assert.equal(a.forecastId,'f-new');assert.equal(a.strength,3);assert.equal(a.confidence,'منخفض');assert.equal(a.source,'mizan-direction-v1');
    assert.equal(by['NNN|5'].direction,'neutral');assert.equal(by['AAA|5'].basis.experimental,true);
  });
});
test('daily-picks, screener and aziz adapters normalise their own records and never invent a direction',async()=>{
  const {raw,db}=setup();
  raw.prepare('INSERT INTO daily_picks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('p1','2026-11-12','us',5,'AAA',1,100,0.99,0.4,1,100,'2026-11-11','USD',null,'f-new','daily-momentum-1','c',iso(NOW-3600000));
  raw.prepare('INSERT INTO daily_picks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('p2','2026-11-12','us',5,'BBB',90,100,0.1,-0.4,0,50,'2026-11-11','USD',null,null,'daily-momentum-1','c',iso(NOW-3600000));
  let sig=await S.collectDailyPickSignals(db,'us',NOW);assert.equal(sig.length,1);assert.deepEqual([sig[0].symbol,sig[0].direction,sig[0].forecastId,sig[0].source],['AAA','up','f-new','daily-picks-momentum']);
  addForecast(raw,'f-s1','AAA',5,3600000,call('هابط',-3));addForecast(raw,'f-s2','BBB',5,3600000,null);
  raw.prepare('INSERT INTO screener_picks VALUES(?,?,?,?)').run('run1','us',1,'f-s1');raw.prepare('INSERT INTO screener_picks VALUES(?,?,?,?)').run('run1','us',2,'f-s2');
  sig=await S.collectScreenerSignals(db,'us',NOW);const s=Object.fromEntries(sig.map(x=>[x.symbol,x]));
  assert.equal(s.AAA.direction,'down');assert.equal(s.BBB.direction,'neutral');assert.equal(s.BBB.strength,null);       // no call => neutral, never "up" by nomination alone
  raw.prepare('INSERT INTO aziz_monitor_records VALUES(?,?,?,?,?,?,?,?,?,?)').run('az1','AAA','us',iso(NOW-3600000),iso(NOW-3600000),5,100,'USD','pilot_untrained',JSON.stringify({kind:'aziz-pilot-monitor-v1',direction:'محايد يميل للهبوط',expectedClose:99}));
  sig=await S.collectAzizSignals(db,'us',NOW);assert.equal(sig.length,1);assert.equal(sig[0].direction,'neutral');assert.equal(sig[0].sourceVersion,'aziz-pilot-monitor-v1');
  raw.exec('DROP TABLE aziz_monitor_records');assert.deepEqual(await S.collectAzizSignals(db,'us',NOW),[]);              // absent source table => no Aziz signals, no failure
  assert.equal(S.BOT_SCAN_ENABLED,false);
});
test('recording is idempotent and append-only; sources stay separate; decision links carry the agreement state',async()=>{
  const {raw,db}=setup();
  addForecast(raw,'f1','AAA',5,3600000,call('صاعد',3));
  raw.prepare('INSERT INTO daily_picks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('p1','2026-11-12','us',5,'AAA',1,100,0.99,0.4,1,100,'2026-11-11','USD',null,'f1','daily-momentum-1','c',iso(NOW-1800000));
  const sigs=await S.collectAllSignals(db,'us',NOW);assert.equal(sigs.length,2);
  let r=await S.recordSignals(db,sigs,iso(NOW));assert.equal(r.inserted,2);
  r=await S.recordSignals(db,sigs,iso(NOW+60000));assert.equal(r.inserted,0);                                              // a repeated step adds nothing
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM bot_signals').get().c,2);assert.equal(r.stored.length,2);
  assert.throws(()=>raw.exec("UPDATE bot_signals SET direction='down'"),/immutable/);assert.throws(()=>raw.exec('DELETE FROM bot_signals'),/append_only/);
  raw.exec(`INSERT INTO bot_strategies VALUES('s1','v','2026-11-12T00:00:00Z','{}','fp','');INSERT INTO bot_experiments VALUES('e1','x','us','USD',1,'s1','dry_run','running','2026-11-12T00:00:00Z','2026-11-12T00:00:00Z',NULL,'{}');
   INSERT INTO bot_decisions VALUES('d1','e1','k1','2026-11-12T10:00:00Z','AAA',5,'buy','r','f1',NULL,'m','bot-strategy-1','{}')`);
  assert.equal(await S.linkDecisionSignals(db,'d1',r.stored),'agree');await S.linkDecisionSignals(db,'d1',r.stored);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM bot_decision_signals WHERE decision_id='d1' AND agreement='agree'").get().c,2);
  assert.throws(()=>raw.exec("UPDATE bot_decision_signals SET agreement='disagree'"),/immutable/);
  // outcomes: pending until the horizon elapses, written once
  const px=[...Array(8)].map((_,i)=>({date:`2026-11-${String(12+i).padStart(2,'0')}`,close:100+i}));
  assert.equal((await S.pendingSignals(db,'us')).length,2);
  const sig0=r.stored[0];
  assert.equal(await S.recordOutcome(db,sig0.id,sig0,px.slice(0,3)),null);
  const o=await S.recordOutcome(db,sig0.id,sig0,px);assert.equal(o.up,1);await S.recordOutcome(db,sig0.id,sig0,px);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM bot_signal_outcomes').get().c,1);assert.equal((await S.pendingSignals(db,'us')).length,1);
  assert.throws(()=>raw.exec('UPDATE bot_signal_outcomes SET up=0'),/immutable/);assert.throws(()=>raw.exec('DELETE FROM bot_signal_outcomes'),/append_only/);
  const rows=await S.scoreRows(db);assert.equal(rows.length,2);assert.equal((await S.scoreRows(db,'sa')).length,0);
});
test('scorecard is per source+version+market+horizon, never merged; baseline and edge are separate; small samples are flagged',()=>{
  const row=(source,symbol,issued,direction,up,v='v1')=>({source,sourceVersion:v,market:'us',symbol,horizon:5,direction,issuedAt:issued+'T09:00:00Z',up});
  const rows=[];
  for(let i=0;i<40;i++)rows.push(row('A','S'+i,'2026-10-01','up',i<26?1:0));                  // A: 26/40 = 65% on up calls
  for(let i=0;i<40;i++)rows.push(row('B','S'+i,'2026-10-01',i<20?'up':'neutral',i<26?1:0));    // B: 20 up calls, same names/dates
  rows.push(row('B','Z1','2026-10-02','up',null),row('C','Z9','2026-10-02','down',0));
  const sc=S.scorecard(rows),by=Object.fromEntries(sc.map(s=>[s.source,s]));
  assert.equal(sc.length,3);
  assert.deepEqual([by.A.signals,by.A.resolved,by.A.upCallsResolved,by.A.upCallHits],[40,40,40,26]);
  assert.ok(Math.abs(by.A.hitRate-0.65)<1e-12);assert.equal(by.A.smallSample,false);assert.equal(by.A.note,'');
  assert.ok(Math.abs(by.A.baselineUpRate-26/41)<1e-12||Math.abs(by.A.baselineUpRate-(26+0)/41)<1e-12);                // 41 distinct symbol+date resolved (S0..S39 + Z9)
  assert.ok(Math.abs(by.A.edge-(0.65-by.A.baselineUpRate))<1e-12);assert.ok(by.A.ci95[0]<0.65&&by.A.ci95[1]>0.65);
  assert.equal(by.B.upCalls,21);assert.equal(by.B.upCallsResolved,20);assert.equal(by.B.smallSample,true);assert.match(by.B.note,/عينة/);
  assert.equal(by.C.hitRate,null);assert.equal(by.C.upCalls,0);assert.equal(by.C.note,'لا نتائج محسومة بعد');
  assert.equal(S.scorecard([row('A','X','2026-10-01','up',1,'v1'),row('A','Y','2026-10-01','up',0,'v2')]).length,2);        // versions never merged
});
