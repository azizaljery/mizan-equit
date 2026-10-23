// Aziz issue/outcome ledger write layer (draft schema research/drafts/0017_aziz_issue_ledger.DRAFT.sql).
// Not wired to any route or cron. Semantics required by the owner's review (2026-10-22):
//  - resend of an identical payload (same identity, same content) = success no-op returning the stored row, no new row;
//  - same identity with different content = explicit conflict, nothing written;
//  - a recorded issue must list the price revisions it used, each received at or before the issue knowledge time;
//  - accuracy counts one outcome per issue (aziz_scored_outcomes policy), never one per revision.
export type Stmt={bind:(...v:unknown[])=>{first:<T=any>()=>Promise<T|null>;run:()=>Promise<unknown>}};
export type LedgerDB={prepare:(sql:string)=>Stmt;batch:(stmts:ReturnType<Stmt['bind']>[])=>Promise<unknown>};

export type IssueRow=Record<string,string|number|null>&{id:string;recorded:0|1;data_as_of:string;issued_at:string};
export type IssueInput={price_revision_id:string;role:'feature'|'reference_price'|'calendar'};
export type OutcomeRow=Record<string,string|number|null>&{id:string;forecast_id:string;outcome_revision:number;event_key:string};
export type WriteResult<T>={status:'created';row:T}|{status:'unchanged';row:T}|{status:'conflict';code:string;message:string}|{status:'rejected';code:string;message:string};

/** Fields excluded from the content hash: bookkeeping that differs between two deliveries of the same fact. */
const VOLATILE=new Set(['created_at','payload_hash']);
function canonical(row:Record<string,unknown>){return JSON.stringify(Object.keys(row).filter(k=>!VOLATILE.has(k)).sort().map(k=>[k,row[k]??null]));}
export async function payloadHash(row:Record<string,unknown>){
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(row)));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
const insertSql=(table:string,cols:string[])=>`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;

export async function recordIssue(DB:LedgerDB,issue:IssueRow,inputs:IssueInput[]):Promise<WriteResult<IssueRow>>{
 const hash=await payloadHash({...issue,inputs_count:inputs.length,__inputs:[...inputs].sort((a,b)=>a.price_revision_id.localeCompare(b.price_revision_id))});
 const existing=await DB.prepare('SELECT * FROM aziz_forecast_issues WHERE id=?').bind(issue.id).first<IssueRow>();
 if(existing)return existing.payload_hash===hash?{status:'unchanged',row:existing}:{status:'conflict',code:'issue_conflict',message:'إصدار بنفس المعرف ومحتوى مختلف؛ لم يُكتب شيء.'};
 if(issue.recorded===1&&!inputs.length)return {status:'rejected',code:'inputs_missing',message:'إصدار مسجل بلا قائمة نسخ الأسعار المستخدمة.'};
 for(const x of inputs){
  const r=await DB.prepare('SELECT received_at FROM aziz_price_revisions WHERE id=?').bind(x.price_revision_id).first<{received_at:string}>();
  if(!r)return {status:'rejected',code:'input_unknown',message:'نسخة سعر غير موجودة: '+x.price_revision_id};
  if(r.received_at>issue.data_as_of)return {status:'rejected',code:'input_after_knowledge_time',message:'نسخة سعر استُلمت بعد وقت معرفة الإصدار: '+x.price_revision_id};
 }
 const row:Record<string,unknown>={...issue,inputs_count:inputs.length,payload_hash:hash};const cols=Object.keys(row);
 try{
  await DB.batch([DB.prepare(insertSql('aziz_forecast_issues',cols)).bind(...cols.map(c=>row[c])),
   ...inputs.map(x=>DB.prepare('INSERT INTO aziz_issue_inputs(forecast_id,price_revision_id,role) VALUES(?,?,?)').bind(issue.id,x.price_revision_id,x.role))]);
 }catch(e){
  // a concurrent writer may have inserted the same id or slot between the SELECT and the batch
  const again=await DB.prepare('SELECT * FROM aziz_forecast_issues WHERE id=?').bind(issue.id).first<IssueRow>();
  if(again)return again.payload_hash===hash?{status:'unchanged',row:again}:{status:'conflict',code:'issue_conflict',message:'إصدار بنفس المعرف ومحتوى مختلف؛ لم يُكتب شيء.'};
  const msg=String((e as Error)?.message||e);
  return {status:'conflict',code:/UNIQUE/.test(msg)?'slot_already_issued':'issue_write_failed',message:/UNIQUE/.test(msg)?'يوجد إصدار آخر لنفس الخانة (السهم/الأفق/الهدف/الإصدار).':msg.slice(0,200)};
 }
 return {status:'created',row:row as unknown as IssueRow};
}

export async function recordOutcome(DB:LedgerDB,outcome:OutcomeRow):Promise<WriteResult<OutcomeRow>>{
 const hash=await payloadHash(outcome);
 const existing=await DB.prepare('SELECT * FROM aziz_forecast_outcomes WHERE event_key=? OR (forecast_id=? AND outcome_revision=?)').bind(outcome.event_key,outcome.forecast_id,outcome.outcome_revision).first<OutcomeRow>();
 if(existing)return existing.payload_hash===hash?{status:'unchanged',row:existing}:{status:'conflict',code:'outcome_conflict',message:'نتيجة بنفس الهوية ومحتوى مختلف؛ التصحيح يكون بنسخة جديدة (outcome_revision+1) مع سبب.'};
 const row:Record<string,unknown>={...outcome,payload_hash:hash};const cols=Object.keys(row);
 try{await DB.prepare(insertSql('aziz_forecast_outcomes',cols)).bind(...cols.map(c=>row[c])).run();}
 catch(e){
  const again=await DB.prepare('SELECT * FROM aziz_forecast_outcomes WHERE event_key=?').bind(outcome.event_key).first<OutcomeRow>();
  if(again)return again.payload_hash===hash?{status:'unchanged',row:again}:{status:'conflict',code:'outcome_conflict',message:'نتيجة بنفس الهوية ومحتوى مختلف.'};
  return {status:'rejected',code:'outcome_rejected',message:String((e as Error)?.message||e).slice(0,200)};
 }
 return {status:'created',row:row as unknown as OutcomeRow};
}

/** Declared scoring policy: one outcome per recorded issue — the highest revision available at the cutoff. */
export const SCORED_AS_OF_SQL="SELECT o.* FROM aziz_forecast_outcomes o JOIN aziz_forecast_issues i ON i.id=o.forecast_id AND i.recorded=1 "+
 "WHERE o.available_at<=?1 AND o.outcome_revision=(SELECT MAX(o2.outcome_revision) FROM aziz_forecast_outcomes o2 WHERE o2.forecast_id=o.forecast_id AND o2.available_at<=?1)";
