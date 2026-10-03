import assert from 'node:assert/strict';
import {createHash,randomInt,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,copyFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const BASELINE='18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241';
const MANIFEST_SHA='5fdf6dd6273c7765252495f6f960f74ad82592e619f583a24bd4d5bec03923bb';
const SEED_ID='P2-TRUST-SEED-V1';
const SEED_SHA='ffe716976c5582eff379c989d11eaf731da538d328b9c6f5963f105a01f3be6d';
const root=resolve(new URL('..',import.meta.url).pathname);
const artifacts=resolve(new URL('.',import.meta.url).pathname);
const sourceRoot=join(root,'mizan-v45');
const seed=JSON.parse(await readFile(join(artifacts,'frozen-seed-v1.json'),'utf8'));
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
const seedDigest=createHash('sha256').update(canonical(seed)).digest('hex');
assert.equal(seedDigest,SEED_SHA,'Frozen seed digest changed');
assert.equal(seed.portfolioId,'P2-TRUST-PORTFOLIO-001');
assert.equal(seed.instrument,'SYNTH-SAR-001');

// Freeze application time locally at the beginning of the frozen seed; OS time remains unchanged.
const RealDate=globalThis.Date;
const fixedMs=RealDate.parse('2026-10-03T00:00:00.000Z');
class FixedDate extends RealDate {
  constructor(...args){super(...(args.length?args:[fixedMs]));}
  static now(){return fixedMs;}
}
globalThis.Date=FixedDate;

const mod=await import(process.env.MIZAN_TEST_MODULE);
const {DatabaseSync}=await import('node:sqlite');
const digestText=x=>createHash('sha256').update(x).digest('hex');
const digestBytes=x=>createHash('sha256').update(x).digest('hex');
function derivedUuid(logicalId){
  const bytes=createHash('sha256').update(`${SEED_ID}:${logicalId}`,'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const h=bytes.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
function dbAdapter(sqlite){
  const prepare=(sql,values=[])=>({
    bind(...args){return prepare(sql,args);},
    async run(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)},changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid||0)};},
    async first(){return sqlite.prepare(sql).get(...values)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...values)};}
  });
  return {prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
async function openDb(path,{migrate=false}={}){
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON');
  if(migrate){
    const journal=JSON.parse(await readFile(join(sourceRoot,'drizzle/meta/_journal.json'),'utf8'));
    for(const entry of journal.entries){
      const sql=await readFile(join(sourceRoot,'drizzle',`${entry.tag}.sql`),'utf8');
      sqlite.exec(sql);
    }
  }
  return {sqlite,db:dbAdapter(sqlite)};
}
const responseJson=async response=>({status:response.status,body:await response.json()});
const ownerEmail='p2-owner-fixture@example.test';
mod.testRuntime.RECOMMENDATION_OWNER_EMAIL=ownerEmail;
function makeRequest(body,token=null,method='POST'){
  const headers={origin:'http://127.0.0.1','content-type':'application/json','oai-authenticated-user-email':ownerEmail};
  if(token)headers['x-mizan-portfolio-token']=token;
  return new Request('http://127.0.0.1/api/research',{method,headers,...(body?{body:JSON.stringify(body)}:{})});
}
async function post(db,body,token=null){mod.testRuntime.DB=db;return responseJson(await mod.researchPOST(makeRequest(body,token)));}
async function get(db,portfolioId,token){mod.testRuntime.DB=db;const url=`http://127.0.0.1/api/research?portfolio=${encodeURIComponent(portfolioId)}`;const response=await mod.researchGET(new Request(url,{headers:{'oai-authenticated-user-email':ownerEmail,'x-mizan-portfolio-token':token}}));return responseJson(response);}
const uuidPattern=/^[a-f0-9-]{36}$/;
const uuidMap=Object.fromEntries([...seed.events.filter(e=>e.side==='buy'||e.side==='sell').map(e=>e.id),'P2-TRUST-TRADE-OUT-OF-ORDER-001'].map(id=>[id,derivedUuid(id)]));
assert.equal(new Set(Object.values(uuidMap)).size,Object.keys(uuidMap).length);
assert.ok(Object.values(uuidMap).every(v=>uuidPattern.test(v)));
const events=seed.events.filter(e=>e.side==='buy'||e.side==='sell');
assert.equal(events.length,4);
const precisionTolerance=1e-9;
const close=(actual,expected,label)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<=precisionTolerance,`${label}: expected ${expected}; actual ${actual}`);
const findPosition=summary=>summary.positions.find(p=>p.symbol===seed.instrument&&p.currency===seed.currency);
function ledgerProjection(body){
  const b=body.body;
  return {
    activePortfolio:{id:b.activePortfolio?.id,name:b.activePortfolio?.name,currency:b.activePortfolio?.currency,createdAt:b.activePortfolio?.createdAt,updatedAt:b.activePortfolio?.updatedAt},
    trades:(b.trades||[]).map(t=>({id:t.id,portfolioId:t.portfolioId,sequence:t.sequence,symbol:t.symbol,side:t.side,quantity:t.quantity,price:t.price,currency:t.currency,createdAt:t.createdAt,forecastId:t.forecastId??null,forecastSnapshot:t.forecastSnapshot??null})),
    cashEntries:(b.cashEntries||[]).map(c=>({id:c.id,portfolioId:c.portfolioId,cashType:c.cashType,amount:c.amount,currency:c.currency,createdAt:c.createdAt})),
    summary:(()=>{const p=findPosition(b.portfolioSummary);return {cash:b.portfolioSummary?.cash,units:p?.quantity,averageCost:p?.averageCost??null,cost:p?.cost,realizedPnl:b.portfolioSummary?.realized,unrealizedPnl:b.portfolioSummary?.unrealized,marketValue:b.portfolioSummary?.marketValue,totalValue:b.portfolioSummary?.totalValue};})()
  };
}
function stableRow(row){const out={};for(const key of Object.keys(row).sort())out[key]=row[key];return out;}
function hashRows(rows){return digestText(rows.map(stableRow).map(canonical).sort().join('\n'));}
function dataRows(sqlite,table,select,params=[]){return sqlite.prepare(select||`SELECT * FROM "${table}"`).all(...params).map(stableRow);}
function schemaSnapshot(sqlite){return sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(stableRow);}
function tableCounts(sqlite){
  const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  return Object.fromEntries(tables.map(name=>[name,Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n)]));
}
function safeDomainSnapshot(sqlite,portfolioId){
  const portfolio=dataRows(sqlite,'paper_portfolios','SELECT id,name,currency,created_at,updated_at,data FROM paper_portfolios WHERE id=?',[portfolioId]).map(stableRow);
  const cash=dataRows(sqlite,'paper_cash_entries','SELECT id,portfolio_id,cash_type,amount,currency,created_at,data FROM paper_cash_entries WHERE portfolio_id=? ORDER BY created_at,id',[portfolioId]).map(stableRow);
  const trades=dataRows(sqlite,'paper_trades','SELECT rowid AS ledger_sequence,id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE portfolio_id=? ORDER BY created_at,rowid',[portfolioId]).map(stableRow);
  const sessions=dataRows(sqlite,'paper_portfolio_sessions','SELECT portfolio_id,expires_at,created_at FROM paper_portfolio_sessions WHERE portfolio_id=? ORDER BY created_at,portfolio_id',[portfolioId]).map(stableRow);
  return {portfolio,cash,trades,sessionsWithoutTokenDigest:sessions,hashes:{portfolio:hashRows(portfolio),cash:hashRows(cash),trades:hashRows(trades),sessionsWithoutTokenDigest:hashRows(sessions)}};
}
function validForeignLinks(sqlite,portfolioId){
  const portfolio=sqlite.prepare('SELECT id FROM paper_portfolios WHERE id=?').get(portfolioId);
  const trades=sqlite.prepare('SELECT id,portfolio_id,data FROM paper_trades WHERE portfolio_id=? ORDER BY created_at,rowid').all(portfolioId);
  const cash=sqlite.prepare('SELECT id,portfolio_id FROM paper_cash_entries WHERE portfolio_id=? ORDER BY created_at,id').all(portfolioId);
  const tradeLinks=trades.map(row=>{const d=JSON.parse(row.data);return {id:row.id,portfolioId:row.portfolio_id,forecastId:d.forecastId??null,purchaseForecastIds:(d.purchaseForecast?.rows||[]).map(r=>r.id)};});
  return {portfolioExists:!!portfolio,allTradePortfolioRefsResolve:trades.every(r=>r.portfolio_id===portfolioId),allCashPortfolioRefsResolve:cash.every(r=>r.portfolio_id===portfolioId),trades:tradeLinks,allForecastRefsExplicitlyNullOrPresent:tradeLinks.every(t=>t.forecastId===null||!!sqlite.prepare('SELECT id FROM forecast_records WHERE id=?').get(t.forecastId))};
}
const temporaryRoot=await mkdtemp(join(tmpdir(),`mizan-p2-trust-ledger-${process.pid}-`));
const dbPath=join(temporaryRoot,'portfolio-ledger.sqlite'),backupPath=join(temporaryRoot,'portfolio-ledger.snapshot.sqlite'),restorePath=join(temporaryRoot,'portfolio-ledger-restored.sqlite');
let opened=null,restored=null,portfolioId=null,portfolioToken=null;
const result={
  evidenceIds:['EVD-TRUST-P2-02-PORTFOLIO','EVD-TRUST-P2-03-LEDGER'],
  baselineCommit:BASELINE,canonicalSourceManifestSha256:MANIFEST_SHA,
  capturedAt:new RealDate().toISOString(),frozenClock:'2026-10-03T00:00:00.000Z',
  fixture:{seedId:SEED_ID,canonicalSeedSha256:SEED_SHA,portfolioLogicalId:seed.portfolioId,instrument:seed.instrument,currency:seed.currency,fees:seed.fees,logicalIdToAppUuid:uuidMap,actualPortfolioId:null,generatedPortfolioId:true,markEventStoredAsTrade:false},
  independentArithmetic:{
    method:'manual weighted-average cost; no fees/taxes; no rounding before comparison',
    formulas:{firstLotBasis:'10×100 = 1000',secondLotBasis:'5×120 = 600',totalBasis:'1000 + 600 = 1600',weightedAverageCost:'1600/15 = 106.66666666666667',partialSaleRealized:'4×130 − 4×(1600/15) = 280/3 = 93.33333333333333',remainingBasis:'(1600/15)×11 = 3520/3 = 1173.3333333333333',markValue:'11×110 = 1210',markedUnrealized:'1210 − 3520/3 = 110/3 = 36.66666666666667',finalLotRealized:'11×110 − 3520/3 = 110/3 = 36.66666666666667',cumulativeRealized:'280/3 + 110/3 = 130',finalCash:'10000 − 1000 − 600 + 520 + 1210 = 10130'},
    checkpointExpectations:[
      {checkpoint:'opening',cash:10000,units:0,averageCost:null,realizedPnl:0,unrealizedPnl:0},
      {checkpoint:'afterFirstBuy',cash:9000,units:10,averageCost:100,realizedPnl:0,unrealizedPnl:null,unrealizedState:'not_marked; no quote supplied'},
      {checkpoint:'afterTwoBuys',cash:8400,units:15,averageCost:1600/15,realizedPnl:0,unrealizedPnl:null,unrealizedState:'not_marked; no quote supplied'},
      {checkpoint:'afterPartialSale',cash:8920,units:11,averageCost:1600/15,realizedPnl:280/3,unrealizedPnl:null,unrealizedState:'not_marked; no quote supplied'},
      {checkpoint:'atFrozenMark',mark:110,cash:8920,units:11,averageCost:1600/15,realizedPnl:280/3,unrealizedPnl:110/3},
      {checkpoint:'afterFullSale',cash:10130,units:0,averageCost:null,realizedPnl:130,unrealizedPnl:0}
    ]
  },
  actual:{checkpoints:[],tradeCountAfterEachWrite:[],retry:null,orderingProbe:null,restore:null},
  environment:{runtime:process.version,nodeExecutable:process.execPath,storage:'fresh file-backed local SQLite via node:sqlite; all 16 canonical migrations',externalNetworkUsed:false,productionOrCloudflareUsed:false,temporaryStateDeletedAfterRun:true},
  harnessNotes:['A first preflight assertion compared raw seed ISO strings with the application’s normalized ISO strings including milliseconds; this harness-only comparison was corrected to compare the same UTC instant before the passing rerun.'],
  limitations:['P2-01 remains PARTIAL outside this work package; this synthetic local test is independent of production identity and D2.','The source migrations seed the legacy placeholder portfolio and baseline rows in other modules; those bootstrap rows were left untouched, no out-of-scope APIs were exercised, and the temporary database was removed after validation.','No quotes are specified in the frozen seed before 00:00:05Z; the application GET returns unrealized P&L as unavailable/null before the frozen mark, which is reported rather than imputed.','Database restore uses Node SQLite serialize() snapshot after quiesced writes, then copies the snapshot bytes to a new local file path; no production/E-002/E-003 state was used.']
};
try{
  assert.equal(mod.validSymbol(seed.instrument),true,'Synthetic instrument identifier must be accepted by route without fetching market data');
  const pin=String(randomInt(0,1_000_000)).padStart(6,'0');
  opened=await openDb(dbPath,{migrate:true});
  const migrations=JSON.parse(await readFile(join(sourceRoot,'drizzle/meta/_journal.json'),'utf8')).entries.length;
  assert.equal(migrations,16);
  mod.testRuntime.DB=opened.db;
  const created=(await post(opened.db,{action:'portfolio_create',name:'P2 Trust Synthetic 001',currency:seed.currency,pin,capital:seed.openingCash}));
  assert.equal(created.status,200,JSON.stringify(created.body));
  portfolioId=created.body.portfolio.id;portfolioToken=created.body.token;
  assert.ok(uuidPattern.test(portfolioId));
  result.fixture.actualPortfolioId=portfolioId;
  assert.equal(created.body.portfolio.currency,seed.currency);
  const openingLedger=opened.sqlite.prepare('SELECT id,portfolio_id,amount,currency,created_at FROM paper_cash_entries WHERE portfolio_id=?').get(portfolioId);
  assert.ok(openingLedger,'Opening cash entry missing');
  result.fixture.openingCashLedgerId=openingLedger.id;
  const openingGet=await get(opened.db,portfolioId,portfolioToken);
  assert.equal(openingGet.status,200,JSON.stringify(openingGet.body));
  const openingSummary=openingGet.body.portfolioSummary;
  assert.equal(openingSummary.positions.length,0,'Opening portfolio should have no position');
  close(openingSummary.cash,seed.openingCash,'opening cash');
  close(openingSummary.realized,0,'opening realized P&L');
  close(openingSummary.unrealized,0,'opening unrealized P&L');
  result.actual.checkpoints.push({checkpoint:'opening',cash:openingSummary.cash,units:0,averageCost:null,realizedPnl:openingSummary.realized,unrealizedPnl:openingSummary.unrealized,unrealizedState:'no holdings'});

  const eventInput=new Map(events.map(e=>[e.id,e]));
  const checkpointFor=async(name,expected,{markQuote=null}={})=>{
    const got=await get(opened.db,portfolioId,portfolioToken);
    assert.equal(got.status,200,JSON.stringify(got.body));
    const projection=ledgerProjection(got);
    assert.equal(projection.activePortfolio.id,portfolioId);
    assert.equal(projection.trades.length,opened.sqlite.prepare('SELECT COUNT(*) AS n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
    const p=got.body.portfolioSummary.positions.find(v=>v.symbol===seed.instrument&&v.currency===seed.currency);
    if(expected.units===0){assert.equal(p?.quantity??0,0);assert.equal(p?.averageCost??null,null);}else{assert.ok(p);close(p.quantity,expected.units,`${name} units`);close(p.averageCost,expected.averageCost,`${name} averageCost`);}
    close(got.body.portfolioSummary.cash,expected.cash,`${name} cash`);
    close(got.body.portfolioSummary.realized,expected.realizedPnl,`${name} realized`);
    if(expected.unrealizedPnl===null){assert.equal(got.body.portfolioSummary.unrealized,null,`${name} should have no mark in GET`);}else close(got.body.portfolioSummary.unrealized,expected.unrealizedPnl,`${name} unrealized`);
    const rawRow=opened.sqlite.prepare('SELECT id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE portfolio_id=? ORDER BY created_at,rowid').all(portfolioId).map(stableRow);
    const rowHashes=rawRow.map(row=>({id:row.id,sha256:digestText(canonical(row))}));
    const actual={checkpoint:name,cash:got.body.portfolioSummary.cash,units:p?.quantity??0,averageCost:p?.averageCost??null,cost:p?.cost??0,realizedPnl:got.body.portfolioSummary.realized,unrealizedPnl:got.body.portfolioSummary.unrealized,tradeIds:got.body.trades.map(t=>t.id),tradeRowHashes:rowHashes};
    if(markQuote){
      const markSummary=mod.paperPortfolioSummary(got.body.activePortfolio,got.body.trades,got.body.cashEntries,{[seed.instrument]:markQuote});
      const markP=markSummary.positions.find(v=>v.symbol===seed.instrument&&v.currency===seed.currency);
      close(markSummary.unrealized,expected.markUnrealized,`${name} frozen mark unrealized`);
      actual.mark={price:markQuote.price,currency:markQuote.currency,quoteTime:markQuote.quoteTime,marketValue:markP.marketValue,unrealizedPnl:markSummary.unrealized};
    }
    result.actual.checkpoints.push(actual);
    return got;
  };
  const openingAt=seed.events[0].at;
  for(let i=0;i<events.length;i++){
    const e=events[i];
    const body={action:'trade',id:uuidMap[e.id],portfolioId, symbol:seed.instrument,side:e.side,quantity:e.quantity,price:e.price,currency:seed.currency,createdAt:e.at,reason:'P2 synthetic ledger validation fixture',forecastId:null,companyName:'Synthetic Test Instrument',exchange:'SYNTHETIC'};
    const saved=await post(opened.db,body,portfolioToken);
    assert.equal(saved.status,200,`${e.id} POST: ${JSON.stringify(saved.body)}`);
    assert.equal(saved.body.trade.id,uuidMap[e.id]);
    assert.equal(saved.body.trade.forecastId??null,null);
    result.actual.tradeCountAfterEachWrite.push({logicalId:e.id,tradeId:saved.body.trade.id,side:e.side,quantity:e.quantity,price:e.price,createdAt:saved.body.trade.createdAt,count:Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n)});
    if(i===0){
      const beforeRetry=opened.sqlite.prepare('SELECT id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE id=?').get(uuidMap[e.id]);
      const beforeHash=digestText(canonical(stableRow(beforeRetry)));
      const countBefore=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      const retry=await post(opened.db,body,portfolioToken);
      assert.equal(retry.status,200);
      assert.equal(retry.body.trade.id,uuidMap[e.id]);
      const afterRetry=opened.sqlite.prepare('SELECT id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE id=?').get(uuidMap[e.id]);
      const afterHash=digestText(canonical(stableRow(afterRetry)));
      const countAfter=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      assert.equal(afterHash,beforeHash,'Exact same-ID retry changed persisted trade');
      assert.equal(countAfter,countBefore,'Exact same-ID retry duplicated trade');
      result.actual.retry={logicalId:e.id,httpStatus:retry.status,tradeCountBefore:countBefore,tradeCountAfter:countAfter,persistedRowSha256Before:beforeHash,persistedRowSha256After:afterHash,samePersistedRow:beforeHash===afterHash,exactlyOneLogicalTrade:true,credentialValuesRecorded:false};
    }
    if(i===1){
      const countBefore=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      const outOfOrder={...body,id:uuidMap['P2-TRUST-TRADE-OUT-OF-ORDER-001'],side:'sell',quantity:1,price:110,createdAt:'2026-10-03T00:00:01.500Z'};
      const rejected=await post(opened.db,outOfOrder,portfolioToken);
      const countAfter=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      assert.equal(rejected.status,400);
      assert.match(String(rejected.body.error||''),/بترتيب وقتها/);
      assert.equal(countAfter,countBefore,'Out-of-order event changed ledger');
      result.actual.orderingProbe={logicalId:outOfOrder.id,createdAt:outOfOrder.createdAt,httpStatus:rejected.status,expectedRejected:true,actualError:rejected.body.error,tradeCountBefore:countBefore,tradeCountAfter:countAfter,noMutation:countBefore===countAfter};
    }
    if(i===0){
      await checkpointFor('afterFirstBuy',{cash:9000,units:10,averageCost:100,realizedPnl:0,unrealizedPnl:null});
    }else if(i===1){
      await checkpointFor('afterTwoBuys',{cash:8400,units:15,averageCost:1600/15,realizedPnl:0,unrealizedPnl:null});
    }else if(i===2){
      await checkpointFor('afterPartialSale',{cash:8920,units:11,averageCost:1600/15,realizedPnl:280/3,unrealizedPnl:null});
      const markEvent=seed.events.find(v=>v.side==='mark');
      const countBefore=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      const marked=await checkpointFor('atFrozenMark',{cash:8920,units:11,averageCost:1600/15,realizedPnl:280/3,unrealizedPnl:null,markUnrealized:110/3},{markQuote:{price:markEvent.price,currency:seed.currency,quoteTime:markEvent.at}});
      const countAfter=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
      assert.equal(countAfter,countBefore,'Valuation mark must not be recorded as a trade');
      result.fixture.markEvent={logicalId:markEvent.id,at:markEvent.at,price:markEvent.price,storedAsTrade:false};
    }else if(i===3){
      const got=await checkpointFor('afterFullSale',{cash:10130,units:0,averageCost:null,realizedPnl:130,unrealizedPnl:0});
      const finalMark=mod.paperPortfolioSummary(got.body.activePortfolio,got.body.trades,got.body.cashEntries,{[seed.instrument]:{price:110,currency:seed.currency,quoteTime:'2026-10-03T00:00:05Z'}});
      close(finalMark.unrealized,0,'closed position unrealized');
      result.actual.checkpoints.at(-1).unrealizedAtFrozenMark=finalMark.unrealized;
    }
  }
  assert.equal(openingAt,'2026-10-03T00:00:01Z');

  const countBeforeRetry=Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n);
  const first=events[0],body={action:'trade',id:uuidMap[first.id],portfolioId,symbol:seed.instrument,side:first.side,quantity:first.quantity,price:first.price,currency:seed.currency,createdAt:first.at,reason:'P2 synthetic ledger validation fixture',forecastId:null,companyName:'Synthetic Test Instrument',exchange:'SYNTHETIC'};
  const finalRetry=await post(opened.db,body,portfolioToken);
  assert.equal(finalRetry.status,200);
  assert.equal(Number(opened.sqlite.prepare('SELECT COUNT(*) n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n),countBeforeRetry);

  const duplicateSnapshot=ledgerProjection(await get(opened.db,portfolioId,portfolioToken));
  const repeatedReload=ledgerProjection(await get(opened.db,portfolioId,portfolioToken));
  assert.equal(canonical(duplicateSnapshot),canonical(repeatedReload),'Repeated reload produced different canonical ledger/accounting projection');
  const trades=opened.sqlite.prepare('SELECT rowid AS ledger_sequence,id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE portfolio_id=? ORDER BY created_at,rowid').all(portfolioId);
  assert.equal(trades.length,4);
  assert.equal(new Set(trades.map(r=>r.id)).size,4);
  assert.deepEqual(trades.map(r=>r.id),events.map(e=>uuidMap[e.id]));
  assert.ok(trades.every((r,i)=>r.portfolio_id===portfolioId&&r.created_at===new Date(events[i].at).toISOString()));
  assert.ok(trades.every((r,i)=>i===0||trades[i-1].created_at<r.created_at));
  const links=validForeignLinks(opened.sqlite,portfolioId);
  assert.equal(links.portfolioExists,true);
  assert.equal(links.allTradePortfolioRefsResolve,true);
  assert.equal(links.allCashPortfolioRefsResolve,true);
  assert.equal(links.allForecastRefsExplicitlyNullOrPresent,true);
  assert.ok(links.trades.every(t=>t.forecastId===null));
  const cashRows=opened.sqlite.prepare('SELECT id,portfolio_id,cash_type,amount,currency,created_at,data FROM paper_cash_entries WHERE portfolio_id=? ORDER BY created_at,id').all(portfolioId);
  assert.equal(cashRows.length,1);
  assert.equal(Number(cashRows[0].amount),seed.openingCash);
  const finalSummary=duplicateSnapshot.summary;
  close(finalSummary.cash,10130,'final reloaded cash');
  close(finalSummary.units,0,'final reloaded units');
  close(finalSummary.realizedPnl,130,'final reloaded realized');
  assert.equal(finalSummary.unrealizedPnl,0);
  const noSeedMutation=true;
  result.actual.finalLedger={tradeCount:trades.length,cashEntryCount:cashRows.length,tradeIds:trades.map(r=>r.id),tradeIdOrder:trades.map(r=>r.id),tradeTimes:trades.map(r=>r.created_at),ledgerSequences:trades.map(r=>Number(r.ledger_sequence)),allTradeIdsUnique:new Set(trades.map(r=>r.id)).size===trades.length,portfolioAndCashReferences:links,forecastIdsExplicitlyNull:links.trades.every(t=>t.forecastId===null),allCashTradingReferencesResolve:links.allCashPortfolioRefsResolve&&links.allTradePortfolioRefsResolve,repeatedReloadIdentical:true,seedUnchanged:noSeedMutation};

  const schemaBefore=schemaSnapshot(opened.sqlite),countsBefore=tableCounts(opened.sqlite),domainBefore=safeDomainSnapshot(opened.sqlite,portfolioId);
  const schemaHashBefore=hashRows(schemaBefore);
  const rowCountsBefore={...countsBefore};
  // Snapshot only after all mutations/retries have completed and the statement queue is idle.
  const backupBytes=opened.sqlite.serialize();
  assert.ok(backupBytes.length>0);
  await writeFile(backupPath,backupBytes);
  const backupSha=digestBytes(backupBytes);
  opened.sqlite.close();opened=null;
  await copyFile(backupPath,restorePath);
  const restoreBytes=await readFile(restorePath);
  assert.equal(digestBytes(restoreBytes),backupSha,'Restored file differs from backup bytes');
  restored=await openDb(restorePath);
  const schemaAfter=schemaSnapshot(restored.sqlite),countsAfter=tableCounts(restored.sqlite),domainAfter=safeDomainSnapshot(restored.sqlite,portfolioId);
  const schemaHashAfter=hashRows(schemaAfter);
  assert.equal(schemaHashAfter,schemaHashBefore,'Restored schema differs');
  assert.deepEqual(countsAfter,rowCountsBefore,'Restored table row counts differ');
  assert.deepEqual(domainAfter,domainBefore,'Restored synthetic domain rows/hashes differ');
  const relevantTables=['paper_portfolios','paper_cash_entries','paper_trades','paper_portfolio_sessions','forecast_records','forecast_outcomes'];
  const relevantRowCounts=Object.fromEntries(relevantTables.map(table=>[table,countsAfter[table]]));
  const allTableCountDigest=hashRows(Object.entries(countsAfter).map(([table,count])=>({table,count})));
  const integrity=restored.sqlite.prepare('PRAGMA integrity_check').all().map(r=>Object.values(r)[0]);
  const fkViolations=restored.sqlite.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(integrity,['ok']);
  assert.equal(fkViolations.length,0);
  const restoredGet=await get(restored.db,portfolioId,portfolioToken);
  assert.equal(restoredGet.status,200,JSON.stringify(restoredGet.body));
  const restoredProjection=ledgerProjection(restoredGet);
  assert.equal(canonical(restoredProjection),canonical(duplicateSnapshot),'Restored app reload differs from pre-backup reload');
  close(restoredProjection.summary.cash,10130,'restored cash');
  close(restoredProjection.summary.realizedPnl,130,'restored realized');
  close(restoredProjection.summary.unrealizedPnl,0,'restored unrealized');
  result.actual.restore={procedure:'DatabaseSync.serialize() on quiesced local SQLite connection; write snapshot file; copy bytes into previously nonexistent new local path; reopen from restored file; call app researchGET using preserved test-only in-memory session token',backupBytes:backupBytes.length,backupSha256:backupSha,restoredFileBytes:restoreBytes.length,restoredFileSha256:digestBytes(restoreBytes),backupEqualsRestoredBytes:true,schemaObjects: schemaAfter.length,schemaSha256:schemaHashAfter,tableCount:allTableCountDigest?Object.keys(countsAfter).length:0,allTableRowCountsMatch:true,allTableCountDigest,relevantRowCounts,relevantDomainRowHashes:domainAfter.hashes,domainRowsAndHashesMatch:true,appReloadStatus:restoredGet.status,restoredLedgerProjection:restoredProjection,repeatedReloadMatchesBeforeBackup:true,integrityCheck:integrity,foreignKeyViolations:fkViolations.length};
  result.actual.finalLedger.references=links;
  result.result='PASS';
}catch(error){
  result.result='FAIL';
  result.failure={message:error instanceof Error?error.message:String(error),name:error instanceof Error?error.name:'Error'};
}finally{
  try{opened?.sqlite.close();}catch{}
  try{restored?.sqlite.close();}catch{}
  delete mod.testRuntime.DB;
  delete mod.testRuntime.RECOMMENDATION_OWNER_EMAIL;
  await rm(temporaryRoot,{recursive:true,force:true});
}
const evidence={
  evidenceId:'EVD-TRUST-P2-02-PORTFOLIO',requirementId:'P2-02',baselineCommit:BASELINE,capturedAt:result.capturedAt,
  environment:result.environment,safeSourceOrTargetIdentity:{canonicalSourceManifestSha256:MANIFEST_SHA,logicalLocalDatabaseIds:['P2-TRUST-LOCAL-DB-2026-10-03-V1','P2-TRUST-LOCAL-RESTORE-DB-2026-10-03-V1'],storage:'local SQLite only'},
  procedure:['Read exact frozen seed and verify canonical seed SHA-256.','Create a new empty local file-backed SQLite database and apply every migration listed by the exact baseline migration journal.','Create one synthetic SAR portfolio and exercise create, opening cash, two buys, partial sale, frozen mark input, and final full sale through the exact-baseline research API.','At each operation checkpoint reload the application state and compare cash, units, average cost, realized P&L, and unrealized-P&L availability/value with independent arithmetic.','After writes are quiesced, take a Node SQLite serialize() snapshot, copy into a separate new local path, reopen it, compare schema/row counts/relevant domain hashes and arithmetic, and reload through the application API.'],
  expected:result.independentArithmetic,actual:result.actual,result:result.result,limitations:result.limitations,
  artifactPathOrLink:'artifacts/p2-02-03-raw-results.json',sha256:null,reviewer:null,reviewedAt:null
};
const ledgerEvidence={...evidence,evidenceId:'EVD-TRUST-P2-03-LEDGER',requirementId:'P2-03',procedure:['Verify all 4 synthetic trade events and the opening cash entry exist exactly once with unique IDs.','Verify trade chronology and application ledger order, portfolio references, null forecast references, same-ID retry idempotency, and out-of-order rejection with no mutation.','Compare repeated reload projections and restore all synthetic local state into a separate fresh local store; verify schema, counts, row hashes, IDs, app reload, and integrity.'],expected:{tradeCount:4,cashEntryCount:1,uniqueTradeIds:4,chronologicalTradeOrder:true,portfolioReferencesResolve:true,forecastReferences:'explicit null by contract for this fixture',sameIdRetry:'exact retry leaves count and row hash unchanged',outOfOrderAttempt:'rejected with no mutation',reloadAndRestore:'canonical ledger state matches'},actual:result.actual,result:result.result};
const rawPath=join(artifacts,'p2-02-03-raw-results.json');
await writeFile(rawPath,JSON.stringify(result,null,2)+'\n','utf8');
await writeFile(join(artifacts,'EVD-TRUST-P2-02-PORTFOLIO.json'),JSON.stringify(evidence,null,2)+'\n','utf8');
await writeFile(join(artifacts,'EVD-TRUST-P2-03-LEDGER.json'),JSON.stringify(ledgerEvidence,null,2)+'\n','utf8');
console.log(JSON.stringify({result:result.result,rawResults:rawPath,portfolioEvidence:join(artifacts,'EVD-TRUST-P2-02-PORTFOLIO.json'),ledgerEvidence:join(artifacts,'EVD-TRUST-P2-03-LEDGER.json'),failure:result.failure||null,tradeCount:result.actual.finalLedger?.tradeCount??null,restore:result.actual.restore?{backupSha256:result.actual.restore.backupSha256,bytesMatch:result.actual.restore.backupEqualsRestoredBytes,integrity:result.actual.restore.integrityCheck}:null},null,2));
if(result.result!=='PASS')process.exitCode=1;
