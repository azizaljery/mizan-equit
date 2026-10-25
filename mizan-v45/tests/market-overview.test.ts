// Market overview: parsing, indicators, proxy, breadth, wording — with recorded-shape fixtures (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSeries,sma,rsi,realizedVol,periodReturn,analyse,equalWeightProxy,breadth,describe,buildOverview,type Series} from '../lib/market-overview';

const day=(i:number)=>Date.UTC(2025,9,24+i)/1000;
function chart(symbol:string,closes:(number|null)[],extra:Record<string,unknown>={}){return {chart:{result:[{meta:{symbol,currency:'USD',instrumentType:'INDEX',regularMarketPrice:closes.filter(x=>x!==null).at(-1),chartPreviousClose:closes.filter(x=>x!==null).at(-2),regularMarketTime:day(closes.length-1),...extra},timestamp:closes.map((_,i)=>day(i)),indicators:{quote:[{close:closes,high:closes.map(c=>c===null?null:c+1),low:closes.map(c=>c===null?null:c-1)}]}}]}};}

test('parseSeries refuses another symbol and drops null closes without filling',()=>{
 assert.throws(()=>parseSeries(chart('^IXIC',[1,2]),'^GSPC'),/غير مطابق/);
 const s=parseSeries(chart('^GSPC',[10,null,12,13]),'^GSPC');assert.deepEqual(s.bars.map(b=>b.close),[10,12,13]);
 assert.equal(s.intraday.high,14);assert.equal(s.intraday.low,9);
});

test('indicators: SMA, Wilder RSI bounds, realized vol, period return',()=>{
 assert.equal(sma([1,2,3,4],2),3.5);assert.equal(sma([1],2),null);
 assert.equal(rsi(Array.from({length:30},(_,i)=>100+i)),100);                 // only gains
 assert.ok(rsi(Array.from({length:30},(_,i)=>100-i))!<1);                       // only losses
 assert.equal(rsi([1,2,3]),null);
 assert.equal(realizedVol(Array(30).fill(100)),0);assert.equal(realizedVol([1,2]),null);
 const bars=[{date:'2026-01-01',close:100},{date:'2026-01-10',close:110},{date:'2026-01-20',close:121}];
 assert.ok(Math.abs(periodReturn(bars,'2026-01-10')!-10)<1e-9);assert.equal(periodReturn(bars,'2025-12-01'),null);   // no base before the window
});

test('analyse: TASI-like series without daily history reports price/day change only and says so',()=>{
 const live=parseSeries({chart:{result:[{meta:{symbol:'^TASI.SR',currency:'SAR',regularMarketPrice:9455.27,chartPreviousClose:9695.86,regularMarketTime:day(0)},timestamp:[day(0)],indicators:{quote:[{close:[9455.27],high:[9700],low:[9440]}]}}]}},'^TASI.SR');
 const a=analyse({...live,bars:[live.bars[0]]},'تاسي',live);
 assert.equal(a.price,9455.27);assert.equal(a.changePct,-2.48);assert.equal(a.historyAvailable,false);assert.ok(a.historyNote);
 assert.equal(a.ma200,null);assert.equal(a.returns.m1,null);assert.equal(a.rsi14,null);
});

test('analyse: full history gives MAs, 52w range and position flags',()=>{
 const closes=Array.from({length:260},(_,i)=>100+i*0.5);
 const s=parseSeries(chart('^GSPC',closes),'^GSPC');const a=analyse(s,'S&P',s);
 assert.equal(a.historyAvailable,true);assert.equal(a.aboveMa50,true);assert.equal(a.aboveMa200,true);
 assert.equal(a.high52,a.price);assert.equal(a.fromHigh52Pct,0);assert.ok(a.returns.m1!>0);
});

test('equal-weight proxy averages member returns and skips thin dates; breadth counts the latest session only',()=>{
 const mk=(sym:string,c:number[]):Series=>({symbol:sym,currency:'SAR',price:c.at(-1)!,previousClose:c.at(-2)!,time:null,bars:c.map((x,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),close:x})),intraday:{high:null,low:null,points:0}});
 const a=mk('A',[100,110,110]),b=mk('B',[100,90,99]);
 const p=equalWeightProxy([a,b]);assert.equal(p.length,2);assert.ok(Math.abs(p[0].close-100)<1e-9);     // (+10% -10%)/2 = 0
 const stale={...mk('C',[100,101]),bars:[{date:'2025-12-30',close:100},{date:'2025-12-31',close:101}]};
 const br=breadth([a,b,stale],3);assert.equal(br.priced,2);assert.equal(br.advancers,1);assert.equal(br.unchanged,1);assert.equal(br.sessionDate,'2026-01-03');
});

test('describe states facts, labels the proxy separately, and always carries the no-forecast disclaimer',()=>{
 const base={symbol:'x',name:'x',currency:'SAR',price:1,change:0,changePct:-1.2,asOf:null,dayHigh:null,dayLow:null,returns:{w1:null,m1:null,m3:null,ytd:null,y1:null},ma50:1,ma200:1,aboveMa50:false,aboveMa200:true,rsi14:72,vol20:null,high52:null,low52:null,fromHigh52Pct:null,historyAvailable:true,source:''};
 const out=describe(base,base,{universe:40,priced:38,advancers:10,decliners:27,unchanged:1,aboveMa50:5,aboveMa200:20,eligibleMa200:38,sessionDate:'2026-10-23'},'تاسي','المؤشر البديل');
 assert.match(out[0],/تاسي منخفض -1.20%/);assert.match(out[1],/^المؤشر البديل: فوق متوسط 200 وتحت متوسط 50/);assert.match(out[2],/تشبع شرائي/);
 assert.match(out[3],/10 صاعدة و27 هابطة/);assert.match(out.at(-1)!,/ليس توقعًا ولا توصية/);
});

test('buildOverview (sa) with a fake fetcher: TASI live only, proxy from members, note explains the substitution',async()=>{
 const members=Array.from({length:40},(_,k)=>k);
 const fetcher=async(url:string)=>{const sym=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
  if(sym==='^TASI.SR'||sym==='^NOMUC.SR')return chart(sym,[9600,9455],{currency:'SAR'});
  const k=Number(sym.slice(0,4))%7;return chart(sym,Array.from({length:230},(_,i)=>50+i*0.1+k),{currency:'SAR',instrumentType:'EQUITY'});};
 const o=await buildOverview('sa',fetcher as any,new Date('2026-10-25T12:00:00Z'));
 assert.equal(o.indices.length,2);assert.ok(o.proxy);assert.equal(o.breadth.priced,40);assert.equal(members.length,40);
 assert.ok(o.notes.some(n=>/التاريخ اليومي لتاسي غير متاح/.test(n)));
 assert.match(o.summary[0],/^تاسي/);assert.match(o.summary[1],/^المؤشر البديل/);
});
