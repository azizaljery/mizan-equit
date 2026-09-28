export function validPin(pin:unknown):pin is string{return typeof pin==='string'&&/^\d{6,12}$/.test(pin)}
export function ownerIdentity(headers:Headers,ownerEmail:string){
 const email=(headers.get('oai-authenticated-user-email')||headers.get('cf-access-authenticated-user-email'))?.trim().toLowerCase();
 return ownerEmail&&email===ownerEmail.trim().toLowerCase()?'site-owner':null;
}
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function hashPin(pin:string,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 const bytes=Uint8Array.from(salt.match(/../g)!.map(x=>parseInt(x,16)));
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,iterations:100000,hash:'SHA-256'},key,256);
 return salt+':'+hex(new Uint8Array(bits));
}
export async function verifyPin(pin:string,stored:string){
 if(!validPin(pin)||!/^([a-f0-9]{32}):([a-f0-9]{64})$/.test(stored))return false;
 const candidate=await hashPin(pin,stored.split(':')[0]);let difference=0;
 for(let i=0;i<stored.length;i++)difference|=stored.charCodeAt(i)^candidate.charCodeAt(i);
 return difference===0;
}
export async function unlock(db:any,initialHash:string,user:string,pin:string){
 if(!user)throw new Error('يلزم تسجيل الدخول بحساب مالك الموقع.');
 await db.prepare('INSERT OR IGNORE INTO recommendation_lock (id,pin_hash) VALUES (1,?)').bind(initialHash).run();
 const now=Date.now();
 await db.prepare('UPDATE recommendation_lock SET attempts=0,window_started=? WHERE id=1 AND window_started<?').bind(now,now-900000).run();
 const row=await db.prepare('UPDATE recommendation_lock SET attempts=attempts+1 WHERE id=1 AND attempts<5 AND (owner_id=? OR owner_id=?) RETURNING *').bind(user,'').first();
 if(!row)throw new Error('تعذر فتح التوصية. تأكد من حسابك، أو انتظر 15 دقيقة بعد كثرة المحاولات.');
 if(!await verifyPin(pin,row.pin_hash))throw new Error('الرمز غير صحيح.');
 const saved=await db.prepare('UPDATE recommendation_lock SET owner_id=?,attempts=0 WHERE id=1 AND pin_hash=? AND (owner_id=? OR owner_id=?) RETURNING id').bind(user,row.pin_hash,user,'').first();
 if(!saved)throw new Error('تغير الرمز؛ أعد المحاولة بالرمز الحالي.');
 return row.pin_hash as string;
}
