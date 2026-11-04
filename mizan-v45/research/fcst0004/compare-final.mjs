// FCST-0004 final verification harness. SYNTHETIC fixtures only (research/forecast-repair/fixtures.mjs); no snapshot, no restricted data.
// usage: node --import tsx research/fcst0004/compare-final.mjs <BASE_REPO_DIR> <OUT.json>
//   BASE_REPO_DIR = a checkout of the pre-fix tree (the deploy head the PR is based on), containing mizan-v45/lib.
// The SAME report object, `now` and settings are given to the base and to the final head. Part 1: US timeline around Friday,
// the weekend and the next open, plus missing-evidence cases. Part 2: grid built around the signal boundaries (1.1, 1.5, 3).
import {writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {syntheticReport} from '../forecast-repair/fixtures.mjs';
const [,,BASE_DIR,OUT]=process.argv;
const headLib=new URL('../../lib/',import.meta.url),baseLib=pathToFileURL(BASE_DIR.replace(/\/$/,'')+'/mizan-v45/lib/');
const load=async root=>{const m=async f=>import(new URL(f,root).href);const [rm,ss,fd,fc,aa,an,sv]=await Promise.all([m('research-model.ts'),m('site-settings.ts'),m('final-decision.ts'),m('trade-scenario.ts'),m('automatic-analysis.ts'),m('analysis.ts'),m('forecast-conditions.ts')]);
 return {forecasts:rm.forecasts,version:rm.MODEL_VERSION,SETTINGS:ss.DEFAULT_SETTINGS,finalDecision:fd.finalDecision,tradeScenario:fc.tradeScenario,automaticAnalysis:aa.automaticAnalysis,technical:an.technical,volumeLabel:an.volumeLabel,forecastConditions:sv.forecastConditions}};
const H=await load(headLib),B=await load(baseLib);
const Z=s=>Date.parse(s),HOUR=3600e3,OFF=-14400;
const win=d=>({start:Z(d+'T13:30:00Z'),end:Z(d+'T20:00:00Z')});   // New York regular session in EDT
const redate=(r,last)=>{const out=[];let d=new Date(last+'T00:00:00Z');while(out.length<r.prices.length){const w=d.getUTCDay();if(w!==0&&w!==6)out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1)}return out};
function build({drift=.0004,amp=.006,jump=.01,lastDate,rLast,rPrev,asOf}){
 const r=syntheticReport({id:'BRK',drift,amplitude:amp,shock:jump});const n=r.prices.length,dates=redate(r,lastDate);
 r.prices=r.prices.map((p,i)=>({...p,date:dates[i],volume:1e6}));r.prices[n-1].volume=rLast*1e6;r.prices[n-2].volume=rPrev*1e6;
 r.asOf=asOf;r.mode='current';return r}
