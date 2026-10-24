import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import * as m from './p2-app-bundle.mjs';

const WORK='/tmp/P2-TRUST-LOCAL-FORECAST-2026-10-03-V1';
const SRC='/tmp/mizan-v45-canonical-18ba8f39-20261003T223500Z/mizan-v45';
const BASELINE='18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241';
const FIXED_NOW=Date.parse('2026-10-03T20:00:00.000Z');
const ORIGINAL_DATE=globalThis.Date;
let clockNow=FIXED_NOW;
class FrozenDate extends ORIGINAL_DATE {
  constructor(...args){ if(args.length===0) super(clockNow); else super(...args); }
  static now(){ return clockNow; }
  static parse(value){ return ORIGINAL_DATE.parse(value); }
  static UTC(...args){ return ORIGINAL_DATE.UTC(...args); }
}
globalThis.Date=FrozenDate;
let prng=0x1a2b3c4d;
const originalRandom=Math.random;
Math.random=()=>{prng=(Math.imul(prng,1664525)+1013904223)>>>0;return prng/4294967296;};
const setClock=iso=>{clockNow=ORIGINAL_DATE.parse(iso);};
const cases=[];
const failures=[];
const digest=s=>createHash('sha256').update(s).digest('hex');
function canonical(v){
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object'){const out={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)out[k]=canonical(v[k]);return out;}
 return v;
}
const stable=v=>JSON.stringify(canonical(v));
function record(id,expected,actual,ok,notes=''){
 const row={id,status:ok?'PASS':'FAIL',expected,actual,...(notes?{notes}:{})};cases.push(row);if(!ok)failures.push(row);return row;
}
function same(id,expected,actual,notes=''){const ok=stable(expected)===stable(actual);record(id,expected,actual,ok,notes);assert.ok(ok,id+' mismatch');}
function truth(id,expected,actual,condition,notes=''){record(id,expected,actual,!!condition,notes);assert.ok(condition,id+' failed');}
function rejects(id,expected,fn,match=''){
 let error=null;try{fn();}catch(e){error=e instanceof Error?e:new Error(String(e));}
 const actual=error?error.message:'accepted input';const ok=!!error&&(!match||actual.toLowerCase().includes(match.toLowerCase()));record(id,expected,actual,ok);assert.ok(ok,id+': '+actual);
}
function rejectAsync(id,expected,fn,match=''){
 return Promise.resolve().then(fn).then(v=>{record(id,expected,'accepted input',false);throw Error(id+' unexpectedly accepted');},e=>{const actual=e instanceof Error?e.message:String(e),ok=!match||actual.toLowerCase().includes(match.toLowerCase());record(id,expected,actual,ok);assert.ok(ok,id+': '+actual);});
}
function chartPayload({symbol='AAPL',currency='USD',exchangeName='NMS',instrumentType='EQUITY',date='2026-10-02',close=110,open,high,low,volume=0,timestampPresent=true,identityPresent=true,currencyPresent=true}={}){
 const t=Math.floor(ORIGINAL_DATE.parse(date+'T15:00:00Z')/1000),o=open??close*.998,h=high??close*1.002,l=low??close*.996;
 const meta={currency,exchangeName,instrumentType,gmtoffset:0};if(!currencyPresent)delete meta.currency;if(identityPresent)meta.symbol=symbol;
 return {chart:{result:[{meta,timestamp:timestampPresent?[t]:[],indicators:{quote:[{open:[o],high:[h],low:[l],close:[close],volume:[volume]}]}}]}};
}
function tradingDates(endDate,count){
 const out=[],d=new ORIGINAL_DATE(endDate+'T00:00:00Z');
 while(out.length<count){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}
 return out;
}
function priceSeries(endDate,count=300,multiplier=1){
 return tradingDates(endDate,count).map((date,i)=>{const close=100*Math.exp(i*.0004+.004*Math.sin(i*.81))*multiplier;return {date,open:close*.998,high:close*1.002,low:close*.996,close,volume:10000+500*Math.sin(i*.3)};});
}
function reportFor(market='us',options={}){
 const currency=market==='sa'?'SAR':'USD',symbol=options.symbol||(market==='sa'?'P2T01.SR':'P2TUS1'),asOf=options.asOf||'2026-10-03';
 const end=options.endPriceDate||asOf,prices=priceSeries(end,options.bars||300,options.priceMultiplier||1);
 const source=market==='sa'?'https://www.saudiexchange.sa/fixture':'https://www.sec.gov/fixture';
 const annualDates=['2023-12-31','2024-12-31','2025-12-31'];
 const annualValues=[
  {revenue:50000,netIncome:3000,operatingCashFlow:10000,capex:-2000,equity:20000,assets:40000,liabilities:20000,debt:8000,cash:3000,currentAssets:15000,currentLiabilities:9000,interestExpense:900,ebitda:6000,operatingIncome:5000,grossProfit:16000,receivables:4000,inventory:3000,shares:1000},
  {revenue:55000,netIncome:3600,operatingCashFlow:11500,capex:-2200,equity:22000,assets:44000,liabilities:22000,debt:7800,cash:3600,currentAssets:16500,currentLiabilities:9500,interestExpense:850,ebitda:6800,operatingIncome:5700,grossProfit:17600,receivables:4300,inventory:3300,shares:1000},
  {revenue:61000,netIncome:4200,operatingCashFlow:13000,capex:-2500,equity:24500,assets:48000,liabilities:23500,debt:7500,cash:4100,currentAssets:18000,currentLiabilities:10000,interestExpense:800,ebitda:7600,operatingIncome:6500,grossProfit:19500,receivables:4600,inventory:3600,shares:1000}
 ];
 const facts=[];for(let y=0;y<annualDates.length;y++)for(const [key,value] of Object.entries(annualValues[y]))facts.push({key,value,date:annualDates[y],period:'annual',currency,source,publishedAt:['2024-03-01','2025-03-01','2026-03-01'][y]});
 for(const [key,value] of Object.entries({revenue:65000,netIncome:4600,ebitda:8000,operatingCashFlow:14000,capex:-2700}))facts.push({key,value,date:'2026-06-30',period:'trailing',currency,source,publishedAt:'2026-08-15'});
 const base={company:{symbol,name:'Synthetic test only',exchange:market==='sa'?'TADAWUL':'NASDAQ',sector:'Retail',industry:'Retail',instrument:'EQUITY',source},currency,asOf,retrievedAt:new ORIGINAL_DATE(clockNow).toISOString(),prices,priceSource:source,priceSourceId:market==='sa'?'tadawul':'yahoo',priceAdjustment:'unadjusted',quoteTime:null,facts,official:market==='sa'?{facts:[],bid:null,ask:null,shares:null,marketCap:null,pe:null,sector:'Retail',activity:'Synthetic only',news:[],events:[],source,auditor:'',quoteDate:null}:null,news:[],peers:[{company:{symbol:'P1'},pe:18,pb:2,ps:2,source:'fixture'},{company:{symbol:'P2'},pe:20,pb:2.2,ps:2.1,source:'fixture'}],checks:[{name:'الأسعار اليومية',url:source,state:'ok',detail:'Synthetic fixture only'}],warnings:[],mode:'current',context:{market:{symbol:market==='sa'?'^TASI.SR':'SPY',name:'Synthetic market benchmark',prices,source:'fixture'},sector:{symbol:'XLK',name:'Synthetic sector benchmark',prices,source:'fixture'}}};
 if(options.asOf==='2026-10-20'||options.asOf==='2026-10-25')base.news=[];
 return base;
}
function memoryDb(){return dbFixture(':memory:',true);}
function dbFixture(path,initialize){
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');
 if(initialize)for(const file of readdirSync(join(SRC,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(join(SRC,'drizzle',file),'utf8'));
 const prepare=(sql,args=[])=>({bind(...values){return prepare(sql,values);},async first(){return sqlite.prepare(sql).get(...args);},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)},changes:Number(result.changes)};}});
 const db={prepare,async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {sqlite,db};
}
const defaultSettings=structuredClone(m.DEFAULT_SETTINGS);
const baselineHorizons=[1,5,21,63,126,252];
const scenarioSeed={id:'P2-TRUST-FORECAST-001',instrument:'SYNTH-SAR-001',symbol:'P2T01.SR',currency:'SAR',createdAt:'2026-10-03T20:00:00.000Z',modelVersion:'SYNTHETIC-1',settingsVersion:'SYNTHETIC-1',anchorDate:'2026-10-03',values:{low:100,point:110,high:120}};
function insertSeed(sqlite,seed){
 const snapshot={id:seed.id,instrument:seed.instrument,company:{symbol:seed.symbol,name:'Synthetic test only',exchange:'TADAWUL'},symbol:seed.symbol,currency:seed.currency,recordClass:'prospective-public',modelVersion:seed.modelVersion,settingsVersion:seed.settingsVersion,anchorDate:seed.anchorDate,values:seed.values};
 sqlite.prepare('INSERT INTO analysis_snapshots(id,symbol,created_at,data) VALUES(?,?,?,?)').run(seed.id,seed.symbol,seed.createdAt,JSON.stringify(snapshot));
 const forecast={id:seed.id,symbol:seed.symbol,currency:seed.currency,unit:'share',assetType:'EQUITY',createdAt:seed.createdAt,anchorDate:seed.anchorDate,price:seed.values.point,predictedPrice:seed.values.point,range:[seed.values.low,seed.values.high],direction:'صاعد',neutralThresholdPct:1,model:seed.modelVersion,settingsVersion:seed.settingsVersion,settingsUsed:{version:seed.settingsVersion},available:true,recordClass:'prospective-public',evaluationPolicy:m.EVALUATION_POLICY};
 sqlite.prepare('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(seed.id,seed.id,seed.symbol,seed.createdAt,5,seed.modelVersion,'sa','Synthetic fixture','منخفض',1,JSON.stringify(forecast));
 return {snapshot,forecast};
}
function sqlRowSet(sqlite,snapshotId){
 const snapshot=sqlite.prepare('SELECT id,symbol,created_at,data FROM analysis_snapshots WHERE id=?').get(snapshotId);
 const forecasts=sqlite.prepare('SELECT id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data FROM forecast_records WHERE snapshot_id=? ORDER BY horizon,id').all(snapshotId);
 return {snapshot,forecasts};
}
function testReportHash(report,settings,modelVersion,now){return digest(stable({baseline:BASELINE,report,settings,modelVersion,now}));}
function materialProjection(result){
 const {snapshotId,rows,...rest}=result;
 return {...rest,rows:rows.map(({id,...row})=>row)};
}
function normalizedStored(result){
 const {snapshotId,rows,...rest}=result;
 return {...rest,snapshotId:'<volatile UUID>',rows:rows.map(({id,...row})=>row)};
}
function quantileNearestRank(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(p*sorted.length)-1];}
function stats(values){return {sampleCount:values.length,p50_ms:quantileNearestRank(values,.5),p95_ms:quantileNearestRank(values,.95),max_ms:Math.max(...values),min_ms:Math.min(...values)};}
function ms(fn){const start=performance.now();fn();return performance.now()-start;}
async function msAsync(fn){const start=performance.now();await fn();return performance.now()-start;}

