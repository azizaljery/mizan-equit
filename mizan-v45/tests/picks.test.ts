import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPicks,validPicksRequest,trackRecord,rowToCandidate,type PickRow} from '../lib/picks.ts';

const row=(symbol:string,o:Record<string,unknown>={},extra:Partial<PickRow>={}):PickRow=>({id:symbol+(extra.created_at||'1'),symbol,created_at:'2026-10-16T10:00:00Z',horizon:5,market:'sa',confidence:String(o.confidence??'متوسط'),available:1,
 data:JSON.stringify({recordClass:'prospective-public',available:true,direction:'صاعد',confidence:'متوسط',price:10,predictedPrice:10.5,expectedChangePct:5,range:[9.8,11],priceTime:'2026-10-15',currency:'SAR',coverage:80,sample:100,independent:40,...o}),...extra});
test('only screener-eligible rising forecasts qualify; ranked by screener order',()=>{
  const rows=[row('1111'),row('2222',{confidence:'مرتفع',predictedPrice:10.3,expectedChangePct:3}),row('3333',{direction:'هابط'}),row('4444',{confidence:'منخفض'}),
   row('5555',{predictedPrice:12,expectedChangePct:20,range:[9,11]}),row('6666',{recordClass:'private'})];
  const r=selectPicks(rows,'أسبوعي',3);
  assert.deepEqual(r.picks.map(p=>p.symbol),['2222','1111']);
  assert.equal(r.eligible,2);assert.equal(r.considered,5);
  assert.equal(r.exclusions.not_rising,1);assert.equal(r.exclusions.low_or_unknown_confidence,1);assert.equal(r.exclusions.target_outside_range,1);
});
test('uses the latest record per symbol',()=>{
  const r=selectPicks([row('1111',{direction:'هابط'},{created_at:'2026-10-17T10:00:00Z'}),row('1111')],'أسبوعي',3);
  assert.equal(r.picks.length,0);assert.equal(r.exclusions.not_rising,1);
});
test('count cap and request validation',()=>{
  const rows=['1','2','3','4','5','6'].map(s=>row('100'+s));
  assert.equal(selectPicks(rows,'x',2).picks.length,2);
  assert.throws(()=>validPicksRequest('xx',5,2));assert.throws(()=>validPicksRequest('sa',7,2));assert.throws(()=>validPicksRequest('sa',5,9));
  assert.deepEqual(validPicksRequest('us','21',undefined).count,3);
});
test('broken rows are dropped, not patched',()=>{
  assert.equal(rowToCandidate({...row('1'),data:'{bad'},'x'),null);
  assert.equal(rowToCandidate({...row('1'),market:'xx'},'x'),null);
});
test('track record counts only complete outcomes',()=>{
  const t=trackRecord([{data:JSON.stringify({state:'complete',directionCorrect:true,rangeHit:false})},{data:JSON.stringify({state:'complete',directionCorrect:false,rangeHit:true})},{data:JSON.stringify({state:'excluded'})},{data:'x'}]);
  assert.deepEqual(t,{evaluated:2,directionCorrect:1,directionAccuracy:50,rangeHits:1,rangeCoverage:50});
});
