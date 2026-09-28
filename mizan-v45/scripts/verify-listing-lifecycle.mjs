#!/usr/bin/env node
/** Regression for a verified delisting. The archived symbol must be REJECTED,
 * not made to pass using another symbol or an invented current price.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {SITE,requestText} from './verify-deployment.mjs';
const DATABASE='e95b74e8-81d6-4beb-8ea2-ad59c863d21d';
const report={commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),checks:[]};
const check=(name,ok,detail)=>report.checks.push({name,ok,detail});
async function query(sql){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||!/^SELECT /i.test(sql)||sql.includes(';'))throw Error('invalid-config');
 const r=await requestText(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params:[]})});
 const data=JSON.parse(r.text),row=data?.result?.[0];
 if(r.status!==200||data.success!==true||row?.success!==true||!Array.isArray(row.results)||Number(row.meta?.rows_written||0)!==0)throw Error('invalid-query-response');
 return row.results;
}
const COUNTS="SELECT (SELECT COUNT(*) FROM forecast_records WHERE symbol='1090.SR') AS forecasts,(SELECT COUNT(*) FROM analysis_snapshots WHERE symbol='1090.SR') AS snapshots,(SELECT COUNT(*) FROM market_observations WHERE symbol='1090.SR') AS observations";
try{
 if(process.argv.includes('--post')){
  const rows=await query("SELECT id,updated_at,json_extract(data,'$.eligibilityPolicy') AS policy,json_extract(data,'$.excludedKnownInactive') AS exclusions FROM research_state WHERE id IN ('job:market-collector:last','job:forecast-seed:last') AND json_valid(data) ORDER BY id");
  report.states=rows;
  for(const id of ['job:market-collector:last','job:forecast-seed:last']){
   const row=rows.find(r=>r.id===id);let excluded=[];try{excluded=JSON.parse(row?.exclusions||'[]');}catch{}
   check(id+' records the listing exclusion',row?.policy==='mizan-known-listing-events-1'&&excluded.includes('1090.SR'),row?.updated_at??null);
  }
 }else{
  report.before=await query(COUNTS);
  const analyzed=await requestText(SITE+'/api/company/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:SITE},body:JSON.stringify({symbol:'1090.SR'})});
  const a=JSON.parse(analyzed.text);
  check('archived symbol is explicitly rejected by current analysis',analyzed.status===410&&a.code==='instrument_not_active'&&a.recorded===false,{httpStatus:analyzed.status,code:a.code});
  check('rejection keeps the original symbol and dated official evidence',a.listing?.symbol==='1090.SR'&&a.listing?.status==='delisted'&&a.listing?.effectiveDate==='2021-04-04'&&new URL(a.listing?.source).hostname==='www.saudiexchange.sa',a.listing??null);
  const searched=await requestText(SITE+'/api/company/search?market=sa&q=1090',{headers:{'Cache-Control':'no-cache'}});
  const company=JSON.parse(searched.text).companies?.find(c=>c.symbol==='1090.SR');
  check('search retains archive with current analysis unavailable',searched.status===200&&company?.analysisAvailable===false&&company?.listingStatus==='delisted',{httpStatus:searched.status,symbol:company?.symbol,listingStatus:company?.listingStatus});
  const screened=await requestText(SITE+'/api/screener',{method:'POST',headers:{'Content-Type':'application/json',Origin:SITE},body:JSON.stringify({market:'sa',horizonSessions:5,symbols:['1090.SR']})});
  const s=JSON.parse(screened.text);
  check('explicit screener request cannot revive or replace Samba',screened.status===200&&s.scanned===1&&s.analyzed===0&&s.failed===1&&s.candidates?.length===0&&s.failures?.[0]?.symbol==='1090.SR'&&s.failures[0].reason.includes('إدراج'),{httpStatus:screened.status,analyzed:s.analyzed,failed:s.failed});
  report.after=await query(COUNTS);
  check('no archived-symbol forecasts, snapshots or prices inserted/deleted',JSON.stringify(report.before)===JSON.stringify(report.after),{before:report.before,after:report.after});
 }
}catch{check('listing regression execution',false,'configuration-or-transport-failure');}
report.status=report.checks.length>0&&report.checks.every(c=>c.ok)?'passed':'failed';
await mkdir('verify-out',{recursive:true});
await writeFile(`verify-out/listing-regression${process.argv.includes('--post')?'-post':''}.json`,JSON.stringify(report,null,2)+'\n');
console.log('MIZAN_LISTING_REGRESSION='+JSON.stringify(report));
if(report.status!=='passed')process.exitCode=1;
