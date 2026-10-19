// Sources audit 2026-10-19: SEC companyconcept fallback, same-site redirects, refusal pause, accurate admin states.
import test from 'node:test';
import assert from 'node:assert/strict';
const M=()=>import(process.env.MIZAN_TEST_MODULE);
async function databaseFixture(){const {DatabaseSync}=await import('node:sqlite'),{readFileSync,readdirSync}=await import('node:fs');const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>/^00(0\d|10)_.*\.sql$/.test(f)).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,v=[])=>({bind(...values){return prepare(sql,values)},run:async()=>sqlite.prepare(sql).run(...v),first:async()=>sqlite.prepare(sql).get(...v),all:async()=>({results:sqlite.prepare(sql).all(...v)})});
 return {sqlite,db:{prepare,batch:async s=>{const r=[];for(const x of s)r.push(await x.run());return r;}}};}
const CIK='0000000001';
const concept=(tag,val,extra={})=>({cik:1,taxonomy:'us-gaap',tag,entityName:'Test Corp',units:{USD:[{val,start:'2025-01-01',end:'2025-12-31',filed:'2026-02-01',form:'10-K',fy:2025,fp:'FY',accn:'0000000001-26-000001',...extra}]}});

test('readSECConcepts builds a companyfacts-shaped object, treats 404 as absence and rejects a foreign CIK',async()=>{
 const {readSECConcepts,parseSECFacts,secConceptURL}=await M();const asked=[];
 const read=async url=>{asked.push(url);const tag=url.split('/').at(-1).replace('.json','');if(tag==='Revenues')return concept(tag,500);if(tag==='Assets')return {...concept(tag,900),units:{USD:[{val:900,end:'2025-12-31',filed:'2026-02-01',form:'10-K',fp:'FY',accn:'0000000001-26-000001'}]}};throw Error('تعذر الوصول إلى المصدر (404).');};
 const merged=await readSECConcepts(CIK,read);
 assert.ok(asked.every(u=>u.startsWith('https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/')));
 assert.deepEqual(Object.keys(merged.facts['us-gaap']).sort(),['Assets','Revenues']);assert.ok(merged._mizanMissingConcepts.includes('NetIncomeLoss'));
 const facts=parseSECFacts(merged,CIK,'2026-03-01');
 assert.equal(facts.find(f=>f.key==='revenue').source,secConceptURL(CIK,'Revenues'));assert.equal(facts.find(f=>f.key==='assets').value,900);
 await assert.rejects(()=>readSECConcepts(CIK,async url=>({...concept(url.split('/').at(-1).replace('.json',''),1),cik:2})),/هوية بند SEC/);
 await assert.rejects(()=>readSECConcepts(CIK,async()=>{throw Error('تعذر الوصول إلى المصدر (404).');}),/لم تتوفر بنود SEC/);
 await assert.rejects(()=>readSECConcepts(CIK,async()=>{throw Error('تعذر الوصول إلى المصدر (500).');}),/500/);
});

test('getRegulatory falls back to companyconcept only when companyfacts exceeds the read cap',async()=>{
 const {getRegulatory}=await M();const urls=[];
 const subs={cik:'0000000001',name:'Test Corp',filings:{recent:{accessionNumber:[],form:[],filingDate:[],reportDate:[],primaryDocument:[]}}};
 const base=async url=>{urls.push(url);if(url.endsWith('company_tickers.json'))return {0:{ticker:'TEST',cik_str:1}};if(url.includes('/submissions/'))return subs;if(url.includes('/companyconcept/')){const tag=url.split('/').at(-1).replace('.json','');if(tag==='Revenues')return concept(tag,700);throw Error('تعذر الوصول إلى المصدر (404).');}throw Error('Unexpected '+url);};
 const big=await getRegulatory('TEST','2026-03-01',async(url,json,ttl)=>{if(url.includes('/companyfacts/')){urls.push(url);throw Error('استجابة المصدر أكبر من الحد.');}return base(url,json,ttl);});
 assert.equal(big.facts.find(f=>f.key==='revenue').value,700);assert.match(big.facts[0].source,/companyconcept/);
 assert.equal(big.documents[0].state,'ok');assert.match(big.documents[0].detail,/companyconcept/);
 urls.length=0;
 const down=await getRegulatory('TEST','2026-03-01',async(url,json,ttl)=>{if(url.includes('/companyfacts/'))throw Error('تعذر الوصول إلى المصدر (503).');return base(url,json,ttl);});
 assert.equal(down.facts.length,0);assert.ok(!urls.some(u=>u.includes('/companyconcept/')),'a non-size failure must not trigger per-concept requests');
});