const quoteFor=(session,{now,isOpen,quoteTime,sessionKnown=true})=>({isOpen,sessionKnown,sessionStart:sessionKnown?win(session).start:null,sessionEnd:sessionKnown?win(session).end:null,gmtOffsetSeconds:OFF,quoteTime:quoteTime??new Date(now-60e3).toISOString()});
// The head rule needs the quote bound to the prices (symbol, currency, fetch time); harmless extra fields for the base commit.
const bind=(r,q)=>({...q,symbol:r.company.symbol,currency:r.currency,retrievedAt:r.retrievedAt});
const liveQuote=(r,now,isOpen)=>({symbol:r.company.symbol,currency:r.currency,price:r.prices.at(-1).close,quoteTime:new Date(now-60e3).toISOString(),isOpen,source:'synthetic://fixture'});
function run(L,r,now){
 const out={};
 const tech=L.automaticAnalysis(r,'trader',now).tech;
 out.tech={basis:tech.volumeBasis??'last-bar',rv:tech.relativeVolume,volumeSession:tech.volumeSessionDate??r.prices.at(-1).date,priceBar:tech.priceBarDate??r.prices.at(-1).date,lag:tech.volumeLagSessions??0,label:L.volumeLabel?L.volumeLabel(tech):null};
 const fc=L.forecastConditions(r,now);out.fc={rv:fc.relativeVolume,session:fc.volumeSessionDate??r.prices.at(-1).date,multiplier:fc.relativeVolume!==null&&fc.relativeVolume<1.1?.6:1};
 const ts=L.tradeScenario(r,now);const g=ts.executionPlan.liquidityConfirmation;out.gate={rvol:g.rvol,confirmed:g.isConfirmed};
 const t=L.technical(r.prices),pr=L.technical(r.prices.slice(0,-1)),atr=t.atr.at(-1),res=pr.resistance??r.prices.at(-1).close;
 const scenario={reasons:[],incomplete:[],levels:{low:res+.1*atr,high:res+.35*atr,stop:res-.8*atr,target1:res+atr,target2:res+2*atr}};
 const open=!!r.liveQuote?.isOpen&&now<(r.liveQuote.sessionEnd??0)&&now>=(r.liveQuote.sessionStart??0);
 const q={...liveQuote(r,now,open),price:scenario.levels.low+.05*atr};const fd=L.finalDecision(r,scenario,q,now);
 out.decision={volumeCheck:fd.checks.find(c=>c.name.includes('الاختراق')).ok,buy:fd.buy,nonVolume:{breakout:t.last.close>pr.resistance,trend:t.sma50.at(-1)>t.sma200.at(-1),rsi:t.rsi.at(-1)>=50&&t.rsi.at(-1)<=70}};
 const f=L.forecasts(r,null,now,L.SETTINGS);out.rows=f.rows.map(x=>({h:x.sessions,avail:x.available,dir:x.direction,pct:x.available?x.expectedChangePct:null,mult:x.modelCondition?.positiveTiltMultiplier??null}));
 return out}
const status=async(r,now)=>(await import(new URL('session-volume.ts',headLib).href)).lastBarStatus(r,now);
const failures=[];const expect=(c,m)=>{if(!c)failures.push(m)};
const clone=o=>JSON.parse(JSON.stringify(o));

