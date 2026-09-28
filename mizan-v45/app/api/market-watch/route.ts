import { env } from 'cloudflare:workers';
import { fingerprint } from '@/lib/evidence-ledger';
import { validSymbol } from '@/lib/market-data';
import { fetchLiveQuote } from '@/lib/market-data';
import { configuredReader } from '@/lib/source-status';
import { readSettings } from '@/lib/site-settings';

const headers = { 'Cache-Control': 'no-store, private' };
const MAX_WATCH_ITEMS = 100;
const account = async (req: Request): Promise<string | null> => {
  const id = req.headers.get('oai-authenticated-user-id');
  return id ? fingerprint('mizan-watch:' + id) : null;
};
const marketOf = (symbol: string) => /^\d{4,5}\.SR$/.test(symbol) ? 'sa' : /^[A-Z][A-Z0-9-]*$/.test(symbol) ? 'us' : null;
type GateResult = { key: string; error?: never } | { error: Response; key?: never };
async function gate(req: Request): Promise<GateResult> {
  const key = await account(req);
  if (!key) return { error: Response.json({ error: 'سجّل الدخول لمراقبة السوق وحفظ بياناتك.' }, { status: 401, headers }) };
  if (req.method === 'POST' && req.headers.get('origin') !== new URL(req.url).origin) return { error: Response.json({ error: 'طلب غير مسموح.' }, { status: 403, headers }) };
  return { key };
}
export async function GET(req: Request) {
  const g = await gate(req); if (g.error) return g.error;
  const db = (env as any).DB; const key = g.key!;
  try {
    const rows = await db.prepare(`SELECT w.account_key,w.symbol,w.market,w.name,w.created_at,w.updated_at,w.data,
      (SELECT o.data FROM market_observations o WHERE o.symbol=w.symbol AND o.market=w.market ORDER BY o.observed_at DESC LIMIT 1) latest_observation
      FROM customer_market_watch w WHERE w.account_key=? ORDER BY w.updated_at DESC,w.symbol`).bind(key).all();
    return Response.json({items:(rows.results||[]).map((r:any)=>({...JSON.parse(r.data),latestObservation:r.latest_observation?JSON.parse(r.latest_observation):null}))},{headers});
  } catch { return Response.json({error:'تعذر قراءة قائمة مراقبة السوق.'},{status:503,headers}); }
}
export async function POST(req: Request) {
  const g = await gate(req); if (g.error) return g.error;
  try {
    const body = await req.json(); const action=String(body?.action||'');
    const symbol=String(body?.symbol||'').trim().toUpperCase();
    const market=marketOf(symbol);
    if (!market || !validSymbol(symbol)) return Response.json({error:'رمز تداول غير صالح.'},{status:400,headers});
    const db=(env as any).DB; const now=new Date().toISOString();
    if(action==='remove'){
      await db.prepare('DELETE FROM customer_market_watch WHERE account_key=? AND symbol=?').bind(g.key,symbol).run();
      return Response.json({message:'أزيل السهم من مراقبتك.'},{headers});
    }
    if(action!=='add') return Response.json({error:'الإجراء غير معروف.'},{status:400,headers});
    const existing=await db.prepare('SELECT 1 AS found FROM customer_market_watch WHERE account_key=? AND symbol=?').bind(g.key,symbol).first();
    if(!existing){
      const count=await db.prepare('SELECT COUNT(*) AS count FROM customer_market_watch WHERE account_key=?').bind(g.key).first();
      if(Number(count?.count||0)>=MAX_WATCH_ITEMS) return Response.json({error:`لا يمكن مراقبة أكثر من ${MAX_WATCH_ITEMS} شركة للحساب الواحد.`},{status:429,headers});
    }
    const name=typeof body?.name==='string'&&body.name.trim()?body.name.trim().slice(0,250):symbol;
    await db.prepare(`INSERT INTO customer_market_watch(account_key,symbol,market,name,created_at,updated_at,data)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_key,symbol) DO UPDATE SET name=excluded.name,market=excluded.market,updated_at=excluded.updated_at,data=excluded.data`)
      .bind(g.key,symbol,market,name,now,now,JSON.stringify({symbol,market,name,createdAt:now,updatedAt:now})).run();
    return Response.json({message:'أضيف السهم إلى مراقبتك وحُفظت إعداداته.',item:{symbol,market,name}},{headers});
  } catch { return Response.json({error:'تعذر حفظ مراقبة السوق.'},{status:503,headers}); }
}