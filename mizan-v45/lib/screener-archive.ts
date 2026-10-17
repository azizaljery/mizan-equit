/** Durable screener cohorts, captured by the existing data/Quant pipeline.
 * The server, not browser-submitted winners, fixes original membership.
 */
import {planScreener,runScreener,type ScreenerPlan} from './screener';
import {mergeScreenerResults,type ScreenerRequest,type ScreenerResult} from './screener-policy';
import {issuedScreenerSnapshot,archiveFingerprint,SCREENER_ARCHIVE_VERSION,type ScreenerEvidence} from './screener-snapshot';
import {performanceStats} from './forecast-journal';
import {forecastMetrics} from './forecast-metrics';
import {tryAcquireLock,releaseLock} from '../worker/scheduled';
const MAX_RUN_AGE=2*60*60*1000,SERVER_MAX_RUN_AGE=36*60*60*1000,LEASE_MS=3*60*1000; // batchSize 1: one symbol (~10–20 s wall). A killed batch never releases its lease, so the
// lease is how long a scan stays blocked; a duplicate batch is still rejected by the (run_id,batch_index) insert.

export const SERVER_ARCHIVE_OWNER='server-followup-v2';
const safeId=(id:unknown)=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
async function all(db:any,sql:string,values:unknown[]=[]){const r=await db.prepare(sql).bind(...values).all();if(r.success===false||!Array.isArray(r.results))throw Error('archive-read-failed');return r.results;}
async function authorizedRun(db:any,id:unknown,token:unknown){
 if(!safeId(id)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('صلاحية سجل الفرز غير صالحة.');
 const row=await db.prepare('SELECT * FROM screener_runs WHERE id=? AND token_hash=?').bind(id,await archiveFingerprint(token)).first();
 if(!row)throw Error('سجل الفرز غير متاح لهذه الجلسة.');return row;
}
async function serverRun(db:any,id:unknown){
 if(!safeId(id))throw Error('invalid-server-run-id');
 const row=await db.prepare('SELECT * FROM screener_runs WHERE id=?').bind(id).first();
 if(!row)throw Error('server-run-not-found');
 let plan:any;try{plan=JSON.parse(row.plan_json);}catch{throw Error('server-run-invalid-plan');}
 if(plan?.archiveOwner!==SERVER_ARCHIVE_OWNER)throw Error('server-run-owner-mismatch');
 return row;
}
async function locked<T>(db:any,id:string,task:()=>Promise<T>){const lease=await tryAcquireLock(db,'screener:'+id,LEASE_MS);if(!lease)throw Error('توجد دفعة قيد التشغيل لهذا المسح؛ أعد المحاولة بعد انتهائها.');try{return await task();}finally{await releaseLock(db,'screener:'+id,lease);}}
export async function createScreenerArchive(db:any,input:ScreenerRequest){
 const plan=await planScreener(db,input),id=crypto.randomUUID();
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const at=new Date().toISOString();
 await db.prepare('INSERT INTO screener_runs(id,token_hash,created_at,status,plan_json) VALUES(?,?,?,?,?)').bind(id,await archiveFingerprint(token),at,'scanning',JSON.stringify(plan)).run();
 return {...plan,runId:id,runToken:token,archiveVersion:SCREENER_ARCHIVE_VERSION,archiveCreatedAt:at};
}
/** Server-owned cohort for resumable scheduled work. No bearer capability is persisted or returned. */
export async function createServerScreenerArchive(db:any,input:ScreenerRequest){
 const plan=await planScreener(db,input),id=crypto.randomUUID(),at=new Date().toISOString();
 const discarded=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const owned={...plan,archiveOwner:SERVER_ARCHIVE_OWNER};
 await db.prepare('INSERT INTO screener_runs(id,token_hash,created_at,status,plan_json) VALUES(?,?,?,?,?)').bind(id,await archiveFingerprint(discarded),at,'scanning',JSON.stringify(owned)).run();
 return {...plan,runId:id,archiveVersion:SCREENER_ARCHIVE_VERSION,archiveCreatedAt:at};
}
async function batchRows(db:any,id:string){return all(db,'SELECT * FROM screener_batches WHERE run_id=? ORDER BY batch_index',[id]);}
function combinedResult(plan:ScreenerPlan,rows:any[]):ScreenerResult{
 let result:ScreenerResult|null=null;
 for(const row of rows)result=mergeScreenerResults(result,JSON.parse(row.result_json));
 if(!result)throw Error('المسح بلا دفعات محفوظة.');
 if(result.scanned!==plan.symbols.length)throw Error('المسح غير مكتمل؛ لا يعتمد كقائمة ترشيح نهائية.');
 return result;
}
async function seal(db:any,row:any){
 if(row.status==='complete')return JSON.parse(row.result_json);
 const plan:ScreenerPlan=JSON.parse(row.plan_json),rows=await batchRows(db,row.id),expected=Math.ceil(plan.symbols.length/plan.batchSize);
 if(rows.length!==expected||rows.some((r:any,i:number)=>r.batch_index!==i))throw Error('المسح غير مكتمل؛ لا يعتمد كقائمة ترشيح نهائية.');
 const result=combinedResult(plan,rows),nominatedAt=new Date().toISOString();
 const frozen={version:SCREENER_ARCHIVE_VERSION,runId:row.id,createdAt:row.created_at,nominatedAt,result,rankingPolicy:result.rankingPolicy,
  selectionRule:'resultCount-per-market; medium-or-higher confidence; valid rising canonical projection',
  evaluation:'forecast-journal.evaluateForecast / forecastMetrics / actual market sessions',
  note:'وقت إصدار التوقع ووقت السعر محفوظان لكل سهم؛ وقت اكتمال الترشيح منفصل. المقاييس تخص حركة السعر لا ربح صفقة منفذة.'};
 const serialized=JSON.stringify(frozen),hash=await archiveFingerprint(serialized),ranks:Record<string,number>={sa:0,us:0};
 const statements=result.candidates.map(c=>{
  if(!c.forecastId)throw Error('ترشيح بلا توقع محفوظ؛ لا يعتمد.');
  return db.prepare('INSERT INTO screener_picks(run_id,market,rank,forecast_id) VALUES(?,?,?,?)').bind(row.id,c.market,++ranks[c.market],c.forecastId);
 });
 statements.push(db.prepare("UPDATE screener_runs SET completed_at=?,status='complete',result_json=?,fingerprint=? WHERE id=? AND status='scanning'").bind(nominatedAt,serialized,hash,row.id));
 await db.batch(statements);return frozen;
}
async function processScreenerBatch(db:any,row:any,index:number,maxAge:number){
 const plan:ScreenerPlan=JSON.parse(row.plan_json),expected=Math.ceil(plan.symbols.length/plan.batchSize);
 if(index>=expected)throw Error('رقم الدفعة خارج الخطة المحفوظة.');
 const stored=await db.prepare('SELECT result_json FROM screener_batches WHERE run_id=? AND batch_index=?').bind(row.id,index).first();
 if(stored){if(index===expected-1&&row.status!=='complete')await seal(db,row);return {...JSON.parse(stored.result_json),reused:true};}
 if(row.status!=='scanning'||Date.now()-Date.parse(row.created_at)>maxAge)throw Error('انتهت صلاحية جمع هذا المسح؛ ابدأ مسحًا جديدًا دون استبدال القديم.');
 const previous=await batchRows(db,row.id);
 if(previous.length!==index)throw Error('يجب إكمال الدفعات بالترتيب المحفوظ؛ لا يمكن اختيار دفعات رابحة فقط.');
 const symbols=plan.symbols.slice(index*plan.batchSize,(index+1)*plan.batchSize);
 const request:ScreenerRequest={market:plan.market,horizonSessions:plan.horizonSessions,resultCount:plan.resultCount,scanLimit:plan.scanLimit,symbols,expectedVersion:plan.modelVersion};
 const result=await runScreener(db,request,async(evidence:ScreenerEvidence[],batch:ScreenerResult)=>{
  const statements:any[]=[];
  for(const ev of evidence){
   const issued=issuedScreenerSnapshot(row.id,ev),position=batch.candidates.findIndex(c=>c.symbol===ev.candidate.symbol);
   if(position<0)throw Error('مرشح خارج نتيجة الدفعة.');batch.candidates[position]=issued.candidate;
   statements.push(db.prepare('INSERT INTO analysis_snapshots(id,symbol,created_at,data) VALUES(?,?,?,?)').bind(issued.snapshotId,ev.candidate.symbol,issued.createdAt,JSON.stringify(issued.snapshot)));
   statements.push(db.prepare('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(issued.forecastId,issued.snapshotId,ev.candidate.symbol,issued.createdAt,issued.record.sessions,issued.record.model,ev.candidate.market,ev.report.company.sector||'غير متحقق',issued.record.confidence,1,JSON.stringify(issued.record)));
  }
  statements.push(db.prepare('INSERT INTO screener_batches(run_id,batch_index,created_at,result_json) VALUES(?,?,?,?)').bind(row.id,index,new Date().toISOString(),JSON.stringify(batch)));
  await db.batch(statements);
 });
 if(index===expected-1)await seal(db,row);
 return result;
}
export async function archivedScreenerBatch(db:any,id:unknown,token:unknown,index:unknown){
 const initial=await authorizedRun(db,id,token);
 if(!Number.isInteger(index)||Number(index)<0)throw Error('رقم الدفعة غير صالح.');
 return locked(db,initial.id,async()=>processScreenerBatch(db,await authorizedRun(db,id,token),Number(index),MAX_RUN_AGE));
}
/** Internal scheduled path. It can only resume rows created with SERVER_ARCHIVE_OWNER. */
export async function serverScreenerBatch(db:any,id:unknown,index:unknown){
 const initial=await serverRun(db,id);
 if(!Number.isInteger(index)||Number(index)<0)throw Error('invalid-server-batch-index');
 return locked(db,initial.id,async()=>processScreenerBatch(db,await serverRun(db,id),Number(index),SERVER_MAX_RUN_AGE));
}
export async function finishScreenerArchive(db:any,id:unknown,token:unknown){
 const row=await authorizedRun(db,id,token);
 await locked(db,row.id,async()=>seal(db,await authorizedRun(db,id,token)));
 return screenerArchiveStatus(db,id,token);
}
export async function finishServerScreenerArchive(db:any,id:unknown){
 const row=await serverRun(db,id);
 await locked(db,row.id,async()=>seal(db,await serverRun(db,id)));
 return runStatus(db,await serverRun(db,id));
}
async function runStatus(db:any,row:any){
 const frozen=row.result_json?JSON.parse(row.result_json):null;
 const picks=await all(db,`SELECT p.market,p.rank,f.id,f.symbol,f.horizon,f.model,f.confidence,f.available,f.created_at,f.sector,f.data AS forecast_data,o.evaluated_at,o.data AS outcome_data
  FROM screener_picks p JOIN forecast_records f ON f.id=p.forecast_id LEFT JOIN forecast_outcomes o ON o.id=f.id WHERE p.run_id=? ORDER BY p.market,p.rank`,[row.id]);
 const normalized=picks.map((p:any)=>({...p,recordClass:'prospective-public',forecast:JSON.parse(p.forecast_data),outcome:p.outcome_data?JSON.parse(p.outcome_data):null}));
 const byMarket=['sa','us'].map(m=>{
  const selected=normalized.filter((p:any)=>p.market===m),complete=selected.filter((p:any)=>p.outcome?.state==='complete'),excluded=selected.filter((p:any)=>p.outcome?.state==='excluded');
  return {market:m,selected:selected.length,complete:complete.length,pending:selected.length-complete.length-excluded.length,excluded:excluded.length,performance:performanceStats(selected),
   note:'النسبة المقاسة تستبعد النوافذ المتداخلة وفق سياسة ميزان؛ المقام ظاهر. الصفر في المكتمل ليس دقة صفر.'};
 });
 return {runId:row.id,status:row.status,createdAt:row.created_at,nominatedAt:row.completed_at,
  fingerprint:row.fingerprint,integrity:row.result_json?await archiveFingerprint(row.result_json)===row.fingerprint:null,
  frozen,byMarket,picks:normalized.map((p:any)=>({id:p.id,symbol:p.symbol,market:p.market,rank:p.rank,horizon:p.horizon,model:p.model,issuedAt:p.created_at,
   referencePrice:p.forecast.price,priceTime:p.forecast.priceTime,predictedPrice:p.forecast.predictedPrice,range:p.forecast.range,confidence:p.confidence,
   estimatedEndAt:p.forecast.window?.estimatedEndAt??null,calendarVerified:p.forecast.window?.calendarVerified===true,
   evaluationState:p.outcome?.state??'pending',evaluatedAt:p.evaluated_at??null,outcome:p.outcome,
   actualChangePct:p.outcome?.state==='complete'?forecastMetrics({reference:p.forecast.price,predicted:p.forecast.predictedPrice,actual:p.outcome.actualPrice}).actualChangePct:null})),
  pendingNote:'لا نجاح أو فشل قبل اكتمال جلسات السوق الفعلية ووصول بيانات قابلة للتحقق. الموعد المعروض تقديري، والإغلاق النهائي لا مجرد لمس الهدف هو أساس القياس.'};
}
export async function screenerArchiveStatus(db:any,id:unknown,token:unknown){return runStatus(db,await authorizedRun(db,id,token));}
export async function listScreenerArchives(db:any,before?:string){
 const rows=await all(db,'SELECT id,created_at,completed_at,status,fingerprint,plan_json FROM screener_runs WHERE created_at<? ORDER BY created_at DESC,id DESC LIMIT 30',[before||'9999']);
 return rows.map((r:any)=>{const p=JSON.parse(r.plan_json);return {runId:r.id,createdAt:r.created_at,nominatedAt:r.completed_at,status:r.status,fingerprint:r.fingerprint,market:p.market,horizon:p.horizonSessions,requestedPerMarket:p.resultCount,scannedPlan:p.symbols.length};});
}
export async function readScreenerArchiveForOwner(db:any,id:string){if(!safeId(id))throw Error('invalid-id');const row=await db.prepare('SELECT * FROM screener_runs WHERE id=?').bind(id).first();if(!row)throw Error('not-found');return runStatus(db,row);}
