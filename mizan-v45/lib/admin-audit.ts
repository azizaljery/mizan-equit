import {settingChanges} from './admin-config';

export type AdminAuditChange={field:string;oldValue:unknown;newValue:unknown};
export type AdminAuditEntry={id:string;created_at:string;action:string;changes:AdminAuditChange[];notice?:string};
const unavailable='تعذر قراءة تفاصيل هذا السجل؛ بقي السجل الأصلي محفوظًا.';
const sensitive=/password|passwd|credential|ciphertext|secret|token|api.?key|vault|authorization|(?:^|[._-])pin(?:[._-]|$)/i;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

function safeValue(value:unknown,field='',depth=0):unknown{
 if(sensitive.test(field))return 'محجوب';
 if(depth>12)return 'تفاصيل متداخلة';
 if(Array.isArray(value))return value.map(v=>safeValue(v,field,depth+1));
 if(object(value))return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,safeValue(v,key,depth+1)]));
 return value??null;
}

// Read all historic formats without rewriting records or returning raw audit data.
export function normalizeAdminAuditEntry(input:unknown,index=0):AdminAuditEntry{
 const row=object(input)?input:{};
 const entry:AdminAuditEntry={id:typeof row.id==='string'?row.id:'audit-'+index,created_at:typeof row.created_at==='string'?row.created_at:'وقت غير متاح',action:typeof row.action==='string'?row.action:'unknown',changes:[]};
 if(entry.action==='gold:credential-saved'){
  entry.changes=[{field:'مفتاح اتصال Metals.dev',oldValue:'محجوب',newValue:'حُفظ بأمان — لا يُعرض في السجل'}];
  return entry;
 }
 try{
  const data=Object.hasOwn(row,'changes')?row.changes:typeof row.data==='string'?JSON.parse(row.data):row.data;
  const changes=Array.isArray(data)?data:object(data)&&Object.hasOwn(data,'old')&&Object.hasOwn(data,'next')?settingChanges(data.old,data.next):null;
  if(!changes){entry.notice=unavailable;return entry;}
  for(const change of changes){
   if(!object(change)||typeof change.field!=='string'){entry.notice=unavailable;continue;}
   entry.changes.push({field:change.field,oldValue:safeValue(change.oldValue,change.field),newValue:safeValue(change.newValue,change.field)});
  }
  if(typeof row.notice==='string')entry.notice=unavailable;
 }catch{entry.changes=[];entry.notice=unavailable;}
 return entry;
}

export function normalizeAdminAudit(input:unknown):AdminAuditEntry[]{return Array.isArray(input)?input.map(normalizeAdminAuditEntry):[];}
export function adminAuditActionLabel(action:string){
 const labels:Record<string,string>={save:'حفظ الإعدادات',reset:'إعادة الإعدادات الافتراضية',restore:'استعادة الإعدادات','gold:save':'حفظ إعدادات الذهب','gold:reset':'إعادة إعدادات الذهب الافتراضية','gold:restore':'استعادة إعدادات الذهب','gold:credential-saved':'حفظ مفتاح اتصال الذهب'};
 return Object.hasOwn(labels,action)?labels[action]:'تعديل إداري';
}
