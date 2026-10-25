import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {mom126_5,rankUniverse,topCut,targetSession,unionCalendar,evaluateRow,ledgerStats,lag1Autocorrelation,effectiveN,nonOverlappingDates,ledgerRowId,
 buildLedgerRows,isNewSession,minCalendarDays,isDisplayed,validLedgerRequest,cleanSeries,MIN_CLOSES,GRACE_DAYS,type Close,type StatRow} from '../lib/daily-picks.ts';
import {SA_UNIVERSE,US_UNIVERSE,MODEL_VERSION,PROTOCOL_COMMIT,HORIZONS,TOP_FRACTION,DISPLAY_TOP} from '../lib/daily-picks-universe.ts';
import {SA_CALENDAR_PROXIES} from '../lib/market-data.ts';

// Weekday calendar (Mon–Fri) for synthetic series.
function weekdays(from:string,count:number,skip:string[]=[]){const out:string[]=[];let t=Date.parse(from+'T00:00:00Z');
 while(out.length<count){const d=new Date(t).toISOString().slice(0,10),w=new Date(t).getUTCDay();if(w!==0&&w!==6&&!skip.includes(d))out.push(d);t+=864e5;}return out;}
const series=(dates:string[],f:(i:number)=>number):Close[]=>dates.map((date,i)=>({date,close:f(i)}));

test('frozen universe and constants match PROTOCOL-DIR-0002',()=>{
 assert.equal(SA_UNIVERSE.length,40);assert.equal(US_UNIVERSE.length,40);
 assert.equal(new Set(SA_UNIVERSE).size,40);assert.equal(new Set(US_UNIVERSE).size,40);
 assert.ok(SA_UNIVERSE.every(s=>/^\d{4}\.SR$/.test(s)));
 for(const p of SA_CALENDAR_PROXIES)assert.ok(SA_UNIVERSE.includes(p),p); // calendar proxies are universe members (no extra fetch)
 assert.equal(MODEL_VERSION,'mom126_5-top20-v1');assert.equal(PROTOCOL_COMMIT,'c831eb62ae8e1058803e20be089498306d45ba62');
 assert.deepEqual([...HORIZONS],[5,21]);assert.equal(TOP_FRACTION,0.2);assert.equal(DISPLAY_TOP,3);
 assert.ok(Object.isFrozen(SA_UNIVERSE)&&Object.isFrozen(US_UNIVERSE));
});

test('mom126_5 = close[t-5]/close[t-131]-1; null with fewer than 132 valid closes',()=>{
 const d=weekdays('2026-01-05',140);
 const s=series(d,i=>100+i); // t=139 → close[134]/close[8]-1
 assert.equal(MIN_CLOSES,132);
 assert.ok(Math.abs(mom126_5(s)!-((100+134)/(100+8)-1))<1e-12);
 assert.equal(mom126_5(s.slice(0,131)),null);
 assert.ok(Math.abs(mom126_5(s.slice(0,132))!-((100+126)/(100+0)-1))<1e-12);
 // Invalid closes do not count as sessions (NaN, 0, negative), and order/duplicates are normalised.
 const dirty=[...s.slice(0,132)];dirty[50]={date:dirty[50].date,close:NaN};
 assert.equal(mom126_5(dirty),null);
 assert.ok(Math.abs(mom126_5([...s].reverse())!-mom126_5(s)!)<1e-15);
 assert.equal(cleanSeries([{date:'2026-01-02',close:1},{date:'2026-01-02',close:2},{date:'bad',close:3},{date:'2026-01-01',close:-1}]).length,1);
});

