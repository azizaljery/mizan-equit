// Real-data before/after: ONE set of live reports (fetched once with the repository's own fetchCompany), then BOTH engines
// run on identical JSON copies. Research only; reads public sources like any visitor; writes nothing to the app or D1.
// Usage: node --import tsx real-compare.mjs <beforeRoot> <afterRoot> SYM1,SYM2,...
import {pathToFileURL} from 'node:url';import path from 'node:path';
const [beforeRoot,afterRoot,list]=[path.resolve(process.argv[2]),path.resolve(process.argv[3]),process.argv[4]||''];
const imp=(root,f)=>import(pathToFileURL(path.join(root,f)).href);
const {fetchCompany}=await imp(afterRoot,'lib/market-data.ts');
const B=await imp(beforeRoot,'lib/research-model.ts'),A=await imp(afterRoot,'lib/research-model.ts');
const settings=(await imp(afterRoot,'lib/site-settings.ts')).DEFAULT_SETTINGS,settingsB=(await imp(beforeRoot,'lib/site-settings.ts')).DEFAULT_SETTINGS;
const std=v=>{if(v.length<2)return 0;const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1));};
function regimeBranch(closes){ // the exact conditions of lib/regime-engine.ts, reported per input
 const r=closes.slice(1).map((p,i)=>Math.log(p/closes[i])),v5=std(r.slice(-5)),v20=std(r.slice(-20)),ratio=v20>1e-12?v5/v20:1;
 const cur=closes.at(-1),sma=closes.slice(-20).reduce((s,p)=>s+p/20,0),z=v20>1e-12?(cur-sma)/(v20*cur):0,lastOver=v20>1e-12?Math.abs(r.at(-1))/v20:0;
 const branches=[];if(ratio>1.6)branches.push('ratio5/20>1.6');if(lastOver>2.8)branches.push('|last|>2.8*vol20 (structural break)');if(ratio>2.2)branches.push('ratio>2.2 (structural break)');if(z<-1.2&&ratio>1.3)branches.push('z<-1.2 and ratio>1.3 (price well below its 20-day mean)');
 return {ratio5to20:+ratio.toFixed(3),lastOverVol20:+lastOver.toFixed(3),zVsSma20:+z.toFixed(3),vol20Pct:+(100*v20).toFixed(3),shockBranches:branches};
}
const out={generatedAt:new Date().toISOString(),versions:{before:B.MODEL_VERSION,after:A.MODEL_VERSION},symbols:{}};
const now=Date.now();
for(const symbol of list.split(',').filter(Boolean)){
 try{
  const report=await fetchCompany(symbol,undefined,true);const js=JSON.stringify(report);
  const rb=B.forecasts(JSON.parse(js),null,now,settingsB),ra=A.forecasts(JSON.parse(js),null,now,settings),rc=A.forecasts(JSON.parse(js),null,now,settings,undefined,{shockWarning:false});
  const closes=report.prices.map(p=>p.close);
  out.symbols[symbol]={asOf:report.asOf,prices:closes.length,price:ra.price,regime:regimeBranch(closes),rows:ra.rows.map((x,i)=>{const b=rb.rows[i],c=rc.rows[i];const f=r=>r.available?{dir:r.direction,pct:+r.expectedChangePct.toFixed(3),price:+r.predictedPrice.toFixed(3),range:r.range.map(v=>+v.toFixed(3)),widthPct:+(100*(r.range[1]-r.range[0])/ra.price).toFixed(2),conf:r.confidence}:{blocked:(r.diagnostics?.blockers||[]).map(k=>k.code)};
   return {s:x.sessions,before:f(b),after:f(x),afterWithoutWidening:f(c),warn:x.shockWarning||null};})};
 }catch(e){out.symbols[symbol]={error:String(e&&e.message||e).slice(0,200)};}
}
console.log(JSON.stringify(out));
