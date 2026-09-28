#!/usr/bin/env node
/**
 * One-time production bootstrap per market.
 * It never inserts forecast rows directly. When a market has no prospective
 * records yet, it calls the deployed canonical company-analysis route, which
 * persists through recordAnalysis(). Later population is handled by cron.
 */
const SITE='https://mizan-equity.aljeryabod.workers.dev';
const DATABASE='e95b74e8-81d6-4beb-8ea2-ad59c863d21d';
const MAX_BYTES=1_000_000;
const seeds={sa:'2222.SR',us:'AAPL'};

async function boundedText(response){
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('response-too-large');
  const reader=response.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let text='',size=0;
  try{
    while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>MAX_BYTES)throw new Error('response-too-large');text+=decoder.decode(p.value,{stream:true});}
    return text+decoder.decode();
  }finally{await reader.cancel().catch(()=>{});}
}
async function request(url,init={}){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),70_000);
  try{const r=await fetch(url,{...init,redirect:'manual',signal:c.signal});return {status:r.status,text:await boundedText(r)};}
  finally{clearTimeout(timer);}
}
async function cloudflareQuery(sql){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw new Error('missing-cloudflare-credentials');
  if(!/^SELECT\s/i.test(sql)||sql.includes(';'))throw new Error('read-only-query-required');
  const r=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE}/query`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({sql,params:[]}),
  });
  if(r.status!==200)throw new Error('cloudflare-query-failed');
  const body=JSON.parse(r.text);
  const result=body?.result?.[0];
  if(body?.success!==true||result?.success!==true||Number(result?.meta?.rows_written||0)!==0||!Array.isArray(result?.results))throw new Error('invalid-query-result');
  return result.results;
}
async function counts(){
  const rows=await cloudflareQuery("SELECT market,COUNT(*) AS n FROM forecast_records WHERE json_valid(data) AND json_extract(data,'$.recordClass')='prospective-public' GROUP BY market");
  return Object.fromEntries(rows.map(r=>[String(r.market),Number(r.n||0)]));
}
async function seed(symbol){
  const r=await request(SITE+'/api/company/analyze',{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:SITE,'Cache-Control':'no-cache'},
    body:JSON.stringify({symbol}),
  });
  if(r.status!==200)throw new Error('analysis-route-failed');
  let body;try{body=JSON.parse(r.text);}catch{throw new Error('analysis-route-invalid-json');}
  if(body?.forecast?.recorded!==true)throw new Error('forecast-not-recorded');
  return {symbol,rows:Array.isArray(body?.forecast?.rows)?body.forecast.rows.length:null,model:body?.forecast?.version||null};
}
const before=await counts(),actions=[];
for(const [market,symbol] of Object.entries(seeds)){
  if(Number(before[market]||0)>0){actions.push({market,symbol,status:'skipped-existing'});continue;}
  try{actions.push({market,status:'seeded',...await seed(symbol)});}
  catch{actions.push({market,symbol,status:'failed'});}
}
const after=await counts();
const report={before,actions,after};
console.log('MIZAN_BOOTSTRAP='+JSON.stringify(report));
if(Number(after.sa||0)===0||Number(after.us||0)===0)process.exitCode=1;
