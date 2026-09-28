import test from 'node:test';
import assert from 'node:assert/strict';
import {listingRestriction,selectCurrentCandidates,assertCurrentInstrument,InactiveInstrumentError,KNOWN_LISTING_EVENTS} from '../lib/listing-lifecycle.ts';
const rows=[{symbol:'1080.SR'},{symbol:'1090.SR'},{symbol:'1120.SR'},{symbol:'AAPL'}];
test('1090 is a documented delisted instrument, not a provider timeout',()=>{
 const x=listingRestriction('1090.SR','2026-09-25');assert.equal(x.status,'delisted');assert.equal(x.effectiveDate,'2021-04-04');assert.equal(x.publishedDate,'2021-04-05');assert.equal(new URL(x.source).hostname,'www.saudiexchange.sa');
});
test('suspension is available before delisting publication, without lookahead',()=>{
 assert.equal(listingRestriction('1090.SR','2021-03-31'),null);
 assert.equal(listingRestriction('1090.SR','2021-04-01').status,'suspended');
 assert.equal(listingRestriction('1090.SR','2021-04-04').status,'suspended');
 assert.equal(listingRestriction('1090.SR','2021-04-05').status,'delisted');
});
test('current candidate filter excludes only the documented restriction',()=>{
 assert.deepEqual(selectCurrentCandidates(rows,'2026-09-25').map(r=>r.symbol),['1080.SR','1120.SR','AAPL']);
});
test('current filter does not mutate or erase the historical directory',()=>{
 const before=JSON.stringify(rows);selectCurrentCandidates(rows,'2026-09-25');assert.equal(JSON.stringify(rows),before);assert.equal(rows[1].symbol,'1090.SR');
});
test('pre-event candidate universe retains historical Samba symbol',()=>{assert.deepEqual(selectCurrentCandidates(rows,'2020-06-01'),rows);});
test('unknown and US symbols are not asserted active or delisted',()=>{
 for(const symbol of ['AAPL','2222.SR','UNKNOWN','1090','1090X.SR'])assert.equal(listingRestriction(symbol,'2026-09-25'),null);
});
test('no alias to the merger successor or changes to unaffected symbols',()=>{
 assert.equal('replacementSymbol' in listingRestriction('1090.SR','2026-09-25'),false);
 assert.deepEqual(selectCurrentCandidates([{symbol:'1180.SR'}],'2026-09-25'),[{symbol:'1180.SR'}]);
});
test('current entry gate returns a typed, explanatory denial',()=>{
 assert.throws(()=>assertCurrentInstrument('1090.SR'),e=>e instanceof InactiveInstrumentError&&e.code==='instrument_not_active'&&e.listing.symbol==='1090.SR'&&e.message.includes('إدراج'));
 assert.doesNotThrow(()=>assertCurrentInstrument('AAPL'));
});
test('invalid cutoff dates cannot silently pass eligibility',()=>{
 for(const date of ['2026-02-30','bad','2026-9-2'])assert.throws(()=>listingRestriction('1090.SR',date),/invalid-listing-date/);
});
test('recorded listing evidence is immutable',()=>{assert.ok(Object.isFrozen(KNOWN_LISTING_EVENTS));assert.ok(KNOWN_LISTING_EVENTS.every(Object.isFrozen));});