test('ranking: descending momentum, ties by symbol, top = ceil(20%·N), excluded with reasons',()=>{
 const d=weekdays('2026-01-05',140),pick=d.at(-1)!;
 const mk=(slope:number)=>series(d,i=>100+i*slope);
 const entries=[{symbol:'BBB',closes:mk(1)},{symbol:'AAA',closes:mk(1)},{symbol:'CCC',closes:mk(2)},{symbol:'DDD',closes:mk(-0.1)},{symbol:'EEE',closes:mk(0.5)},
  {symbol:'SHORT',closes:mk(3).slice(-100)},{symbol:'STALE',closes:mk(3).slice(0,-1)},{symbol:'DOWN',closes:null}];
 const {ranked,excluded}=rankUniverse(entries,pick);
 assert.deepEqual(ranked.map(r=>r.symbol),['CCC','AAA','BBB','EEE','DDD']);
 assert.deepEqual(ranked.map(r=>r.rank),[1,2,3,4,5]);
 assert.ok(ranked.every(r=>r.universeSize===5&&r.refPriceDate===pick));
 assert.deepEqual(ranked.map(r=>r.inTop),[true,false,false,false,false]); // ceil(0.2·5)=1
 assert.equal(ranked[0].percentile,100);assert.equal(ranked.at(-1)!.percentile,0);
 assert.equal(ranked[0].refPrice,100+139*2);
 assert.deepEqual(Object.fromEntries(excluded.map(e=>[e.symbol,e.reason])),{SHORT:'insufficient_history',STALE:'no_close_on_pick_date',DOWN:'fetch_failed'});
 // Data after the pick date is never used.
 const future=rankUniverse([{symbol:'X',closes:mk(1)}],d[135]);assert.equal(future.ranked[0].refPrice,100+135);
 assert.equal(topCut(40),8);assert.equal(topCut(35),7);assert.equal(topCut(33),7);assert.equal(topCut(31),7);assert.equal(topCut(30),6);assert.equal(topCut(1),1);assert.equal(topCut(0),0);
 assert.equal(isDisplayed({rank:3,in_top:1}),true);assert.equal(isDisplayed({rank:4,in_top:1}),false);assert.equal(isDisplayed({rank:2,in_top:0}),false);
});

test('target session: h-th session strictly after pick date, Saudi holidays and week respected',()=>{
 // Tadawul week Sun–Thu; 2026-09-23 (National Day, Wed) closed.
 const sa:string[]=[];for(let t=Date.parse('2026-09-13T00:00:00Z');t<=Date.parse('2026-10-08T00:00:00Z');t+=864e5){const d=new Date(t),w=d.getUTCDay(),s=d.toISOString().slice(0,10);if(w!==5&&w!==6&&s!=='2026-09-23')sa.push(s);}
 assert.equal(targetSession(sa,'2026-09-17',1),'2026-09-20'); // Thu → Sun
 assert.equal(targetSession(sa,'2026-09-17',4),'2026-09-24'); // Sun Mon Tue (Wed holiday) Thu → 4th = Thu 24th
 assert.equal(targetSession(sa,'2026-09-17',5),'2026-09-27'); // the holiday pushes the 5th session to the next Sunday
 assert.equal(targetSession(sa,'2026-09-18',1),'2026-09-20'); // a non-session pick date still counts strictly after
 assert.equal(targetSession(sa,'2026-10-07',5),null); // calendar does not reach it yet → pending
 assert.throws(()=>targetSession(sa,'2026-09-17',0));
 const cal=unionCalendar([[{date:'2026-09-14',close:1},{date:'2026-09-15',close:1}],null,[{date:'2026-09-15',close:2},{date:'2026-09-16',close:2}]]);
 assert.deepEqual(cal,['2026-09-14','2026-09-15','2026-09-16']);
 assert.equal(minCalendarDays(5),7);assert.equal(minCalendarDays(21),29);
 // The SQL pre-filter is a true lower bound on a 5-day week with no holidays.
 const us=weekdays('2026-01-05',400);for(let i=0;i<300;i+=7){for(const h of [5,21]){const t=targetSession(us,us[i],h)!;assert.ok(Math.round((Date.parse(t)-Date.parse(us[i]))/864e5)>=minCalendarDays(h));}}
 assert.equal(isNewSession('2026-10-16','2026-10-15'),true);assert.equal(isNewSession('2026-10-15','2026-10-15'),false);assert.equal(isNewSession('2026-10-14','2026-10-15'),false);assert.equal(isNewSession('2026-10-14',null),true);
});

