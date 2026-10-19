/** Circuit breaker for sources that refuse automated requests (HTTP 403/429 from bot protection).
 *  Mizan never bypasses such protection: no browser spoofing, proxies or mirrors. After a refusal the source is
 *  skipped without a network request until the pause ends, then one ordinary request is tried again. */
export const BLOCK_PAUSE_MS:Record<string,number>={tadawul:6*3600000};
export const BLOCKABLE=new Set(Object.keys(BLOCK_PAUSE_MS));
const lockId=(id:string)=>id+':blocked';
export function blockedReason(id:string,until:number){
 const at=new Date(until).toISOString();
 return id==='tadawul'
  ?`موقع تداول السعودية يرفض الطلبات الآلية من خادم ميزان (حماية من الروبوتات، HTTP 403). لا يتجاوز ميزان هذه الحماية. تُقرأ أسعار الأسهم السعودية من Yahoo كمصدر ثانوي مع إظهار وقت السعر، وتبقى قوائم تداول وإعلاناته غير متاحة آليًا. المحاولة التالية تلقائيًا بعد ${at}.`
  :`المصدر يرفض الطلبات الآلية؛ أُوقفت المحاولات حتى ${at} دون تجاوز الحماية.`;
}
export function isRefusal(e:unknown){return e instanceof Error&&/\((?:403|429)\)/.test(e.message);}
export async function activeBlock(db:any,id:string,now=Date.now()):Promise<number|null>{
 if(!BLOCKABLE.has(id))return null;
 try{const row=await db.prepare('SELECT until_ms FROM research_locks WHERE id=?').bind(lockId(id)).first();return row&&Number(row.until_ms)>now?Number(row.until_ms):null;}catch{return null;}
}
export async function recordBlock(db:any,id:string,url:string,now=Date.now()){
 const until=now+(BLOCK_PAUSE_MS[id]||3600000),at=new Date(now).toISOString();
 try{await db.prepare("INSERT INTO research_locks(id,token,until_ms) VALUES(?,'blocked',?) ON CONFLICT(id) DO UPDATE SET until_ms=excluded.until_ms").bind(lockId(id),until).run();}catch{}
 try{await db.prepare("INSERT INTO source_status (id,status,last_attempt,last_success,detail) VALUES (?,'blocked',?,'',?) ON CONFLICT(id) DO UPDATE SET status='blocked',last_attempt=excluded.last_attempt,detail=excluded.detail")
  .bind(id,at,JSON.stringify({stage:'read',url,reason:blockedReason(id,until),pausedUntil:new Date(until).toISOString()})).run();}catch{}
 return until;
}
