import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readCompanyDeepLink} from '../lib/company-deep-link';
test('ordinary home navigation does not request a company',()=>assert.equal(readCompanyDeepLink(''),null));
for(const q of ['?symbol=2222','?symbol=2222.sr','?symbol=٢٢٢٢'])test('Saudi deep link '+q,()=>assert.deepEqual(readCompanyDeepLink(q),{symbol:'2222.SR',market:'sa'}));
for(const symbol of ['AAPL','BRK-B','BRK.B'])test('US deep link '+symbol,()=>assert.deepEqual(readCompanyDeepLink('?symbol='+symbol.toLowerCase()),{symbol,market:'us'}));
test('foreign suffix is not silently treated as US',()=>assert.deepEqual(readCompanyDeepLink('?symbol=7203.T'),{symbol:'7203.T',market:'global'}));
for(const q of ['?symbol=','?symbol=AAPL&symbol=MSFT','?symbol=%3Cscript%3E','?symbol=https://evil.test','?symbol=INVALID.SR','?symbol='+ 'A'.repeat(21)])test('invalid deep link rejected '+q,()=>assert.throws(()=>readCompanyDeepLink(q)));
test('home routes deep links through its existing guarded analysis function',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('readCompanyDeepLink(window.location.search)'));
 assert.ok(source.includes('if(!settings.enabledMarkets.includes(target.market))'));
 assert.ok(source.includes('void analyzeCompany({symbol:target.symbol'));
 assert.ok(source.indexOf('pendingDeepLink.current=null;\n    void analyzeCompany')>source.indexOf('const timer=setTimeout(()=>{'));
});