test('readExternalSource follows up to three same-site redirects and refuses cross-site or unsafe targets',async()=>{
 const {readExternalSource,siteOf}=await M();
 assert.equal(siteOf('www.stats.gov.sa'),'stats.gov.sa');assert.equal(siteOf('stats.gov.sa'),'stats.gov.sa');assert.equal(siteOf('data.sec.gov'),'sec.gov');assert.equal(siteOf('evil-stats.gov.sa'),'evil-stats.gov.sa');
 const hop=(map)=>async url=>{const to=map[url];return to?new Response(null,{status:301,headers:{location:to}}):new Response('<html>ok</html>',{status:200,headers:{'content-type':'text/html'}});};
 const ok=await readExternalSource('https://www.stats.gov.sa/',hop({'https://www.stats.gov.sa/':'/ar','https://www.stats.gov.sa/ar':'https://stats.gov.sa/ar/home'}));
 assert.equal(ok.finalUrl,'https://stats.gov.sa/ar/home');assert.match(ok.raw,/ok/);
 await assert.rejects(()=>readExternalSource('https://www.stats.gov.sa/',hop({'https://www.stats.gov.sa/':'https://other.example.org/x'})),/لم يُتبع/);
 await assert.rejects(()=>readExternalSource('https://www.stats.gov.sa/',hop({'https://www.stats.gov.sa/':'http://www.stats.gov.sa/ar'})),/غير آمن|غير صالح/);
 await assert.rejects(()=>readExternalSource('https://a.stats.gov.sa/',hop({'https://a.stats.gov.sa/':'https://b.stats.gov.sa/','https://b.stats.gov.sa/':'https://c.stats.gov.sa/','https://c.stats.gov.sa/':'https://d.stats.gov.sa/','https://d.stats.gov.sa/':'https://e.stats.gov.sa/'})),/أكثر من المسموح/);
 const {probeSource}=await M();
 const p=await probeSource({id:'gastat',name:'الإحصاء',url:'https://www.stats.gov.sa/',enabled:false,deleted:false,priority:9,authority:'official',kind:'general',adapter:'reference'},'AAPL',hop({'https://www.stats.gov.sa/':'/ar'}));
 assert.equal(p.state,'partial');assert.equal(p.finalUrl,'https://www.stats.gov.sa/ar');assert.match(p.detail,/www\.stats\.gov\.sa\/ar/);
});

test('A source refusing automated requests is paused without network calls and reported as blocked, never bypassed',async()=>{
 const {configuredReader,DEFAULT_SETTINGS,saudiURL,activeBlock}=await M(),{db,sqlite}=await databaseFixture();
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.match(String(init?.headers?.['User-Agent']||''),/^Mizan equity research/);return new Response('challenge',{status:403});};
 try{const read=await configuredReader(db,structuredClone(DEFAULT_SETTINGS));
  await assert.rejects(()=>read(saudiURL('2222.SR'),false),/يرفض الطلبات الآلية/);assert.equal(calls,1);
  const row=await db.prepare("SELECT status,detail FROM source_status WHERE id='tadawul'").first();assert.equal(row.status,'blocked');assert.match(JSON.parse(row.detail).reason,/لا يتجاوز ميزان/);
  assert.ok(await activeBlock(db,'tadawul'));
  await assert.rejects(()=>read(saudiURL('1120.SR'),false),/المحاولة التالية/);assert.equal(calls,1,'paused source must not be requested again');
  await db.prepare("UPDATE research_locks SET until_ms=1 WHERE id='tadawul:blocked'").run();
  await assert.rejects(()=>read(saudiURL('1120.SR'),false),/يرفض/);assert.equal(calls,2,'one ordinary retry after the pause ends');
 }finally{globalThis.fetch=original;sqlite.close();}
});

test('Daily series are never marked delayed; only a stale live quote is, with its real age',async()=>{
 const {configuredReader,DEFAULT_SETTINGS}=await M(),{db,sqlite}=await databaseFixture();const now=Math.floor(Date.now()/1000);
 const days=Array.from({length:30},(_,i)=>now-(30-i)*86400);
 const chart=(time,granularity)=>({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',instrumentType:'EQUITY',exchangeName:'NMS',fullExchangeName:'NasdaqGS',regularMarketPrice:100,regularMarketTime:time,dataGranularity:granularity},timestamp:days,indicators:{quote:[{open:days.map(()=>99),high:days.map(()=>101),low:days.map(()=>98),close:days.map(()=>100),volume:days.map(()=>1000)}]}}]}});
 const original=globalThis.fetch;let payload=chart(now-7*86400,'1d');globalThis.fetch=async()=>Response.json(payload);
 try{const read=await configuredReader(db,structuredClone(DEFAULT_SETTINGS));
  await read('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&period1=1&period2=2');
  assert.equal((await db.prepare("SELECT status FROM source_status WHERE id='yahoo'").first()).status,'ok');
  payload=chart(now-1800,'1m');await read('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m&range=1d&includePrePost=false',true,0,'quote');
  const row=await db.prepare("SELECT status,detail FROM source_status WHERE id='yahoo'").first();assert.equal(row.status,'delayed');assert.match(JSON.parse(row.detail).reason,/30 دقيقة/);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test('Admin source states distinguish blocked, review-only and delayed from real failures',async()=>{
 const {sourceOperationalState,sourceUsageLabel,DEFAULT_SOURCE_CONFIG}=await M();
 const tadawul=DEFAULT_SOURCE_CONFIG.find(s=>s.id==='tadawul'),gastat=DEFAULT_SOURCE_CONFIG.find(s=>s.id==='gastat'),yahoo=DEFAULT_SOURCE_CONFIG.find(s=>s.id==='yahoo');
 assert.equal(sourceOperationalState(tadawul,{status:'blocked',detail:JSON.stringify({reason:'حماية'})}).label,'محجوب من المصدر');
 const ref=sourceOperationalState(gastat,undefined,{state:'failed',detail:'الرابط يعيد التوجيه'});assert.equal(ref.label,'رابط مراجعة لا يفتح آليًا');assert.match(ref.detail,/لا يؤثر على التحليل/);
 assert.equal(sourceOperationalState(yahoo,{status:'delayed',detail:JSON.stringify({reason:'عمره 30 دقيقة'})}).label,'يستجيب بسعر متأخر');
 assert.equal(sourceOperationalState(yahoo,{status:'failed',detail:'{}'}).label,'متعطل');
 assert.equal(sourceUsageLabel({...gastat,enabled:true}),'رابط مراجعة — لا يُجلب آليًا');assert.equal(sourceUsageLabel(tadawul),'مفعّل — اتصال آلي');assert.equal(sourceUsageLabel({...gastat,enabled:false}),'غير مفعّل');
});
