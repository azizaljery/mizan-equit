import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import type {YahooHistoryValue} from '../parsers/yahoo';

const RUN=process.env.MIZAN_LIVE_TESTS==='1';
describe('live — optional upstream connectivity, not production acceptance',()=>{
  for(const [symbol,market,currency] of [['AAPL','us','USD'],['2222.SR','sa','SAR']] as const){
    test(`${symbol}: non-empty matching daily OHLCV`,{skip:RUN?false:'set MIZAN_LIVE_TESTS=1 to run',timeout:60000},async()=>{
      // Lazy imports: the disabled suite does not initialize application transports.
      const {fetchViaSources}=await import('../integration');
      const {upstream}=await import('../../market-data');
      const r=await fetchViaSources<YahooHistoryValue>(symbol,'history',market,{reader:upstream});
      assert.equal(r.result.state,'ok',r.summary);
      if(r.result.state!=='ok')assert.fail(r.summary);
      const v=r.result.value;assert.equal(v.symbol,symbol);assert.equal(v.currency,currency);
      assert.ok(v.prices.length>0);assert.ok(r.result.provenance.sourceTime);
      let previous='';
      for(const p of v.prices){
        assert.match(p.date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(p.date>previous);previous=p.date;
        for(const key of ['open','high','low','close','volume'] as const)assert.ok(Number.isFinite(p[key]),`${key} must be finite`);
        assert.ok(p.open>0&&p.close>0&&p.low>0&&p.high>=p.low&&p.volume>=0);
        assert.ok(p.high>=Math.max(p.open,p.close)&&p.low<=Math.min(p.open,p.close));
      }
    });
  }
});