test('evaluation: complete / pending / unavailable after the 10-day grace',()=>{
 const cal=weekdays('2026-03-02',40),pick=cal[0],target=cal[5],row={pick_date:pick,horizon:5,ref_price:100};
 const closes=series(cal,i=>i===5?101:99);
 assert.deepEqual(evaluateRow(row,{calendar:cal,closes,today:target,providerHealthy:true}),{state:'complete',targetDate:target,actualPrice:101,changePct:1,wentUp:true});
 const flat=evaluateRow(row,{calendar:cal,closes:series(cal,()=>100),today:target,providerHealthy:true});assert.equal(flat.state,'complete');assert.equal((flat as any).wentUp,false); // equal ≠ up
 assert.equal(evaluateRow(row,{calendar:cal.slice(0,5),closes,today:cal[4],providerHealthy:true}).state,'pending'); // target not reached
 const delisted=series(cal.slice(0,3),()=>100);
 const plus=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
 assert.deepEqual(evaluateRow(row,{calendar:cal,closes:delisted,today:plus(target,GRACE_DAYS),providerHealthy:true}),{state:'pending',targetDate:target});
 assert.deepEqual(evaluateRow(row,{calendar:cal,closes:delisted,today:plus(target,GRACE_DAYS+1),providerHealthy:true}),{state:'unavailable',targetDate:target});
 // Fetch failed this run: unavailable only when the provider is otherwise healthy (not during a broad outage).
 assert.equal(evaluateRow(row,{calendar:cal,closes:null,today:plus(target,30),providerHealthy:false}).state,'pending');
 assert.equal(evaluateRow(row,{calendar:cal,closes:null,today:plus(target,30),providerHealthy:true}).state,'unavailable');
});

function statRows(dates:string[],targets:string[],perDate:(i:number)=>{top:number[];rest:number[]}):StatRow[]{
 const out:StatRow[]=[];
 dates.forEach((d,i)=>{const {top,rest}=perDate(i);let rank=1;
  for(const u of top)out.push({pick_date:d,rank:rank++,in_top:1,outcome_state:u<0?'unavailable':'complete',went_up:u<0?0:u,target_date:targets[i]});
  for(const u of rest)out.push({pick_date:d,rank:rank++,in_top:0,outcome_state:u<0?'unavailable':'complete',went_up:u<0?0:u,target_date:targets[i]});});
 return out;
}
test('stats: hit rates, base rate, lift, unavailable as not-up + sensitivity, pending dates excluded',()=>{
 const cal=weekdays('2026-03-02',60),dates=cal.slice(0,2),targets=[cal[5],cal[6]];
 // date 1: top [1,1] rest [0,0,1,0,0,0,0,0] → hitTop 1, base 3/10; date 2: top [1,-1(unavail)] rest [1,1,0,0,0,0,0,0] → hitTop .5, base 3/10
 const rows=statRows(dates,targets,i=>i===0?{top:[1,1],rest:[0,0,1,0,0,0,0,0]}:{top:[1,-1],rest:[1,1,0,0,0,0,0,0]});
 rows.push({pick_date:cal[2],rank:1,in_top:1,outcome_state:'pending',went_up:null,target_date:null}); // unresolved date ignored by rates
 const s=ledgerStats(rows,5);
 assert.deepEqual(s.counts,{rows:21,pending:1,complete:19,unavailable:1});
 assert.equal(s.all.dates,2);assert.equal(s.all.hitTop,0.75);assert.equal(s.all.baseRate,0.3);assert.equal(s.all.lift,0.45);
 assert.equal(s.all.hitTop3,0.75); // top-3 ∩ in_top = the two top rows here
 assert.equal(s.excludingUnavailable.hitTop,1);assert.equal(s.excludingUnavailable.baseRate,Math.round(((3/10)+(3/9))/2*1e4)/1e4);
 assert.equal(s.startDate,cal[0]);assert.equal(s.ownerTarget,0.8);assert.equal(s.formalTestEligible,false);assert.match(s.note,/n_eff ≥ 60/);
 // Non-overlap: date 2 (cal[1]) is before date 1's target (cal[5]) → only one independent date.
 assert.equal(s.nonOverlap.n,1);assert.deepEqual(s.nonOverlap.selectedDates,[cal[0]]);
});
test('non-overlapping dates and n_eff (AMEND-1)',()=>{
 const ds=[{date:'a1',target:'a5'},{date:'a2',target:'a6'},{date:'a5',target:'a9'},{date:'a8',target:'b2'},{date:'a9',target:'b3'}];
 assert.deepEqual(nonOverlappingDates(ds).map(d=>d.date),['a1','a5','a9']);
 assert.equal(effectiveN(60,0),60);assert.ok(Math.abs(effectiveN(60,0.2)-60*0.8/1.2)<1e-12);assert.equal(effectiveN(60,-0.5),60); // ρ clamped ≥ 0
 assert.equal(lag1Autocorrelation([1,-1,1,-1,1,-1]),0); // negative → 0, no extra credit
 assert.ok(lag1Autocorrelation([1,2,3,4,5,6,7,8])>0.5);
 assert.equal(lag1Autocorrelation([1,2]),0);assert.equal(lag1Autocorrelation([3,3,3,3]),0);
 // 70 weekly non-overlapping dates with alternating lifts → ρ clamped to 0 → n_eff = n → formal test allowed.
 const cal=weekdays('2025-01-06',70*5+10),dates=Array.from({length:70},(_,i)=>cal[i*5]),targets=Array.from({length:70},(_,i)=>cal[i*5+5]);
 const s=ledgerStats(statRows(dates,targets,i=>({top:i%2?[1,1]:[1,0],rest:[0,0,0,0,0,0,0,0]})),5);
 assert.equal(s.nonOverlap.n,70);assert.equal(s.nonOverlap.rho,0);assert.equal(s.nonOverlap.nEff,70);assert.equal(s.formalTestEligible,true);
});

