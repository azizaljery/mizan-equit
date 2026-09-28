import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseYahooFinancials, parseYahooNews, parseYahooHistory } from '../yahoo';
import { parseSecFinancials, parseSecFilings, secDispatch } from '../sec';
import { getParser } from '..';
import { gradeFromProvenance } from '../../quality';
import { detectConflict, resolveByTier, numericEqual } from '../../conflict';
import type { SourceRef } from '../../types';
import type { ParserContext } from '../../fallback';

const CTX_AAPL:ParserContext={
  expectedSymbol:'AAPL',
  expectedCik:'0000320193',
};

function fakeSource(o:Partial<SourceRef>&{id:string}):SourceRef{
  return {
    id:o.id,
    name:o.name??o.id,
    tier:o.tier??'provider',
    market:o.market??'global',
    dataTypes:o.dataTypes??[],
    urlTemplate:o.urlTemplate??'',
    requiresKey:o.requiresKey??false,
    envKeyName:o.envKeyName,
    official:o.official??false,
    derived:o.derived??false,
    knownDelayMinutes:o.knownDelayMinutes??null,
    resolvedUrl:o.resolvedUrl??`https://example.com/${o.id}`,
  };
}

test('Yahoo financials: all result + filedAt null + ttm',()=>{
  const payload={timeseries:{result:[
    {meta:{symbol:['AAPL']},annualTotalRevenue:[{asOfDate:'2023-12-31',currencyCode:'USD',reportedValue:{raw:100}}],
     trailingEBITDA:[{asOfDate:'2024-03-31',currencyCode:'USD',reportedValue:{raw:50}}]},
    {meta:{symbol:['AAPL']},quarterlyNetIncome:[{periodType:'3M',asOfDate:'2024-03-31',currencyCode:'USD',reportedValue:{raw:10}}]},
  ]}};
  const out=parseYahooFinancials(JSON.stringify(payload),fakeSource({id:'yahoo'}),CTX_AAPL);
  assert.equal(out.value.lines.length,3);
  assert.ok(out.value.lines.every(l=>l.filedAt===null));
  assert.equal(out.value.lines.find(l=>l.key==='ebitda')?.period,'ttm');
  assert.equal(out.sourceTime,null);
});

test('Yahoo history: rejects wrong symbol',()=>{
  const payload={chart:{result:[{
    meta:{symbol:'MSFT',currency:'USD',instrumentType:'EQUITY',exchangeName:'NMS',fullExchangeName:'NasdaqGS',regularMarketTime:1700000000},
    timestamp:[1700000000],
    indicators:{quote:[{open:[1],high:[1],low:[1],close:[1],volume:[1]}]},
  }]}};
  assert.throws(
    ()=>parseYahooHistory(JSON.stringify(payload),fakeSource({id:'yahoo'}),CTX_AAPL),
    /لا يطابق المتوقع/,
  );
});

test('Yahoo news: excludes undated and uses latest sourceTime',()=>{
  const payload={news:[
    {title:'A',link:'https://a',providerPublishTime:1700000000},
    {title:'B',link:'https://b'},
    {title:'C',link:'https://c',providerPublishTime:1800000000},
  ]};
  const out=parseYahooNews(JSON.stringify(payload),fakeSource({id:'yahoo'}),CTX_AAPL);
  assert.equal(out.value.items.length,2);
  assert.equal(out.sourceTime,new Date(1800000000*1000).toISOString());
});

test('SEC financials: missing or mismatched CIK fails closed',()=>{
  const src=fakeSource({id:'sec'});
  assert.throws(()=>parseSecFinancials(JSON.stringify({cik:'0000320193',facts:{'us-gaap':{}}}),src,{expectedSymbol:'AAPL'}),/expectedCik/);
  assert.throws(()=>parseSecFinancials(JSON.stringify({cik:'0000999999',facts:{'us-gaap':{}}}),src,CTX_AAPL),/لا يطابق المتوقع/);
});

