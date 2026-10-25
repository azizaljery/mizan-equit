import {hashPin} from './pin-lock';

const HASH_RE=/^([a-f0-9]{32}):([a-f0-9]{64})$/;
/** Constant-time PBKDF2 check for any password string (the PIN verifier only accepts 6-12 digits). */
export async function verifyPassword(password:string,stored:string){
 if(typeof password!=='string'||!password||password.length>128||!HASH_RE.test(stored||''))return false;
 const candidate=await hashPin(password,stored.split(':')[0]);let difference=0;
 for(let i=0;i<stored.length;i++)difference|=stored.charCodeAt(i)^candidate.charCodeAt(i);
 return difference===0;
}
/** Password chosen in the admin panel overrides the Worker secret; empty column = secret. */
async function effectiveHash(db:any,envHash:string){
 let row:any=null;try{row=await db.prepare('SELECT password_hash FROM admin_access WHERE id=1').first();}catch{/* column not migrated yet */}
 return row?.password_hash&&HASH_RE.test(row.password_hash)?row.password_hash:envHash;
}
export const PASSWORD_MIN=10,PASSWORD_MAX=128;
export async function tokenDigest(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function adminLogin(db:any,envHash:string,username:unknown,password:unknown){
 const now=Date.now();
 await db.prepare('INSERT OR IGNORE INTO admin_access (id) VALUES (1)').run();
 const hash=await effectiveHash(db,envHash);
 if(!HASH_RE.test(hash||''))throw Error('دخول الإدارة غير مهيأ.');
 await db.prepare('UPDATE admin_access SET attempts=0,window_started=? WHERE id=1 AND window_started<?').bind(now,now-900000).run();
 const row=await db.prepare('UPDATE admin_access SET attempts=attempts+1 WHERE id=1 AND attempts<5 RETURNING id').first();
 if(!row)throw Error('محاولات كثيرة؛ انتظر 15 دقيقة.');
 const valid=await verifyPassword(typeof password==='string'?password:'',hash);
 if(username!=='azoz'||!valid)throw Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare('UPDATE admin_access SET attempts=0,session_hash=?,expires_at=? WHERE id=1').bind(await tokenDigest(token),now+1800000).run();return token;
}
export async function adminSession(db:any,request:Request){const token=request.headers.get('cookie')?.match(/(?:^|;\s*)mizan_admin=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return false;return !!await db.prepare('SELECT id FROM admin_access WHERE id=1 AND session_hash=? AND expires_at>?').bind(await tokenDigest(token),Date.now()).first();}

/** Changes the admin password. Requires an active admin session (checked by the caller) AND the current password.
 * Shares the 5-attempts/15-minutes counter with login. On success the session is revoked: the owner signs in again. */
export async function changeAdminPassword(db:any,envHash:string,current:unknown,next:unknown,confirm:unknown){
 if(typeof next!=='string'||next.length<PASSWORD_MIN||next.length>PASSWORD_MAX)throw Error(`كلمة المرور الجديدة يجب أن تكون بين ${PASSWORD_MIN} و${PASSWORD_MAX} حرفًا أو رقمًا.`);
 if(next!==confirm)throw Error('تأكيد كلمة المرور الجديدة غير مطابق.');
 if(/^\s|\s$/.test(next))throw Error('لا تبدأ كلمة المرور الجديدة أو تنتهي بمسافة.');
 const now=Date.now();
 await db.prepare('UPDATE admin_access SET attempts=0,window_started=? WHERE id=1 AND window_started<?').bind(now,now-900000).run();
 const row=await db.prepare('UPDATE admin_access SET attempts=attempts+1 WHERE id=1 AND attempts<5 RETURNING id').first();
 if(!row)throw Error('محاولات كثيرة؛ انتظر 15 دقيقة.');
 const hash=await effectiveHash(db,envHash);
 if(!await verifyPassword(typeof current==='string'?current:'',hash))throw Error('كلمة المرور الحالية غير صحيحة.');
 if(await verifyPassword(next,hash))throw Error('كلمة المرور الجديدة مطابقة للحالية.');
 const at=new Date(now).toISOString();
 await db.batch([
  db.prepare("UPDATE admin_access SET password_hash=?,password_changed_at=?,attempts=0,session_hash='',expires_at=0 WHERE id=1").bind(await hashPin(next),at),
  db.prepare('INSERT INTO admin_audit(id,created_at,action,data) VALUES(?,?,?,?)').bind(crypto.randomUUID(),at,'change_password',JSON.stringify({changedAt:at})),
 ]);
 return {changedAt:at};
}
