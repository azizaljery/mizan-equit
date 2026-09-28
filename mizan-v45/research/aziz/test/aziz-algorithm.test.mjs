import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAzizResearch} from '../src/aziz-algorithm.mjs';
const at=n=>new Date(Date.UTC(2024,0,1+n)).toISOString();
const base={schemaVersion:1,id:'original',symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',issuedAt:at(0),shortTargetAt:at(5),targetAt:at(21),shortHorizon:5,longHorizon:21,shortPrice:102,longPrice:110};
const snapshot={schemaVersion:1,symbol:'AAPL',market:'US',currency:'USD',priceBasis:'split_adjusted',asOf:at(5),observedThrough:at(5),elapsedSessions:5,remainingSessions:16,currentPrice:{value:104,availableAt:at(5)}};
const bridge={schemaVersion:1,market:'US',horizon:21,trainedThrough:at(4),version:'bridge-1',featureNames:['earlyError','baselineRemainingLogReturn'],weights:[0,0],intercept:.01,maxAbsCorrection:.5};
const direction={market:'US',horizon:21,trainedThrough:at(3),version:'direction-1',featureNames:['earlyError','baselineRemainingLogReturn'],weights:[0,0,0]};
const calibration={market:'US',horizon:21,modelVersion:'direction-1',calibratedThrough:at(4),version:'platt-1',weights:[0,1]};
test('AZIZ composes point and calibrated probability without replacing original',()=>{
 const r=runAzizResearch({base,snapshot,bridge,direction,calibration,policy:{},facts:{market:'US',dataQuality:'ok'}});
 assert.equal(r.original,base);assert.equal(r.effective,base);assert.equal(r.route,'fallback');
 assert.equal(r.shadow.status,'corrected');assert.equal(r.shadow.probabilityUp,.5);
 assert.equal(r.components.bridge,'corrected');assert.equal(r.components.probability,'available');
});
test('AZIZ abstains on missing model, rejects future or wrong-market artifacts',()=>{
 const empty=runAzizResearch({base,snapshot});assert.equal(empty.effective,base);assert.equal(empty.shadow,null);
 assert.throws(()=>runAzizResearch({base,snapshot,bridge:{...bridge,trainedThrough:at(5)}}));
 assert.throws(()=>runAzizResearch({base,snapshot,bridge,direction:{...direction,market:'SA'},calibration}));
});