test('idempotency key and row building (append-only reference fields)',()=>{
 const id=ledgerRowId({market:'sa',pickDate:'2026-10-15',horizon:5,symbol:'2222.SR'});
 assert.equal(id,'mom126_5-top20-v1|sa|2026-10-15|h5|2222.SR');
 assert.equal(ledgerRowId({market:'sa',pickDate:'2026-10-15',horizon:5,symbol:'2222.SR'}),id);
 assert.notEqual(ledgerRowId({market:'sa',pickDate:'2026-10-15',horizon:21,symbol:'2222.SR'}),id);
 const ranked=[{symbol:'2222.SR',rank:1,universeSize:2,percentile:100,mom:0.1,inTop:true,refPrice:27.5,refPriceDate:'2026-10-15'},{symbol:'1120.SR',rank:2,universeSize:2,percentile:0,mom:-0.1,inTop:false,refPrice:90,refPriceDate:'2026-10-15'}];
 const rows=buildLedgerRows('sa','2026-10-15',ranked,'SAR','2026-10-15T21:30:00Z',new Map([['2222.SR|5',{id:'f1',predictedPrice:28}],['1120.SR|21',{id:'f2',predictedPrice:NaN}]]));
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(r=>[r.symbol,r.horizon,r.mizan_predicted_price]),[['2222.SR',5,28],['1120.SR',5,null],['2222.SR',21,null],['1120.SR',21,null]]);
 assert.ok(rows.every(r=>r.model_version===MODEL_VERSION&&r.protocol_commit===PROTOCOL_COMMIT&&!('outcome_state' in r)));
});

