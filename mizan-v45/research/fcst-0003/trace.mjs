// FCST-0003 step 2: stage-by-stage trace of forecasts() center/range on ONE frozen snapshot.
// Recomputes every stage from exported production internals and ASSERTS that the final center, displayed price,
// change %, range and direction equal forecasts() output bit-for-bit (consistency proof). No engine behavior change.
// usage: node trace.mjs <bundle.mjs> <snapshot.json.gz> <out.json>
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [,,bundle,snapFile,outFile]=process.argv;
const M=await import(pathToFileURL(bundle).href);
const gz=readFileSync(snapFile),raw=gunzipSync(gz);
const snap=JSON.parse(raw.toString('utf8'));
const settings=M.DEFAULT_SETTINGS;
if(M.CONFORMAL_RANGE_CALIBRATION_ENABLED!==false)throw Error('trace assumes conformal range calibration disabled (as in production a29199b)');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
// verbatim copies of non-exported helpers in lib/research-model.ts (verified by the equality assertions below)
function deviation(values){if(values.length<2)return null;const mean=values.reduce((s,v)=>s+v,0)/values.length;return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1));}
function dailyReturnRange(prices,sessions){const daily=prices.slice(1).map((p,i)=>Math.log(p.close/prices[i].close)).filter(Number.isFinite);if(daily.length<12)return null;const median=M.quantile(daily,.5),sigma=deviation(daily);if(median===null||sigma===null||sigma<=0)return null;return {median:median*sessions,low:median*sessions-1.28155*sigma*Math.sqrt(sessions),high:median*sessions+1.28155*sigma*Math.sqrt(sessions),sample:daily.length,derived:true};}
const fmt2=v=>finite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:0}).format(v):'—';
const median=a=>{const v=a.filter(finite).sort((x,y)=>x-y);if(!v.length)return null;const m=(v.length-1)/2;return (v[Math.floor(m)]+v[Math.ceil(m)])/2;};
const q=(a,p)=>{const v=a.filter(finite);return v.length?M.quantile(v,p):null;};
const rows=[],stocks=[],failures=[],ciDiffs=[];let assertions=0;
for(const e of snap.entries){
 if(!e.ok){stocks.push({symbol:e.symbol,ok:false,error:e.error});continue;}
 const report=e.report,now=e.now,quote=report.liveQuote||null;
 const out=M.forecasts(report,quote,now,settings);
 const {a,factors,conditioning}=M.researchFactors(report,now),last=report.prices.at(-1);
 const quoteUsable=report.mode!=='historical'&&quote&&finite(quote.price)&&quote.price>0&&quote.symbol===report.company.symbol&&quote.currency===report.currency&&now-Date.parse(quote.quoteTime)>=0&&now-Date.parse(quote.quoteTime)<=15*60000;
 const price=quoteUsable?quote.price:last?.close??null;
 const readiness=M.forecastReadiness(report,now);
 const check=(cond,msg)=>{assertions++;if(!cond)failures.push(e.symbol+': '+msg);};
 check(Object.is(price,out.price),'reference price');
 // the same CI-run output recorded at snapshot time must reproduce exactly (determinism + same input)
 // (only enforced when the bundle's MODEL_VERSION equals the snapshot's; a patched engine is compared, not asserted)
 for(const r of e.ciForecast.rows){const o=out.rows.find(x=>x.sessions===r.sessions),same=Object.is(o.predictedPrice??null,r.predictedPrice)&&o.direction===r.direction;
  if(M.MODEL_VERSION===snap.modelVersion)check(same,'reproduces CI-time forecast h='+r.sessions);else if(!same)ciDiffs.push({symbol:e.symbol,h:r.sessions,snapshotPrice:r.predictedPrice,nowPrice:o.predictedPrice??null,snapshotDirection:r.direction,nowDirection:o.direction});}
 const daily=report.prices.slice(1).map((p,i)=>Math.log(p.close/report.prices[i].close));
 const recentSigma=deviation(daily.slice(-63))??0,longSigma=deviation(daily.slice(-252))??recentSigma,shortSigma=deviation(daily.slice(-20))??recentSigma;
 const stockRows=[];
 for(const o of out.rows){
  const h=o.sessions,cond=M.horizonCondition(conditioning,h),shockWarning=cond.shockWarning;
  const weights=M.adjustedWeights(M.forecastWeights(h),settings);
  const avail=factors.filter(f=>f.signal!==null),coverage=avail.reduce((s,f)=>s+weights[f.key],0);
  check(Object.is(coverage,o.coverage),'coverage h='+h);
  const perFactor=factors.map(f=>({key:f.key,signal:f.signal,weight:weights[f.key],contribution:f.signal===null?null:f.signal*weights[f.key]/100}));
  // production sorts `available` in place (for `basis`) BEFORE summing bias; same order reproduces floating-point bits
  const sorted=[...avail].sort((x,y)=>Math.abs(y.signal)*weights[y.key]-Math.abs(x.signal)*weights[x.key]);
  const bias=coverage?sorted.reduce((s,f)=>s+f.signal*weights[f.key],0)/100:0;
  const gross=avail.reduce((s,f)=>s+Math.abs(f.signal)*weights[f.key],0)/100;
  const groups={fundamental:['growth','quality','debt','valuation'],technical:['trend','momentum','levels'],liquidity:['liquidity'],risk:['risk','market','sector','events']};
  const groupContribution=Object.fromEntries(Object.entries(groups).map(([g,ks])=>[g,perFactor.filter(f=>ks.includes(f.key)&&f.contribution!==null).reduce((s,f)=>s+f.contribution,0)]));
  const returns=[];for(let i=h;i<report.prices.length;i++)returns.push(Math.log(report.prices[i].close/report.prices[i-h].close));
  const med=M.quantile(returns,.5),q10=M.quantile(returns,.1),q90=M.quantile(returns,.9);
  const history=med!==null&&q10!==null&&q90!==null&&q90-q10>0?{median:med,low:q10,high:q90,sample:returns.length,derived:false}:dailyReturnRange(report.prices,h);
  const empiricalSigma=deviation(returns)??0;
  const baseDaySigma=h<=21?recentSigma:(recentSigma+longSigma)/2,daySigma=shockWarning?Math.max(baseDaySigma,shortSigma):baseDaySigma;
  const sigma=daySigma*Math.sqrt(h),expectedScale=Math.max(sigma,empiricalSigma);
  const base={symbol:e.symbol,market:e.symbol.endsWith('.SR')?'sa':'us',h,dataDate:last?.date??null,referencePrice:price,referenceSource:quoteUsable?'liveQuote':'lastClose',lastClose:last?.close??null,
   validSessions:report.prices.filter(p=>finite(p.close)&&p.close>0).length,historyReturns:returns.length,factorsAvailable:avail.length,coverage,weights:Object.fromEntries(perFactor.map(f=>[f.key,f.weight])),
   signals:Object.fromEntries(perFactor.map(f=>[f.key,f.signal])),contributions:Object.fromEntries(perFactor.map(f=>[f.key,f.contribution])),groupContribution,
   bias,grossAbsBias:gross,cancellation:gross>0?1-Math.abs(bias)/gross:null,biasIfRenormalized:coverage?bias*100/coverage:null,
   dailySigma:daySigma,recentSigma63:recentSigma,longSigma252:longSigma,sigmaSqrtH:sigma,empiricalSigma,expectedScale,shockWarning:!!shockWarning,positiveTiltMultiplier:cond.positiveTiltMultiplier,
   relativeVolume:conditioning.relativeVolume,available:o.available,direction:o.direction};
  if(!o.available){
   const dc=o.diagnostics?.center??null;
   stockRows.push({...base,abstain:true,abstainReasons:o.reasons,abstainCodes:o.diagnostics?.blockers?.map(b=>b.code)??[],centerIfComputed:dc});continue;
  }
  const sc=M.scenarioCenter({bias,sessions:h,dailySigma:daySigma,expectedScale,positiveTiltMultiplier:cond.positiveTiltMultiplier});
  const center=sc.centerLogReturn;
  check(Object.is(center,o.diagnostics.center.centerLogReturn),'center h='+h);
  const widthLow=Math.max(history.median-history.low,1.28155*sigma),widthHigh=Math.max(history.high-history.median,1.28155*sigma);
  const penalty=1+Math.min(.20,(100-coverage)/500)+(readiness.quality==='ضعيفة'?.10:0);
  const low=price*Math.exp(center-widthLow*penalty),high=price*Math.exp(center+widthHigh*penalty);
  const predicted=price*Math.exp(center),chg=100*(predicted-price)/price,thr=h===1?.1:h<=5?.25:.5;
  check(Object.is(predicted,o.predictedPrice),'predictedPrice h='+h);
  check(Object.is(chg,o.expectedChangePct),'expectedChangePct h='+h);
  check(Object.is(low,o.range[0])&&Object.is(high,o.range[1]),'range h='+h);
  check(M.directionOf(chg,thr)===o.direction,'direction h='+h);
  const annualTiltMax=.15,requestedAtFullBias=h===1?daySigma*.25:annualTiltMax*h/252;
  stockRows.push({...base,abstain:false,
   annualLogTilt:sc.annualLogTilt,requestedLogReturn:sc.requestedLogReturn,maxAbsLogReturn:sc.maxAbsLogReturn,clipped:sc.clipped,clippedLogReturn:sc.clippedLogReturn,
   multiplierEffect:sc.centerLogReturn-sc.clippedLogReturn,centerLogReturn:center,
   requestedAtFullBias,ceilingOverSigmaSqrtH:requestedAtFullBias/sigma,centerOverSigmaSqrtH:center/sigma,centerOverHalfWidth:center/((widthLow+widthHigh)/2*penalty),
   widthLow,widthHigh,penalty,rangeLow:low,rangeHigh:high,halfWidthOverSigmaSqrtH:Math.log(high/low)/2/sigma,
   predictedPrice:predicted,displayedPrice:fmt2(predicted),displayedReference:fmt2(price),expectedChangePct:chg,displayedChangePct:fmt2(chg)+'%',neutralThresholdPct:thr,
   neutralBiasNeeded:h===1?Math.log(1+thr/100)/(daySigma*.25):Math.log(1+thr/100)/(.15*h/252)});
 }
 rows.push(...stockRows);
 const act=stockRows.filter(r=>!r.abstain);
 const centers=act.map(r=>r.centerLogReturn);
 const s252=act.find(r=>r.h===252);
 stocks.push({symbol:e.symbol,ok:true,dataDate:last?.date,reference:price,referenceSource:quoteUsable?'liveQuote':'lastClose',activeHorizons:act.map(r=>r.h),
  centersPct:Object.fromEntries(act.map(r=>[r.h,100*(Math.exp(r.centerLogReturn)-1)])),displayed:Object.fromEntries(act.map(r=>[r.h,r.displayedPrice])),
  distinctDisplayed:new Set(act.map(r=>r.displayedPrice)).size,
  centerSpreadLog:centers.length?Math.max(...centers)-Math.min(...centers):null,
  centerSpreadOverSigma252:s252&&centers.length?(Math.max(...centers)-Math.min(...centers))/s252.sigmaSqrtH:null,
  biasByH:Object.fromEntries(stockRows.map(r=>[r.h,r.bias])),biasSpread:Math.max(...stockRows.map(r=>r.bias))-Math.min(...stockRows.map(r=>r.bias))});
}
// aggregate summaries per horizon (active rows)
const H=[1,5,21,63,126,252];
const per=H.map(h=>{const r=rows.filter(x=>x.h===h&&!x.abstain),all=rows.filter(x=>x.h===h);const pick=k=>r.map(x=>x[k]);
 return {h,rows:all.length,active:r.length,abstained:all.length-r.length,clipped:r.filter(x=>x.clipped).length,multiplier06:r.filter(x=>x.positiveTiltMultiplier!==1).length,
  neutral:r.filter(x=>x.direction==='محايد').length,up:r.filter(x=>x.direction==='صاعد').length,down:r.filter(x=>x.direction==='هابط').length,
  medianAbsBias:median(pick('bias').map(Math.abs)),p90AbsBias:q(pick('bias').map(Math.abs),.9),maxAbsBias:Math.max(...pick('bias').map(Math.abs)),
  medianGrossAbsBias:median(pick('grossAbsBias')),medianCancellation:median(pick('cancellation')),medianCoverage:median(pick('coverage')),
  medianAbsAnnualTilt:median(pick('annualLogTilt').filter(finite).map(Math.abs)),
  medianAbsRequested:median(pick('requestedLogReturn').map(Math.abs)),medianAbsCenter:median(pick('centerLogReturn').map(Math.abs)),
  medianAbsChangePct:median(pick('expectedChangePct').map(Math.abs)),maxAbsChangePct:Math.max(...pick('expectedChangePct').map(Math.abs)),
  medianSigmaSqrtH:median(pick('sigmaSqrtH')),medianAbsCenterOverSigma:median(pick('centerOverSigmaSqrtH').map(Math.abs)),
  ceilingOverSigma_median:median(pick('ceilingOverSigmaSqrtH')),medianHalfWidthOverSigma:median(pick('halfWidthOverSigmaSqrtH')),
  medianNeutralBiasNeeded:median(pick('neutralBiasNeeded')),rowsAboveNeutralBias:r.filter(x=>Math.abs(x.bias)*(x.bias>0?x.positiveTiltMultiplier:1)>x.neutralBiasNeeded).length,
  medianAbsGroup:Object.fromEntries(['fundamental','technical','liquidity','risk'].map(g=>[g,median(r.map(x=>x.groupContribution[g]))]))};});
