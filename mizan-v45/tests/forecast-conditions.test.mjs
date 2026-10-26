import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m=await import(process.env.MIZAN_TEST_MODULE);
const now=Date.parse('2026-09-10T20:00:00Z');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function report(){
 const dates=[];let day=new Date('2026-09-10T00:00:00Z');
 while(dates.length<300){if(![0,6].includes(day.getUTCDay()))dates.unshift(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()-1);}
 const prices=dates.map((date,i)=>{const close=100*Math.exp(i*.0004+.004*Math.sin(i*.81));return {date,open:close*.998,high:close*1.002,low:close*.996,close,volume:10000};});
 const facts=Object.entries({revenue:50000,netIncome:3000,operatingCashFlow:10000,capex:-2000,equity:20000,shares:1000}).map(([key,value])=>({key,value,date:'2026-06-30',period:'annual',currency:'USD',source:'https://www.sec.gov/fixture',publishedAt:'2026-08-01'}));
 return {company:{symbol:'AAPL',name:'Synthetic test only',exchange:'NASDAQ',sector:'Retail',industry:'Retail',source:'fixture'},currency:'USD',asOf:'2026-09-10',retrievedAt:new Date(now).toISOString(),quoteTime:null,priceSource:'fixture',prices,facts,official:null,news:[],peers:[],checks:[{name:'الأسعار اليومية',state:'ok'}],warnings:[],mode:'current'};
}
test('FCF uses matched, source-resolved base-unit amounts and explicitly dated shares',()=>{
 const r=report(),before=JSON.stringify(r),c=m.forecastConditions(r,now);
 assert.equal(c.cashFlow.freeCashFlow,8000);near(c.cashFlow.qualitySignal,.8);
 near(c.cashFlow.marketCap,1000*r.prices.at(-1).close);near(c.cashFlow.yieldPercent,8000/c.cashFlow.marketCap*100);
 assert.equal(c.cashFlow.sources.length,3);assert.equal(JSON.stringify(r),before);
 const units=structuredClone(r);units.facts=units.facts.map(f=>f.key==='shares'?f:{...f,value:f.value/1000,unit:'thousand'});
 assert.deepEqual(m.forecastConditions(units,now).cashFlow,c.cashFlow);
 for(const patch of [{value:0},{value:-2000}]){
  const zero=structuredClone(r);zero.facts=zero.facts.map(f=>f.key==='operatingCashFlow'?{...f,value:2000}:f.key==='capex'?{...f,...patch}:f);
  assert.equal(m.forecastConditions(zero,now).cashFlow.freeCashFlow,patch.value===0?2000:0);
 }
});
test('missing, future, stale, mismatched and conflicting financials never create invented FCF or market cap',()=>{
 const r=report();
 for(const facts of [[],r.facts.filter(f=>f.key!=='capex'),r.facts.map(f=>({...f,publishedAt:undefined})),r.facts.map(f=>({...f,publishedAt:'2026-09-11'})),r.facts.map(f=>({...f,date:'2023-06-30'})),r.facts.map(f=>f.key==='capex'?{...f,currency:'SAR'}:f),r.facts.map(f=>f.key==='capex'?{...f,date:'2025-06-30'}:f)]){
  const x=m.forecastConditions({...r,facts},now);assert.equal(x.cashFlow.freeCashFlow,null);assert.equal(x.cashFlow.qualitySignal,null);
 }
 const direct={...r.facts[0],key:'freeCashFlow',value:0};
 assert.equal(m.forecastConditions({...r,facts:[direct]},now).cashFlow.freeCashFlow,0);
 assert.equal(m.forecastConditions({...r,facts:[...r.facts,{...direct,value:90000}]},now).cashFlow.freeCashFlow,null);
 for(const variant of [{...r,facts:r.facts.filter(f=>f.key!=='shares'),official:{marketCap:1e9}}, {...r,corporateActions:[{kind:'split',date:'2026-08-15'}]}])assert.equal(m.forecastConditions(variant,now).cashFlow.yieldPercent,null);
 const conflict={...r.facts.find(f=>f.key==='capex'),source:'https://data.sec.gov/fixture',value:99999};
 assert.equal(m.forecastConditions({...r,facts:[...r.facts,conflict]},now).cashFlow.freeCashFlow,null);
 const intraday=r.facts.map(f=>({...f,publishedAt:'2026-09-10T22:00:00Z'}));
 assert.equal(m.forecastConditions({...r,facts:intraday},now).cashFlow.freeCashFlow,null);
 for(const publishedAt of ['2026-08-32','2026-08-01T24:00:00Z','2026-08-01T10:00:00'])assert.equal(m.forecastConditions({...r,facts:r.facts.map(f=>({...f,publishedAt}))},now).cashFlow.freeCashFlow,null);
});
test('RVOL needs all 20 preceding sessions and never treats unknown volume as confirmed',()=>{
 const r=report();r.prices.at(-1).volume=13000;
 near(m.forecastConditions(r,now).relativeVolume,1.3);
 for(const prices of [r.prices.slice(-20),r.prices.map(p=>({...p,volume:0})),r.prices.map((p,i)=>i===290?{...p,volume:NaN}:p),r.prices.map((p,i)=>i===290?{...p,volume:-1}:p)])assert.equal(m.forecastConditions({...r,prices},now).relativeVolume,null);
});
test('forecast API uses canonical six rows and estimated market-specific dates; no fake probability or Q quantiles',()=>{
 const r=report(),f=m.forecasts(r,null,now),g=m.generateCalibratedForecast({report:r,now});
 assert.deepEqual(Object.keys(g.horizons).map(Number),[1,5,21,63,126,252]);assert.equal(g.modelVersion,f.version);assert.equal(g.calibrated,false);
 assert.ok(f.rows.every(x=>x.available));
 for(const row of f.rows){const h=g.horizons[row.sessions];assert.equal(h.centralTarget,row.predictedPrice);assert.deepEqual(h.range,row.range);assert.equal(h.probabilityUp,null);assert.equal(h.confidenceScore,null);assert.equal(h.fcfDriftImpact,null);assert.equal(h.calendarVerified,false);assert.ok(h.range[0]>0&&h.range[0]<=h.centralTarget&&h.centralTarget<=h.range[1]);}
 assert.equal(g.horizons[1].targetDate,'2026-09-11');
 const sa={...r,company:{...r.company,symbol:'2222.SR'}};
 assert.equal(m.generateCalibratedForecast({report:sa,now}).horizons[1].targetDate,'2026-09-13');
 const hist={...r,mode:'historical',asOf:'2026-09-03',prices:r.prices.filter(p=>p.date<='2026-09-03')};
 const historic=m.generateCalibratedForecast({report:hist,now:Date.parse('2026-09-03T20:00:00Z'),quote:{symbol:'AAPL',currency:'USD',price:9999,quoteTime:new Date(now).toISOString()}});
 assert.equal(historic.horizons[1].targetDate,'2026-09-04');assert.equal(historic.anchorPrice,hist.prices.at(-1).close);
});
test('short-horizon shocks are issued with a warning in the live forecast path (policy 2026-10-26)',()=>{
 const r=report();r.prices.at(-1).close*=1.08;
 const f=m.forecasts(r,null,now),g=m.generateCalibratedForecast({report:r,now});
 assert.ok(f.rows[0].modelCondition.shock);
 for(const h of [1,5,21]){assert.equal(g.horizons[h].status,'active');assert.ok(g.horizons[h].range);assert.ok(Number.isFinite(g.horizons[h].centralTarget));assert.match(g.horizons[h].warning,/صدمة تقلب|كسر هيكلي/);assert.equal(g.horizons[h].evidenceQuality,'منخفض');}
 for(const h of [63,126,252]){const row=f.rows.find(r=>r.sessions===h);assert.equal(row.modelCondition.abstain,false);assert.equal(row.shockWarning,null);}
 const html=m.renderForecastForTest(f);assert.match(html,/صدمة تقلب|كسر هيكلي/);assert.doesNotMatch(html,/معايرة إحصائياً|تمثل فترات ثقة مغلقة/);
});
test('low RVOL scales only positive tilt and FCF changes quality within its existing weight',()=>{
 const r=report(),low=m.forecasts(r,null,now),high=structuredClone(r);high.prices.at(-1).volume=15000;
 const strong=m.forecasts(high,null,now);
 assert.equal(low.rows[1].modelCondition.positiveTiltMultiplier,.6);assert.equal(strong.rows[1].modelCondition.positiveTiltMultiplier,1);
 // Liquidity also has an existing independent weight; the new multiplier is never upward.
 assert.ok(low.rows.some(row=>row.available&&row.expectedChangePct>0));
 const absent={...r,facts:r.facts.filter(f=>f.key!=='capex')};
 const factors=m.researchFactors(r,now).factors,missing=m.researchFactors(absent,now).factors;
 assert.notEqual(factors.find(f=>f.key==='quality').signal,missing.find(f=>f.key==='quality').signal);
 for(const f of factors.filter(f=>f.key!=='quality'))assert.equal(f.signal,missing.find(x=>x.key===f.key).signal);
});
test('invalid prices, chronology and future bars fail closed without repair or mutation',()=>{
 const r=report();
 for(const prices of [r.prices.map((p,i)=>i===290?{...p,close:NaN}:p),r.prices.map((p,i)=>i===290?{...p,close:0}:p),[...r.prices].reverse(),[...r.prices,r.prices.at(-1)],r.prices.map((p,i)=>i===299?{...p,date:'2026-09-11'}:p)]){
  const result=m.forecasts({...r,prices},null,now);assert.ok(result.rows.every(row=>!row.available));
 }
});
test('new forecasts retain condition evidence and model version without rewriting stored forecasts',async()=>{
 const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,args=[])=>({bind(...v){return prepare(sql,v)},first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});
 const db={prepare,batch:async statements=>{for(const s of statements)await s.run();}};
 try{
  const oldData=JSON.stringify({price:100,predictedPrice:105,range:[90,120],direction:'صاعد'});
  sqlite.prepare('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('old','old-snapshot','AAPL','2026-09-10T10:00:00Z',252,'mizan-scenarios-6','us','Retail','منخفض',1,oldData);
  const saved=await m.recordAnalysis(db,report());
  assert.equal(saved.rows.length,6);assert.ok(saved.version.startsWith('mizan-scenarios-7-'));
  assert.equal(sqlite.prepare('SELECT data FROM forecast_records WHERE id=?').get('old').data,oldData);
  for(const row of saved.rows){const stored=JSON.parse(sqlite.prepare('SELECT data FROM forecast_records WHERE id=?').get(row.id).data);assert.deepEqual(stored.modelCondition,row.modelCondition);assert.equal(stored.model,saved.version);}
 }finally{sqlite.close();}
});
