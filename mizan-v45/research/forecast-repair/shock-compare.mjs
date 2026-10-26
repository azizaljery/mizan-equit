// Before/after comparison of the shock policy on identical SYNTHETIC inputs (research only, imported by nothing).
// Usage: node --import tsx shock-compare.mjs <rootOfEngine> > out.json   (run once per engine copy)
import {pathToFileURL} from 'node:url';import path from 'node:path';
const root=path.resolve(process.argv[2]);
const {forecasts,MODEL_VERSION}=await import(pathToFileURL(path.join(root,'lib/research-model.ts')).href);
const {DEFAULT_SETTINGS}=await import(pathToFileURL(path.join(root,'lib/site-settings.ts')).href);
const {syntheticReport,NOW}=await import(pathToFileURL(path.resolve(process.argv[3]||'research/forecast-repair/fixtures.mjs')).href);
const cases={calm:syntheticReport(),shock_down:syntheticReport({id:'T_SHOCK_DN',shock:-.025}),shock_up:syntheticReport({id:'T_SHOCK_UP',shock:.05}),shock_big_up:syntheticReport({id:'T_SHOCK_BIG',shock:.08}),
 sa_shock:syntheticReport({id:'T_SA_SHOCK',market:'sa',shock:-.03})};
const dup=syntheticReport({id:'T_DUP'});dup.prices[dup.prices.length-1].date=dup.prices[dup.prices.length-2].date;cases.invalid_dates=dup;
const strict=structuredClone(DEFAULT_SETTINGS);strict.minConfidence='medium';
const out={version:MODEL_VERSION,cases:{}};
for(const [k,rep] of Object.entries(cases)){
 for(const [sn,st] of [['default',DEFAULT_SETTINGS],['minConfidence_medium',strict]]){
  if(sn!=='default'&&k!=='shock_down')continue;
  const f=forecasts(rep,null,NOW,st);
  out.cases[k+(sn==='default'?'':'@'+sn)]=f.rows.map(r=>({s:r.sessions,ok:r.available,dir:r.direction,pct:r.expectedChangePct==null?null:+r.expectedChangePct.toFixed(3),price:r.predictedPrice==null?null:+r.predictedPrice.toFixed(3),range:r.range?r.range.map(x=>+x.toFixed(3)):null,widthPct:r.range&&f.price?+(100*(r.range[1]-r.range[0])/f.price).toFixed(2):null,conf:r.confidence,warn:r.shockWarning||null,blockers:(r.diagnostics?.blockers||[]).map(b=>b.code)}));
 }
}
console.log(JSON.stringify(out));
