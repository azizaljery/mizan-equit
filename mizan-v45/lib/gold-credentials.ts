import type {GoldRuntime} from './gold-service';

// Application-owned credentials are encrypted; the wrapping key stays in the
// hosting secret store. This record is never part of settings or exports.
const recordId='credential:metalsdev:v1';
const aad=new TextEncoder().encode('mizan-equity:gold:metalsdev:credential:v1');
type Envelope={version:1;iv:string;ciphertext:string;updatedAt:string};
const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
function bytes(v:string){if(!/^(?:[a-f0-9]{2})+$/.test(v))throw Error('invalid envelope');return Uint8Array.from(v.match(/../g)!,b=>parseInt(b,16));}
export function credentialStorageReady(runtime:GoldRuntime){return /^[a-f0-9]{64}$/.test(runtime.MIZAN_PROVIDER_VAULT_KEY||'');}
async function wrappingKey(runtime:GoldRuntime){
  if(!credentialStorageReady(runtime))throw Error('لم تكتمل تهيئة الحفظ الآمن على الخادم.');
  return crypto.subtle.importKey('raw',bytes(runtime.MIZAN_PROVIDER_VAULT_KEY!),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function stored(runtime:GoldRuntime){return runtime.DB.prepare('SELECT data,updated_at FROM gold_state WHERE id=?').bind(recordId).first();}
export async function metalsCredentialStatus(runtime:GoldRuntime){
  const row=await stored(runtime);
  return {storageReady:credentialStorageReady(runtime),configured:!!row||!!runtime.METALS_DEV_API_KEY,location:row?'saved':runtime.METALS_DEV_API_KEY?'hosting':'none',updatedAt:row?.updated_at??null};
}
export async function saveMetalsCredential(runtime:GoldRuntime,value:unknown){
  if(typeof value!=='string'||!/^\S{8,512}$/.test(value.trim())||/[^\x21-\x7e]/.test(value.trim()))throw Error('الصق مفتاح API كاملًا من لوحة Metals.dev؛ لا تضع رابطًا أو مسافات.');
  const key=value.trim();if(key.includes('://'))throw Error('أدخل المفتاح وحده، وليس رابط الخدمة.');
  const wrapping=await wrappingKey(runtime),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},wrapping,new TextEncoder().encode(key));
  const now=new Date().toISOString(),envelope:Envelope={version:1,iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext)),updatedAt:now};
  // Saving/replacing cannot reset the provider request budget, auth, or history.
  const rateId='credential-save:'+now.slice(0,16);
  await runtime.DB.prepare('INSERT OR IGNORE INTO gold_budgets(id,requests) VALUES(?,0)').bind(rateId).run();
  const slot=await runtime.DB.prepare('UPDATE gold_budgets SET requests=requests+1 WHERE id=? AND requests<3 RETURNING requests').bind(rateId).first();
  if(!slot)throw Error('تكررت محاولات الحفظ؛ انتظر دقيقة ثم أعد المحاولة.');
  await runtime.DB.batch([
    runtime.DB.prepare('INSERT INTO gold_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(recordId,JSON.stringify(envelope),now),
    runtime.DB.prepare("DELETE FROM gold_state WHERE id IN ('cache:metalsdev:quote','status:metalsdev')"),
    runtime.DB.prepare('INSERT INTO admin_audit(id,created_at,action,data) VALUES(?,?,?,?)').bind(crypto.randomUUID(),now,'gold:credential-saved',JSON.stringify({provider:'metalsdev',changed:'API credential',actor:'site-owner'})),
  ]);
  return metalsCredentialStatus(runtime);
}
export async function resolveGoldCredentials(runtime:GoldRuntime):Promise<GoldRuntime>{
  const row=await stored(runtime);if(!row)return runtime;
  try{
    const e=JSON.parse(row.data) as Envelope;
    if(e.version!==1||typeof e.iv!=='string'||e.iv.length!==24||typeof e.ciphertext!=='string'||e.ciphertext.length>1100)throw Error('invalid envelope');
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv),additionalData:aad},await wrappingKey(runtime),bytes(e.ciphertext));
    return {...runtime,METALS_DEV_API_KEY:new TextDecoder().decode(clear),metalsCredentialError:undefined};
  }catch{
    // Do not silently reuse a different credential after vault corruption.
    return {...runtime,METALS_DEV_API_KEY:undefined,metalsCredentialError:'تعذر فتح مفتاح Metals.dev المحفوظ؛ أعد حفظه من إدارة ميزان.'};
  }
}
