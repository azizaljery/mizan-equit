/** One shared reservation row limits SEC requests across concurrent Worker instances. */
export async function reserveSecRequest(db:any,clock:()=>number=Date.now,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 for(let attempt=0;attempt<12;attempt++){
  const now=clock(),cooldown=await db.prepare("SELECT until_ms FROM research_locks WHERE id='sec:cooldown'").first();
  if(cooldown?.until_ms>now)throw Error('مصدر SEC طلب مهلة قبل المحاولة التالية؛ تستمر المصادر الأخرى.');
  const row=await db.prepare("INSERT INTO research_locks(id,token,until_ms) VALUES('sec:rate','rate',?) ON CONFLICT(id) DO UPDATE SET until_ms=excluded.until_ms WHERE until_ms<=? RETURNING until_ms").bind(now+150,now).first();
  if(row)return;
  if(attempt<11)await wait(150);
 }
 throw Error('وصل الاتصال المشترك بـ SEC إلى حد الطلبات؛ أعد المحاولة لاحقًا دون تكرار سريع.');
}
export async function recordSecCooldown(db:any,response:Response,now=Date.now()){
 if(![403,429].includes(response.status))return;
 const raw=response.headers.get('retry-after'),seconds=raw&&/^\d+$/.test(raw)?Number(raw):null;
 const requested=seconds!==null?now+seconds*1000:raw?Date.parse(raw):NaN;
 const until=Number.isFinite(requested)?Math.max(now+1000,requested):now+60000;
 await db.prepare("INSERT INTO research_locks(id,token,until_ms) VALUES('sec:cooldown','cooldown',?) ON CONFLICT(id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)").bind(until).run();
}
