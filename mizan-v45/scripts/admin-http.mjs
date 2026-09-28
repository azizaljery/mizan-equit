/** Owner identity comes from the hosting session, never from a forged email header. */
export async function adminRequest(path, {method = 'GET', body} = {}) {
  const raw = process.env.MIZAN_HOST, cookie = process.env.MIZAN_COOKIE;
  if (!raw || !cookie) throw Error('اضبط MIZAN_HOST وMIZAN_COOKIE من جلسة المالك والإدارة الفعلية.');
  let host;try{host=new URL(raw);}catch{throw Error('صيغة المضيف غير صالحة.');}
  if (host.username || host.password || host.search || host.hash || !['', '/'].includes(host.pathname)) throw Error('MIZAN_HOST يجب أن يكون أصل الموقع فقط.');
  if (host.protocol !== 'https:' && !(host.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(host.hostname))) throw Error('يلزم HTTPS خارج الجهاز المحلي.');
  const target=new URL(path,host.origin);if(target.origin!==host.origin||target.username||target.password)throw Error('لا تُرسل الجلسة إلى مضيف آخر.');
  let response;
  try {
    response = await fetch(target, {method, redirect: 'error', signal: AbortSignal.timeout(180000),
      headers: {Cookie: cookie, Origin: host.origin, Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  } catch { throw Error('فشل الاتصال؛ تحقق من المضيف والجلسة. لم تُطبع بيانات الدخول.'); }
  if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}: تحقق من جلسة المالك والإدارة ومدخلات الطلب.`); }
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw Error('لم تصل استجابة JSON؛ قد تكون جلسة الاستضافة منتهية.'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 1500000) { await reader.cancel(); throw Error('الاستجابة تجاوزت حد القراءة.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('استجابة JSON غير صالحة؛ لم يُطبع محتواها.');}
}
