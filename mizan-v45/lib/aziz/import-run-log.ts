// Evidence for Aziz archive imports. Every POST that passes the owner/admin gates leaves a row in aziz_import_runs,
// including attempts that cannot start (missing provider key), so an empty archive can be diagnosed from D1 alone.
export const TWELVE_DATA_SECRET='TWELVE_DATA_API_KEY';
export type PreflightFailure={code:'twelve_data_key_missing';secretName:string;message:string};

/** Pure check: the provider key must be a non-empty string. Returns the failure to record, or null. */
export function importPreflight(key:unknown):PreflightFailure|null{
 if(typeof key==='string'&&key.trim())return null;
 return {code:'twelve_data_key_missing',secretName:TWELVE_DATA_SECRET,message:'مفتاح Twelve Data غير مهيأ في أسرار الخادم ('+TWELVE_DATA_SECRET+')؛ لم يبدأ الاستيراد ولم تمس بيانات ميزان.'};
}

/** Inserts one aziz_import_runs row with status 'failed' and the failure in result_json. Never throws on insert failure (evidence is best-effort). */
export async function recordImportAttemptFailure(DB:{prepare:(sql:string)=>{bind:(...v:unknown[])=>{run:()=>Promise<unknown>}}},batch:number,symbols:string[],failure:PreflightFailure){
 const at=new Date().toISOString(),id=crypto.randomUUID();
 try{await DB.prepare('INSERT INTO aziz_import_runs(id,started_at,finished_at,requested_batch,status,provider,requested_symbols_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(id,at,at,batch,'failed','twelve_data',JSON.stringify(symbols),JSON.stringify({error:failure.message,code:failure.code,secretName:failure.secretName,results:[],errors:[]}),at).run();return id;}
 catch{return null;}
}
