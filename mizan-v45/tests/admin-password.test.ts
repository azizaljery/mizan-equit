// Owner code change (decision 2026-10-25): inside an admin session, a new 6-digit code + confirmation changes either the
// admin password or the private gate PIN. Real PBKDF2 hashes, real SQLite (admin_access + 0017 columns, recommendation_lock).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {hashPin,unlock} from '../lib/pin-lock';
import {adminLogin,adminSession,changeOwnerCode,verifyPassword} from '../lib/admin-access';

function make(withColumns=true){
 const d=new DatabaseSync(':memory:');
 d.exec("CREATE TABLE admin_access(id integer PRIMARY KEY NOT NULL, attempts integer DEFAULT 0 NOT NULL, window_started integer DEFAULT 0 NOT NULL, session_hash text DEFAULT '' NOT NULL, expires_at integer DEFAULT 0 NOT NULL); CREATE TABLE admin_audit(id text PRIMARY KEY NOT NULL, created_at text NOT NULL, action text NOT NULL, data text NOT NULL); CREATE TABLE recommendation_lock(id integer PRIMARY KEY NOT NULL, owner_id text DEFAULT '' NOT NULL, pin_hash text NOT NULL, attempts integer DEFAULT 0 NOT NULL, window_started integer DEFAULT 0 NOT NULL);");
 if(withColumns)d.exec(readFileSync('drizzle/0017_admin_password.sql','utf8'));
 const st=(sql:string,a:unknown[]=[])=>({sql,a,run:async()=>d.prepare(sql).run(...(a as any[])),first:async()=>(d.prepare(sql).get(...(a as any[])) as any)??null});
 const DB={prepare:(sql:string)=>({...st(sql),bind:(...a:unknown[])=>st(sql,a)}),batch:async(l:any[])=>{d.exec('BEGIN');try{for(const s of l)d.prepare(s.sql).run(...s.a);d.exec('COMMIT');}catch(e){d.exec('ROLLBACK');throw e;}}};
 return {d,DB};
}
const cookie=(t:string)=>new Request('https://x.test/api/admin',{headers:{cookie:'mizan_admin='+t}});

test('admin: new 6-digit code without the old one; old stops, new works, session revoked, audited without the code',async()=>{
 const env=await hashPin('2939959121');const {d,DB}=make();
 const t=await adminLogin(DB,env,'azoz','2939959121');assert.ok(await adminSession(DB,cookie(t)));
 await changeOwnerCode(DB,'admin','482913','482913');
 assert.equal(await adminSession(DB,cookie(t)),false);
 await assert.rejects(adminLogin(DB,env,'azoz','2939959121'),/غير صحيحة/);
 assert.ok(await adminLogin(DB,env,'azoz','482913'));
 const a:any=d.prepare('SELECT action,data FROM admin_audit').get();assert.equal(a.action,'change_admin_password');assert.doesNotMatch(a.data,/482913/);
});

test('gate: new 6-digit code replaces the private gate PIN; old PIN refused; admin login untouched',async()=>{
 const env=await hashPin('2939959121'),gateOld=await hashPin('8158817445');const {d,DB}=make();
 d.prepare('INSERT INTO recommendation_lock(id,pin_hash) VALUES(1,?)').run(gateOld);
 assert.ok(await unlock(DB,gateOld,'owner',' 8158817445'.trim()));
 await changeOwnerCode(DB,'gate','730514','730514');
 await assert.rejects(unlock(DB,gateOld,'owner','8158817445'),/غير صحيح/);
 assert.ok(await unlock(DB,gateOld,'owner','730514'));
 assert.ok(await adminLogin(DB,env,'azoz','2939959121'));
 assert.equal((d.prepare("SELECT action FROM admin_audit").get() as any).action,'change_gate_pin');
 // gate row absent (fresh database): the change creates it
 const {d:d2,DB:DB2}=make();await changeOwnerCode(DB2,'gate','112233','112233');assert.ok(await unlock(DB2,gateOld,'owner','112233'));assert.equal((d2.prepare('SELECT COUNT(*) n FROM recommendation_lock').get() as any).n,1);
});

test('rejections: not exactly 6 digits, mismatch, unknown target; nothing changes',async()=>{
 const env=await hashPin('2939959121');const {d,DB}=make();
 for(const bad of ['12345','1234567','12a456',' 123456','']) await assert.rejects(changeOwnerCode(DB,'admin',bad,bad),/6 أرقام/,bad);
 await assert.rejects(changeOwnerCode(DB,'admin','123456','123457'),/غير مطابق/);
 await assert.rejects(changeOwnerCode(DB,'other','123456','123456'),/اختر/);
 assert.equal((d.prepare('SELECT COUNT(*) n FROM admin_audit').get() as any).n,0);
 assert.ok(await adminLogin(DB,env,'azoz','2939959121'));
});

test('before the migration runs, login still works from the secret (no outage during deploy)',async()=>{
 const env=await hashPin('2939959121');const {DB}=make(false);
 assert.ok(await adminLogin(DB,env,'azoz','2939959121'));
 assert.equal(await verifyPassword('anything',''),false);
});

test('API route: change_code is reachable only after the admin session and owner identity checks',()=>{
 const src=readFileSync('app/api/admin/route.ts','utf8');
 const sess=src.indexOf('if(!await adminSession(runtime.DB,req))'),owner=src.indexOf("if(!ownerIdentity(req.headers",sess),change=src.indexOf("b.action==='change_code'");
 assert.ok(sess>0&&owner>sess&&change>owner);
 assert.match(src.slice(change,change+500),/Max-Age=0/);
});
