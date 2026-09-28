/** Bounded, read-only projections over the existing research_state table. */
export class StateInputError extends Error {}
export type StateRow={id:string;updated_at:string;size:number;sizeUnit:'utf8-bytes'};
export type StateRowSummary=StateRow;
export type ListResult=Awaited<ReturnType<typeof listStateRows>>;
export function stateInteger(value:unknown,fallback:number,min:number,max:number):number{
 if(value===undefined)return fallback;
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new StateInputError(`الحد يجب أن يكون عددًا صحيحًا بين ${min} و${max}.`);
 return value;
}
export function stateId(id:unknown):string{
 if(typeof id!=='string'||!id.length||id.length>256||/[\u0000-\u001f\u007f]/.test(id))throw new StateInputError('معرف سجل غير صالح.');
 return id;
}
export async function listStateRows(db:any,options:{offset?:number;limit?:number}={}){
 const limit=stateInteger(options.limit,20,1,100),offset=stateInteger(options.offset,0,0,1000000);
 const list=await db.prepare('SELECT id,updated_at,length(CAST(data AS BLOB)) AS size FROM research_state ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?').bind(limit,offset).all();
 const count=await db.prepare('SELECT COUNT(*) AS n FROM research_state').first();
 const rows:StateRow[]=(list.results??[]).map((r:any)=>({...r,sizeUnit:'utf8-bytes'}));
 return {rows,total:Number(count.n),offset,limit,hasMore:offset+rows.length<Number(count.n)};
}
/** Paths are bound values; aliases are generated internally. Large/nested values never escape. */
export async function readStateField(db:any,id:string,fields:string[]):Promise<Record<string,unknown>|null>{
 stateId(id);
 if(!Array.isArray(fields)||!fields.length||fields.length>20||new Set(fields).size!==fields.length||fields.some(f=>typeof f!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f)))throw new StateInputError('اختر 1–20 اسم حقل بسيطًا وغير مكرر.');
 const data="CASE WHEN json_valid(data) THEN data ELSE '{}' END",params:string[]=[id];
 const projected=fields.flatMap((f,i)=>{params.push('$.'+f,'$.'+f);return [`json_extract(${data},?) AS v${i}`,`json_type(${data},?) AS t${i}`];});
 const expressions=fields.flatMap((_,i)=>{
  const omitted=`t${i} IN ('array','object') OR length(CAST(v${i} AS BLOB))>2048`;
  return [`CASE WHEN ${omitted} THEN NULL ELSE v${i} END AS f${i}`,`t${i}`,`CASE WHEN ${omitted} THEN 1 ELSE 0 END AS o${i}`];
 });
 const row=await db.prepare(`WITH selected AS (SELECT data,updated_at FROM research_state WHERE id=?), projected AS (SELECT updated_at,json_valid(data) AS valid_json,${projected.join(',')} FROM selected) SELECT updated_at,valid_json,${expressions.join(',')} FROM projected`).bind(...params).first();
 if(!row)return null;
 const out:Record<string,unknown>=Object.create(null),omitted:string[]=[];
 fields.forEach((f,i)=>{out[f]=row['t'+i]==='true'?true:row['t'+i]==='false'?false:row['f'+i]??null;if(row['o'+i])omitted.push(f);});
 out._updatedAt=row.updated_at;
 if(omitted.length)out._omittedFields=omitted;
 if(!row.valid_json)out._invalidJson=true;
 return out;
}
/** Retain both supplied spellings as one implementation. */
export const readStateFields=readStateField;
export async function listStateKeys(db:any,options:{offset?:number;limit?:number}={}){
 const limit=stateInteger(options.limit,20,1,100),offset=stateInteger(options.offset,0,0,1000000);
 const result=await db.prepare('SELECT id FROM research_state ORDER BY id LIMIT ? OFFSET ?').bind(limit+1,offset).all();
 const keys=(result.results??[]).slice(0,limit).map((r:any)=>String(r.id));
 return {keys,count:keys.length,offset,limit,hasMore:(result.results??[]).length>limit};
}
export async function stateExists(db:any,id:string){
 stateId(id);const row=await db.prepare('SELECT length(CAST(data AS BLOB)) AS size,updated_at FROM research_state WHERE id=?').bind(id).first();
 return {exists:!!row,size:row?Number(row.size):null,updated_at:row?.updated_at??null,sizeUnit:'utf8-bytes'};
}
/** SQLite substr counts Unicode code points. UTF-8 byte size is reported separately. */
export async function readStateSlices(db:any,id:string,options:{offset?:number;length?:number;updatedAt?:string}={}){
 stateId(id);const offset=stateInteger(options.offset,0,0,100000000),length=stateInteger(options.length,4000,1,8000);
 const row=await db.prepare('SELECT id,updated_at,length(data) AS totalLength,length(CAST(data AS BLOB)) AS size,substr(data,?,?) AS slice FROM research_state WHERE id=?').bind(offset+1,length,id).first();
 if(!row)return null;
 if(options.updatedAt!==undefined&&row.updated_at!==options.updatedAt)throw new StateInputError('تغير السجل أثناء القراءة؛ ابدأ من الشريحة الأولى مجددًا.');
 const slice=String(row.slice??''),nextOffset=offset+Array.from(slice).length;
 return {id:row.id,updatedAt:row.updated_at,totalLength:Number(row.totalLength),size:Number(row.size),sizeUnit:'utf8-bytes',offset,length,offsetUnit:'unicode-code-points',slice,nextOffset,hasMore:nextOffset<Number(row.totalLength)};
}
