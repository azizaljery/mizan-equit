import test from 'node:test';
import assert from 'node:assert/strict';
import {readAzizArchiveStatus} from '../lib/aziz/archive-status.ts';

test('reports persisted counts separately for Saudi and US without claiming five-year coverage', async () => {
  const calls:string[]=[];
  const db={prepare(sql:string){calls.push(sql);return {
    async all(){return {results:[
      {id:'sa',market:'sa',symbol:'2222.SR',name:'أرامكو',bars:1250,first_session:'2021-09-27',last_session:'2026-09-24',last_retrieved_at:'2026-09-27T10:00:00Z',datasets:1,events:0},
      {id:'us',market:'us',symbol:'AAPL',name:'Apple',bars:0,first_session:null,last_session:null,last_retrieved_at:null,datasets:0,events:0},
    ]};},
    async first(){return {id:'run-1',status:'completed_with_errors',requested_batch:1};},
  };}};
  const result=await readAzizArchiveStatus(db);
  assert.equal(result.totalBars,1250);
  assert.equal(result.withBars,1);
  assert.equal(result.expectedSymbols,2);
  assert.equal(result.historicalCompleteness,'not_verified');
  assert.deepEqual(result.symbols.map(row=>[row.market,row.symbol,row.bars]),[['sa','2222.SR',1250],['us','AAPL',0]]);
  assert.equal((result.latestRun as {status:string}).status,'completed_with_errors');
  assert.match(calls[0],/aziz_market_bars/);
  assert.doesNotMatch(calls.join(' '),/forecast_records|mizan_forecast/);
});

test('propagates missing D1 migration instead of reporting an empty archive', async () => {
  const db={prepare(){return {async all(){throw Error('no such table: aziz_symbols');},async first(){return null;}};}};
  await assert.rejects(readAzizArchiveStatus(db),/no such table/);
});
