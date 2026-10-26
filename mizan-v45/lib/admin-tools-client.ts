/**
 * Admin tools: pure helpers shared by the owner-only tools page (browser) and the
 * internal automation route (server). No Worker bindings or secrets are imported here.
 */
/**
 * Same rule as ownerIdentity() in ./pin-lock, kept local on purpose: this module is bundled for the browser, and
 * importing ./pin-lock (server-side hashing) produced an EMPTY chunk that Safari/WebKit refuses to import
 * ("'text/plain' is not a valid JavaScript MIME type"), which stopped the home page from hydrating on iPad.
 */
function ownerIdentity(headers:Headers,ownerEmail:string){
  const email=(headers.get('oai-authenticated-user-email')||headers.get('cf-access-authenticated-user-email'))?.trim().toLowerCase();
  return ownerEmail&&email===ownerEmail.trim().toLowerCase()?'site-owner':null;
}

/* ───────────────────────── Safe caps used by the UI ───────────────────────── */
/** Server accepts up to 100; each symbol fetches a full report, so one click stays tiny. */
export const EVALUATE_LIMIT_MAX = 5;
export const EVALUATE_LIMIT_DEFAULT = 2;
/** Server accepts 1–3 symbols; the UI keeps it to 2 to stay well inside the CPU budget. */
export const BACKTEST_MAX_SYMBOLS = 2;
/** Walk-forward runs one full audit per window and per symbol. */
export const WALK_FORWARD_MAX_WINDOWS = 2;
export const WALK_FORWARD_MAX_SYMBOLS = 1;
export const AGGREGATE_LIMIT_MAX = 20;
export const BACKTEST_HORIZONS = [1, 5, 21, 63, 126, 252] as const;
export const DEFAULT_BACKTEST_HORIZONS = [5, 21, 63, 126, 252];

export function clampEvaluateLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EVALUATE_LIMIT_DEFAULT;
  return Math.min(EVALUATE_LIMIT_MAX, Math.max(1, Math.trunc(n)));
}

/* ───────────────────── Internal automation authorization ───────────────────── */
export type AutomationAuthMode = 'token' | 'owner-session';

/**
 * Actions reachable through the owner session (UI). Excluded on purpose:
 * followup-run (9-minute budget), followup-accept (enables periodic runs; the gated
 * /api/admin/screener-operations path owns that), collect/seed/resolve (cron work),
 * council (the UI uses /api/admin/council). The bearer token keeps every action.
 */
export const OWNER_SESSION_AUTOMATION_ACTIONS: ReadonlySet<string> = new Set([
  'daily-archive-status', 'status', 'screener-operations', 'runtime-ready',
  'followup-acceptance-status', 'followup-acceptance-start', 'followup-step',
]);
export function ownerSessionActionAllowed(action: unknown): boolean {
  return typeof action === 'string' && OWNER_SESSION_AUTOMATION_ACTIONS.has(action);
}

/** Constant-time comparison over SHA-256 digests (lengths never leak through timing). */
export async function equalSecret(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const aa = new Uint8Array(x), bb = new Uint8Array(y);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export type AutomationAuthOptions = {
  /** MIZAN_INTERNAL_AUTOMATION_TOKEN; empty means the token path is disabled. */
  expectedToken: string;
  /** RECOMMENDATION_OWNER_EMAIL; empty means the owner path is disabled. */
  ownerEmail: string;
  /** adminSession(env.DB, req) — called last, only after every cheap check passes. */
  hasAdminSession: () => Promise<boolean>;
};

/**
 * Decide how (if at all) a request to the internal automation handler is authorized.
 * 1. An Authorization header selects the token path only: a valid bearer equal (in
 *    constant time) to a configured token → 'token'. A wrong/unconfigured token never
 *    falls through to the session path.
 * 2. Owner session path → 'owner-session' only when ALL hold:
 *    POST; path under /api/admin/ (behind Cloudflare Access, and the only path the
 *    HttpOnly `mizan_admin` cookie is scoped to); Origin present and equal to the
 *    request origin; not Sec-Fetch-Site: cross-site; verified owner identity header;
 *    and a valid, unexpired admin session in D1.
 */
export async function decideAutomationAuth(req: Request, options: AutomationAuthOptions): Promise<AutomationAuthMode | null> {
  const authorization = req.headers.get('authorization');
  if (authorization !== null) {
    const supplied = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1] || '';
    return await equalSecret(supplied, options.expectedToken || '') ? 'token' : null;
  }
  let url: URL;
  try { url = new URL(req.url); } catch { return null; }
  if (req.method.toUpperCase() !== 'POST') return null;
  if (!url.pathname.startsWith('/api/admin/')) return null;
  const origin = req.headers.get('origin');
  if (origin === null || origin !== url.origin) return null;
  if (req.headers.get('sec-fetch-site') === 'cross-site') return null;
  if (!options.ownerEmail || !ownerIdentity(req.headers, options.ownerEmail)) return null;
  try { return await options.hasAdminSession() === true ? 'owner-session' : null; }
  catch { return null; }
}

