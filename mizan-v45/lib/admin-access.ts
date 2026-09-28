import {verifyPin} from './pin-lock';
export async function tokenDigest(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function adminLogin(db:any,hash:string,username:unknown,password:unknown){
 if(!/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash||''))throw Error('دخول الإدارة غير مهيأ.');
 const now=Date.now();
 await db.prepare('INSERT OR IGNORE INTO admin_access (id) VALUES (1)').run();
 await db.prepare('UPDATE admin_access SET attempts=0,window_started=? WHERE id=1 AND window_started<?').bind(now,now-900000).run();
 const row=await db.prepare('UPDATE admin_access SET attempts=attempts+1 WHERE id=1 AND attempts<5 RETURNING id').first();
 if(!row)throw Error('محاولات كثيرة؛ انتظر 15 دقيقة.');
 const valid=await verifyPin(typeof password==='string'?password:'',hash);
 if(username!=='azoz'||!valid)throw Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare('UPDATE admin_access SET attempts=0,session_hash=?,expires_at=? WHERE id=1').bind(await tokenDigest(token),now+1800000).run();return token;
}
export async function adminSession(db:any,request:Request){const token=request.headers.get('cookie')?.match(/(?:^|;\s*)mizan_admin=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return false;return !!await db.prepare('SELECT id FROM admin_access WHERE id=1 AND session_hash=? AND expires_at>?').bind(await tokenDigest(token),Date.now()).first();}