test('SEC filings: 8-K supported',()=>{
  const payload={cik:'0000320193',filings:{recent:{
    accessionNumber:['0000320193-24-000001'],
    form:['8-K'],
    filingDate:['2024-05-01'],
    reportDate:['2024-05-01'],
    primaryDocument:['x.htm'],
  }}};
  const out=parseSecFilings(JSON.stringify(payload),fakeSource({id:'sec'}),CTX_AAPL);
  assert.equal(out.value.filings[0].form,'8-K');
});

test('getParser: SEC news rejected, SEC filings accepted',()=>{
  const news=getParser('news');
  assert.throws(()=>news('{}',fakeSource({id:'sec'}),CTX_AAPL),/غير مدعوم/);
  const filings=getParser('filings');
  const payload={cik:'0000320193',filings:{recent:{
    accessionNumber:['0000320193-24-000001'],
    form:['10-K'],
    filingDate:['2024-02-01'],
    reportDate:['2023-12-31'],
    primaryDocument:['x.htm'],
  }}};
  assert.ok((filings(JSON.stringify(payload),fakeSource({id:'sec'}),CTX_AAPL).value as any).filings.length);
});

test('quality: null sourceTime has no fresh bonus',()=>{
  const grade=gradeFromProvenance({
    source:'yahoo',url:'https://x',sourceTime:null,
    retrievedAt:new Date().toISOString(),
    official:false,derived:false,delayMinutes:null,
  });
  assert.ok(grade.reasons.some(r=>r.includes('غير معروف')));
  assert.ok(!grade.reasons.some(r=>r.includes('طازجة')));
});

test('conflict: regulator beats provider',()=>{
  const values=[
    {value:100,provenance:{source:'yahoo',url:'',sourceTime:null,retrievedAt:'',official:false,derived:false,delayMinutes:null}},
    {value:105,provenance:{source:'sec',url:'',sourceTime:null,retrievedAt:'',official:true,derived:false,delayMinutes:null}},
  ];
  const r=resolveByTier(values,(a,b)=>a===b,id=>id==='sec'?'regulator':'provider');
  assert.equal(r.resolved?.value,105);
});

test('conflict: near-equal values are not conflict',()=>{
  const values=[
    {value:100,provenance:{source:'a',url:'',sourceTime:null,retrievedAt:'',official:false,derived:false,delayMinutes:null}},
    {value:100.2,provenance:{source:'b',url:'',sourceTime:null,retrievedAt:'',official:false,derived:false,delayMinutes:null}},
  ];
  assert.equal(detectConflict(values,numericEqual(0.5)).hasConflict,false);
});


test('PIT rejects Yahoo and malformed publication dates',async()=>{
  const {pitSafe,hasPitSafeLines}=await import('../pit');
  const payload={timeseries:{result:[{meta:{symbol:['AAPL']},trailingNetIncome:[{asOfDate:'2024-03-31',currencyCode:'USD',reportedValue:{raw:11}}]}]}};
  const out=parseYahooFinancials(JSON.stringify(payload),fakeSource({id:'yahoo'}),CTX_AAPL);
  assert.equal(out.value.lines[0].period,'ttm');
  assert.equal(hasPitSafeLines(out.value),false);assert.throws(()=>pitSafe(out.value),/PIT/);
  assert.throws(()=>pitSafe({...out.value,lines:out.value.lines.map(l=>({...l,filedAt:'2024-02-30'}))}),/PIT/);
});

test('Yahoo financial identity cannot be supplied from the request itself',()=>{
  const point={asOfDate:'2024-03-31',currencyCode:'USD',reportedValue:{raw:12}};
  for(const meta of [undefined,{symbol:['MSFT']},{symbol:'MSFT'}])assert.throws(()=>parseYahooFinancials(JSON.stringify({timeseries:{result:[{meta,annualTotalRevenue:[point]}]}}),fakeSource({id:'yahoo'}),CTX_AAPL));
});

test('SEC financials reuse revision selection; latest filing remains a publication date',()=>{
  const line={val:12,start:'2024-01-01',end:'2024-03-31',filed:'2024-05-01',form:'10-Q',fp:'Q1',accn:'0000320193-24-000001'};
  const payload={cik:320193,entityName:'Apple',facts:{'us-gaap':{NetIncomeLoss:{units:{USD:[line,{...line,val:13,filed:'2024-05-02'}]}}}}};
  const out=parseSecFinancials(JSON.stringify(payload),fakeSource({id:'sec'}),CTX_AAPL);
  assert.equal(out.value.lines.length,1);assert.equal(out.value.lines[0].value,13);assert.equal(out.sourceTime,'2024-05-02');
});

