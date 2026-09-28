import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveCik,needsCik,normalizeSecTicker} from '../lib/sources/cik.ts';

test('CIK uses the supplied reader and existing SEC map URL/TTL',async()=>{
  const calls=[];
  const read=async(...args)=>{calls.push(args);return {0:{ticker:'AAPL',cik_str:320193}};};
  assert.equal(await resolveCik(' aapl ',read),'0000320193');
  assert.deepEqual(calls,[['https://www.sec.gov/files/company_tickers.json',true,86400000]]);
});
test('SEC ticker normalization handles share classes',async()=>{
  assert.equal(normalizeSecTicker(' brk.b '),'BRK-B');
  assert.equal(await resolveCik('BRK.B',async()=>({0:{ticker:'BRK-B',cik_str:1067983}})),'0001067983');
});
test('Missing, zero and malformed CIKs never become valid padded identities',async()=>{
  for(const cik_str of [undefined,null,'',0,'0000000000',-1,1.5,'1e2','12345678901',{},true]){
    assert.equal(await resolveCik('AAPL',async()=>({0:{ticker:'AAPL',cik_str}})),null);
  }
});
test('Invalid symbols do not read; failed or unmatched maps return null',async()=>{
  const forbidden=async()=>{assert.fail('reader must not be called');};
  for(const symbol of ['', ' ', '2222.SR', '../AAPL'])assert.equal(await resolveCik(symbol,forbidden),null);
  assert.equal(await resolveCik('AAPL',async()=>{throw Error('disabled source');}),null);
  for(const map of [null,[],{},'invalid',{0:null},{0:{ticker:'MSFT',cik_str:789019}}]){
    assert.equal(await resolveCik('AAPL',async()=>map),null);
  }
});
test('CIK lookup is needed only for US financials and filings',()=>{
  assert.equal(needsCik('financials','us'),true);
  assert.equal(needsCik('filings','us'),true);
  assert.equal(needsCik('financials','sa'),false);
  for(const type of ['price','history','news','dividends'])assert.equal(needsCik(type,'us'),false);
});