// ---------------- Part 1: US timeline ----------------
const FRI='2026-10-23',MON='2026-10-26',TUE='2026-10-27';
const profiles={A_breakout_final:{rLast:1.8,rPrev:.9},B_weak_last_strong_prev:{rLast:1.0,rPrev:1.8},C_partial_in_session:{rLast:.4,rPrev:1.2}};
// provider behaviour on weekends is NOT known: P1 = quote still describes the last session, P2 = quote already describes the next one.
const T=[
 ['S1 Fri 13:00 local, in session',FRI,'Fri','2026-10-23T17:00:00Z',true,FRI],
 ['S2 Fri 16:30 local, just closed',FRI,'Fri','2026-10-23T20:30:00Z',false,FRI],
 ['S3 Sat, provider P1 (quote = Friday)',FRI,'Fri','2026-10-24T12:00:00Z',false,FRI],
 ['S3b Sat, provider P2 (quote = Monday)',FRI,'Mon','2026-10-24T12:00:00Z',false,MON],
 ['S4 Sun night, P1',FRI,'Fri','2026-10-25T23:00:00Z',false,FRI],
 ['S4b Sun night, P2',FRI,'Mon','2026-10-25T23:00:00Z',false,MON],
 ['S5 Mon before open, P1',FRI,'Fri','2026-10-26T12:00:00Z',false,FRI],
 ['S5b Mon before open, P2',FRI,'Mon','2026-10-26T12:00:00Z',false,MON],
 ['S6 Mon 10:00 local, Monday bar delivered (partial)',MON,'Mon','2026-10-26T14:00:00Z',true,MON],
 ['S7 Mon 10:00 local, Monday bar NOT yet delivered',FRI,'Mon','2026-10-26T14:00:00Z',true,MON],
 ['S8 Mon 17:00 local, closed',MON,'Mon','2026-10-26T21:00:00Z',false,MON],
 ['S9 Tue 10:00 local, quote on Tuesday',MON,'Tue','2026-10-27T14:00:00Z',true,TUE],
];
const E=[
 ['E1 no quote at all (Sat, Friday bar)',FRI,null,'2026-10-24T12:00:00Z'],
 ['E2 quote without a session window (Sat)',FRI,{sessionKnown:false,session:FRI,isOpen:false},'2026-10-24T12:00:00Z'],
 ['E3 date conflict: Monday bar, quote still on Friday',MON,{session:FRI,isOpen:false},'2026-10-26T21:00:00Z'],
 ['E4 closed, last trade time before the close',FRI,{session:FRI,isOpen:false,quoteTime:'2026-10-23T18:10:00Z'},'2026-10-23T21:00:00Z'],
];
const usRows=[];
for(const [pname,pv] of Object.entries(profiles))for(const [label,barDate,qs,when,open,qDate] of T){
 const now=Z(when),asOf=when.slice(0,10);const r=build({lastDate:barDate,...pv,asOf});
 r.liveQuote=bind(r,quoteFor(qDate,{now,isOpen:open}));
 const st=await status(r,now),h=run(H,clone(r),now),b=run(B,clone(r),now);
 const vs=h.tech.volumeSession,ageH=Math.round((now-Z(vs+'T20:00:00Z'))/HOUR*10)/10;
 usRows.push({profile:pname,case:label,barDate,state:st.state,reason:st.reasonCode,volumeSessionUsedByStats:vs,priceBar:h.tech.priceBar,volumeAgeHours_afterNYClose:ageH,head:h,base:b});
}
for(const [pname,pv] of Object.entries(profiles))for(const [label,barDate,qs,when] of E){
 const now=Z(when),asOf=when.slice(0,10);const r=build({lastDate:barDate,...pv,asOf});
 if(qs)r.liveQuote=bind(r,quoteFor(qs.session,{now,isOpen:qs.isOpen,quoteTime:qs.quoteTime ? qs.quoteTime : undefined,sessionKnown:qs.sessionKnown!==false}));
 const st=await status(r,now),h=run(H,clone(r),now),b=run(B,clone(r),now);
 const vs=h.tech.volumeSession;
 usRows.push({profile:pname,case:label,barDate,state:st.state,reason:st.reasonCode,volumeSessionUsedByStats:vs,priceBar:h.tech.priceBar,volumeAgeHours_afterNYClose:Math.round((now-Z(vs+'T20:00:00Z'))/HOUR*10)/10,head:h,base:b});
}
// ---- assertions on Part 1 ----
for(const x of usRows){
 const tag=`${x.profile} | ${x.case}`;
 expect(x.head.gate.rvol===x.base.gate.rvol&&x.head.gate.confirmed===x.base.gate.confirmed,'gate changed: '+tag);
 expect(x.head.decision.volumeCheck===x.base.decision.volumeCheck&&x.head.decision.buy===x.base.decision.buy,'final decision changed at fixed inputs: '+tag);
 if(x.head.tech.basis==='previous-confirmed'){
  expect(x.head.tech.label&&x.head.tech.label.includes(x.head.tech.volumeSession)&&x.head.tech.label.includes(x.head.tech.priceBar),'previous volume without both dates: '+tag);
  expect(x.head.tech.volumeSession<x.head.tech.priceBar,'volume session not earlier than price bar: '+tag);
  expect(x.head.tech.lag===1,'lag not reported: '+tag);
 }else expect(x.head.tech.label===null&&x.head.tech.lag===0,'last-bar volume wrongly labelled: '+tag);
 if(x.profile==='B_weak_last_strong_prev')expect(x.head.gate.confirmed===false&&x.head.decision.volumeCheck===false,'previous session confirmed a current breakout: '+tag);
 if(x.state==='complete')expect(x.head.tech.basis==='last-bar'&&x.head.fc.session===x.priceBar,'complete bar not used: '+tag);
 if(x.state!=='complete')expect(x.head.tech.basis==='previous-confirmed'&&x.head.fc.session===x.head.tech.volumeSession,'unconfirmed bar used for statistics: '+tag);
}
// ---------------- Part 2: boundary grid ----------------
const drifts=[.0003,.0006,.0009,.0012,.0015,.002],rPrevs=[.8,1.09,1.11,1.6,3.2],rLasts=[.4,1.0,1.09,1.11,1.6];
const stateCases={'complete':{qd:TUE,now:'2026-10-27T14:00:00Z',open:true},'unverified':{qd:MON,now:'2026-10-26T21:00:00Z',open:false},'in-session':{qd:MON,now:'2026-10-26T17:00:00Z',open:true}};
const grid=[];
for(const drift of drifts)for(const rPrev of rPrevs)for(const rLast of rLasts)for(const [sname,sc] of Object.entries(stateCases)){
 const now=Z(sc.now),r=build({drift,amp:.006,jump:.01,lastDate:MON,rLast,rPrev,asOf:sc.now.slice(0,10)});r.liveQuote=bind(r,quoteFor(sc.qd,{now,isOpen:sc.open}));
 const h=run(H,clone(r),now),b=run(B,clone(r),now);
 const changes=h.rows.map((x,i)=>({h:x.h,dirBase:b.rows[i].dir,dirHead:x.dir,pctBase:b.rows[i].pct,pctHead:x.pct,multBase:b.rows[i].mult,multHead:x.mult})).filter(c=>c.dirBase!==c.dirHead||c.pctBase!==c.pctHead||c.multBase!==c.multHead);
 grid.push({drift,rPrev,rLast,state:sname,fcRvBase:b.fc.rv,fcRvHead:h.fc.rv,sessionBase:b.fc.session,sessionHead:h.fc.session,gateSame:h.gate.confirmed===b.gate.confirmed&&h.gate.rvol===b.gate.rvol,decisionSame:h.decision.volumeCheck===b.decision.volumeCheck&&h.decision.buy===b.decision.buy,changes})}