const okStocks=stocks.filter(s=>s.ok);
// Counterfactual (NOT production): same prices, no facts/official/peers/context/news, as in the FCST-0001 price-only diagnosis.
const priceOnly=H.map(h=>({h,absCenterOverSigma:[],absBias:[],neutral:0,active:0}));
for(const e of snap.entries){if(!e.ok)continue;const rep={...e.report,facts:[],official:null,peers:[],news:[],context:{market:null,sector:null}};
 const o=M.forecasts(rep,e.report.liveQuote||null,e.now,settings);
 for(const r of o.rows){if(!r.available)continue;const t=priceOnly[H.indexOf(r.sessions)];t.active++;if(r.direction==='محايد')t.neutral++;
  const sig=r.rangeCheck.dailyVolatility/100*Math.sqrt(r.sessions);t.absCenterOverSigma.push(Math.abs(r.diagnostics.center.centerLogReturn)/sig);
  t.absBias.push(r.sessions===1?null:Math.abs(r.diagnostics.center.annualLogTilt/.15));}}
const priceOnlySummary=priceOnly.map(t=>({h:t.h,active:t.active,neutral:t.neutral,medianAbsCenterOverSigma:median(t.absCenterOverSigma),medianAbsBias:median(t.absBias)}));
const summary={assertions,failures:failures.length,stocks:stocks.length,okStocks:okStocks.length,failedFetch:stocks.filter(s=>!s.ok).map(s=>s.symbol+': '+s.error),
 perHorizon:per,
 medianCenterSpreadOverSigma252:median(okStocks.map(s=>s.centerSpreadOverSigma252)),
 stocksAllDisplayedDistinct:okStocks.filter(s=>s.activeHorizons.length&&s.distinctDisplayed===s.activeHorizons.length).length,
 stocksWithDuplicateDisplayed:okStocks.filter(s=>s.activeHorizons.length&&s.distinctDisplayed<s.activeHorizons.length).map(s=>({symbol:s.symbol,displayed:s.displayed})),
 medianBiasSpreadAcrossH:median(okStocks.map(s=>s.biasSpread)),counterfactualPriceOnly:priceOnlySummary};
const result={id:'FCST-0003-engine-trace',snapshot:{file:snapFile.split('/').slice(-2).join('/'),sha256_uncompressed_json:createHash('sha256').update(raw).digest('hex'),sha256_gz:createHash('sha256').update(gz).digest('hex'),startedAt:snap.startedAt,finishedAt:snap.finishedAt,runId:snap.runId,commit:snap.commit},
 modelChangedSinceSnapshot:M.MODEL_VERSION!==snap.modelVersion,diffsVsSnapshotEngine:ciDiffs,engine:{modelVersion:M.MODEL_VERSION,version:M.forecastModelVersion(settings),settings:'DEFAULT_SETTINGS'},summary,failures,stocks,rows};
writeFileSync(outFile,JSON.stringify(result,null,1));
console.log(JSON.stringify({assertions,failures:failures.slice(0,20),okStocks:okStocks.length},null,1));
if(failures.length)process.exitCode=1;