test('SEC filings accept 8-K/A but never news',()=>{
  const payload={cik:320193,filings:{recent:{accessionNumber:['0000320193-24-000002'],form:['8-K/A'],filingDate:['2024-05-02'],primaryDocument:['report.htm']}}};
  assert.equal(parseSecFilings(JSON.stringify(payload),fakeSource({id:'sec'}),CTX_AAPL).value.filings[0].form,'8-K/A');
  assert.throws(()=>secDispatch('news',JSON.stringify(payload),fakeSource({id:'sec'}),CTX_AAPL));
});

test('Publication, dividend dates and unknown delay do not become live latency',()=>{
  const provenance={source:'sec',url:'https://data.sec.gov',sourceTime:'2020-01-01',retrievedAt:'2026-09-12T10:00:00Z',official:true,derived:false,delayMinutes:null};
  for(const dataType of ['financials','filings','dividends'] as const){
    const old=gradeFromProvenance(provenance,{dataType}),recent=gradeFromProvenance({...provenance,sourceTime:provenance.retrievedAt},{dataType});
    assert.equal(old.score,recent.score);
  }
  const p={...provenance,official:false,sourceTime:'2026-09-12T09:50:00Z'};
  assert.equal(gradeFromProvenance({...p,delayMinutes:10},{dataType:'price'}).score,gradeFromProvenance(p,{dataType:'price'}).score);
});

test('Yahoo history sourceTime belongs to the last valid bar, not the last timestamp',()=>{
  const t=Date.parse('2024-01-02T14:30:00Z')/1000;
  const payload={chart:{result:[{meta:{symbol:'AAPL',currency:'USD',instrumentType:'EQUITY',exchangeName:'NMS'},timestamp:[t,t+86400],indicators:{quote:[{open:[1,null],high:[2,null],low:[1,null],close:[2,null],volume:[100,null]}]}}]}};
  assert.equal(parseYahooHistory(JSON.stringify(payload),fakeSource({id:'yahoo'}),CTX_AAPL).sourceTime,new Date(t*1000).toISOString());
});

test('Fallback preserves failed SEC attempt, configured reader and Yahoo provenance',async()=>{
  const {fetchViaSources}=await import('../../integration');
  const calls:string[]=[];
  const reader=async(url:string)=>{
    calls.push(url);if(url.includes('sec.gov'))throw Error('synthetic SEC failure');
    return {timeseries:{result:[{meta:{symbol:['AAPL']},annualTotalRevenue:[{asOfDate:'2024-03-31',currencyCode:'USD',reportedValue:{raw:12}}]}]}};
  };
  const out=await fetchViaSources<any>('AAPL','financials','us',{cik:'0000320193',reader});
  assert.equal(calls.length,2);assert.equal(out.result.state,'ok');
  if(out.result.state==='ok'){assert.equal(out.result.provenance.source,'yahoo');assert.equal(out.result.provenance.official,false);assert.equal(out.result.provenance.sourceTime,null);assert.equal(out.result.provenance.delayMinutes,null);}
  assert.deepEqual(out.result.attempts.map(a=>[a.source,a.status]),[['sec','failed'],['yahoo','ok']]);
  const sa=await fetchViaSources('2222.SR','filings','sa',{reader});assert.equal(sa.result.state,'unavailable');assert.equal(sa.result.attempts.length,0);assert.equal(calls.length,2);
});

test('Same-tier disagreement remains unresolved',()=>{
  const provenance={source:'one',url:'',sourceTime:null,retrievedAt:'',official:false,derived:false,delayMinutes:null};
  const r=resolveByTier([{value:10,provenance},{value:20,provenance:{...provenance,source:'two'}}],(a,b)=>a===b,()=> 'provider');
  assert.equal(r.hasConflict,true);assert.equal(r.resolved,null);
});
