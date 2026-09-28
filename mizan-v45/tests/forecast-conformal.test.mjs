import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m=await import(process.env.MIZAN_TEST_MODULE);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const iso=d=>new Date(d).toISOString();
const date=d=>iso(d).slice(0,10);
const ctx={symbol:'AAPL',market:'us',currency:'USD',model:'mizan-scenarios-7-test',horizon:5,
  asOf:'2026-09-15T12:00:00.000Z',recordClass:'prospective-public',adjustment:'unadjusted'};
const point={available:true,price:100,predictedPrice:100,range:[80,120],sessions:5,
  rangeCheck:{horizonVolatility:4},evaluationPolicy:m.EVALUATION_POLICY,rangeMeaning:'end_close_estimate'};
function history(n=30,context=ctx){
  return Array.from({length:n},(_,i)=>{
    const start=Date.parse('2020-01-01T12:00:00.000Z')+i*10*864e5;
    return {id:'r'+String(i).padStart(4,'0'),symbol:context.symbol,market:context.market,model:context.model,
      horizon:context.horizon,available:1,created_at:iso(start),evaluated_at:iso(start+8*864e5),
      forecast:{...structuredClone(point),createdAt:iso(start),sessions:context.horizon,model:context.model,currency:context.currency,
        recordClass:'prospective-public',anchorDate:date(start),seriesBasis:{adjustment:context.adjustment}},
      outcome:{state:'complete',actualDate:date(start+7*864e5),actualPrice:104+i,evaluationPolicy:m.EVALUATION_POLICY}};
  });
}
function dbFixture(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+f,'utf8'));
  const prepare=(sql,args=[])=>({bind(...values){return prepare(sql,values)},first:async()=>sqlite.prepare(sql).get(...args),
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});
  return {sqlite,db:{prepare,batch:async statements=>{for(const s of statements)await s.run();}}};
}
function insert(sqlite,r){
  sqlite.prepare('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.id,'snapshot-'+r.id,r.symbol,r.created_at,r.horizon,r.model,r.market,'fixture','منخفض',r.available,JSON.stringify(r.forecast));
  sqlite.prepare('INSERT INTO forecast_outcomes(id,evaluated_at,data) VALUES(?,?,?)').run(r.id,r.evaluated_at,JSON.stringify(r.outcome));
}
test('finite-sample quantile is an order statistic and refuses inadequate rank or invalid scores',()=>{
  assert.deepEqual(m.conformalQuantile(Array.from({length:30},(_,i)=>i+1)),{rank:28,value:28});
  assert.deepEqual(m.conformalQuantile([0,0,0,0,0,0,0,0,0]),{rank:9,value:0});
  for(const [scores,target] of [[[],.9],[[1,2],.99],[[NaN],.9],[[Infinity],.9],[[-1],.9],[[1],1],[[1],0]])assert.equal(m.conformalQuantile(scores,target),null);
});
test('uses saved price-unit volatility and historical point errors; never changes canonical forecast',()=>{
  const records=history(),before=JSON.stringify({point,records}),c=m.calibrateForecastRange(point,records,ctx);
  assert.equal(c.status,'shadow');assert.equal(c.sample,30);assert.equal(c.rank,28);
  near(c.scale,4);near(c.quantile,31/4);assert.deepEqual(c.range,[69,131]);near(c.widthPct,62);
  assert.equal(c.guaranteedCoverage,false);assert.equal(c.observed.sample,0);assert.equal(c.observed.candidateCoveragePct,null);
  assert.equal(JSON.stringify({point,records}),before);
  const larger=m.calibrateForecastRange({...point,rangeCheck:{horizonVolatility:8}},records,ctx);
  near(larger.quantile,c.quantile);assert.deepEqual(larger.range,[38,162]);
  // The saved horizon already includes time scaling; no second sqrt(horizon) appears.
  const longerCtx={...ctx,horizon:21},longer=history(30,longerCtx);
  assert.deepEqual(m.calibrateForecastRange({...point,sessions:21},longer,longerCtx).range,c.range);
});
test('29 samples and missing scale abstain from calibration without hiding the original range',()=>{
  const c=m.calibrateForecastRange(point,history(29),ctx);
  assert.equal(c.status,'collecting');assert.equal(c.quantile,null);assert.equal(c.range,null);assert.deepEqual(c.baselineRange,point.range);
  for(const forecast of [{...point,available:false},{...point,predictedPrice:NaN},{...point,price:0},{...point,rangeCheck:{}},
    {...point,rangeCheck:{horizonVolatility:-1}},{...point,range:[80,NaN]}])assert.equal(m.calibrateForecastRange(forecast,history(),ctx).status,'unavailable');
  for(const context of [{...ctx,recordClass:'private-input'},{...ctx,recordClass:'historical'},{...ctx,model:'v-old'},
    {...ctx,market:'other'},{...ctx,horizon:3},{...ctx,asOf:'bad-date'}])assert.equal(m.calibrateForecastRange(point,history(),context).status,'unavailable');
});
test('future results, later revisions, mismatched units/models and private/imported data cannot calibrate',()=>{
  const variants=[r=>r.symbol='MSFT',r=>r.market='sa',r=>r.model='different',r=>r.horizon=21,r=>r.available=0,
    r=>r.forecast.currency='SAR',r=>r.forecast.sessions=21,r=>r.forecast.model='old',r=>r.forecast.recordClass='private-input',
    r=>r.forecast.recordClass='historical',r=>r.forecast.recordClass='legacy-unverified',r=>r.forecast.rangeMeaning='path',
    r=>r.forecast.evaluationPolicy='old',r=>r.outcome.evaluationPolicy='old',r=>r.forecast.seriesBasis.adjustment='split-adjusted',
    r=>r.forecast.rangeCheck.horizonVolatility=null,r=>r.outcome.actualPrice=NaN,r=>r.outcome.state='excluded',
    r=>r.evaluated_at='2030-01-01T00:00:00Z',r=>r.evaluated_at=ctx.asOf,r=>r.evaluated_at='bad-date',
    r=>r.created_at=ctx.asOf,r=>r.created_at='2020-02-31T00:00:00Z',r=>r.evaluated_at=r.created_at,
    r=>r.outcome.actualDate=ctx.asOf.slice(0,10),r=>r.outcome.actualDate='2020-02-31',
    r=>r.outcome.actualDate=r.forecast.anchorDate,r=>r.forecast.predictedPrice=0,r=>r.forecast.range=[120,80]];
  for(const change of variants){const records=history();change(records[0]);const c=m.calibrateForecastRange(point,records,ctx);assert.equal(c.sample,29,change.toString());assert.equal(c.range,null);}
  const dirty=history();dirty.push({...history()[0],id:'future-extra',evaluated_at:'2030-01-01T00:00:00Z',outcome:{...history()[0].outcome,actualPrice:1e15}});
  assert.deepEqual(m.calibrateForecastRange(point,dirty,ctx),m.calibrateForecastRange(point,history(),ctx));
});
test('duplicate IDs, repeated clicks and overlapping issue periods do not inflate calibration',()=>{
  const records=history(),duplicates=records.flatMap(r=>[r,structuredClone(r),{...structuredClone(r),id:r.id+'again'},
    {...structuredClone(r),id:r.id+'overlap',created_at:iso(Date.parse(r.created_at)+864e5),forecast:{...r.forecast,anchorDate:date(Date.parse(r.created_at)+864e5)}}]);
  const c=m.calibrateForecastRange(point,duplicates.reverse(),ctx);
  assert.equal(c.sample,30);assert.deepEqual(c.range,m.calibrateForecastRange(point,records,ctx).range);
  const sameDay=records.map(r=>({...r,id:r.id+'end',created_at:iso(Date.parse(r.created_at)+7*864e5),forecast:{...r.forecast,anchorDate:r.outcome.actualDate},outcome:{...r.outcome,actualDate:date(Date.parse(r.created_at)+9*864e5)},evaluated_at:iso(Date.parse(r.created_at)+10*864e5)}));
  assert.equal(m.calibrateForecastRange(point,[...records,...sameDay],ctx).sample,30);
});
test('extreme, zero-width and non-finite candidate ranges are never clipped or replaced by constants',()=>{
  for(const actualPrice of [1e15,100]){
    const records=history().map(r=>({...r,outcome:{...r.outcome,actualPrice}}));
    assert.equal(m.calibrateForecastRange(point,records,ctx).status,'unavailable');
  }
});
test('saved candidate and baseline are measured on the same actual price, with width and miss penalties',()=>{
  const rangeCalibration=m.calibrateForecastRange(point,history(),ctx),forecast={...point,createdAt:ctx.asOf,rangeCalibration};
  const p=m.evaluateConformalRange(forecast,135);
  assert.equal(p.candidateHit,false);assert.equal(p.baselineHit,false);
  near(p.candidateWidthPct,62);near(p.baselineWidthPct,40);near(p.candidateIntervalScorePct,142);near(p.baselineIntervalScorePct,340);
  assert.equal(m.evaluateConformalRange({...forecast,rangeCalibration:{...rangeCalibration,status:'collecting'}},100),null);
  const pairs=history().map(r=>({...r,forecast:{...r.forecast,rangeCalibration:{...rangeCalibration,calibratedAt:r.created_at,calibrationThrough:'2019-12-31T00:00:00.000Z'}}}));
  const observed=m.calibrateForecastRange(point,pairs,ctx).observed;
  assert.equal(observed.sample,30);near(observed.candidateCoveragePct,28/30*100);near(observed.baselineCoveragePct,17/30*100);
});
test('walk-forward replay uses only outcomes known at each issue, and measures subsequent endpoints',()=>{
  const records=history(70),issued=[];
  for(const r of records){
    const c=m.calibrateForecastRange(point,records,{...ctx,asOf:r.created_at});
    assert.ok(c.calibrationIds.every(id=>records.find(x=>x.id===id).evaluated_at<r.created_at));
    if(c.status==='shadow')issued.push(m.evaluateConformalRange({...point,createdAt:r.created_at,rangeCalibration:c},r.outcome.actualPrice));
  }
  assert.equal(issued.length,40);assert.ok(issued.every(p=>p!==null));
  // This drifting synthetic sequence is intentionally poorly covered. It cannot turn into a claimed 90%.
  assert.ok(issued.filter(p=>p.candidateHit).length<issued.length*.9);
});
test('SQLite journal loader limits each horizon separately and tolerates malformed JSON and read errors',async()=>{
  const {sqlite,db}=dbFixture();try{
    for(const r of history())insert(sqlite,r);
    const loaded=await m.loadConformalHistory(db,ctx.symbol,ctx.market,ctx.model,ctx.asOf);
    assert.equal(loaded.readError,false);assert.equal(loaded.records.length,30);
    assert.equal(m.calibrateForecastRange(point,loaded.records,ctx).status,'shadow');
    sqlite.prepare('UPDATE forecast_records SET data=? WHERE id=?').run('{broken','r0000');
    assert.equal((await m.loadConformalHistory(db,ctx.symbol,ctx.market,ctx.model,ctx.asOf)).records.length,29);
    const more=history(505).map(r=>({...r,id:'many-'+r.id,horizon:21,forecast:{...r.forecast,sessions:21}}));
    for(const r of more)insert(sqlite,r);
    const capped=await m.loadConformalHistory(db,ctx.symbol,ctx.market,ctx.model,'2040-01-01T00:00:00.000Z');
    assert.equal(capped.records.filter(r=>r.horizon===21).length,500);assert.equal(capped.records.filter(r=>r.horizon===5).length,29);assert.equal(capped.truncatedHorizons.has(21),true);
    const failed=await m.loadConformalHistory({prepare(){throw Error('offline')}},ctx.symbol,ctx.market,ctx.model,ctx.asOf);
    assert.equal(failed.readError,true);assert.equal(m.calibrateForecastRange(point,[],ctx,failed).status,'unavailable');
  }finally{sqlite.close();}
});
function report(){
  const now=Date.now(),dates=[];let d=new Date(now);
  while(dates.length<300){if(![0,6].includes(d.getUTCDay()))dates.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}
  const prices=dates.map((date,i)=>{const close=100*Math.exp(i*.0004+.004*Math.sin(i*.81));return {date,open:close*.998,high:close*1.002,low:close*.996,close,volume:10000};});
  return {company:{symbol:'AAPL',name:'Synthetic only',exchange:'NASDAQ',sector:'Retail',source:'fixture'},currency:'USD',asOf:date(now),retrievedAt:iso(now),
    quoteTime:null,priceSource:'fixture',priceAdjustment:'unadjusted',prices,facts:[],official:null,news:[],peers:[],checks:[{name:'الأسعار اليومية',state:'ok'}],warnings:[],mode:'current'};
}
test('recordAnalysis persists calibration for all existing horizons and preserves old forecasts and purchase snapshots',async()=>{
  const {sqlite,db}=dbFixture();try{
    const r=report(),model=m.forecasts(r).version,records=history(30,{...ctx,model});
    for(const row of records)insert(sqlite,row);
    const originals=sqlite.prepare('SELECT id,data FROM forecast_records ORDER BY id').all();
    const saved=await m.recordAnalysis(db,r);
    assert.equal(saved.rows.length,6);const weekly=saved.rows.find(r=>r.sessions===5);
    assert.equal(weekly.rangeCalibration.status,'shadow');assert.equal(weekly.rangeCalibration.sample,30);
    for(const row of saved.rows){
      const stored=JSON.parse(sqlite.prepare('SELECT data FROM forecast_records WHERE id=?').get(row.id).data);
      assert.deepEqual(stored.rangeCalibration,row.rangeCalibration);assert.deepEqual(stored.range,row.range);
    }
    for(const old of originals)assert.equal(sqlite.prepare('SELECT data FROM forecast_records WHERE id=?').get(old.id).data,old.data);
    const purchase=await m.capturePurchaseForecast(db,'AAPL',iso(Date.now()+1000),100);
    assert.deepEqual(purchase.rows.find(r=>r.sessions===5).rangeCalibration,weekly.rangeCalibration);
    const html=m.renderForecastForTest(saved);
    assert.match(html,/معايرة نطاق السعر/);assert.match(html,/التغطية المستهدفة/);assert.match(html,/لم تتوفر نتائج سابقة مكتملة/);
    assert.doesNotMatch(html,/دخول مؤكد|هبوط حتمي|دقة شرطية محققة/);
    // Evaluation flows through the existing policy and checks the originally stored candidate.
    const after=structuredClone(r);const anchor=weekly.anchorDate;
    const future=[];let day=Date.parse(anchor+'T00:00:00Z');while(future.length<5){day+=864e5;if(![0,6].includes(new Date(day).getUTCDay()))future.push({date:date(day),open:135,high:136,low:134,close:135,volume:10000});}
    after.prices.push(...future);after.asOf=date(day+864e5);after.context={market:{prices:after.prices}};
    const outcome=m.evaluateForecast({symbol:'AAPL',horizon:5,available:1,data:weekly},after);
    assert.equal(outcome.state,'complete');assert.deepEqual(outcome.rangeComparison,m.evaluateConformalRange(weekly,135));
    const testHtml=m.forecastTestHtml({id:'conformal-test',company:{name:'Synthetic only'},symbol:'AAPL',currency:'USD',unit:'share',
      forecastId:weekly.id,createdAt:saved.createdAt,original:weekly,outcome});
    assert.match(testHtml,/النطاق التجريبي المحفوظ/);assert.match(testHtml,/عرض التجريبي/);assert.match(testHtml,/ليست ضمانًا/);
    const split=m.evaluateForecast({symbol:'AAPL',horizon:5,available:1,data:weekly},{...after,corporateActions:[{kind:'split',date:future[0].date}]});
    assert.equal(split.state,'excluded');assert.equal(split.rangeComparison,undefined);
  }finally{sqlite.close();}
});
