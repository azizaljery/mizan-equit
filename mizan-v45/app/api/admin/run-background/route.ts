import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {adminSession} from '@/lib/admin-access';
import {runResolutionCycle, readLastRun} from '@/worker/scheduled';

const headers = {'Cache-Control': 'no-store, private'};
const MAX_MANUAL_LIMIT = 5;
type Runtime = {DB: any; RECOMMENDATION_OWNER_EMAIL: string};
const runtime = () => env as unknown as Runtime;
const error = (message: string, status: number) => Response.json({error: message}, {status, headers});

function rejectCrossOrigin(req: Request) {
  const origin = req.headers.get('origin');
  // Non-browser callers may omit Origin but still require both existing credentials.
  return (origin !== null && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site';
}

export async function GET(req: Request) {
  try {
    const r = runtime();
    if (!ownerIdentity(req.headers, r.RECOMMENDATION_OWNER_EMAIL || '')) return error('متاح لحساب مالك ميزان فقط.', 403);
    if (!await adminSession(r.DB, req)) return error('سجّل الدخول إلى إدارة ميزان لعرض سجل التشغيل.', 401);
    return Response.json({lastRun: await readLastRun(r.DB)}, {headers});
  } catch { return error('تعذر قراءة آخر تشغيل من قاعدة البيانات.', 503); }
}

export async function POST(req: Request) {
  try {
    if (rejectCrossOrigin(req)) return error('طلب غير مسموح.', 403);
    const r = runtime();
    if (!ownerIdentity(req.headers, r.RECOMMENDATION_OWNER_EMAIL || '')) return error('متاح لحساب مالك ميزان فقط.', 403);
    if (!await adminSession(r.DB, req)) return error('انتهت جلسة الإدارة؛ سجّل الدخول مجددًا.', 401);
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return error('استخدم application/json.', 415);
    // Limit bytes while reading, not after allocating an arbitrarily large body.
    const reader = req.body?.getReader(); let raw = '', size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 500) { await reader.cancel(); return error('الطلب أكبر من الحد.', 413); }
          raw += decoder.decode(value, {stream: true});
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    let body: any = {};
    try { if (raw.trim()) body = JSON.parse(raw); } catch { return error('JSON غير صالح.', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'limit')) return error('الطلب يقبل حقل limit فقط.', 400);
    const limit = body.limit === undefined ? 5 : body.limit;
    // Each symbol is a full fetchCompany (up to 60 s); one HTTP request must stay bounded. Larger backlogs drain via cron.
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANUAL_LIMIT) return error(`limit يجب أن يكون عددًا صحيحًا بين 1 و${MAX_MANUAL_LIMIT}.`, 400);
    const summary = await runResolutionCycle(r.DB, {limit, triggeredBy: 'manual'});
    return Response.json({summary}, {status: summary.status === 'failed' || !summary.stateSaved && summary.status !== 'locked' ? 503 : summary.status === 'locked' ? 409 : 200, headers});
  } catch { return error('تعذر تشغيل مهمة التقييم؛ راجع حالة الاتصال بقاعدة البيانات.', 503); }
}