/* ───────────────────────────── Browser fetch helper ───────────────────────────── */
export type AdminErrorKind = 'session' | 'owner' | 'access' | 'input' | 'locked' | 'disabled' | 'server' | 'network';
export class AdminToolsError extends Error {
  status: number; kind: AdminErrorKind; body: unknown;
  constructor(message: string, status: number, kind: AdminErrorKind, body: unknown = null) {
    super(message); this.status = status; this.kind = kind; this.body = body;
  }
}
export function classifyAdminStatus(status: number): AdminErrorKind {
  if (status === 0) return 'access';
  if (status === 401) return 'session';
  if (status === 403) return 'owner';
  if (status === 409) return 'locked';
  if (status === 503) return 'disabled';
  if (status >= 400 && status < 500) return 'input';
  return 'server';
}
export function adminErrorMessage(status: number, serverMessage?: string): string {
  const kind = classifyAdminStatus(status);
  if (kind === 'access') return 'يلزم تسجيل الدخول عبر بوابة Cloudflare Access بحساب مالك ميزان أولًا.';
  if (kind === 'session') return 'جلسة الإدارة غير موجودة أو انتهت (مدتها 30 دقيقة). سجّل الدخول إلى إدارة ميزان ثم أعد المحاولة.' + (serverMessage ? ` (${serverMessage})` : '');
  if (kind === 'owner') return 'هذا الإجراء لحساب مالك ميزان فقط، أو أن الطلب رُفض لمصدره. سجّل الدخول بحساب المالك عبر Cloudflare Access ثم بإدارة ميزان.' + (serverMessage ? ` (${serverMessage})` : '');
  return serverMessage || (kind === 'server' ? 'تعذرت العملية في الخادم.' : 'تعذرت العملية.');
}

/** Fetch an /api/admin* endpoint. Never follows the Access login redirect. */
export async function adminRequest<T = any>(url: string, init: RequestInit & {json?: unknown} = {}): Promise<{data: T; status: number}> {
  const {json, headers, ...rest} = init;
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual', ...rest,
      headers: {...(json !== undefined ? {'Content-Type': 'application/json'} : {}), ...(headers as Record<string, string> | undefined)},
      ...(json !== undefined ? {body: JSON.stringify(json)} : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AdminToolsError('تعذر الاتصال بالخادم؛ تحقق من الشبكة أو من تسجيل الدخول عبر Cloudflare Access.', 0, 'network');
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new AdminToolsError(adminErrorMessage(0), 0, 'access');
  }
  const type = response.headers.get('content-type') || '';
  let body: any = null;
  if (type.includes('application/json')) { try { body = await response.json(); } catch { body = null; } }
  else { try { body = await response.text(); } catch { body = null; } }
  if (!response.ok) {
    const serverMessage = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : undefined;
    throw new AdminToolsError(adminErrorMessage(response.status, serverMessage), response.status, classifyAdminStatus(response.status), body);
  }
  return {data: body as T, status: response.status};
}

