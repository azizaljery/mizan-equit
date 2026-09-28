import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectCurrentCandidates} from '../lib/listing-lifecycle.ts';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('actual Saudi directory retains Samba while current candidates exclude it',async()=>{
 const directory=JSON.parse(await read('lib/data/saudi-directory.json'));
 const rows=directory.rows.map(r=>({symbol:String(r.symbol)+'.SR'}));
 assert.ok(rows.some(r=>r.symbol==='1090.SR'));
 assert.ok(!selectCurrentCandidates(rows).some(r=>r.symbol==='1090.SR'));
 assert.equal(rows.length-selectCurrentCandidates(rows).length,1);
});
test('collector and screener explicitly opt into the current universe',async()=>{
 for(const path of ['worker/market-collector.ts','lib/screener.ts']){
  const source=await read(path);assert.ok(source.includes("eligibleSaudiCompanies('current')"));assert.ok(source.includes('assertCurrentInstrument('));
 }
});
test('historical callers retain their original directory rather than current-only filtering',async()=>{
 const source=await read('lib/accuracy-sample.ts');assert.ok(source.includes('eligibleSaudiCompanies()'));assert.ok(!source.includes("eligibleSaudiCompanies('current')"));
 const directory=await read('lib/saudi-directory.ts');assert.ok(directory.includes("scope:'directory'|'current'='directory'"));
});
test('common current-analysis service checks before any DB or provider reads',async()=>{
 const source=await read('lib/research-service.ts');const body=source.slice(source.indexOf('export async function analyzedCompany'));
 assert.ok(body.indexOf('assertCurrentInstrument(symbol)')<body.indexOf('await readSettings(db)'));
});
test('watchlist skips known inactive instruments without deleting saved entries',async()=>{
 const source=await read('worker/watchlist-scheduled.ts');assert.ok(source.indexOf('if(listingRestriction(symbol))')<source.indexOf('const q=await fetchLiveQuote'));
 assert.ok(!source.includes('DELETE FROM customer_market_watch'));
});
