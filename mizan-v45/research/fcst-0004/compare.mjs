// FCST-0004: run production (old) and fix (new) code on the SAME frozen snapshot, with Date.now pinned to each entry's `now`.
// No returns, no accuracy: only volume statistics, gates and displayed forecast fields are compared.
// usage: node compare.mjs <oldBundle> <newBundle> <snapshot.json.gz> <out.json>
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const [,,oldB,newB,snapFile,outFile]=process.argv;
const O=await import(pathToFileURL(oldB).href),N=await import(pathToFileURL(newB).href);
const snap=JSON.parse(gunzipSync(readFileSync(snapFile)).toString('utf8'));
const realNow=Date.now,fin=x=>typeof x==='number'&&Number.isFinite(x);
const tryRun=f=>{try{return f()}catch(e){return {error:String(e&&e.message||e).slice(0,160)}}};
function run(M,isNew,e){
 const report=e.report,now=typeof e.now==='number'?e.now:Date.parse(e.now),quote=report.liveQuote||null;
 Date.now=()=>now;
 const inc=isNew?M.lastBarIncomplete(report,now):false;
 const tech=tryRun(()=>{const t=M.automaticAnalysis(report,'trader',now).tech;return {relativeVolume:t.relativeVolume,volumeRatio:t.volumeRatio,turnover:t.turnover,zeroVolume:t.zeroVolume,avgV20:t.avgV20,basis:t.volumeBasis??'last-bar'}});
 const sc=tryRun(()=>M.tradeScenario(report,now));
 const lc=sc.error?sc:{rvol:sc.executionPlan.liquidityConfirmation.rvol,isConfirmed:sc.executionPlan.liquidityConfirmation.isConfirmed};
 const fd=tryRun(()=>{const d=M.finalDecision(report,sc,quote,now);return {buy:d.buy,checks:d.checks.map(c=>c.ok)}});
 const cond=tryRun(()=>({relativeVolume:M.forecastConditions(report,now).relativeVolume,mult:M.forecastConditions(report,now).horizons?.map?.(h=>h.positiveTiltMultiplier)}));
 const fc=tryRun(()=>M.forecasts(report,quote,now,M.DEFAULT_SETTINGS).rows.map(r=>({h:r.sessions,available:r.available,predictedPrice:r.predictedPrice,direction:r.direction,center:r.diagnostics?.center?.centerLogReturn,mult:r.diagnostics?.center?.positiveTiltMultiplier})));
 const retMs=Date.parse(report.retrievedAt||'')||now;
 const ev=tryRun(()=>{const o=isNew?{lastBarIncomplete:M.lastBarIncomplete({prices:report.prices,liveQuote:report.liveQuote,mode:report.mode},retMs)}:undefined;const m=M.marketEvidence(report.prices,report.retrievedAt,o);return {medianTradedValue20:m.medianTradedValue20,zeroVolumeDays20:m.zeroVolumeDays20,atrPct20:m.atrPct20,lastBarAgeDays:m.lastBarAgeDays}});
 return {inc,tech,lc,fd,cond,fc,ev};
}
const rows=[];
for(const e of snap.entries){
 if(!e.ok||!e.report)continue;
 const o=run(O,false,e),n=run(N,true,e);
 rows.push({symbol:e.symbol,market:e.symbol.endsWith('.SR')?'sa':'us',incomplete:n.inc,old:o,new:n});
}
Date.now=realNow;
const med=a=>{const v=a.filter(fin).sort((x,y)=>x-y);return v.length?(v[(v.length-1)>>1]+v[v.length>>1])/2:null};
const diff=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);
const sum={entries:rows.length,incompleteCount:rows.filter(r=>r.incomplete).length,errorsOld:rows.filter(r=>[r.old.tech,r.old.lc,r.old.fd,r.old.fc,r.old.ev].some(x=>x?.error)).length,errorsNew:rows.filter(r=>[r.new.tech,r.new.lc,r.new.fd,r.new.fc,r.new.ev].some(x=>x?.error)).length};
for(const mk of ['sa','us']){
 const R=rows.filter(r=>r.market===mk),I=R.filter(r=>r.incomplete);
 sum[mk]={n:R.length,incomplete:I.length,
  medianRelVolOld_incomplete:med(I.map(r=>r.old.tech.relativeVolume)),medianRelVolNew_incomplete:med(I.map(r=>r.new.tech.relativeVolume)),
  medianVolumeRatioOld_incomplete:med(I.map(r=>r.old.tech.volumeRatio)),medianVolumeRatioNew_incomplete:med(I.map(r=>r.new.tech.volumeRatio)),
  zeroVolumeChanged:R.filter(r=>diff(r.old.tech.zeroVolume,r.new.tech.zeroVolume)).length,
  turnoverChanged:R.filter(r=>diff(r.old.tech.turnover,r.new.tech.turnover)).length,
  scenarioGateChanged:R.filter(r=>diff(r.old.lc,r.new.lc)).length,
  finalDecisionChanged:R.filter(r=>diff(r.old.fd,r.new.fd)).length,
  finalBuyOld:R.filter(r=>r.old.fd?.buy).length,finalBuyNew:R.filter(r=>r.new.fd?.buy).length,
  conditionRelVolChanged:R.filter(r=>diff(r.old.cond?.relativeVolume,r.new.cond?.relativeVolume)).length,
  forecastRowsChanged:R.reduce((s,r)=>s+(Array.isArray(r.old.fc)&&Array.isArray(r.new.fc)?r.old.fc.filter((x,i)=>diff(x,r.new.fc[i])).length:0),0),
  forecastRowsTotal:R.reduce((s,r)=>s+(Array.isArray(r.old.fc)?r.old.fc.length:0),0),
  evidenceChanged:R.filter(r=>diff(r.old.ev,r.new.ev)).length,
  newlyConfirmedScenario:R.filter(r=>!r.old.lc?.isConfirmed&&r.new.lc?.isConfirmed).length};
}
writeFileSync(outFile,JSON.stringify({id:'FCST-0004-session-volume-compare',snapshotEntries:snap.entries.length,oldModel:O.MODEL_VERSION,newModel:N.MODEL_VERSION,summary:sum,rows},null,1));
console.log(JSON.stringify(sum,null,1));
