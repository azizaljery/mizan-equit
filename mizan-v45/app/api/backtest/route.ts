/** API only — never paste this into lib/backtest/all-in-one.ts. */
import { env } from 'cloudflare:workers';
import { ownerIdentity } from '@/lib/pin-lock';
import { configuredReader } from '@/lib/source-status';
import { readSettings } from '@/lib/site-settings';
import { runBacktest, renderBacktestReport, type BacktestOptions } from '@/lib/backtest/all-in-one';
import { fetchCompany, validSymbol } from '@/lib/market-data';

const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie' };
const MAX_BYTES = 2048;
class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new InputError('الطلب أكبر من الحد أو طوله غير صالح.', 413);
  if (!req.body) throw new InputError('جسم الطلب فارغ.');
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new InputError('الطلب أكبر من الحد.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new InputError('جسم الطلب يجب أن يكون JSON صالحاً.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('جسم الطلب يجب أن يكون كائن JSON.');
  return body as Record<string, unknown>;
}
function parseSymbol(value: unknown): string {
  if (typeof value !== 'string') throw new InputError('رمز غير صالح.');
  const symbol = value.trim().toUpperCase();
  if (!symbol || !validSymbol(symbol)) throw new InputError('رمز غير صالح.');
  return symbol;
}
function parseBps(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) throw new InputError('الرسوم والانزلاق: رقم بين 0 و1000 نقطة أساس لكل جانب.');
  return value;
}
function parseAsOf(value: unknown): string {
  const today = new Date().toISOString().slice(0, 10);
  if (value === undefined) return new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('asOf يجب أن يكون تاريخاً بصيغة YYYY-MM-DD.');
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value || value >= today) {
    throw new InputError('اختر تاريخاً صحيحاً سابقاً لليوم؛ لا تُستخدم جلسة اليوم غير المكتملة.');
  }
  return value;
}
export function GET(): Response {
  return Response.json({ error: 'استخدم POST مع جسم JSON لتشغيل الاختبار.' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
}
export async function POST(req: Request): Promise<Response> {
  try {
    // Origin is a CSRF check, NOT authentication. Keep the existing owner check.
    if (req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ error: 'طلب غير مسموح.' }, { status: 403, headers });
    const runtime = env as unknown as {
      DB: Parameters<typeof configuredReader>[0]; RECOMMENDATION_OWNER_EMAIL?: string;
    };
    const ownerEmail = runtime.RECOMMENDATION_OWNER_EMAIL?.trim();
    if (!ownerEmail || !(await ownerIdentity(req.headers, ownerEmail))) return Response.json({ error: 'هذا الإجراء متاح لحساب مالك ميزان فقط.' }, { status: 403, headers });
    if (!runtime.DB) return Response.json({ error: 'إعداد قاعدة البيانات غير مكتمل.' }, { status: 503, headers });
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new InputError('نوع المحتوى يجب أن يكون application/json.', 415);
    }
    const body = await readBody(req);
    const allowed = new Set(['symbol', 'mode', 'asOf', 'benchmarkSymbol', 'benchmarkComparableBasisConfirmed', 'pricesAreSplitAdjusted', 'feeBps', 'slippageBps']);
    if (Object.keys(body).some(key => !allowed.has(key))) throw new InputError('يتضمن الطلب حقلاً غير معروف.');
    const symbol = parseSymbol(body.symbol);
    if (body.mode !== undefined && body.mode !== 'full' && body.mode !== 'technical') throw new InputError('الوضع يجب أن يكون technical أو full.');
    const mode = body.mode === 'full' ? 'full' : 'technical';
    const asOf = parseAsOf(body.asOf);
    for (const key of ['benchmarkComparableBasisConfirmed', 'pricesAreSplitAdjusted']) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new InputError(`الحقل ${key} يجب أن يكون منطقياً.`);
    }
    const benchmarkSymbol = body.benchmarkSymbol === undefined ? undefined : parseSymbol(body.benchmarkSymbol);
    if (benchmarkSymbol && body.benchmarkComparableBasisConfirmed !== true) throw new InputError('أكد تطابق أساس تعديل أسعار السهم والمؤشر بعد التحقق من المصدر.');
    const options: BacktestOptions = { feeBps: parseBps(body.feeBps), slippageBps: parseBps(body.slippageBps), pricesAreSplitAdjusted: body.pricesAreSplitAdjusted === true };
    const settings = await readSettings(runtime.DB);
    for (const ticker of [symbol, benchmarkSymbol].filter((s): s is string => !!s)) {
      const market = ticker.endsWith('.SR') ? 'sa' : /^[A-Z][A-Z0-9.-]*$/.test(ticker) ? 'us' : 'global';
      if (!settings.enabledMarkets.includes(market)) throw new InputError('هذا السوق متوقف من إعدادات الإدارة.', 403);
    }
    // Preserve source policy, SEC reservations and source telemetry. Never invoke
    // analyzedCompany, recordAnalysis, resolveForecasts or supplementResearch here.
    const read = await configuredReader(runtime.DB, settings);
    const report = await fetchCompany(symbol, read, true, asOf);
    // Provider-specific benchmark symbols are NOT guessed. Use a verified symbol.
    if (benchmarkSymbol) {
      const benchmarkReport = await fetchCompany(benchmarkSymbol, read, true, asOf);
      options.benchmark = { symbol: benchmarkReport.company.symbol, prices: benchmarkReport.prices,
        currency: benchmarkReport.currency || '', comparableBasisConfirmed: true };
      report.warnings.push(...benchmarkReport.warnings.map(w => `المؤشر ${benchmarkSymbol}: ${w}`));
    }
    let output: ReturnType<typeof runBacktest>;
    try { output = runBacktest(report, mode, options); }
    catch { return Response.json({ error: 'تعذر الاختبار: تحقق من صلاحية الأسعار وتواريخها والحقائق المالية والتجزئات.' }, { status: 422, headers }); }
    output.result.warnings = [...new Set([...report.warnings, ...output.result.warnings])];
    output.text = renderBacktestReport(output.result);
    const blockedByReason: Record<string, number> = Object.create(null);
    for (const row of output.result.records) if (row.verdict === 'BLOCKED') {
      for (const reason of new Set(row.reasons)) blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1;
    }
    return Response.json({ symbol: report.company.symbol, name: report.company.name, requestedMode: mode,
      mode: output.result.mode, asOf: report.asOf, ...output, generatedAt: output.result.createdAt,
      diagnostics: { windows: output.result.records.length, blockedByReason, factsReceived: report.facts.length,
        buy: output.result.records.filter(r => r.verdict === 'BUY').length,
        blocked: output.result.records.filter(r => r.verdict === 'BLOCKED').length,
        wait: output.result.records.filter(r => r.verdict === 'WAIT').length },
      sources: { priceSource: report.priceSource, retrievedAt: report.retrievedAt, checks: report.checks },
      persistence: { forecastJournal: false, backtestRun: false, sourceTelemetry: true },
    }, { headers });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status, headers });
    // Do not expose internal provider, DB, or authentication errors to clients.
    return Response.json({ error: 'تعذر تشغيل الاختبار التاريخي. تحقق من المصدر أو إعدادات المشروع.' }, { status: 500, headers });
  }
}
