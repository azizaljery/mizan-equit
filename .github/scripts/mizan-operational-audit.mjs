// Fixed read-only diagnostics. Never create forecasts, modify state, or expose credentials.
import {mkdir,writeFile} from 'node:fs/promises';
import {requestText} from '../../mizan-v45/scripts/verify-deployment.mjs';
const database='e95b74e8-81d6-4beb-8ea2-ad59c863d21d';
const queries={
 scheduledRuns:"SELECT id,updated_at,json_extract(data,'$.triggeredBy') AS triggered_by,json_extract(data,'$.cron') AS cron,json_extract(data,'$.scheduledTime') AS scheduled_time,json_extract(data,'$.status') AS status,json_extract(data,'$.stateSaved') AS saved,json_extract(data,'$.symbolsScanned') AS symbols_scanned,json_extract(data,'$.symbolsFailed') AS symbols_failed,json_extract(data,'$.evaluationsSaved') AS outcomes_saved,json_extract(data,'$.errors') AS errors FROM research_state WHERE id IN ('job:evaluate-due:last-cron','job:market-collector:last','job:forecast-seed:last') AND json_valid(data)",
 failedAccuracyRows:"SELECT id,run_id,symbol,updated_at,state,substr(error,1,600) AS error FROM accuracy_rows WHERE state='failed' ORDER BY updated_at DESC LIMIT 10",
 archiveCounts:"SELECT status,COUNT(*) AS runs FROM screener_runs GROUP BY status",
 archivedNominees:"SELECT p.market,COUNT(*) AS picks,COUNT(DISTINCT p.run_id) AS runs FROM screener_picks p GROUP BY p.market"
};
const report={checkedAt:new Date().toISOString(),scope:'Read-only operational diagnostics, not an alteration of old samples or scheduled events.',sections:{}};
for(const [name,sql] of Object.entries(queries)){
 try{
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token||!sql.startsWith('SELECT ')||sql.includes(';'))throw Error('invalid-config');
  const r=await requestText(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params:[]})});
  const body=JSON.parse(r.text),part=body.result?.[0];
  if(r.status!==200||body.success!==true||part?.success!==true||!Array.isArray(part.results)||Number(part.meta?.rows_written||0)!==0)throw Error('invalid-response');
  report.sections[name]={status:'ok',data:part.results};
 }catch{report.sections[name]={status:'unavailable',reason:'request-failed-or-schema-unavailable'};}
}
await mkdir('mizan-v45/verify-out',{recursive:true});
await writeFile('mizan-v45/verify-out/operational-audit.json',JSON.stringify(report,null,2)+'\n');
console.log('MIZAN_OPERATIONAL_AUDIT='+JSON.stringify(report));
