import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const mocks={
 'research-model':`export const HORIZONS=[{name:'يومي',sessions:1},{name:'أسبوع',sessions:5},{name:'شهر',sessions:21},{name:'3 أشهر',sessions:63},{name:'6 أشهر',sessions:126},{name:'سنة',sessions:252}];export const forecastModelVersion=s=>'fixture-'+s.tag;export const forecasts=(...a)=>globalThis.__screenTest.forecast(...a);`,
 'market-data':`export const fetchCompany=(...a)=>globalThis.__screenTest.fetchCompany(...a);export const fetchLiveQuote=(...a)=>globalThis.__screenTest.fetchQuote(...a);`,
 'site-settings':`export const readSettings=async()=>globalThis.__screenTest.settings;`,
 'source-status':`export const configuredReader=async(db,s)=>{globalThis.__screenTest.readerSettings=s;return ()=>{};};`,
 'saudi-directory':`export const eligibleSaudiCompanies=scope=>{if(scope!=='current')throw Error('not current');return Array.from({length:250},(_,i)=>({symbol:(2000+i)+'.SR'}));};`,
 'us-directory':`export const eligibleUSCompanies=()=>Array.from({length:250},(_,i)=>({symbol:'US'+i}));`,
 'listing-lifecycle':`export const assertCurrentInstrument=s=>{if(s==='1090.SR')throw Error('ملغى الإدراج');};`,
};
const dir=await mkdtemp(join(tmpdir(),'mizan-screener-'));
const outfile=join(dir,'screener.cjs');
await build({entryPoints:[new URL('../lib/screener.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile,
 plugins:[{name:'canonical-dependency-fixtures',setup(b){b.onResolve({filter:/.*/},args=>{const name=args.path.replace(/^\.\//,'');if(mocks[name])return {path:name,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const {planScreener,runScreener}=createRequire(import.meta.url)(outfile);
function reset(){const state={settings:{enabledMarkets:['sa','us'],periods:{},tag:'one'},calls:[],quoteCalls:0,readerSettings:null,
 async fetchCompany(symbol){if(symbol==='FAIL')throw Error('تعذر المصدر');return {company:{symbol,name:symbol,exchange:'fixture'},currency:symbol.endsWith('.SR')?'SAR':'USD',prices:Array.from({length:30},()=>({close:100})),retrievedAt:'2026-09-25T00:00:00Z',priceSource:'https://example.com'};},
 async fetchQuote(symbol){state.quoteCalls++;return {symbol,quoteTime:new Date().toISOString(),price:100,currency:'USD'};},
 forecast(report,quote,now,settings,horizons){state.calls.push({report,quote,settings,horizons});return {priceTime:'2026-09-24',dataQuality:'جيدة',rows:[{sessions:horizons[0].sessions,price:100,predictedPrice:110,expectedChangePct:10,direction:'صاعد',range:[80,120],available:true,confidence:report.company.symbol==='LOW'?'منخفض':'متوسط',dataQuality:'جيدة',coverage:70,sample:200,independent:30,basis:['سبب موثق'],reasons:['تحذير'],risks:['خطر'],invalidation:['مراجعة'],riskLevel:'متوسط'}]};}};
 globalThis.__screenTest=state;return state;}
test('200-symbol plan is balanced and does not call providers or forecasts',async()=>{const s=reset(),p=await planScreener({}, {market:'both',horizonSessions:5,resultCount:10,scanLimit:200});assert.equal(p.symbols.length,200);assert.deepEqual(p.selectedCount,{sa:100,us:100});assert.equal(p.batchSize,1);assert.equal(s.calls.length,0);});
test('actual orchestrator passes settings and only the selected horizon',async()=>{const s=reset(),r=await runScreener({}, {market:'us',horizonSessions:21,resultCount:7,symbols:['AAPL']});assert.equal(s.readerSettings,s.settings);assert.equal(s.calls[0].settings,s.settings);assert.deepEqual(s.calls[0].horizons,[{name:'شهر',sessions:21}]);assert.equal(r.requestedResultCount,7);assert.equal(r.returned,1);assert.equal(r.missingCount,6);assert.deepEqual(r.candidates[0].basis,['سبب موثق']);assert.equal(r.candidates[0].priceTime,'2026-09-24');});
test('daily passes a real quote rather than forcing the engine quote to null',async()=>{const s=reset();await runScreener({}, {market:'us',horizonSessions:1,symbols:['AAPL']});assert.equal(s.quoteCalls,1);assert.equal(s.calls[0].quote.symbol,'AAPL');});
test('failed sources and low confidence are distinct and not padded',async()=>{reset();const r=await runScreener({}, {market:'us',horizonSessions:5,resultCount:10,symbols:['AAPL','FAIL','LOW']});assert.equal(r.scanned,3);assert.equal(r.analyzed,2);assert.equal(r.failed,1);assert.equal(r.excluded,1);assert.equal(r.returned,1);assert.equal(r.exclusionCounts.low_or_unknown_confidence,1);});
test('known delisting is rejected before the model',async()=>{const s=reset(),r=await runScreener({}, {market:'sa',horizonSessions:5,symbols:['1090.SR']});assert.equal(s.calls.length,0);assert.equal(r.failed,1);});
test('market and horizon admin gates precede provider calls',async()=>{const s=reset();s.settings.enabledMarkets=['us'];await assert.rejects(runScreener({}, {market:'both',horizonSessions:5}));s.settings.periods[21]={enabled:false};await assert.rejects(runScreener({}, {market:'us',horizonSessions:21}));assert.equal(s.calls.length,0);});
test('settings changes during a scan are not silently merged',async()=>{const s=reset();await assert.rejects(runScreener({}, {market:'us',horizonSessions:5,expectedVersion:'fixture-previous',symbols:['AAPL']}));assert.equal(s.calls.length,0);});
test('both-market batch reports per-stock currencies and separate result quotas',async()=>{reset();const r=await runScreener({}, {market:'both',horizonSessions:5,resultCount:10,symbols:['2222','AAPL']});assert.equal(r.candidates.length,2);assert.equal(r.missingCount,18);assert.equal(r.candidates.find(c=>c.symbol==='2222.SR').currency,'SAR');assert.equal(r.candidates.find(c=>c.symbol==='AAPL').currency,'USD');});
test('existing page presents independent choices and server-authoritative archive batches',async()=>{const s=await readFile(new URL('../app/screener/page.tsx',import.meta.url),'utf8');for(const v of ['عدد النتائج المطلوبة','عدد الأسهم المفحوصة','[5,6,7,8,9,10]','[20,40,100,200]','mergeScreenerResults','archive:true','batchIndex:offset/p.batchSize','c.basis.map','إيقاف المسح'])assert.ok(s.includes(v),v);});
test('capture receives the original projection and no second forecast call',async()=>{const s=reset();let captured;await runScreener({}, {market:'us',horizonSessions:5,symbols:['AAPL','LOW']},async ev=>{captured=ev;});assert.equal(s.calls.length,2);assert.equal(captured.length,1);assert.equal(captured[0].candidate.symbol,'AAPL');assert.equal(captured[0].projection.rows[0].predictedPrice,110);});
test('failed durable capture cannot return a false successful scan',async()=>{reset();await assert.rejects(runScreener({}, {market:'us',horizonSessions:5,symbols:['AAPL']},async()=>{throw Error('write-failed');}));});
test.after(async()=>{delete globalThis.__screenTest;await rm(dir,{recursive:true,force:true});});
