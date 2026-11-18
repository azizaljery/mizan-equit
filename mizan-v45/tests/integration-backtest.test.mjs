import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), B = m.integrationBacktest;
const P = B.BACKTEST_PARAMS;
function lcg(seed){let a=seed;return()=>{a=(a*1664525+1013904223)>>>0;return a/4294967296;};}
const norm=r=>{let s=0;for(let i=0;i<6;i++)s+=r();return (s-3)/Math.sqrt(0.5);};
function dates(n){const out=[];let t=Date.parse('2024-01-02T00:00:00Z');while(out.length<n){const d=new Date(t);t+=86400000;if(d.getUTCDay()%6===0)continue;out.push(d.toISOString().slice(0,10));}return out;}
// world: macro series follows a random walk; price returns depend on lagged macro change when `planted`
function world(seed,planted,nSym=20,n=700){
  const r=lcg(seed),ds=dates(n),vix=[];let v=18;
  for(const d of ds){v=Math.max(9,v*(1+0.02*norm(r)));vix.push({date:d,value:v});}
  const symbols=[];
  for(let s=0;s<nSym;s++){
    const prices=[];let c=100;
    for(let i=0;i<n;i++){
      const sig=planted&&i>30?-(vix[i-2].value/vix[i-22].value-1)*0.25:0;   // uses only data older than the feature's own lag
      c*=1+0.01*norm(r)+sig*0.1; prices.push({date:ds[i],open:c,high:c,low:c,close:c,volume:1000});
    }
    symbols.push(prices);
  }
  return {macro:{'YH:^VIX':vix},symbols};
}
function run(seed,planted){
  const w=world(seed,planted),specs=[B.MACRO_FEATURES[0]];
  const rows=w.symbols.flatMap((p,i)=>B.buildRows('S'+i,p,w.macro,specs));
  return B.analyze(rows,5,specs.map(s=>s.label));
}
test('macroChange reads only data at least lagDays before the date', () => {
  const obs=[];for(let i=0;i<30;i++)obs.push({date:`2025-01-${String(i+1).padStart(2,'0')}`,value:100+i});
  const a=B.macroChange(obs,'2025-01-25','diff',1,5);   // last obs dated 01-24 (value 123) minus 5 obs earlier (118)
  assert.equal(a,5);
  const changed=obs.map(o=>o.date>='2025-01-25'?{...o,value:9999}:o);
  assert.equal(B.macroChange(changed,'2025-01-25','diff',1,5),5);          // future edits do not move it
  assert.equal(B.macroChange(obs,'2025-01-03','diff',1,5),null);           // not enough history -> null, never filled
});
test('null world: macro adds no information and the test does not claim it does', () => {
  let claims=0;for(const seed of [1,2,3]){const a=run(seed,false);assert.equal(a.status,'ok');if(a.addsInformation)claims++;}
  assert.equal(claims,0);
});
test('planted world: a real lagged macro effect is detected', () => {
  const a=run(7,true);assert.equal(a.status,'ok');
  assert.ok(a.brier.full<a.brier.price,JSON.stringify(a.brier));
});
test('too little data reports insufficient, not a number', () => {
  const w=world(1,false,2,300),specs=[B.MACRO_FEATURES[0]];
  const rows=w.symbols.flatMap((p,i)=>B.buildRows('S'+i,p,w.macro,specs));
  assert.equal(B.analyze(rows,5,['x']).status,'insufficient');
});
test('analysis is deterministic', () => {
  assert.deepEqual(run(3,false),run(3,false));
});
test('parseChart accepts Brent futures and the dollar index only through the declared proxy list', () => {
  const chart=(sym,type)=>({chart:{result:[{meta:{symbol:sym,instrumentType:type,currency:'USD',exchangeName:'X',fullExchangeName:'X',gmtoffset:0},timestamp:[1700000000],indicators:{quote:[{open:[80],high:[81],low:[79],close:[80.5],volume:[10]}]}}]}});
  assert.equal(m.parseChart(chart('BZ=F','FUTURE'),'2026-01-01',true).prices.length,1);
  assert.equal(m.parseChart(chart('DX-Y.NYB','CURRENCY'),'2026-01-01',true).prices.length,1);
  assert.throws(()=>m.parseChart(chart('BZ=F','FUTURE'),'2026-01-01',false));
  assert.throws(()=>m.parseChart(chart('CL=F','FUTURE'),'2026-01-01',true));
});