for(const g of grid){
 const tag=`grid drift=${g.drift} rPrev=${g.rPrev} rLast=${g.rLast} ${g.state}`;
 expect(g.gateSame&&g.decisionSame,'gate/decision changed: '+tag);
 if(g.state==='complete')expect(g.changes.length===0,'rule not stable at fixed inputs (complete bar): '+tag);
}
// Two channels move the centre when the volume input moves: (1) the discrete low-volume multiplier (0.6 -> 1.0), (2) the continuous
// 'liquidity' factor (turnover, zero-volume days, 20-vs-prior-20 volume ratio), whose window shifts by one session.
const changed=grid.filter(g=>g.state!=='complete').flatMap(g=>g.changes.map(c=>({...c,drift:g.drift,rPrev:g.rPrev,rLast:g.rLast,state:g.state})));
const viaMult=changed.filter(c=>c.multBase!==c.multHead),viaLiq=changed.filter(c=>c.multBase===c.multHead);
const rel=c=>Math.abs(c.pctHead-c.pctBase)/Math.max(1e-9,Math.abs(c.pctBase));
const channels={rowsChanged:changed.length,viaMultiplier:{rows:viaMult.length,directionFlips:viaMult.filter(c=>c.dirBase!==c.dirHead).length},
 viaLiquidityFactorOnly:{rows:viaLiq.length,directionFlips:viaLiq.filter(c=>c.dirBase!==c.dirHead).length,maxAbsPctPointChange:Math.max(0,...viaLiq.map(c=>Math.abs(c.pctHead-c.pctBase))),maxRelativeChange:Math.max(0,...viaLiq.map(rel))}};
const summary={channels,cells:grid.length,byState:Object.fromEntries(Object.keys(stateCases).map(s=>{const gs=grid.filter(g=>g.state===s);return [s,{cells:gs.length,cellsWithAnyChange:gs.filter(g=>g.changes.length).length,directionChanges:gs.reduce((n,g)=>n+g.changes.filter(c=>c.dirBase!==c.dirHead).length,0),rowsCompared:gs.length*6}]})),
 gateOrDecisionChanged:grid.filter(g=>!g.gateSame||!g.decisionSame).length};
const result={meta:{head:H.version,base:B.version,fixtures:'synthetic (research/forecast-repair/fixtures.mjs), US calendar proxy, NY EDT windows',note:'No snapshot, no restricted data, no accuracy claim.'},failures,usRows,summary,grid};
writeFileSync(OUT,JSON.stringify(result));
console.log(JSON.stringify({failures,summary},null,1));
process.exit(failures.length?1:0);