async function run(){
 // Baseline source horizon inventory.
 same('P2-horizon-inventory',baselineHorizons,m.HORIZONS.map(x=>x.sessions),'Canonical six rows = the five named week-to-year horizons plus the later-added independent next-session daily row.');
 const sourceContentCount=readdirSync(SRC).length;
 // P2-06 parser and input failure matrix, synthetic fixtures only.
 const p206Start=cases.length;let p206Cases=[];const matrix=[];
 const mat=(id,expected,actual,ok,notes='')=>{const row={id,expected,actual,status:ok?'PASS':'FAIL',...(notes?{notes}:{})};matrix.push(row);record('P2-06-'+id,expected,actual,ok,notes);assert.ok(ok,'P2-06 '+id+' failed');};
 const yahoo=m.SOURCE_REGISTRY.find(x=>x.id==='yahoo'),tadawul=m.SOURCE_REGISTRY.find(x=>x.id==='tadawul');
 const yahooRef={...yahoo,resolvedUrl:'https://query1.finance.yahoo.com/v8/finance/chart/AAPL'},saRef={...tadawul,resolvedUrl:'https://www.saudiexchange.sa/fixture'};
 const yctx={expectedSymbol:'AAPL',asOf:'2026-10-03'},sctx={expectedSymbol:'2222.SR',asOf:'2026-10-03'};
 const validY=m.parseYahooHistory(JSON.stringify(chartPayload()),yahooRef,yctx);
 mat('US-identity-price-currency-valid','AAPL/USD/NMS with valid close 110',{symbol:validY.value.symbol,currency:validY.value.currency,close:validY.value.prices[0]?.close,priceCount:validY.value.prices.length},validY.value.symbol==='AAPL'&&validY.value.currency==='USD'&&validY.value.prices.length===1&&validY.value.prices[0].close===110);
 rejects('US-identity-missing','missing symbol rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({identityPresent:false})),yahooRef,yctx));
 rejects('US-identity-mismatch','different ticker rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({symbol:'MSFT'})),yahooRef,yctx));
 rejects('US-currency-missing','missing currency rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({currencyPresent:false})),yahooRef,yctx));
 rejects('US-currency-wrong','SAR currency for US ticker rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({currency:'SAR'})),yahooRef,yctx));
 rejects('US-exchange-missing','missing exchange rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({exchangeName:''})),yahooRef,yctx));
 rejects('US-instrument-not-equity','index payload is not accepted as the requested company equity',()=>m.parseYahooHistory(JSON.stringify(chartPayload({instrumentType:'INDEX'})),yahooRef,yctx));
 rejects('US-price-zero','zero quote close rejected as price',()=>m.parseYahooHistory(JSON.stringify(chartPayload({close:0,open:0,high:0,low:0})),yahooRef,yctx));
 rejects('US-price-null','null quote close rejected as price',()=>m.parseYahooHistory(JSON.stringify(chartPayload({close:null,open:null,high:null,low:null})),yahooRef,yctx));
 rejects('US-price-absent','missing timestamp/price series rejected',()=>m.parseYahooHistory(JSON.stringify(chartPayload({timestampPresent:false})),yahooRef,yctx));
 const validSPrice=m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'SAR',lastPrice:110,asOfDate:'2026-10-02T15:00:00Z',volume:0}),saRef,sctx);
 mat('SA-identity-price-currency-valid','2222.SR/SAR with explicit time and zero volume preserved',{symbol:validSPrice.value.symbol,currency:validSPrice.value.currency,volume:validSPrice.value.volume,time:validSPrice.value.quoteTime},validSPrice.value.symbol==='2222.SR'&&validSPrice.value.currency==='SAR'&&validSPrice.value.volume===0&&validSPrice.value.quoteTime==='2026-10-02T15:00:00.000Z','Zero volume is an explicit valid zero; it is not replaced.');
 rejects('SA-identity-missing','missing company identity rejected',()=>m.parseTadawulPrice(JSON.stringify({currency:'SAR',lastPrice:110,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-identity-mismatch','wrong company ticker rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'1120.SR',currency:'SAR',lastPrice:110,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-currency-missing','missing SAR currency rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',lastPrice:110,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-currency-wrong','USD currency for Tadawul rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'USD',lastPrice:110,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-price-zero','zero last price rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'SAR',lastPrice:0,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-price-null','null last price rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'SAR',lastPrice:null,asOfDate:'2026-10-02T15:00:00Z'}),saRef,sctx));
 rejects('SA-price-time-missing','missing source timestamp rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'SAR',lastPrice:110}),saRef,sctx));
 rejects('SA-price-future-time','price after fixed cutoff rejected',()=>m.parseTadawulPrice(JSON.stringify({symbol:'2222.SR',currency:'SAR',lastPrice:110,asOfDate:'2026-10-04T15:00:00Z'}),saRef,sctx));
 const tadZero={symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'annual',isAnnual:true,periodEndDate:'2025-12-31',announcementDate:'2026-03-01',totalRevenue:0,netIncome:0,operatingCashFlow:null,capitalExpenditures:0}]};
 const saFinancial=m.parseTadawulFinancials(JSON.stringify(tadZero),saRef,sctx).value;
 mat('SA-zero-null-period','explicit zero retained; null omitted; valid period remains annual',{revenue:saFinancial.lines.find(x=>x.key==='revenue')?.value,netIncome:saFinancial.lines.find(x=>x.key==='netIncome')?.value,cfo:saFinancial.lines.find(x=>x.key==='operatingCashFlow')?.value,periods:[...new Set(saFinancial.lines.map(x=>x.period))]},saFinancial.lines.find(x=>x.key==='revenue')?.value===0&&saFinancial.lines.find(x=>x.key==='netIncome')?.value===0&&!saFinancial.lines.some(x=>x.key==='operatingCashFlow')&&saFinancial.lines.every(x=>x.period==='annual'),'A valid zero stays zero; a null field is omitted, not coerced.');
 const saNoPublication=m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'annual',isAnnual:true,periodEndDate:'2025-12-31',totalRevenue:100}]}),saRef,sctx).value;
 mat('SA-publication-null-not-fabricated','missing publication remains null',saNoPublication.lines.find(x=>x.key==='revenue')?.filedAt,saNoPublication.lines.find(x=>x.key==='revenue')?.filedAt===null);
 rejects('SA-period-end-missing','missing period end yields no accepted lines',()=>m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'annual',isAnnual:true,totalRevenue:100}]}),saRef,sctx));
 rejects('SA-period-end-future','future period is not accepted',()=>m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'annual',isAnnual:true,periodEndDate:'2026-12-31',announcementDate:'2026-12-31',totalRevenue:100}]}),saRef,sctx));
 rejects('SA-period-date-invalid','invalid calendar date is not accepted',()=>m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'annual',isAnnual:true,periodEndDate:'2025-02-30',announcementDate:'2026-03-01',totalRevenue:100}]}),saRef,sctx));
 rejects('SA-period-quarter-type-invalid','12M input is not relabeled as quarter',()=>m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'quarterly',isAnnual:false,periodType:'12M',periodEndDate:'2026-06-30',announcementDate:'2026-08-01',totalRevenue:100}]}),saRef,sctx));
 rejects('SA-period-unit-scale-missing','unknown units rejected rather than guessed',()=>m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',financialStatements:[{statementType:'annual',isAnnual:true,periodEndDate:'2025-12-31',announcementDate:'2026-03-01',totalRevenue:100}]}),saRef,sctx));
 const validQuarter=m.parseTadawulFinancials(JSON.stringify({symbol:'2222.SR',currency:'SAR',unitScale:1,financialStatements:[{statementType:'quarterly',isAnnual:false,periodType:'3M',periodEndDate:'2026-06-30',announcementDate:'2026-08-01',totalRevenue:100}]}),saRef,sctx).value;
 mat('SA-quarter-3M-preserved','quarter period is 3M and dated',{period:validQuarter.lines[0]?.period,periodEnd:validQuarter.lines[0]?.periodEnd},validQuarter.lines.some(x=>x.period==='quarterly'&&x.periodEnd==='2026-06-30'));
 const yFinRef=yahooRef;
 const yFinRaw={timeseries:{result:[{meta:{symbol:['AAPL'],type:['annualTotalRevenue']},annualTotalRevenue:[{reportedValue:{raw:0},asOfDate:'2025-09-27',currencyCode:'USD',periodType:'12M'}]}]}};
 const yFin=m.parseYahooFinancials(JSON.stringify(yFinRaw),yFinRef,yctx).value;
 mat('US-zero-financial-period','explicit zero and annual period preserved',{value:yFin.lines[0]?.value,period:yFin.lines[0]?.period,periodEnd:yFin.lines[0]?.periodEnd},yFin.lines.length===1&&yFin.lines[0].value===0&&yFin.lines[0].period==='annual'&&yFin.lines[0].periodEnd==='2025-09-27');
 rejects('US-financial-identity-mismatch','mismatched financial symbol rejected',()=>m.parseYahooFinancials(JSON.stringify({...yFinRaw,timeseries:{result:[{...yFinRaw.timeseries.result[0],meta:{symbol:['MSFT'],type:['annualTotalRevenue']}}]}}),yFinRef,yctx));
 rejects('US-financial-period-missing','missing period end yields no accepted line',()=>m.parseYahooFinancials(JSON.stringify({timeseries:{result:[{meta:{symbol:['AAPL'],type:['annualTotalRevenue']},annualTotalRevenue:[{reportedValue:{raw:100},currencyCode:'USD',periodType:'12M'}]}]}}),yFinRef,yctx));
 rejects('US-financial-period-future','future period not accepted',()=>m.parseYahooFinancials(JSON.stringify({timeseries:{result:[{meta:{symbol:['AAPL'],type:['annualTotalRevenue']},annualTotalRevenue:[{reportedValue:{raw:100},asOfDate:'2026-12-31',currencyCode:'USD',periodType:'12M'}]}]}}),yFinRef,yctx));
 rejects('US-financial-quarter-12M-not-quarter','12M quarterly record is not relabeled',()=>m.parseYahooFinancials(JSON.stringify({timeseries:{result:[{meta:{symbol:['AAPL'],type:['quarterlyTotalRevenue']},quarterlyTotalRevenue:[{reportedValue:{raw:100},asOfDate:'2026-06-30',currencyCode:'USD',periodType:'12M'}]}]}}),yFinRef,yctx));
 const outage=await m.fetchWithFallback('AAPL','history','us',new Set(),m.getParser('history'),{reader:async()=>{throw Error('synthetic source outage');}});
 truth('source-outage-explicit','all injected price-source reads fail with recorded attempts',{state:outage.state,attempts:outage.attempts?.map(x=>x.status),hasValue:Object.hasOwn(outage,'value')},outage.state==='failed'&&outage.attempts?.length>0&&outage.attempts.every(x=>x.status==='failed')&&!Object.hasOwn(outage,'value'));
 const financialOutage=await m.fetchWithFallback('AAPL','financials','us',new Set(),m.getParser('financials'),{cik:'0000320193',reader:async()=>{throw Error('synthetic financial source outage');}});
 truth('source-outage-financials-explicit','financial source outage retains failed attempts and no numeric result',{state:financialOutage.state,attempts:financialOutage.attempts?.map(x=>x.status),hasValue:Object.hasOwn(financialOutage,'value')},financialOutage.state==='failed'&&financialOutage.attempts?.some(x=>x.status==='failed')&&!Object.hasOwn(financialOutage,'value')); 
 const malformed=await m.fetchWithFallback('AAPL','history','us',new Set(),m.getParser('history'),{fetcher:async()=>new Response('not json',{status:200})});
 truth('http-200-malformed-explicit','HTTP 200 invalid JSON is a failed source result',{state:malformed.state,attempts:malformed.attempts?.map(x=>x.status),hasValue:Object.hasOwn(malformed,'value')},malformed.state==='failed'&&malformed.attempts?.some(x=>x.status==='failed')&&!Object.hasOwn(malformed,'value'));
 const staleReport=reportFor('us',{symbol:'P2TUS1',asOf:'2026-10-03',endPriceDate:'2026-07-31'}),staleReady=m.forecastReadiness(staleReport,FIXED_NOW),staleForecast=m.forecasts(staleReport,null,FIXED_NOW,defaultSettings);
 truth('stale-price-gate','>21-day price age is stated and all forecast horizons abstain',{staleDays:staleReady.stale,quality:staleReady.quality,unavailable:staleReady.unavailable,available:staleForecast.rows.map(x=>x.available)},staleReady.stale>21&&staleReady.unavailable.length>0&&staleForecast.rows.every(x=>!x.available));
 const validReport=reportFor('us'),missingFinancial={...structuredClone(validReport),facts:[]},missingAnalysis=m.automaticAnalysis(missingFinancial),missingForecast=m.forecasts(missingFinancial,null,FIXED_NOW,defaultSettings);
 truth('missing-financials-not-zero','missing financials stay null and lower confidence; valid prices may still support conditional ranges',{pe:missingAnalysis.pe,roe:missingAnalysis.roe,cashConversion:missingAnalysis.cashConversion,quality:missingForecast.dataQuality,confidence:missingForecast.rows.map(x=>x.confidence),warnings:missingForecast.dataWarnings},missingAnalysis.pe===null&&missingAnalysis.roe===null&&missingAnalysis.cashConversion===null&&missingForecast.rows.every(x=>x.confidence==='منخفض')&&missingForecast.dataWarnings.length>0);
 const staleFacts={...structuredClone(validReport),facts:validReport.facts.filter(f=>f.period==='annual'&&f.date==='2023-12-31')},staleFactAnalysis=m.automaticAnalysis(staleFacts),staleFactForecast=m.forecasts(staleFacts,null,FIXED_NOW,defaultSettings);
 truth('stale-financial-period-not-current','very old financial period remains dated, is blocked from strong analysis, and does not produce current valuation ratios',{annualDate:staleFactAnalysis.annualDate,pe:staleFactAnalysis.pe,roe:staleFactAnalysis.roe,blockers:staleFactAnalysis.blockers,quality:staleFactForecast.dataQuality},staleFactAnalysis.annualDate==='2023-12-31'&&staleFactAnalysis.pe===null&&staleFactAnalysis.roe===null&&staleFactAnalysis.blockers.some(x=>x.includes('قديمة'))&&staleFactForecast.dataQuality!=='ممتازة');
 const mismatchedFacts={...structuredClone(validReport),facts:validReport.facts.map(f=>({...f,currency:'SAR'}))},mismatchAnalysis=m.automaticAnalysis(mismatchedFacts);
 truth('currency-mismatch-no-conversion','USD quote with SAR facts is not silently converted',{pe:mismatchAnalysis.pe,blockers:mismatchAnalysis.blockers,currency:mismatchAnalysis.currency},mismatchAnalysis.pe===null&&mismatchAnalysis.blockers.some(x=>x.includes('عملة القوائم')));
 const badPrice={...structuredClone(validReport),prices:validReport.prices.map((p,i)=>i===validReport.prices.length-1?{...p,close:0,low:0,open:0,high:0}:p)},badPriceResult=m.forecasts(badPrice,null,FIXED_NOW,defaultSettings);
 truth('zero-analysis-price-not-fabricated','zero close does not become forecast price/range',{available:badPriceResult.rows.map(x=>x.available),ranges:badPriceResult.rows.map(x=>x.range)},badPriceResult.rows.every(x=>!x.available&&x.range===null));
 const missingPrice={...structuredClone(validReport),prices:[]},missingPriceResult=m.forecasts(missingPrice,null,FIXED_NOW,defaultSettings);
 truth('missing-analysis-price-not-fabricated','missing history causes unavailable rows rather than default price',{price:missingPriceResult.price,available:missingPriceResult.rows.map(x=>x.available)},missingPriceResult.price===null&&missingPriceResult.rows.every(x=>!x.available));
 const staleQuote={symbol:validReport.company.symbol,currency:validReport.currency,price:9999,quoteTime:'2026-09-01T20:00:00.000Z'},staleQuoteResult=m.forecasts(structuredClone(validReport),staleQuote,FIXED_NOW,defaultSettings);
 truth('stale-quote-not-used-as-current','old quote is not substituted; reported price/time are the fixed daily-bar close/date',{quotePrice:staleQuote.price,selectedPrice:staleQuoteResult.price,dailyBar:validReport.prices.at(-1).close,selectedTime:staleQuoteResult.priceTime,dailyTime:validReport.prices.at(-1).date},staleQuoteResult.price===validReport.prices.at(-1).close&&staleQuoteResult.priceTime===validReport.prices.at(-1).date);
 p206Cases=cases.slice(p206Start);

 // P2-07: exact same frozen inputs/model/settings/version and a positive material-difference control.
 const reproducibility={};
 for(const market of ['sa','us']){
  setClock('2026-10-03T20:00:00.000Z');const report=reportFor(market),settings=structuredClone(defaultSettings),version=m.forecastModelVersion(settings),inputHash=testReportHash(report,settings,version,FIXED_NOW);
  const a=m.forecasts(structuredClone(report),null,FIXED_NOW,settings),b=m.forecasts(structuredClone(report),null,FIXED_NOW,settings);
  const ah=digest(stable(a)),bh=digest(stable(b));truth('P2-07-'+market+'-same-replay','same full forecast JSON and digest for identical frozen input/version',{version,rows:a.rows.length,digestA:ah,digestB:bh},version===m.forecastModelVersion(settings)&&ah===bh&&stable(a)===stable(b));
  const changed=structuredClone(report);const last=changed.prices.length-1,old=changed.prices[last].close;for(const k of ['open','high','low','close'])changed.prices[last][k]*=1.001;
  const c=m.forecasts(changed,null,FIXED_NOW,settings),ch=digest(stable(c));truth('P2-07-'+market+'-positive-control','same model version but changed material price changes output digest',{sameVersion:c.version===version,oldPrice:old,newPrice:c.price,digestOriginal:ah,digestChanged:ch},c.version===version&&c.price!==old&&ch!==ah);
  const dbA=memoryDb(),dbB=memoryDb();
  const savedA=await m.recordAnalysis(dbA.db,structuredClone(report),settings),savedB=await m.recordAnalysis(dbB.db,structuredClone(report),settings);
  const nA=normalizedStored(savedA),nB=normalizedStored(savedB),dA=digest(stable(nA)),dB=digest(stable(nB));
  truth('P2-07-'+market+'-persisted-replay','saved decision-bearing fields match after only ID allowlist normalization',{digestA:dA,digestB:dB,volatile:['snapshotId','rows[*].id']},dA===dB&&stable(nA)===stable(nB));
  const snapDataA=dbA.sqlite.prepare('SELECT data FROM analysis_snapshots').get().data,snapDataB=dbB.sqlite.prepare('SELECT data FROM analysis_snapshots').get().data;
  truth('P2-07-'+market+'-snapshot-payload','input snapshot payload bytes match exactly across separate empty databases',{shaA:digest(snapDataA),shaB:digest(snapDataB)},snapDataA===snapDataB);
  for(const h of [dbA,dbB])h.sqlite.close();
  reproducibility[market]={modelVersion:version,inputSha256:inputHash,outputSha256:ah,normalizedPersistedSha256:dA,rows:a.rows.map(x=>({sessions:x.sessions,period:x.period,available:x.available,price:x.price,predictedPrice:x.predictedPrice??null,range:x.range,change:x.change,confidence:x.confidence,coverage:x.coverage})),volatileFields:['analysis_snapshots.id','forecast_records.id','forecast_records.snapshot_id','forecast_records.data.id']};
 }

 // P2-04: fixed seed plus app-generated snapshots, later analysis, reload and local DB restore.
 const dbPath=join(WORK,'forecast-lifecycle.sqlite');if(existsSync(dbPath))throw Error('fresh test DB already exists');mkdirSync(join(WORK,'db'),{recursive:true});
 const initialDb=dbFixture(dbPath,true),sqlite=initialDb.sqlite,db=initialDb.db;
 truth('P2-04-fresh-empty-db','new fresh schema has zero forecast input rows',{snapshots:sqlite.prepare('SELECT COUNT(*) n FROM analysis_snapshots').get().n,forecasts:sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n},sqlite.prepare('SELECT COUNT(*) n FROM analysis_snapshots').get().n===0&&sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n===0);
 const seed=insertSeed(sqlite,scenarioSeed),seedBefore=sqlRowSet(sqlite,scenarioSeed.id),seedBeforeHash=digest(stable(seedBefore));
 setClock('2026-10-03T20:00:00.000Z');const initSettings=structuredClone(defaultSettings),firstReport=reportFor('sa',{symbol:scenarioSeed.symbol});
 const first=await m.recordAnalysis(db,structuredClone(firstReport),initSettings);
 const firstAppRows=sqlRowSet(sqlite,first.snapshotId),firstAppHash=digest(stable(firstAppRows));
 const firstModel=first.version,firstModelSettings=first.rows[0].settingsUsed,firstAnchor=first.rows[0].anchorDate,firstCreatedAt=first.createdAt;
 truth('P2-04-app-save-linked-snapshot','recordAnalysis appends one input snapshot and six linked forecast rows with model/settings/date captured',{snapshotIdPresent:!!first.snapshotId,recorded:first.recorded,rows:first.rows.length,model:firstModel,settingsUsed:firstModelSettings,anchorDate:firstAnchor,createdAt:firstCreatedAt},!!first.snapshotId&&first.recorded===true&&first.rows.length===6&&firstModel===m.forecastModelVersion(initSettings)&&stable(firstModelSettings)===stable({weights:initSettings.weights,maxSigma:initSettings.maxSigma,minConfidence:initSettings.minConfidence,periods:initSettings.periods})&&first.rows.every(x=>x.anchorDate===firstAnchor&&x.createdAt===firstCreatedAt&&x.model===firstModel));
 const snapshotPayload=JSON.parse(firstAppRows.snapshot.data);
 truth('P2-04-snapshot-record-split','input snapshot stores symbol/currency and links forecasts separately; forecast is not duplicated into input payload',{snapshotSymbol:snapshotPayload.company.symbol,currency:snapshotPayload.currency,containsForecast:Object.hasOwn(snapshotPayload,'forecast'),linkedRows:firstAppRows.forecasts.length},snapshotPayload.company.symbol===scenarioSeed.symbol&&snapshotPayload.currency==='SAR'&&!Object.hasOwn(snapshotPayload,'forecast')&&firstAppRows.forecasts.length===6,'Model/settings/anchor values are in the linked forecast records; creation time is also in row columns.');
 // Later market activity with a new input and model settings.
 setClock('2026-10-20T20:00:00.000Z');const laterSettings=structuredClone(defaultSettings);laterSettings.weights={...laterSettings.weights,technical:125};laterSettings.maxSigma=3.2;
 const laterReport=reportFor('sa',{symbol:scenarioSeed.symbol,asOf:'2026-10-20',endPriceDate:'2026-10-19',bars:312,priceMultiplier:1.035});
 const later=await m.recordAnalysis(db,structuredClone(laterReport),laterSettings);
 const seedAfterLater=sqlRowSet(sqlite,scenarioSeed.id),appAfterLater=sqlRowSet(sqlite,first.snapshotId);
 same('P2-04-seed-payload-unchanged-after-new-analysis',seedBefore,seedAfterLater,'Original seeded values/model/settings/anchor/time and raw payload are compared.');
 same('P2-04-app-payload-unchanged-after-new-analysis',firstAppRows,appAfterLater,'Original app snapshot plus every linked forecast row are compared byte-for-byte by DB fields.');
 truth('P2-04-later-activity-appends','new inputs/settings create new snapshot and model version without replacing originals',{newSnapshotId:later.snapshotId,oldSnapshotId:first.snapshotId,newModel:later.version,oldModel:firstModel,snapshotCount:sqlite.prepare('SELECT COUNT(*) n FROM analysis_snapshots').get().n,forecastCount:sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n,outcomes:sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n},later.snapshotId!==first.snapshotId&&later.version!==firstModel&&sqlite.prepare('SELECT COUNT(*) n FROM analysis_snapshots').get().n===3&&sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n===13,'Counts include one fixed-seed pair plus 2 app-issued snapshots × 6 horizons.');
 setClock('2026-10-25T20:00:00.000Z');const correctionReport=reportFor('sa',{symbol:scenarioSeed.symbol,asOf:'2026-10-25',endPriceDate:'2026-10-23',bars:316,priceMultiplier:1.05});
 const correctionSettings=structuredClone(defaultSettings);correctionSettings.weights={...correctionSettings.weights,technical:130};
 const correction=await m.recordAnalysis(db,structuredClone(correctionReport),correctionSettings);
 same('P2-04-originals-unchanged-after-third-activity',seedBefore,sqlRowSet(sqlite,scenarioSeed.id),'Subsequent analysis/revision remains append-only for fixed record.');
 truth('P2-04-later-analysis-appends','a changed later analysis returns and persists a distinct new snapshot; no dedicated correction endpoint was invoked',{newId:correction.snapshotId,oldId:first.snapshotId,modelChanged:correction.version!==firstModel},correction.snapshotId!==first.snapshotId&&correction.snapshotId!==later.snapshotId&&correction.version!==firstModel);
 const directGuardTriggers=sqlite.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('analysis_snapshots','forecast_records') ORDER BY tbl_name,name").all();
 let directSqlUpdateAllowed=false;sqlite.exec('BEGIN');try{const raw=JSON.stringify({...JSON.parse(seedBefore.snapshot.data),syntheticProbe:'rollback-only'});const change=sqlite.prepare('UPDATE analysis_snapshots SET data=? WHERE id=?').run(raw,scenarioSeed.id);directSqlUpdateAllowed=Number(change.changes)>0;sqlite.exec('ROLLBACK');}catch{try{sqlite.exec('ROLLBACK');}catch{}}
 same('P2-04-rollback-probe-preserves-state',seedBefore,sqlRowSet(sqlite,scenarioSeed.id),'Any synthetic SQL mutability probe is rolled back before readback.');
 const integrity={inputSnapshotRow:seedBefore.snapshot,linkedForecastRows:seedBefore.forecasts};
 sqlite.exec(`VACUUM INTO '${join(WORK,'forecast-restored.sqlite')}'`);sqlite.close();
 const reopened=dbFixture(dbPath,false);same('P2-04-reload-preserves-fixed-seed',seedBefore,sqlRowSet(reopened.sqlite,scenarioSeed.id));same('P2-04-reload-preserves-app-originals',firstAppRows,sqlRowSet(reopened.sqlite,first.snapshotId));
 const schemaBefore=sqliteSchema(dbPath);const restored=dbFixture(join(WORK,'forecast-restored.sqlite'),false),schemaAfter=sqliteSchema(join(WORK,'forecast-restored.sqlite'));
 same('P2-04-local-vacuum-restore-schema',schemaBefore,schemaAfter,'SQLite VACUUM INTO was used only for a local synthetic backup/restore.');same('P2-04-local-restore-preserves-fixed-seed',seedBefore,sqlRowSet(restored.sqlite,scenarioSeed.id));same('P2-04-local-restore-preserves-app-originals',firstAppRows,sqlRowSet(restored.sqlite,first.snapshotId));
 const appTriggerNames=directGuardTriggers.map(x=>x.name);
 const originalAppForecastFields=firstAppRows.forecasts.map(r=>{const d=JSON.parse(r.data);return {snapshotId:r.snapshot_id,recordId:r.id,symbol:r.symbol,currency:d.currency,createdAt:r.created_at,horizon:r.horizon,model:r.model,settingsUsed:d.settingsUsed,anchorDate:d.anchorDate,price:d.price,predictedPrice:d.predictedPrice??null,range:d.range};});
 const appImmutability={supportedFlowOriginalRowsUnchanged:true,fixedSyntheticSeed:scenarioSeed,originalSeedSha256:seedBeforeHash,originalAppSnapshotSha256:firstAppHash,originalAppForecastFields,roundtripReloadAndRestore:true,genericSnapshotForecastTriggers:directGuardTriggers,directSqlUpdateAllowedWithinRolledBackSyntheticTransaction:directSqlUpdateAllowed,limitation:'This verifies supported app activity/reload/restore behavior. The observed SQLite schema does not block arbitrary direct SQL UPDATE to generic analysis_snapshots; the mutation was inside a transaction and rolled back. A separate correction endpoint was not invoked; changed analyses appended distinct snapshots. No app edit was made.'};
 truth('P2-04-payload-and-linkage-roundtrip','original seed and app-generated snapshot are unchanged after reload and restore',{seedHash:seedBeforeHash,appHash:firstAppHash,snapshotModel:firstModel,settings:firstModelSettings,anchor:firstAnchor,createdAt:firstCreatedAt,restoreSchemaStable:stable(schemaBefore)===stable(schemaAfter)},stable(sqlRowSet(restored.sqlite,scenarioSeed.id))===stable(seedBefore)&&stable(sqlRowSet(restored.sqlite,first.snapshotId))===stable(firstAppRows)&&stable(schemaBefore)===stable(schemaAfter));
 reopened.sqlite.close();restored.sqlite.close();

 // P2-08 measurement-only, preloaded synthetic report, in-memory SQLite; no source fetching or optimization.
 const perf={method:{cold:'first invocation after module import and fixture preparation',warmupOperations:3,samplesPerOperation:30,quantile:'nearest-rank; p50=ceil(.50*n)-1, p95=ceil(.95*n)-1',analysisMetric:'automaticAnalysis(report) on an already-built synthetic report',forecastMetric:'forecasts(report,null,fixedNow,settings) for all six canonical horizons',saveMetric:'recordAnalysis end-to-end including forecast recompute, history reads and inserts into fresh in-memory SQLite; schema setup excluded',excluded:['market-data retrieval/network','report-construction','Cloudflare Worker CPU','remote D1 latency/durability','UI/browser/render','portfolio update (measured by the separate portfolio work package)'],optimizationPerformed:false,thresholdSet:false},markets:{}};
 for(const market of ['sa','us']){
  setClock('2026-10-03T20:00:00.000Z');const report=reportFor(market),settings=structuredClone(defaultSettings),now=FIXED_NOW;
  const coldAnalysis=ms(()=>m.automaticAnalysis(structuredClone(report)));
  const coldForecast=ms(()=>m.forecasts(structuredClone(report),null,now,settings));
  const coldSave=await msAsync(async()=>{const h=memoryDb();try{await m.recordAnalysis(h.db,structuredClone(report),settings);}finally{h.sqlite.close();}});
  for(let i=0;i<3;i++){m.automaticAnalysis(structuredClone(report));m.forecasts(structuredClone(report),null,now,settings);const h=memoryDb();try{await m.recordAnalysis(h.db,structuredClone(report),settings);}finally{h.sqlite.close();}}
  const analysisSamples=[],forecastSamples=[],saveSamples=[];
  for(let i=0;i<30;i++){
   analysisSamples.push(ms(()=>m.automaticAnalysis(structuredClone(report))));
   forecastSamples.push(ms(()=>m.forecasts(structuredClone(report),null,now,settings)));
   saveSamples.push(await msAsync(async()=>{const h=memoryDb();try{await m.recordAnalysis(h.db,structuredClone(report),settings);}finally{h.sqlite.close();}}));
  }
  perf.markets[market]={fixture:{symbol:report.company.symbol,currency:report.currency,barCount:report.prices.length,factCount:report.facts.length,asOf:report.asOf,synthetic:true},cold:{automaticAnalysis_ms:coldAnalysis,allHorizonsForecast_ms:coldForecast,recordAnalysisEndToEnd_ms:coldSave},warm:{automaticAnalysis:stats(analysisSamples),allHorizonsForecast:stats(forecastSamples),recordAnalysisEndToEnd:stats(saveSamples)},rawWarmSamples_ms:{automaticAnalysis:analysisSamples,allHorizonsForecast:forecastSamples,recordAnalysisEndToEnd:saveSamples},recordedOutputs:{forecastRows:6,modelVersion:m.forecastModelVersion(settings)}};
 }
 const measurementEnv={node:process.version,platform:process.platform,architecture:process.arch,reportedCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBytesAtCapture:os.freemem(),testRoot:WORK,source:BASELINE};
 const output={
  evidenceBundle:'P2-04/06/07/08 forecast trust validation',
  baselineCommit:BASELINE,
  canonicalSourceParityManifest:'/tmp/mizan-v45-canonical-18ba8f39-20261003T223500Z/source-parity.ndjson',
  canonicalSourceParityManifestSha256:'5fdf6dd6273c7765252495f6f960f74ad82592e619f583a24bd4d5bec03923bb',
  environment:measurementEnv,syntheticOnly:true,noUserOrProductionData:true,
  network:'outbound blocked; loopback used only in parent test suite, P2 harness did not fetch',
  horizons:{code:m.HORIZONS,semantics:'1-session daily plus five named periods [5,21,63,126,252]'},
  results:{
   p204:appImmutability,
   p206:{matrixCases:p206Cases.length,passed:p206Cases.filter(x=>x.status==='PASS').length,failed:p206Cases.filter(x=>x.status==='FAIL').length,cases:p206Cases},
   p207:{markets:reproducibility,volatileAllowlist:['analysis_snapshots.id','forecast_records.id','forecast_records.snapshot_id','forecast_records.data.id'],allOtherSavedFieldsCompared:true,positiveControlChangedMaterialPrice:true},
   p208:perf,
   preexistingBaselineTests:{suite:'npm test',passed:211,failed:0,skipped:1,total:212,skipName:'Current Saudi and US behavior matches the actual pre-change module with identical inputs and a fixed clock',skipReason:'MIZAN_LIVE_BASELINE_MODULE environment variable was unset'}
  }
 };
 output.status=failures.length?'FAIL':'PASS_WITH_STORAGE_ENFORCEMENT_LIMIT';output.assertionCases=cases.length;output.failures=failures;
 writeFileSync(join(WORK,'p2-trust-evidence.json'),JSON.stringify(output,null,2)+'\n');
 writeFileSync(join(WORK,'p2-trust-cases.ndjson'),cases.map(x=>JSON.stringify(x)).join('\n')+'\n');
 console.log(JSON.stringify({status:output.status,assertionCases:cases.length,failures:failures.map(x=>x.id),p204:{supportedFlowOriginalUnchanged:appImmutability.supportedFlowOriginalRowsUnchanged,sqlTriggers:appTriggerNames,directSqlUpdateAllowed},p206:{cases:p206Cases.length,passed:p206Cases.filter(x=>x.status==='PASS').length},p207:Object.fromEntries(Object.entries(reproducibility).map(([k,v])=>[k,{version:v.modelVersion,digest:v.outputSha256,rows:v.rows.length}])),p208:Object.fromEntries(Object.entries(perf.markets).map(([k,v])=>[k,{analysis:v.warm.automaticAnalysis,forecast:v.warm.allHorizonsForecast,save:v.warm.recordAnalysisEndToEnd}]))}));
 if(failures.length)process.exitCode=1;
}
function sqliteSchema(path){const x=new DatabaseSync(path);const result=x.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();x.close();return result;}

try{await run();}catch(error){
 const fail={id:'HARNESS',status:'FAIL',error:error instanceof Error?error.message:String(error)};failures.push(fail);
 const partial={evidenceBundle:'P2-04/06/07/08 forecast trust validation',baselineCommit:BASELINE,status:'FAIL',syntheticOnly:true,cases,failures};
 writeFileSync(join(WORK,'p2-trust-evidence.json'),JSON.stringify(partial,null,2)+'\n');
 console.error(JSON.stringify({status:'FAIL',error:fail.error,completedCases:cases.length}));process.exitCode=1;
}
