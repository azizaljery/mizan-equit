// Admin password change: real PBKDF2 hashes, real SQLite with migrations 0001 schema + 0017 columns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {hashPin} from '../lib/pin-lock';
import {adminLogin,adminSession,changeAdminPassword,verifyPassword} from '../lib/admin-access';

function make(withColumns=true){
 const d=new DatabaseSync(':memory:');
 d.exec("CREATE TABLE admin_access(id integer PRIMARY KEY NOT NULL, attempts integer DEFAULT 0 NOT NULL, window_started integer DEFAULT 0 NOT NULL, session_hash text DEFAULT '' NOT NULL, expires_at integer DEFAULT 0 NOT NULL); CREATE TABLE admin_audit(id text PRIMARY KEY NOT NULL, created_at text NOT NULL, action text NOT NULL, data text NOT NULL);");
 if(withColumns)d.exec(readFileSync('drizzle/0017_admin_password.sql','utf8'));
 const st=(sql:string,a:unknown[]=[])=>({sql,a,run:async()=>d.prepare(sql).run(...(a as any[])),first:async()=>(d.prepare(sql).get(...(a as any[])) as any)??null});
 const DB={prepare:(sql:string)=>({...st(sql),bind:(...a:unknown[])=>st(sql,a)}),batch:async(l:any[])=>{d.exec('BEGIN');try{for(const s of l)d.prepare(s.sql).run(...s.a);d.exec('COMMIT');}catch(e){d.exec('ROLLBACK');throw e;}}};
 return {d,DB};
}
const cookie=(t:string)=>new Request('https://x.test/api/admin',{headers:{cookie:'mizan_admin='+t}});

test('change password: old stops working, new works, session revoked, audit written, secret untouched',async()=>{
 const env=await hashPin('2939959121');const {d,DB}=make();
 const t=await adminLogin(DB,env,'azoz','2939959121');assert.ok(await adminSession(DB,cookie(t)));
 await changeAdminPassword(DB,env,'2939959121','New-Pass-2026!','New-Pass-2026!');
 assert.equal(await adminSession(DB,cookie(t)),false);                                   // session revoked
 await assert.rejects(adminLogin(DB,env,'azoz','2939959121'),/غير صحيحة/);               // old password refused
 assert.ok(await adminLogin(DB,env,'azoz','New-Pass-2026!'));                              // new one works
 assert.equal((d.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='change_password'").get() as any).n,1);
 assert.doesNotMatch(String((d.prepare('SELECT data FROM admin_audit').get() as any).data),/New-Pass/); // no password in audit
 const row:any=d.prepare('SELECT password_hash FROM admin_access').get();assert.match(row.password_hash,/^[a-f0-9]{32}:[a-f0-9]{64}$/);
});

test('rejections: wrong current, short, mismatch, same as current, spaces; nothing changes',async()=>{
 const env=await hashPin('2939959121');const {d,DB}=make();await adminLogin(DB,env,'azoz','2939959121');
 await assert.rejects(changeAdminPassword(DB,env,'0000000000','New-Pass-2026!','New-Pass-2026!'),/الحالية غير صحيحة/);
 await assert.rejects(changeAdminPassword(DB,env,'2939959121','short','short'),/بين 10/);
 await assert.rejects(changeAdminPassword(DB,env,'2939959121','New-Pass-2026!','New-Pass-2027!'),/غير مطابق/);
 await assert.rejects(changeAdminPassword(DB,env,'2939959121','2939959121','2939959121'),/مطابقة للحالية/);
 await assert.rejects(changeAdminPassword(DB,env,'2939959121',' New-Pass-2026',' New-Pass-2026'),/مسافة/);
 assert.equal((d.prepare('SELECT password_hash FROM admin_access').get() as any).password_hash,'');
 assert.ok(await adminLogin(DB,env,'azoz','2939959121'));
});

test('wrong current password shares the 5-attempt lockout with login',async()=>{
 const env=await hashPin('2939959121');const {DB}=make();await adminLogin(DB,env,'azoz','2939959121');
 for(let i=0;i<5;i++)await assert.rejects(changeAdminPassword(DB,env,'1111111111','New-Pass-2026!','New-Pass-2026!'),/الحالية/);
 await assert.rejects(changeAdminPassword(DB,env,'2939959121','New-Pass-2026!','New-Pass-2026!'),/محاولات كثيرة/);
 await assert.rejects(adminLogin(DB,env,'azoz','2939959121'),/محاولات كثيرة/);
});

test('before the migration runs, login still works from the secret (no outage during deploy)',async()=>{
 const env=await hashPin('2939959121');const {DB}=make(false);
 assert.ok(await adminLogin(DB,env,'azoz','2939959121'));
 assert.equal(await verifyPassword('anything',''),false);assert.equal(await verifyPassword('x'.repeat(129),env),false);
});

test('API route: action requires an admin session and owner identity before it can change anything',()=>{
 const src=readFileSync('app/api/admin/route.ts','utf8');
 const sess=src.indexOf('if(!await adminSession(runtime.DB,req))'),owner=src.indexOf("if(!ownerIdentity(req.headers",sess),change=src.indexOf("b.action==='change_password'");
 assert.ok(sess>0&&owner>sess&&change>owner,'change_password is handled after the session and owner checks');
 assert.match(src.slice(change,change+600),/Max-Age=0/);                                  // cookie cleared
});