/** Download a file endpoint (CSV/TSV/MD) via fetch so 401/403 show readable errors. */
export async function adminDownload(url: string, fallbackName: string): Promise<void> {
  let response: Response;
  try { response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', redirect: 'manual'}); }
  catch { throw new AdminToolsError('تعذر الاتصال بالخادم.', 0, 'network'); }
  if (response.type === 'opaqueredirect') throw new AdminToolsError(adminErrorMessage(0), 0, 'access');
  if (!response.ok) {
    let message: string | undefined;
    try { const d = await response.json(); message = typeof d?.error === 'string' ? d.error : undefined; } catch { /* not JSON */ }
    throw new AdminToolsError(adminErrorMessage(response.status, message), response.status, classifyAdminStatus(response.status));
  }
  const name = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const blob = await response.blob(), href = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function newRequestKey(prefix = 'owner-ui'): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}.${Date.now().toString(36)}.${random}`;
}

/* ───────────────────────────── Backtest validation ───────────────────────────── */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validDay(value: string): boolean {
  return DATE.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseSymbols(text: string): string[] {
  return [...new Set(text.split(/[\s,،]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
}
export function validAuditSymbol(symbol: string): boolean {
  return /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol) && (/^[A-Z][A-Z0-9-]*$/.test(symbol) || /^\d{4}\.SR$/.test(symbol));
}
export type BacktestForm = {
  symbols: string; startDate: string; endDate: string; horizons: number[];
  commissionBps: number; slippageBps: number; doubleSided: boolean; minSessions: number; runId?: string;
};
export type ValidationResult<T> = {ok: true; value: T} | {ok: false; error: string};

export function validateBacktestForm(form: BacktestForm, today = new Date().toISOString().slice(0, 10)): ValidationResult<Record<string, unknown>> {
  const symbols = parseSymbols(form.symbols);
  if (!symbols.length) return {ok: false, error: 'أدخل رمزًا واحدًا على الأقل.'};
  if (symbols.length > BACKTEST_MAX_SYMBOLS) return {ok: false, error: `الحد من هذه الواجهة ${BACKTEST_MAX_SYMBOLS} رمز لكل تشغيل حفاظًا على حد المعالجة.`};
  const bad = symbols.find(s => !validAuditSymbol(s));
  if (bad) return {ok: false, error: `الرمز ${bad} غير صالح؛ استخدم رمزًا أمريكيًا مثل AAPL أو سعوديًا مثل 2222.SR.`};
  if (!validDay(form.startDate) || !validDay(form.endDate)) return {ok: false, error: 'التواريخ بصيغة YYYY-MM-DD.'};
  if (form.startDate > form.endDate) return {ok: false, error: 'تاريخ البداية بعد النهاية.'};
  if (form.endDate >= today) return {ok: false, error: 'اختر نهاية سابقة لليوم؛ لا تُستخدم جلسة غير مكتملة.'};
  if (Date.parse(form.endDate) - Date.parse(form.startDate) > 5 * 366 * 864e5) return {ok: false, error: 'الفترة لا تتجاوز خمس سنوات.'};
  const horizons = [...new Set(form.horizons)].sort((a, b) => a - b);
  if (!horizons.length || horizons.some(h => !(BACKTEST_HORIZONS as readonly number[]).includes(h))) return {ok: false, error: 'اختر أفقًا واحدًا على الأقل من الآفاق المعتمدة.'};
  for (const [label, n] of [['العمولة', form.commissionBps], ['الانزلاق', form.slippageBps]] as const) {
    if (!Number.isFinite(n) || n < 0 || n > 1000) return {ok: false, error: `${label} بين 0 و1000 نقطة أساس.`};
  }
  if (!Number.isInteger(form.minSessions) || form.minSessions < 2 || form.minSessions > 1500) return {ok: false, error: 'أدنى عدد جلسات عدد صحيح بين 2 و1500.'};
  const runId = form.runId?.trim();
  if (runId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,84}$/.test(runId)) return {ok: false, error: 'المعرف: حروف لاتينية وأرقام و . _ : - فقط، حتى 85 حرفًا.'};
  return {ok: true, value: {
    mode: 'single', symbols, startDate: form.startDate, endDate: form.endDate, horizons,
    costs: {commissionBps: form.commissionBps, slippageBps: form.slippageBps, doubleSided: form.doubleSided},
    minSessions: form.minSessions, ...(runId ? {runId} : {}),
  }};
}

export type WalkWindow = {trainStart: string; trainEnd: string; testStart: string; testEnd: string};
export function validateWalkForward(form: BacktestForm, windows: WalkWindow[], today = new Date().toISOString().slice(0, 10)): ValidationResult<Record<string, unknown>> {
  if (parseSymbols(form.symbols).length > WALK_FORWARD_MAX_SYMBOLS) return {ok: false, error: `النوافذ المتتابعة من هذه الواجهة لرمز واحد فقط.`};
  if (!windows.length || windows.length > WALK_FORWARD_MAX_WINDOWS) return {ok: false, error: `اختر من نافذة إلى ${WALK_FORWARD_MAX_WINDOWS} نوافذ.`};
  for (const [i, w] of windows.entries()) {
    if (![w.trainStart, w.trainEnd, w.testStart, w.testEnd].every(validDay)) return {ok: false, error: `تواريخ النافذة ${i + 1} بصيغة YYYY-MM-DD.`};
    if (!(w.trainStart <= w.trainEnd && w.trainEnd < w.testStart && w.testStart <= w.testEnd)) return {ok: false, error: `النافذة ${i + 1}: يلزم أن يسبق التدريب الاختبار.`};
    if (i > 0 && windows[i - 1].testEnd >= w.testStart) return {ok: false, error: 'نوافذ الاختبار مرتبة ودون تداخل.'};
  }
  const base = validateBacktestForm({...form, startDate: windows[0].testStart, endDate: windows[windows.length - 1].testEnd}, today);
  if (!base.ok) return base;
  const {startDate: _s, endDate: _e, ...rest} = base.value;
  return {ok: true, value: {...rest, mode: 'walk-forward', windows}};
}

/* ───────────────────────────── Formatting helpers ───────────────────────────── */
const numberFormat = new Intl.NumberFormat('ar-SA', {maximumFractionDigits: 2});
export const fmtNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? numberFormat.format(v) : '—';
export const fmtPercent = (v: unknown, ratio = true) => typeof v === 'number' && Number.isFinite(v) ? numberFormat.format(ratio ? v * 100 : v) + '٪' : '—';
export function fmtDateTime(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '—';
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('ar-SA', {dateStyle: 'medium', timeStyle: 'short'}).format(d);
}
export function fmtDuration(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${fmtNumber(ms)} ملّي ث` : `${fmtNumber(ms / 1000)} ث`;
}
