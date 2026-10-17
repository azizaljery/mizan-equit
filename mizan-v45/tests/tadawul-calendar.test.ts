import test from 'node:test';
import assert from 'node:assert/strict';
import {saudiSessionCalendar,SA_CALENDAR_MIN_SESSIONS} from '../lib/market-data.ts';
import {currentSessionEvidence} from '../lib/jobs/daily-forecast-archive.mjs';

const day=(i:number)=>new Date(Date.UTC(2026,7,2)+i*86400000).toISOString().slice(0,10);
function chart(symbol:string,dates:string[]){
  return {chart:{result:[{meta:{symbol,instrumentType:'EQUITY',currency:'SAR',exchangeName:'SAU',dataGranularity:'1d'},
    timestamp:dates.map(d=>Date.parse(d+'T07:00:00Z')/1000),
    indicators:{quote:[{open:dates.map(()=>10),high:dates.map(()=>11),low:dates.map(()=>9),close:dates.map(()=>10),volume:dates.map(()=>1000)}],adjclose:[{adjclose:dates.map(()=>10)}]}}],error:null}};
}
const sessions=Array.from({length:40},(_,i)=>day(i)).filter(d=>![5,6].includes(new Date(d+'T00:00:00Z').getUTCDay()));
test('calendar is the union of proxy session dates, sorted, labelled',async()=>{
  const missing=new Set([sessions[3],sessions[10]]);
  const read:any=async(url:string)=>{const s=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
    if(s==='2222.SR')return chart(s,sessions.filter(d=>!missing.has(d)));
    if(s==='1120.SR')return chart(s,sessions);
    throw Error('down');};
  const asOf=sessions.at(-1)!;
  const cal=await saudiSessionCalendar(asOf,read,true);
  assert.ok(cal);
  assert.equal(cal!.symbol,'TADAWUL-CALENDAR');
  assert.deepEqual(cal!.prices.map(p=>p.date),sessions.filter(d=>d<=asOf));
  assert.match(cal!.name,/2222\.SR/);assert.match(cal!.name,/1120\.SR/);assert.doesNotMatch(cal!.name,/2010\.SR/);
});
test('calendar refuses to exist with too few sessions',async()=>{
  const read:any=async(url:string)=>{const s=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);return chart(s,sessions.slice(0,SA_CALENDAR_MIN_SESSIONS-1));};
  assert.equal(await saudiSessionCalendar(sessions.at(-1)!,read,true),null);
});
test('daily archive accepts the calendar as Saudi session evidence, not for US',()=>{
  const now=Date.parse('2026-10-15T14:00:00Z');
  const report:any={prices:[{date:'2026-10-15',close:25}],retrievedAt:new Date(now-60000).toISOString(),context:{market:{symbol:'TADAWUL-CALENDAR',prices:[{date:'2026-10-15'}]}}};
  assert.equal(currentSessionEvidence(report,'sa','2026-10-15',now),true);
  assert.equal(currentSessionEvidence(report,'us','2026-10-15',now),false);
  report.context.market.prices=[{date:'2026-10-14'}];
  assert.equal(currentSessionEvidence(report,'sa','2026-10-15',now),false);
});
