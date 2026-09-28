import {after, before, describe, mock, test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveCik, resolveCikDetailed, needsCik, normalizeSecTicker} from '../cik';
import {parseYahooHistory, parseYahooFinancials} from '../parsers/yahoo';
import {parseSecFinancials} from '../parsers/sec';
import {gradeFromProvenance} from '../quality';
import {fetchWithFallback} from '../fallback';
import {fetchViaSources} from '../integration';
import {getParser} from '../parsers';
import {resolveSource} from '../resolver';
import {pitSafe, hasPitSafeLines} from '../parsers/pit';
import {USER_AGENT} from '../../market-data';
import type {SourceRef, Provenance} from '../types';
import type {ParsedFinancials} from '../parsers/types';

// Fail closed if a test accidentally escapes its injected reader/fetcher.
before(()=>{mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected network in acceptance tests');});});
after(()=>mock.restoreAll());

const AS_OF='2025-01-01';
const CIK='0000320193';
const TICKERS='https://www.sec.gov/files/company_tickers.json';
const yahooRef:SourceRef={id:'yahoo',name:'Yahoo Finance',tier:'provider',market:'global',
  dataTypes:['history','financials'],urlTemplate:'https://query1.finance.yahoo.com/',
  requiresKey:false,official:false,derived:false,knownDelayMinutes:null,
  resolvedUrl:'https://query1.finance.yahoo.com/v8/finance/chart/AAPL'};
const secRef:SourceRef={...yahooRef,id:'sec',name:'SEC EDGAR',tier:'regulator',market:'us',
  dataTypes:['financials'],official:true,urlTemplate:'https://data.sec.gov/',
  resolvedUrl:`https://data.sec.gov/api/xbrl/companyfacts/CIK${CIK}.json`};
const context={expectedSymbol:'AAPL',expectedCik:CIK,asOf:AS_OF};
function history(symbol='AAPL',currency='USD'){
  return {chart:{result:[{meta:{symbol,currency,exchangeName:symbol.endsWith('.SR')?'SAU':'NMS',instrumentType:'EQUITY',gmtoffset:0},
    timestamp:[1700000000],indicators:{quote:[{open:[100],high:[110],low:[95],close:[105],volume:[1000000]}]}}]}};
}
function yahooFinancials(symbol='AAPL'){
  return {timeseries:{result:[{meta:{symbol:[symbol],type:['annualTotalRevenue']},annualTotalRevenue:[
    {reportedValue:{raw:391035000000},asOfDate:'2024-09-28',currencyCode:'USD',periodType:'12M'},
  ]}]}};
}
const secFinancials={cik:320193,entityName:'Apple Inc.',facts:{'us-gaap':{
  Revenues:{units:{USD:[{start:'2023-10-01',end:'2024-09-28',val:391035000000,form:'10-K',
    accn:'0000320193-24-000123',filed:'2024-11-01',fy:2024,fp:'FY'}]}},
}}};

describe('Criterion 1 — AAPL history',()=>{
  test('valid OHLCV and exact accepted-bar sourceTime',()=>{
    const p=parseYahooHistory(JSON.stringify(history()),yahooRef,context);
    assert.equal(p.value.symbol,'AAPL');assert.equal(p.value.currency,'USD');
    assert.deepEqual(p.value.prices,[{date:'2023-11-14',open:100,high:110,low:95,close:105,volume:1000000}]);
    assert.equal(p.sourceTime,new Date(1700000000000).toISOString());
  });
  test('empty series is rejected',()=>{
    const d=history();d.chart.result[0].timestamp=[];
    assert.throws(()=>parseYahooHistory(JSON.stringify(d),yahooRef,context));
  });
  test('valid prices with wrong symbol are rejected',()=>{
    assert.throws(()=>parseYahooHistory(JSON.stringify(history('MSFT')),yahooRef,context));
  });
});

describe('Criterion 2 — Saudi identity',()=>{
  test('SAR is accepted and USD rejected for 2222.SR',()=>{
    const ctx={expectedSymbol:'2222.SR',asOf:AS_OF};
    const p=parseYahooHistory(JSON.stringify(history('2222.SR','SAR')),yahooRef,ctx);
    assert.equal(p.value.symbol,'2222.SR');assert.equal(p.value.currency,'SAR');assert.equal(p.value.prices.length,1);
    assert.throws(()=>parseYahooHistory(JSON.stringify(history('2222.SR','USD')),yahooRef,ctx));
  });
});

describe('Criterion 3 — SEC financials and source priority',()=>{
  test('wrong or absent expected CIK is rejected',()=>{
    assert.throws(()=>parseSecFinancials(JSON.stringify(secFinancials),secRef,{...context,expectedCik:'0000000001'}));
    assert.throws(()=>parseSecFinancials(JSON.stringify(secFinancials),secRef,{expectedSymbol:'AAPL',asOf:AS_OF}));
  });
  test('matching CIK yields actual annual revenue and publication date',()=>{
    const p=parseSecFinancials(JSON.stringify(secFinancials),secRef,context);
    assert.equal(p.value.symbol,'AAPL');assert.equal(p.value.currency,'USD');
    assert.equal(p.value.lines.length,1);
    assert.equal(p.value.lines[0].key,'revenue');assert.equal(p.value.lines[0].value,391035000000);
    assert.equal(p.value.lines[0].period,'annual');assert.equal(p.value.lines[0].filedAt,'2024-11-01');
    assert.equal(p.sourceTime,'2024-11-01');
  });
  test('SEC publication after cutoff is excluded',()=>{
    assert.throws(()=>parseSecFinancials(JSON.stringify(secFinancials),secRef,{...context,asOf:'2024-10-31'}));
  });
  test('resolver places SEC before Yahoo',async()=>{
    const r=await resolveSource('AAPL','financials','us',new Set(),{cik:CIK});
    assert.equal(r.state,'resolved');if(r.state!=='resolved')assert.fail('No source chain');
    assert.equal(r.primary.id,'sec');assert.ok(r.fallbacks.some(s=>s.id==='yahoo'));
  });
});

describe('Criterion 4 — automatic CIK through integration',()=>{
  test('ticker normalization and request scope',()=>{
    assert.equal(normalizeSecTicker(' brk.b '),'BRK-B');
    assert.equal(needsCik('financials','us'),true);assert.equal(needsCik('filings','us'),true);
    assert.equal(needsCik('history','us'),false);assert.equal(needsCik('financials','sa'),false);
  });
  test('same reader resolves the map and fetches SEC financials',async()=>{
    const calls:string[]=[];
    const reader=async(url:string,json?:boolean,ttl?:number)=>{
      calls.push(url);
      if(url===TICKERS){assert.equal(json,true);assert.equal(ttl,86400000);return {0:{ticker:'AAPL',cik_str:320193}};}
      assert.equal(url,secRef.resolvedUrl);return secFinancials;
    };
    const {result}=await fetchViaSources<ParsedFinancials>('AAPL','financials','us',{reader});
    assert.equal(result.state,'ok');if(result.state!=='ok')assert.fail('SEC result unavailable');
    assert.equal(result.provenance.source,'sec');assert.equal(result.value.lines.length,1);
    assert.deepEqual(calls,[TICKERS,secRef.resolvedUrl]);
  });
  test('caller-provided CIK prevents map lookup',async()=>{
    const calls:string[]=[];
    const {result}=await fetchViaSources('AAPL','financials','us',{cik:CIK,reader:async(url)=>{calls.push(url);return secFinancials;}});
    assert.equal(result.state,'ok');assert.deepEqual(calls,[secRef.resolvedUrl]);
  });
  test('no lookup for history or Saudi filings',async()=>{
    const calls:string[]=[];
    const reader=async(url:string)=>{calls.push(url);return history();};
    assert.equal((await fetchViaSources('AAPL','history','us',{reader})).result.state,'ok');
    assert.equal((await fetchViaSources('2222.SR','filings','sa',{reader})).result.state,'unavailable');
    assert.equal(calls.length,1);assert.ok(!calls.includes(TICKERS));
  });
  test('missing, zero, malformed or failed CIK returns null',async()=>{
    for(const cik_str of [undefined,null,'',0,'0000000000',-1,1.5,'12345678901',{}]){
      assert.equal(await resolveCik('AAPL',async()=>({0:{ticker:'AAPL',cik_str}})),null);
    }
    assert.equal(await resolveCik('AAPL',async()=>{throw Error('network disabled');}),null);
    assert.equal(await resolveCik('NOPE',async()=>({})),null);
  });
  test('detailed resolution retains an auditable failure reason',async()=>{
    const r=await resolveCikDetailed('AAPL',async()=>{throw Error('SEC unavailable');});
    assert.equal(r.ok,false);if(!r.ok)assert.match(r.reason,/SEC unavailable/);
  });
});

describe('Criterion 5 — unresolved CIK and fallback identity',()=>{
  test('empty map permits a matching Yahoo fallback, without SEC request',async()=>{
    const calls:string[]=[];
    const {result}=await fetchViaSources<ParsedFinancials>('NOPE','financials','us',{reader:async(url)=>{
      calls.push(url);if(url===TICKERS)return {};
      assert.ok(!url.includes('data.sec.gov'));return yahooFinancials('NOPE');
    }});
    assert.equal(result.state,'ok');if(result.state!=='ok')assert.fail('Matching Yahoo data rejected');
    assert.equal(result.value.symbol,'NOPE');assert.equal(result.provenance.source,'yahoo');
    assert.deepEqual(result.attempts.map(a=>a.source),['yahoo']);assert.equal(calls.length,2);
  });
  test('NOPE request cannot accept AAPL financials',async()=>{
    const {result}=await fetchViaSources('NOPE','financials','us',{reader:async(url)=>url===TICKERS?{}:yahooFinancials()});
    assert.equal(result.state,'failed');assert.deepEqual(result.attempts.map(a=>a.status),['failed']);
  });
  test('failure of supplied CIK reader does not bypass it',async()=>{
    const calls:string[]=[];
    const {result}=await fetchViaSources('AAPL','financials','us',{reader:async(url)=>{
      calls.push(url);if(url===TICKERS)throw Error('SEC disabled');return yahooFinancials();
    }});
    assert.equal(result.state,'ok');assert.equal(calls.length,2);
    assert.ok(calls.every(url=>!url.includes('data.sec.gov')));
  });
});

describe('Criterion 6 — HTTP 200 is not parsed success',()=>{
  test('parsers reject malformed JSON and empty financials',()=>{
    assert.throws(()=>parseYahooHistory('<html>500</html>',yahooRef,context));
    assert.throws(()=>parseYahooFinancials(JSON.stringify({timeseries:{result:[]}}),yahooRef,context));
    assert.throws(()=>parseSecFinancials('not json',secRef,context));
  });
  test('HTTP 200 malformed or empty payload produces failed attempt',async()=>{
    for(const body of ['not json','{}','']){
      const fetcher:typeof fetch=async()=>new Response(body,{status:200});
      const r=await fetchWithFallback('AAPL','history','us',new Set(),getParser('history'),{fetcher});
      assert.equal(r.state,'failed');assert.equal(r.attempts.length,1);assert.equal(r.attempts[0].status,'failed');
    }
  });
});

describe('Criterion 7 — provenance and PIT limits',()=>{
  const base:Provenance={source:'yahoo',url:'https://example.test/',retrievedAt:'2025-01-01T12:00:00Z',sourceTime:null,official:false,derived:false,delayMinutes:null};
  test('price without sourceTime scores below the otherwise identical fresh price',()=>{
    const absent=gradeFromProvenance(base,{dataType:'price'});
    const fresh=gradeFromProvenance({...base,sourceTime:base.retrievedAt},{dataType:'price'});
    assert.ok(absent.score<fresh.score);assert.notEqual(absent.grade,'excellent');
  });
  test('financial publication age is not price latency or proof of completeness',()=>{
    const absent=gradeFromProvenance({...base,official:true},{dataType:'financials'});
    const dated=gradeFromProvenance({...base,official:true,sourceTime:'2020-01-01'},{dataType:'financials'});
    assert.equal(absent.score,dated.score);
  });
  test('actual Yahoo output preserves null publication and is excluded by PIT helper',()=>{
    const parsed=parseYahooFinancials(JSON.stringify(yahooFinancials()),yahooRef,context);
    assert.equal(parsed.sourceTime,null);assert.ok(parsed.value.lines.every(l=>l.filedAt===null));
    assert.equal(hasPitSafeLines(parsed.value),false);assert.throws(()=>pitSafe(parsed.value));
  });
});

describe('Criterion 8 — ordered and honest attempts',()=>{
  test('failed SEC followed by successful Yahoo records both attempts',async()=>{
    const r=await fetchWithFallback('AAPL','financials','us',new Set(),getParser('financials'),{
      cik:CIK,reader:async(url)=>{if(url.includes('data.sec.gov'))throw Error('SEC 503');return yahooFinancials();},
    });
    assert.equal(r.state,'ok');if(r.state!=='ok')assert.fail('Fallback failed');
    assert.equal(r.provenance.source,'yahoo');assert.equal(r.provenance.official,false);
    assert.deepEqual(r.attempts.map(a=>[a.source,a.status]),[['sec','failed'],['yahoo','ok']]);
  });
  test('all sources fail with both attempts preserved',async()=>{
    const r=await fetchWithFallback('AAPL','financials','us',new Set(),getParser('financials'),{
      cik:CIK,reader:async()=>{throw Error('down');},
    });
    assert.equal(r.state,'failed');assert.deepEqual(r.attempts.map(a=>[a.source,a.status]),[['sec','failed'],['yahoo','failed']]);
  });
});

describe('User-Agent transport contract',()=>{
  test('default, custom and empty UA on the direct fallback transport',async()=>{
    for(const userAgent of [undefined,'Mizan acceptance test','']){
      const headers:Headers[]=[];
      const fetcher:typeof fetch=async(_url,init)=>{headers.push(new Headers(init?.headers));return Response.json(history());};
      const r=await fetchWithFallback('AAPL','history','us',new Set(),getParser('history'),{fetcher,userAgent});
      assert.equal(r.state,'ok');assert.equal(headers.length,1);
      assert.equal(headers[0].get('user-agent'),userAgent||USER_AGENT);
    }
  });
  test('auto-CIK forwards custom fetcher and UA without using global fetch',async()=>{
    const calls:Array<{url:string;ua:string|null}>=[];
    const fetcher:typeof fetch=async(input,init)=>{
      const url=String(input);calls.push({url,ua:new Headers(init?.headers).get('user-agent')});
      return Response.json(url===TICKERS?{0:{ticker:'AAPL',cik_str:320193}}:secFinancials);
    };
    const {result}=await fetchViaSources('AAPL','financials','us',{fetcher,userAgent:'Mizan injected transport'});
    assert.equal(result.state,'ok');assert.deepEqual(calls,[TICKERS,secRef.resolvedUrl].map(url=>({url,ua:'Mizan injected transport'})));
  });
});
