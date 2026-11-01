// FCST-0003 step 1: build ONE snapshot of full MarketReport objects through the production report builder
// (lib/market-data.ts fetchCompany) with the plain `upstream` reader. Read-only: no D1, no secrets, no production API.
// Differences from production analyzedCompany(): configuredReader(db) (D1 source settings/blocks/custom connectors) is
// replaced by `upstream`; supplementResearch (needs D1 + TAVILY_API_KEY) is skipped; site settings = DEFAULT_SETTINGS.
// usage: node snapshot.mjs <bundle.mjs> <SYMBOLS.json> <outdir>
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const [,,bundle,symbolsFile,outDir]=process.argv;
const M=await import(pathToFileURL(bundle).href);
const {symbols}=JSON.parse(readFileSync(symbolsFile,'utf8'));
mkdirSync(outDir,{recursive:true});
const startedAt=new Date().toISOString();
const entries=new Array(symbols.length);
let next=0;
async function worker(){
 while(next<symbols.length){
  const i=next++,symbol=symbols[i],t0=Date.now();
  try{
   const report=await M.fetchCompany(symbol,M.upstream,false);
   const now=Date.now();
   // Exactly the production call shape (lib/forecast-journal.ts recordAnalysis): forecasts(report,report.liveQuote||null,Date.now(),settings)
   const published=M.forecasts(report,report.liveQuote||null,now,M.DEFAULT_SETTINGS);
   entries[i]={symbol,ok:true,fetchStartedAt:new Date(t0).toISOString(),now,report,ciForecast:{version:published.version,price:published.price,priceTime:published.priceTime,rows:published.rows.map(r=>({sessions:r.sessions,available:r.available,predictedPrice:r.predictedPrice??null,expectedChangePct:r.expectedChangePct??null,range:r.range,direction:r.direction,center:r.diagnostics?.center??null,reasons:r.available?[]:r.reasons}))}};
   console.log(symbol,'ok',report.prices.length,'prices',report.facts.length,'facts',published.rows.map(r=>r.available?r.expectedChangePct.toFixed(3):'x').join(' '));
  }catch(e){entries[i]={symbol,ok:false,fetchStartedAt:new Date(t0).toISOString(),error:String(e?.message||e).slice(0,400)};console.log(symbol,'FAIL',String(e?.message||e).slice(0,200));}
  await new Promise(r=>setTimeout(r,1500));
 }
}
await Promise.all([worker(),worker(),worker()]);
const finishedAt=new Date().toISOString();
const snapshot={id:'FCST-0003-snapshot',purpose:'Arithmetic tracing of forecasts() only. NOT for accuracy evaluation; no outcomes evaluated.',
 builder:'lib/market-data.ts fetchCompany(symbol, upstream, false)',settings:'DEFAULT_SETTINGS',modelVersion:M.MODEL_VERSION,
 deviationsFromProduction:['reader=upstream (not configuredReader(db): no D1 source settings/blocks/custom daily connectors such as Alpaca)','supplementResearch skipped (needs D1 + TAVILY_API_KEY)','site settings = DEFAULT_SETTINGS (production reads D1 site_settings)'],
 commit:process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null,startedAt,finishedAt,entries};
const raw=Buffer.from(JSON.stringify(snapshot));
const gz=gzipSync(raw,{level:9});
const sha=createHash('sha256').update(raw).digest('hex'),shaGz=createHash('sha256').update(gz).digest('hex');
writeFileSync(outDir+'/snapshot.json.gz',gz);
const manifest={file:'snapshot.json.gz',sha256_uncompressed_json:sha,sha256_gz:shaGz,bytes:raw.length,bytesGz:gz.length,startedAt,finishedAt,commit:snapshot.commit,runId:snapshot.runId,
 symbols:entries.map(e=>({symbol:e.symbol,ok:e.ok,error:e.error,prices:e.report?.prices.length,lastDate:e.report?.prices.at(-1)?.date,facts:e.report?.facts.length,market:e.report?.context?.market?.symbol??null,sector:e.report?.context?.sector?.symbol??null,quoteTime:e.report?.liveQuote?.quoteTime??null,now:e.now?new Date(e.now).toISOString():null,checks:e.report?.checks.map(c=>c.name+':'+c.state)}))};
writeFileSync(outDir+'/MANIFEST.json',JSON.stringify(manifest,null,1));
console.log('sha256',sha,'bytes',raw.length,'gz',gz.length);
