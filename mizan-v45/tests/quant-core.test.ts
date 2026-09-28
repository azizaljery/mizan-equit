import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PurgedWalkForwardValidator,FractionalDifferentiator} from '../lib/quant-core';
import {RegimeEngine} from '../lib/regime-engine';
test('splits reference original rows, purge labels and exclude embargoed sessions',()=>{
 const records=Array.from({length:30},(_,i)=>({id:i,timestamp:i,labelHorizonEndTimestamp:i+1})).reverse();
 const splits=new PurgedWalkForwardValidator(3,3,0.1).generateSplits(records);
 assert.ok(splits.length>1);
 for(const s of splits){assert.equal(new Set(s.trainIndices).size,s.trainIndices.length);for(const i of s.trainIndices)assert.ok(records[i].labelHorizonEndTimestamp<s.testStart);for(const i of s.testIndices)assert.ok(records[i].timestamp>=s.testStart&&records[i].timestamp<=s.testEnd);}
 const prior=splits[0],next=splits[1];
 assert.ok(next.embargoedCount>0);
 assert.ok(next.trainIndices.every(i=>records[i].timestamp<=prior.testEnd||records[i].timestamp>prior.testEnd+3));
 assert.deepEqual(new PurgedWalkForwardValidator(3,2,0).generateSplits(records.map(r=>({...r,labelHorizonEndTimestamp:100}))),[]);
});
test('invalid configs and timestamps cannot hang or silently pass',()=>{
 assert.throws(()=>new PurgedWalkForwardValidator(0,0));
 assert.throws(()=>new PurgedWalkForwardValidator(2,2,NaN));
 assert.throws(()=>new PurgedWalkForwardValidator().generateSplits([{id:1,timestamp:NaN,labelHorizonEndTimestamp:1}]));
});
test('metrics fail closed for invalid inputs and missing DSR evidence',()=>{
 const v=new PurgedWalkForwardValidator();
 for(const r of [[],[NaN,0.1],[-2,0.1]])assert.equal(v.evaluateChampionship(r,[],[]).isAccepted,false);
 const m=v.evaluateChampionship([0.01,-0.02,0.03],[0.8],[1],1,252);
 assert.ok(Math.abs(m.maxDrawdown!-0.02)<1e-12);assert.ok(Math.abs(m.brierScore!-0.04)<1e-12);
 assert.equal(m.deflatedSharpeProbability,null);assert.equal(m.isAccepted,false);
 assert.equal(v.evaluateChampionship([0.01,-0.02],[0.8],[1,0]).brierScore,null);
 assert.equal(v.evaluateChampionship([0.01,-0.02],[],[]).annualizedSharpe,null);
});
test('fractional transform preserves identity, first difference and missing data',()=>{
 assert.deepEqual(FractionalDifferentiator.transform([1,3,6],0),[1,3,6]);
 assert.deepEqual(FractionalDifferentiator.transform([1,3,6],1),[null,2,3]);
 assert.deepEqual(FractionalDifferentiator.transform([],0),[]);
 assert.deepEqual(FractionalDifferentiator.transform([1,NaN,6],1),[null,null,null]);
});
test('regime rejects bad and insufficient prices, detects a large shock deterministically',()=>{
 assert.equal(RegimeEngine.detect([1,2]).available,false);
 assert.equal(RegimeEngine.detect(new Array(30).fill(0)).available,false);
 const flat=new Array(30).fill(100);
 assert.equal(RegimeEngine.detect(flat).currentRegime,'MEAN_REVERTING');
 const shock=[...flat,150];const result=RegimeEngine.detect(shock);
 assert.equal(result.currentRegime,'VOLATILITY_SHOCK');assert.equal(result.calibrated,false);
 assert.deepEqual(result,RegimeEngine.detect(shock));
});
