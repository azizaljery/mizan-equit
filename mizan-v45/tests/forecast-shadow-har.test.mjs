import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import * as R from '../research/fcst0006/range-core.mjs';
const m=await import(process.env.MIZAN_TEST_MODULE),S=m.shadowHar;
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const iso=d=>new Date(d).toISOString(),day=d=>iso(d).slice(0,10);
const rnd=(()=>{let a=11;return()=>(a=(a*16807)%2147483647)/2147483647;})();
function prices(n=760,end=Date.parse('2026-09-14T00:00:00Z')){
  const dates=[];let d=new Date(end);while(dates.length<n){if(![0,6].includes(d.getUTCDay()))dates.unshift(day(d));d.setUTCDate(d.getUTCDate()-1);}
  let c=100;return dates.map(date=>{c*=Math.exp(.01*(rnd()-.5));const w=.004+.02*rnd();return {date,open:c,high:c*Math.exp(w),low:c*Math.exp(-w),close:c,volume:1000};});
}
const P=prices(),anchor=P.at(-1).date;
const ctx={symbol:'AAPL',market:'us',currency:'USD',model:'mizan-scenarios-7-test',horizon:5,asOf:'2026-09-15T12:00:00.000Z',recordClass:'prospective-public',adjustment:'unadjusted'};
const point={available:true,price:100,predictedPrice:101,range:[90,112],sessions:5,anchorDate:anchor,createdAt:ctx.asOf,
  rangeCheck:{horizonVolatility:4},evaluationPolicy:m.EVALUATION_POLICY,rangeMeaning:'end_close_estimate'};
function history(n=30,actual=i=>104+i*.1){
  return Array.from({length:n},(_,i)=>{const start=Date.parse('2020-01-01T12:00:00.000Z')+i*10*864e5;
    return {id:'h'+String(i).padStart(4,'0'),symbol:ctx.symbol,market:ctx.market,model:ctx.model,horizon:ctx.horizon,available:1,created_at:iso(start),evaluated_at:iso(start+8*864e5),
      forecast:{...structuredClone(point),createdAt:iso(start),model:ctx.model,currency:ctx.currency,recordClass:'prospective-public',anchorDate:day(start),seriesBasis:{adjustment:ctx.adjustment},
        predictedPrice:100,shadowHar:{policy:S.SHADOW_HAR_POLICY,mode:'shadow',status:'r1',calibratedAt:iso(start),r1:[100*Math.exp(-.1),100*Math.exp(.1)]}},
      outcome:{state:'complete',actualDate:day(start+7*864e5),actualPrice:actual(i),evaluationPolicy:m.EVALUATION_POLICY}};});
}

