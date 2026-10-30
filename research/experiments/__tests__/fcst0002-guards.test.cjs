'use strict';
const test = require('node:test'), A = require('node:assert/strict');
const G = require('../fcst0002-guards.cjs');
const {audit} = require('../audit-fcst0001.cjs');
const row = (more={}) => ({sym:'1120.SR',market:'sa',h:5,date:'2020-01-01',labelDate:'2020-01-08',sig:.02,y:.01,...more});
const scope = {asOf:'2020-01-10',market:'sa',h:5};
test('labels at or after origin cannot calibrate',()=>{
 A.equal(G.calibrationWindow([row(),row({sym:'2222.SR',labelDate:'2020-01-10'}),row({sym:'1180.SR',labelDate:'2020-01-11'})],scope).length,1);
});
test('future labels do not alter historical quantiles',()=>{
 const policy={minRows:1,minDates:1,alpha:.2};
 const a=G.empiricalZeroCentre([row()],scope,policy);
 const b=G.empiricalZeroCentre([row(),row({sym:'OTHER',labelDate:'2020-02-01',y:999})],scope,policy);
 A.deepEqual(a,b);
});
test('sealed origin rejected',()=>A.throws(()=>G.calibrationWindow([],{...scope,asOf:'2024-09-05'})));
test('invalid dates rejected',()=>A.throws(()=>G.calibrationWindow([row({date:'2020-02-30'})],scope)));
test('market and horizon separated',()=>A.equal(G.calibrationWindow([row({h:21}),row({sym:'AAPL',market:'us'})],scope).length,0));
test('duplicates rejected',()=>A.throws(()=>G.calibrationWindow([row(),row()],scope)));
test('calibration count does not become effectiveN',()=>{
 const r=G.empiricalZeroCentre([row()],scope,{minRows:1,minDates:1,alpha:.2});
 A.equal(r.status,'RESEARCH_ONLY'); A.equal(r.effectiveN,null);
});
test('insufficient dates abstain despite many stocks',()=>{
 const rows=Array.from({length:20},(_,i)=>row({sym:'S'+i}));
 A.equal(G.empiricalZeroCentre(rows,scope,{minRows:10,minDates:2,alpha:.2}).status,'INSUFFICIENT_CALIBRATION');
});
test('score reuses Winkler units and penalty',()=>{
 const s=G.scoreInterval({y:.03,lo:-.01,hi:.01,sig:.01,h:1,alpha:.2});
 A.equal(s.covered,false); A.ok(Math.abs(s.winkler-22)<1e-10);
});
test('invalid intervals fail',()=>A.throws(()=>G.scoreInterval({y:0,lo:1,hi:0,sig:1,h:5,alpha:.2})));
test('MDE 2.5 percent cannot resolve target 1 percent',()=>{
 A.equal(G.powerGate({sigmaD:.1,effectiveN:100,referenceLoss:1,targetRelative:.01,multiplier:2.5}).status,'UNDERPOWERED');
});
test('missing power information remains unknown',()=>A.equal(G.powerGate({}).status,'UNKNOWN'));
test('dates weighted equally rather than by stock count',()=>{
 const r=G.pairedDateLoss([{sym:'A',date:'2020-01-01',candidate:0,reference:1},{sym:'B',date:'2020-01-01',candidate:0,reference:1},{sym:'A',date:'2020-01-02',candidate:2,reference:1}]);
 A.equal(r.meanDifference,0); A.equal(r.nDates,2);
});
test('duplicate pairs rejected',()=>A.throws(()=>G.pairedDateLoss([{sym:'A',date:'2020-01-01',candidate:1,reference:1},{sym:'A',date:'2020-01-01',candidate:1,reference:1}])));
test('audit rejects wrong protocol',()=>A.throws(()=>audit({protocol:'OTHER'})));
