import {env} from 'cloudflare:workers';
import {adminSession} from '@/lib/admin-access';
import {ownerIdentity} from '@/lib/pin-lock';

const headers={'Cache-Control':'no-store, private'};
const BATCHES=[
 ['aziz-sa-2222','aziz-sa-1120','aziz-us-aapl','aziz-us-msft'],
 ['aziz-sa-2010','aziz-sa-7010','aziz-us-nvda','aziz-us-xom'],
 ['aziz-sa-2082','aziz-sa-4013','aziz-us-jpm','aziz-us-jnj'],
] as const;

/** Twelve Data request bound; four symbols per batch keep one request well inside Worker limits. */
const FETCH_TIMEOUT_MS=15000;
/** An import still 'running' after this was killed mid-request (no UPDATE ran). */
const STALE_RUN_MS=10*60*1000;
type AzizSymbol={id:string;market:'sa'|'us';symbol:string;provider_symbol:string};
type TwelveBar={datetime?:string;open?:string;high?:string;low?:string;close?:string;volume?:string};

function isoDayBeforeYears(years:number){const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-years);return d.toISOString().slice(0,10);}
function numeric(value:unknown){const n=Number(value);return Number.isFinite(n)?n:null;}
async function sha256(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function chunks<T>(items:T[],size:number){const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));return result;}

async function importOne(DB:any,runId:string,item:AzizSymbol,key:string){
 const retrievedAt=new Date().toISOString();
 const query=new URLSearchParams({symbol:item.provider_symbol,interval:'1day',start_date:isoDayBeforeYears(5),outputsize:'1400',apikey:key});
 if(item.market==='sa')query.set('exchange','XSAU');
 const endpoint='https://api.twelvedata.com/time_series?'+query.toString();
 const response=await fetch(endpoint,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
 const raw=await response.text();
 const datasetId=crypto.randomUUID();
 let payload:any={};try{payload=JSON.parse(raw);}catch{}
 const values:Array<TwelveBar>=Array.isArray(payload?.values)?payload.values:[];
 const message=typeof payload?.message==='string'?payload.message:response.ok?'':('HTTP '+response.status);
 await DB.prepare('INSERT INTO aziz_market_datasets(id,import_run_id,symbol_id,provider,endpoint,retrieved_at,availability_basis,raw_sha256,raw_payload,source_status,source_message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(datasetId,runId,item.id,'twelve_data',endpoint.replace(/apikey=[^&]+/,'apikey=redacted'),retrievedAt,'retrieval_time_only',await sha256(raw),raw,response.ok&&values.length?'ok':'error',message||null,retrievedAt).run();
 if(!response.ok||!values.length)throw Error(message||('تعذر جلب '+item.symbol));
 const statements=values.map((bar,index)=>{
  const day=typeof bar.datetime==='string'?bar.datetime.slice(0,10):'';
  const opened=numeric(bar.open),high=numeric(bar.high),low=numeric(bar.low),closed=numeric(bar.close),volume=numeric(bar.volume);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||opened===null||high===null||low===null||closed===null||high<Math.max(opened,closed)||low>Math.min(opened,closed))return null;
  const flags:string[]=[];if(volume===null)flags.push('volume_missing');
  return DB.prepare('INSERT INTO aziz_market_bars(id,dataset_id,symbol_id,provider,session_date,opened,high,low,closed,adjusted_close,volume,retrieved_at,available_at,availability_basis,quality_flags_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol_id,provider,session_date) DO UPDATE SET dataset_id=excluded.dataset_id,opened=excluded.opened,high=excluded.high,low=excluded.low,closed=excluded.closed,volume=excluded.volume,retrieved_at=excluded.retrieved_at,available_at=NULL,availability_basis=excluded.availability_basis,quality_flags_json=excluded.quality_flags_json').bind(crypto.randomUUID(),datasetId,item.id,'twelve_data',day,opened,high,low,closed,null,volume,retrievedAt,null,'retrieval_time_only',JSON.stringify(flags),retrievedAt);
 }).filter(Boolean);
 for(const batch of chunks(statements,100))await DB.batch(batch);
 return {symbol:item.symbol,bars:statements.length,datasetId};
}

export async function POST(req:Request){
 const runtime=env as any,{DB}=runtime;
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin||!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''))return Response.json({error:'يلزم حساب المالك.'},{status:403,headers});
  if(!await adminSession(DB,req))return Response.json({error:'انتهت جلسة الإدارة.'},{status:401,headers});
  const raw=await req.text();if(raw.length>200)throw Error('طلب الاستيراد غير صالح.');
  const body=JSON.parse(raw||'{}'),batch=Number(body.batch);
  if(!Number.isInteger(batch)||batch<1||batch>BATCHES.length)throw Error('اختر الدفعة 1 أو 2 أو 3.');
  const key=String(runtime.TWELVE_DATA_API_KEY||'').trim();if(!key)throw Error('مفتاح Twelve Data غير مهيأ في أسرار الخادم.');
  const ids=[...BATCHES[batch-1]],marks=ids.map(()=>'?').join(',');
  const found=await DB.prepare('SELECT id,market,symbol,provider_symbol FROM aziz_symbols WHERE id IN ('+marks+') AND active=1').bind(...ids).all();
  const byId=new Map((found.results||[]).map((x:any)=>[x.id,x]));
  const items=ids.map(id=>byId.get(id)).filter(Boolean) as AzizSymbol[];
  if(items.length!==ids.length)throw Error('تعذر العثور على قائمة عزيز المعتمدة لهذه الدفعة.');
  const runId=crypto.randomUUID(),startedAt=new Date().toISOString();
  // Close rows left 'running' by killed requests so status pages do not show them as in progress forever.
  await DB.prepare("UPDATE aziz_import_runs SET status='failed',finished_at=?,result_json=? WHERE status='running' AND started_at<?")
   .bind(startedAt,JSON.stringify({error:'انقطع الاستيراد قبل اكتماله؛ لم يُسجل له نتيجة.',staleMarkedAt:startedAt}),new Date(Date.now()-STALE_RUN_MS).toISOString()).run();
  await DB.prepare('INSERT INTO aziz_import_runs(id,started_at,requested_batch,status,provider,requested_symbols_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(runId,startedAt,batch,'running','twelve_data',JSON.stringify(items.map(x=>x.symbol)),startedAt).run();
  const results:any[]=[],errors:any[]=[];
  for(const item of items){try{results.push(await importOne(DB,runId,item,key));}catch(error){errors.push({symbol:item.symbol,error:error instanceof Error&&error.name==='TimeoutError'?'انتهت مهلة جلب '+item.symbol+' من Twelve Data.':error instanceof Error?error.message:'تعذر الاستيراد'});}}
  const finishedAt=new Date().toISOString(),status=errors.length?(results.length?'completed_with_errors':'failed'):'completed';
  const summary={runId,batch,provider:'twelve_data',results,errors,events:'لم يُستورد بعد؛ جدول الأحداث مستقل ولا تُنسب له أوقات توافر غير موثقة.',sahmkConfigured:!!String(runtime.SAHMK_API_KEY||'').trim()};
  await DB.prepare('UPDATE aziz_import_runs SET finished_at=?,status=?,result_json=? WHERE id=?').bind(finishedAt,status,JSON.stringify(summary),runId).run();
  return Response.json(summary,{status:errors.length?207:200,headers});
 }catch(error){return Response.json({error:error instanceof Error&&/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر استيراد دفعة عزيز؛ لم تمس بيانات ميزان.'},{status:400,headers});}
}
