import {hashPin,CODE_DISABLED} from './pin-lock';

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
 if(row?.password_hash===CODE_DISABLED)return CODE_DISABLED;
 return row?.password_hash&&HASH_RE.test(row.password_hash)?row.password_hash:envHash;
}

export async function tokenDigest(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function adminLogin(db:any,envHash:string,username:unknown,password:unknown){
 const now=Date.now();
 await db.prepare('INSERT OR IGNORE INTO admin_access (id) VALUES (1)').run();
 const hash=await effectiveHash(db,envHash);
 if(hash!==CODE_DISABLED&&!HASH_RE.test(hash||''))throw Error('دخول الإدارة غير مهيأ.');
 await db.prepare('UPDATE admin_access SET attempts=0,window_started=? WHERE id=1 AND window_started<?').bind(now,now-900000).run();
 const row=await db.prepare('UPDATE admin_access SET attempts=attempts+1 WHERE id=1 AND attempts<5 RETURNING id').first();
 if(!row)throw Error('محاولات كثيرة؛ انتظر 15 دقيقة.');
 const valid=hash===CODE_DISABLED||await verifyPassword(typeof password==='string'?password:'',hash);
 if(username!=='azoz'||!valid)throw Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare('UPDATE admin_access SET attempts=0,session_hash=?,expires_at=? WHERE id=1').bind(await tokenDigest(token),now+1800000).run();return token;
}
export async function adminSession(db:any,request:Request){const token=request.headers.get('cookie')?.match(/(?:^|;\s*)mizan_admin=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return false;return !!await db.prepare('SELECT id FROM admin_access WHERE id=1 AND session_hash=? AND expires_at>?').bind(await tokenDigest(token),Date.now()).first();}

/** Owner decision 2026-10-25: from inside an active admin session (owner identity + admin cookie, checked by the
 * caller), a new 6-digit code plus its confirmation is enough — no old code. Target: the admin password or the private
 * gate (بوابة ميزان الخاصة) PIN. Admin change revokes the admin session; gate change invalidates open gate unlocks. */
export const CODE_RE=/^\d{6}$/;
export async function changeOwnerCode(db:any,target:unknown,next:unknown,confirm:unknown){
 if(target!=='admin'&&target!=='gate')throw Error('اختر: كلمة مرور الإدارة أو رمز بوابة ميزان.');
 if(typeof next!=='string'||!CODE_RE.test(next))throw Error('الرمز الجديد يجب أن يكون 6 أرقام بالضبط.');
 if(next!==confirm)throw Error('تأكيد الرمز غير مطابق.');
 const at=new Date().toISOString(),hash=await hashPin(next);
 const audit=db.prepare('INSERT INTO admin_audit(id,created_at,action,data) VALUES(?,?,?,?)').bind(crypto.randomUUID(),at,target==='admin'?'change_admin_password':'change_gate_pin',JSON.stringify({changedAt:at}));
 if(target==='admin')await db.batch([db.prepare('INSERT OR IGNORE INTO admin_access (id) VALUES (1)'),db.prepare("UPDATE admin_access SET password_hash=?,password_changed_at=?,attempts=0,window_started=0,session_hash='',expires_at=0 WHERE id=1").bind(hash,at),audit]);
 else await db.batch([db.prepare('INSERT OR IGNORE INTO recommendation_lock (id,pin_hash) VALUES (1,?)').bind(hash),db.prepare('UPDATE recommendation_lock SET pin_hash=?,attempts=0,window_started=0 WHERE id=1').bind(hash),audit]);
 return {target,changedAt:at};
}

/** Removes the code for the admin login or the private gate (owner decision 2026-10-25). Owner identity (Cloudflare Access)
 * and, for admin, the username stay required. Setting a new 6-digit code later re-enables it. Requires explicit confirm. */
export async function disableOwnerCode(db:any,target:unknown,confirmed:unknown){
 if(target!=='admin'&&target!=='gate')throw Error('اختر: كلمة مرور الإدارة أو رمز بوابة ميزان.');
 if(confirmed!==true)throw Error('أكّد إلغاء الرمز أولًا.');
 const at=new Date().toISOString();
 const audit=db.prepare('INSERT INTO admin_audit(id,created_at,action,data) VALUES(?,?,?,?)').bind(crypto.randomUUID(),at,target==='admin'?'disable_admin_password':'disable_gate_pin',JSON.stringify({changedAt:at}));
 if(target==='admin')await db.batch([db.prepare('INSERT OR IGNORE INTO admin_access (id) VALUES (1)'),db.prepare("UPDATE admin_access SET password_hash=?,password_changed_at=?,attempts=0,window_started=0 WHERE id=1").bind(CODE_DISABLED,at),audit]);
 else await db.batch([db.prepare('INSERT OR IGNORE INTO recommendation_lock (id,pin_hash) VALUES (1,?)').bind(CODE_DISABLED),db.prepare('UPDATE recommendation_lock SET pin_hash=?,attempts=0,window_started=0 WHERE id=1').bind(CODE_DISABLED),audit]);
 return {target,changedAt:at};
}