test('production constants and HAR forecast equal the preregistered research definition',()=>{
  assert.deepEqual([S.SHADOW_HAR_ALPHA,S.SHADOW_HAR_Z,S.SHADOW_HAR_MIN_TRAIN,S.SHADOW_HAR_PK_FLOOR,S.SHADOW_HAR_TARGET,S.SHADOW_HAR_MIN_SAMPLE],[R.ALPHA,R.Z80,R.HAR_MIN_TRAIN,R.PK_FLOOR,R.CONF_TARGET,R.CONF_MIN]);
  assert.deepEqual(S.SHADOW_HAR_HORIZONS,R.H);
  const v=P.map(p=>R.parkinson(p.high,p.low));assert.deepEqual(P.map(p=>S.parkinsonVariance(p.high,p.low)),v);
  for(const h of R.H){const a=S.harSigma(v,h),b=R.harForecaster(v,h)(v.length-1);assert.ok(a&&b);near(a.sigma,b.sigma,1e-12);assert.equal(a.train,b.train);}
  assert.equal(S.harSigma(v.slice(0,400),5),null);
});
test('R1 is centred on the published centre, uses only prices up to the anchor, and leaves the forecast untouched',()=>{
  const before=JSON.stringify(point),r=S.shadowHarRange(point,P,[],ctx);
  assert.equal(r.status,'r1');assert.equal(r.displayed,false);assert.equal(r.guaranteedCoverage,false);assert.equal(r.r2,null);assert.equal(r.sample,0);
  near(Math.log(r.r1[1]/101),S.SHADOW_HAR_Z*r.sigma);near(Math.log(101/r.r1[0]),S.SHADOW_HAR_Z*r.sigma);
  const later=[...P,{date:'2026-09-15',open:1,high:900,low:1,close:1,volume:1}];
  assert.deepEqual(S.shadowHarRange(point,later,[],ctx).r1,r.r1);assert.equal(JSON.stringify(point),before);
});
test('out-of-scope, short or invalid inputs produce no range',()=>{
  assert.equal(S.shadowHarRange({...point,sessions:63},P,[],{...ctx,horizon:63}).status,'unavailable');
  assert.equal(S.shadowHarRange(point,P,[],{...ctx,recordClass:'historical'}).status,'unavailable');
  assert.equal(S.shadowHarRange(point,P.slice(-300),[],ctx).reason,'insufficient-history');
  assert.equal(S.shadowHarRange(point,P.map((p,i)=>i===5?{...p,low:0}:p),[],ctx).reason,'invalid-high-low');
  assert.equal(S.shadowHarRange({...point,available:false},P,[],ctx).status,'unavailable');
});
test('R2 needs 30 resolved saved R1 records and applies the exact-rank 80% quantile to each half-width',()=>{
  assert.equal(S.shadowHarRange(point,P,history(29),ctx).status,'r1');
  const recs=history(30,i=>100*Math.exp(.1*(i+1)/30)),r=S.shadowHarRange(point,P,recs,ctx);   // scores (i+1)/30 -> rank ceil(31*.8)=25 -> 25/30
  assert.equal(r.status,'r2');assert.equal(r.sample,30);near(r.quantile,25/30);
  near(Math.log(r.r2[1]/101),(25/30)*S.SHADOW_HAR_Z*r.sigma);near(Math.log(101/r.r2[0]),(25/30)*S.SHADOW_HAR_Z*r.sigma);
  const foreign=recs.map(x=>({...x,forecast:{...x.forecast,shadowHar:{...x.forecast.shadowHar,policy:'other'}}}));
  assert.equal(S.shadowHarRange(point,P,foreign,ctx).status,'r1');
  assert.equal(S.shadowHarRange(point,P,recs,ctx,{readError:true}).status,'r1');
});
test('evaluation scores only the saved ranges with the alpha=0.2 interval score in log units',()=>{
  const shadowHar={policy:S.SHADOW_HAR_POLICY,mode:'shadow',status:'r2',calibratedAt:point.createdAt,r1:[95,105],r2:[97,103]},f={...point,shadowHar};
  const e=S.evaluateShadowHar(f,104);assert.equal(e.baseline.hit,true);assert.equal(e.r1.hit,true);assert.equal(e.r2.hit,false);
  near(e.r1.intervalScoreLogPct,100*Math.log(105/95));near(e.r2.intervalScoreLogPct,100*(Math.log(103/97)+10*Math.log(104/103)));
  assert.equal(S.evaluateShadowHar({...f,createdAt:'2026-09-16T00:00:00.000Z'},104),null);
  assert.equal(S.evaluateShadowHar({...f,shadowHar:{...shadowHar,status:'r1'}},104).r2,null);
  assert.equal(S.evaluateShadowHar(point,104),null);
});
test('journal stores the shadow range with the record, does not render it and does not alter the published range',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+f,'utf8'));
  const prepare=(sql,args=[])=>({bind(...v){return prepare(sql,v)},first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});
  const db={prepare,batch:async s=>{for(const x of s)await x.run();}};
  try{
    const now=Date.now(),px=prices(760,now),report={company:{symbol:'AAPL',name:'Synthetic only',exchange:'NASDAQ',sector:'Retail',source:'fixture'},currency:'USD',asOf:day(now),retrievedAt:iso(now),
      quoteTime:null,priceSource:'fixture',priceAdjustment:'unadjusted',prices:px,facts:[],official:null,news:[],peers:[],checks:[{name:'الأسعار اليومية',state:'ok'}],warnings:[],mode:'current'};
    const plain=m.forecasts(report),saved=await m.recordAnalysis(db,report);
    for(const row of saved.rows){
      const stored=JSON.parse(sqlite.prepare('SELECT data FROM forecast_records WHERE id=?').get(row.id).data);
      assert.deepEqual(stored.shadowHar??null,row.shadowHar??null);assert.deepEqual(stored.range,row.range);assert.deepEqual(row.range,plain.rows.find(r=>r.sessions===row.sessions).range);
      if(row.available&&[1,5,21].includes(row.sessions)){assert.equal(stored.shadowHar.policy,S.SHADOW_HAR_POLICY);assert.equal(stored.shadowHar.status,'r1');assert.equal(stored.shadowHar.calibratedAt,stored.createdAt);}
      else if(stored.shadowHar)assert.equal(stored.shadowHar.status,'unavailable');
    }
    const html=m.renderForecastForTest(saved);assert.doesNotMatch(html,/shadow-har|shadowHar|HAR/);
    assert.ok(saved.rows.some(r=>r.available&&[1,5,21].includes(r.sessions)),'fixture must issue at least one in-scope forecast');
  }finally{sqlite.close();}
});
