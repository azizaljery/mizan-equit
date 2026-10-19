import type {FetchAttempt} from './sources/types';
import {automaticSourceId} from './supporting-sources';
import {upstream,parseChart} from './market-data';
import {readSettings,type SiteSettings} from './site-settings';
import {readExternalSource} from './source-probe';
import {validateMarketIdentity} from './market-identity';
import {parseLiveQuote} from './live-quote';
import type {MarketReport} from './market-data';
import {resolveFinancialSources} from './source-resolution';
import {env} from 'cloudflare:workers';
import {readAlpacaBars,type AlpacaConfig} from './alpaca-data';
import {reserveSecRequest,recordSecCooldown} from './sec-transport';
import {recordSourceRead} from './source-health';
import {activeBlock,recordBlock,isRefusal,blockedReason,BLOCKABLE} from './source-blocking';
export async function recordSourceUse(db:any,report:MarketReport){
 const used=new Map<string,{count:number;url:string}>(),facts=resolveFinancialSources(report).facts;
 for(const fact of facts){const id=automaticSourceId(fact.source);if(id)used.set(id,{count:(used.get(id)?.count||0)+1,url:fact.source});}
 if(report.prices.length>=20){const id=automaticSourceId(report.priceSource)||report.priceSourceId;if(id)used.set(id,{count:report.prices.length,url:report.priceSource});}
 const usedAt=new Date().toISOString();
 await Promise.all([...used].map(async([id,{count,url}])=>{const detail=JSON.stringify({stage:'analysis-used',symbol:report.company.symbol,usedAt,url,count,currency:report.currency,priceTime:report.quoteTime,analysisId:report.forecast?.snapshotId||null});await db.prepare("INSERT INTO source_status(id,status,last_attempt,last_success,detail) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,last_attempt=excluded.last_attempt,last_success=excluded.last_success,detail=excluded.detail").bind('used-'+id,'ok',usedAt,usedAt,detail).run();}));
}
export async function configuredReader(db:any,settings?:SiteSettings){const s=settings||await readSettings(db);
 const sourceAttempts:FetchAttempt[]=[];
 const track=async(id:string,url:string,job:()=>Promise<any>,purpose?:'quote')=>{
  const started=Date.now(),now=new Date(started).toISOString();
  // A source that refused automated requests is paused (no network call) until its pause ends.
  const blockedUntil=await activeBlock(db,id,started);
  if(blockedUntil){const reason=blockedReason(id,blockedUntil);sourceAttempts.push({source:id,url,status:'failed',latencyMs:0,error:reason});throw Error(reason);}
  try{
   const result=await job(),latencyMs=Date.now()-started;
   // Only a live-quote read can be "delayed". Daily/historical series and publication dates are never quote latency.
   let state=result?._mizanPartial?'partial':'ok',reason='قراءة ناجحة؛ يلزم تحقق النوع والهوية قبل اعتماد البيانات.';
   if(purpose==='quote'&&result?.chart?.result?.[0]?.meta)try{const q=parseLiveQuote(result,result.chart.result[0].meta.symbol);if(q.delayed){state='delayed';reason=`وصل سعر مطابق لكن عمره ${Math.round(q.ageSeconds/60)} دقيقة ولم يثبت أنه سعر إغلاق الجلسة؛ المزود لا يقدم بثًا لحظيًا مضمونًا، ويُعرض وقت السعر الحقيقي مع التحليل.`;}}catch{}
   sourceAttempts.push({source:id,url,status:'ok',latencyMs});
   try{await recordSourceRead(db,id,true,latencyMs,new Date().toISOString());}catch{console.warn('Source telemetry write unavailable');}
   try{await db.prepare("INSERT INTO source_status (id,status,last_attempt,last_success,detail) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,last_attempt=excluded.last_attempt,last_success=excluded.last_success,detail=excluded.detail")
    .bind(id,state,now,now,JSON.stringify({stage:'read',url,latencyMs,reason})).run()}catch{}
   return result;
  }catch(e){
   const latencyMs=Date.now()-started;
   const reason=e instanceof Error?e.message.slice(0,240):'تعذر جلب المصدر.';
   sourceAttempts.push({source:id,url,status:'failed',latencyMs,error:reason});
   // A concept the issuer never reported (companyconcept 404) is absence of data, not a source failure.
   if(id==='sec'&&/\/api\/xbrl\/companyconcept\//.test(url)&&/\(404\)/.test(reason))throw e;
   if(isRefusal(e)&&BLOCKABLE.has(id)){try{await recordSourceRead(db,id,false,latencyMs,new Date().toISOString());}catch{}const until=await recordBlock(db,id,url);throw Error(blockedReason(id,until));}
   try{await recordSourceRead(db,id,false,latencyMs,new Date().toISOString());}catch{console.warn('Source telemetry write unavailable');}
   try{await db.prepare("INSERT INTO source_status (id,status,last_attempt,last_success,detail) VALUES (?,'failed',?,'',?) ON CONFLICT(id) DO UPDATE SET status='failed',last_attempt=excluded.last_attempt,detail=excluded.detail")
    .bind(id,now,JSON.stringify({stage:'read',url,latencyMs,reason})).run()}catch{}
   throw e;
  }
 };
 return Object.assign(async (url:string,json=true,ttl=300000,purpose?:'quote'):Promise<any>=>{
 const id=automaticSourceId(url);if(!id)throw Error('هذا الرابط مرجع مساعد أو مصدر غير موصول؛ لا يُستخدم تلقائيًا لجلب الأسعار.');
 const matching=s.sourceConfig.find(v=>v.id===id),enabled=s.sources[id]&&(!matching||matching.enabled&&!matching.deleted);
 const request=new URL(url),symbol=decodeURIComponent(request.pathname.split('/').at(-1)||'');
 const custom=s.sourceConfig.filter(v=>(v.adapter==='chart-json'||v.adapter==='alpaca')&&v.enabled&&!v.deleted&&(!v.metadata||v.metadata.market==='global'||v.metadata.market===(symbol.endsWith('.SR')?'sa':'us')));
 // Only ordinary daily company series use the custom daily connector. Intraday/index paths remain isolated.
 if(custom.length&&id==='yahoo'&&request.pathname.startsWith('/v8/finance/chart/')&&(request.searchParams.get('interval')==='1d'||purpose==='quote')&&/^(?:[A-Z][A-Z0-9.-]{0,15}|\d{4,5}\.SR)$/.test(symbol)){
  const candidates=[...custom,...(enabled&&matching?[matching]:[])].sort((a,b)=>(a.authority==='official'?0:1)-(b.authority==='official'?0:1)||a.priority-b.priority).slice(0,purpose==='quote'?2:3);
  const errors:string[]=[];const started=Date.now();let partial:any=null;
  for(const source of candidates){if(Date.now()-started>24000){errors.push('انتهت مهلة المصادر البديلة؛ أعد المحاولة.');break;}try{
   const result=await track(source.id,source.adapter==='builtin'?url:source.url.replaceAll('{symbol}',encodeURIComponent(symbol)),async()=>{const target=source.url.replaceAll('{symbol}',encodeURIComponent(symbol));const d=source.adapter==='builtin'?await upstream(url,json,ttl,purpose):source.adapter==='alpaca'?await readAlpacaBars(symbol,purpose==='quote'?'quote':'history',env as AlpacaConfig):JSON.parse((await readExternalSource(target,fetch,purpose==='quote'?4000:12000)).raw);const meta=d?.chart?.result?.[0]?.meta;
    if(source.adapter==='chart-json'&&purpose!=='quote'&&meta?.dataGranularity!=='1d')throw Error('المصدر البديل لا يحدد الفاصل اليومي الصحيح.');validateMarketIdentity(meta,symbol);
    let complete=false;
    if(purpose==='quote'){const q=parseLiveQuote(d,symbol);complete=Date.now()-Date.parse(q.quoteTime)<=15*60000;}
    else{const series=parseChart(d,new Date().toISOString().slice(0,10));if(!series.prices.length)throw Error('لا توجد جلسات سعرية صالحة في هذا المصدر.');const age=Date.now()-Date.parse(series.prices.at(-1)!.date+'T00:00:00Z');complete=series.prices.length>=(request.searchParams.get('range')==='5d'?1:20)&&age<=4*86400000;}
    return {...d,_mizanSourceId:source.id,_mizanSource:source.adapter==='builtin'?undefined:source.adapter==='alpaca'?d._mizanSource:target,_mizanPartial:!complete};},purpose);
   if(!result._mizanPartial)return {...result,_mizanFallbackErrors:[...errors]};
   // Retain the highest-priority usable partial source; never manufacture or merge prices.
   if(!partial)partial=result;
   errors.push(source.name+': بيانات جزئية أو متأخرة؛ نبحث عن مصدر مكتمل وأحدث.');
  }catch(e){errors.push(source.name+': '+(e instanceof Error?e.message:'تعذر الجلب'));}}
  if(partial)return {...partial,_mizanFallbackErrors:[...errors,'اعتمدنا أعلى المصادر المتاحة أولوية ببياناته الجزئية؛ يظل وقت السعر وحدود القراءة ظاهرين.']};
  throw Error(errors.join('؛ '));
 }
 if(!enabled)throw Error('هذا المصدر متوقف من إعدادات الإدارة.');
 return track(id,url,async()=>{const data=await upstream(url,json,ttl,purpose,id==='sec'?{beforeRequest:()=>reserveSecRequest(db),onResponse:r=>recordSecCooldown(db,r),userAgent:typeof (env as any).SEC_USER_AGENT==='string'?(env as any).SEC_USER_AGENT:undefined}:undefined);
  if(id==='yahoo'&&request.pathname.startsWith('/v8/finance/chart/')){
   validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol,symbol.startsWith('^'));
   if(purpose==='quote')parseLiveQuote(data,symbol);
   else if(request.searchParams.get('interval')==='1d'&&!parseChart(data,new Date().toISOString().slice(0,10),symbol.startsWith('^')).prices.length)throw Error('المصدر استجاب لكن لم يُرجع جلسات يومية صالحة.');
  }
  return data;
 },purpose);
 },{sourceAttempts});}