test('migration: UNIQUE + ON CONFLICT DO NOTHING is idempotent; triggers keep reference append-only and outcome final',()=>{
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));assert.ok(journal.entries.some((e:any)=>e.tag==='0016_daily_picks'),'0016 registered in the journal');
 const r=buildLedgerRows('us','2026-10-16',[{symbol:'AAPL',rank:1,universeSize:40,percentile:100,mom:0.2,inTop:true,refPrice:200,refPriceDate:'2026-10-16'}],'USD','2026-10-16T21:30:00Z')[0];
 const ins=()=>db.prepare(`INSERT INTO daily_picks(id,pick_date,market,horizon,symbol,rank,universe_size,percentile,mom126_5,in_top,ref_price,ref_price_date,currency,mizan_predicted_price,mizan_forecast_id,model_version,protocol_commit,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(r.id,r.pick_date,r.market,r.horizon,r.symbol,r.rank,r.universe_size,r.percentile,r.mom126_5,r.in_top,r.ref_price,r.ref_price_date,r.currency,r.mizan_predicted_price,r.mizan_forecast_id,r.model_version,r.protocol_commit,r.created_at);
 assert.equal(Number(ins().changes),1);assert.equal(Number(ins().changes),0);
 // Same natural key, different id → still ignored by the UNIQUE constraint.
 assert.equal(Number(db.prepare(`INSERT INTO daily_picks(id,pick_date,market,horizon,symbol,rank,universe_size,percentile,mom126_5,in_top,ref_price,ref_price_date,currency,model_version,protocol_commit,created_at)
  VALUES('other',?,?,?,?,1,40,100,0.3,1,999,?, 'USD',?,?,?) ON CONFLICT DO NOTHING`).run(r.pick_date,r.market,r.horizon,r.symbol,r.ref_price_date,r.model_version,r.protocol_commit,r.created_at).changes),0);
 assert.equal(db.prepare('SELECT outcome_state s FROM daily_picks').get()!.s,'pending');
 assert.throws(()=>db.prepare('UPDATE daily_picks SET ref_price=1 WHERE id=?').run(r.id),/daily_pick_reference_is_immutable/);
 assert.throws(()=>db.prepare('UPDATE daily_picks SET rank=2 WHERE id=?').run(r.id),/daily_pick_reference_is_immutable/);
 assert.throws(()=>db.prepare('DELETE FROM daily_picks').run(),/daily_pick_is_append_only/);
 db.prepare(`UPDATE daily_picks SET target_date='2026-10-23',actual_price=210,actual_change_pct=5,went_up=1,outcome_state='complete',evaluated_at='x' WHERE id=? AND outcome_state='pending'`).run(r.id);
 assert.throws(()=>db.prepare(`UPDATE daily_picks SET went_up=0 WHERE id=?`).run(r.id),/daily_pick_outcome_is_final/);
 assert.throws(()=>db.prepare(`INSERT INTO daily_picks(id,pick_date,market,horizon,symbol,rank,universe_size,percentile,mom126_5,in_top,ref_price,ref_price_date,currency,model_version,protocol_commit,created_at)
  VALUES('bad','2026-10-16','us',7,'AAPL',1,40,100,0.3,1,1,'2026-10-16','USD','v','c','t') ON CONFLICT DO NOTHING`).run(),/CHECK/); // CHECK violations are not silently ignored
 // Run rows: a gap can be upgraded to recorded once; recorded is sealed.
 const run=(status:string)=>db.prepare(`INSERT INTO daily_pick_runs(id,market,pick_date,model_version,created_at,status,universe_ok,universe_failed,failures_json) VALUES('k','us','2026-10-16','v','t',?,1,0,'[]')
  ON CONFLICT(id) DO UPDATE SET status=excluded.status WHERE daily_pick_runs.status='gap'`).run(status);
 run('gap');run('recorded');run('gap');
 assert.equal(db.prepare(`SELECT status FROM daily_pick_runs WHERE id='k'`).get()!.status,'recorded');
 assert.throws(()=>db.prepare(`DELETE FROM daily_pick_runs`).run(),/append_only/);
 db.close();
});

test('ledger request validation',()=>{
 assert.deepEqual(validLedgerRequest('sa','5',undefined),{market:'sa',horizon:5,limit:30});
 assert.deepEqual(validLedgerRequest('us',21,'60'),{market:'us',horizon:21,limit:60});
 assert.throws(()=>validLedgerRequest('xx',5,1));assert.throws(()=>validLedgerRequest('sa',1,1));assert.throws(()=>validLedgerRequest('sa',5,500));
});
