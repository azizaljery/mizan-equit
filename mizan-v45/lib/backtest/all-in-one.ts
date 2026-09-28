/**
 * MIZAN — isolated backtest module. API code belongs in app/api/backtest/route.ts.
 * This is a replay of the supplied analyze() adapter, NOT proof of live-model accuracy.
 * Uses the site's actual analysis and research-model dependencies.
 */
import { analyze, blankFinancials, blankMeta, blankEvents, type Financials, type Price } from '../analysis';
import { HORIZONS } from '../research-model';
import type { Fact, MarketReport } from '../market-data';

export type BacktestMode = 'technical' | 'full';
type Direction = 'صاعد' | 'محايد' | 'هابط';
export type BacktestRecord = {
  horizon: string; sessions: number; issuedAt: string; entryDate: string; actualDate: string;
  anchorPrice: number; entryPrice: number; actualPrice: number;
  /** Price change from signal date; NOT the executed trade return. */
  returnPct: number;
  /** Entry at the NEXT session close; exit after sessions holding intervals. */
  netTradeReturnPct: number;
  traderScore: number | null; investorScore: number | null;
  verdict: 'BUY' | 'WAIT' | 'BLOCKED'; actualDirection: Direction;
  /** Reserved: an action is not an explicit direction forecast. */
  correct: boolean | null;
  blockers: number; warnings: number; reasons: string[]; warningMessages: string[];
};
export type PerformanceMetrics = {
  /** Completed BUY trades. Daily risk observations are counted separately. */
  sampleSize: number; dailySampleSize: number;
  meanReturnPct: number | null; stdReturnPct: number | null;
  sharpe: number | null; sortino: number | null; maxDrawdownPct: number | null;
  calmar: number | null; winRatePct: number | null; profitFactor: number | null;
  strategyPct: number | null; cagrPct: number | null;
};
export type BenchmarkComparison = {
  symbol: string; startDate: string; endDate: string;
  /** Gross benchmark price-series return; no transaction fees. */
  benchmarkBuyHoldPct: number;
  /** Net strategy return, cash included, on the same dates. */
  strategyPct: number; excessReturnPct: number; daysInPeriod: number;
};
export type HorizonSummary = {
  period: string; sessions: number; count: number; blockedRatio: number;
  /** Always null until an actual direction-forecast adapter is supplied. */
  accuracyExcludingBlocked: number | null;
  buyCount: number; waitCount: number;
  actualDistribution: Record<Direction, number>; metrics: PerformanceMetrics;
  benchmark: BenchmarkComparison | null;
};
export type BacktestResult = {
  model: string; symbol: string; mode: BacktestMode; createdAt: string;
  firstDate: string; lastDate: string; records: BacktestRecord[];
  summaries: HorizonSummary[]; warnings: string[]; limitations: string[];
  assumptions: { warmupSessions: number; feeBps: number; slippageBps: number; execution: string };
};
export type PitResult = {
  known: Fact[]; warnings: string[]; approximatedCount: number;
  excludedCount: number; totalInput: number;
};
export type BenchmarkInput = {
  symbol: string; prices: Price[]; currency: string;
  /** Confirm compatible dividend/split adjustment conventions at the data source. */
  comparableBasisConfirmed: boolean;
};
export type BacktestOptions = {
  warmupSessions?: number;
  /** Basis points PER SIDE; zero by default, with an explicit warning. */
  feeBps?: number; slippageBps?: number;
  pricesAreSplitAdjusted?: boolean;
  benchmark?: BenchmarkInput;
};
type Costs = { feeBps: number; slippageBps: number };
type EquityPoint = { date: string; value: number };
const DAY_MS = 86_400_000;

export function day(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}
function publicationDay(value: unknown): string | null {
  const simple = day(value);
  if (simple) return simple;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!day(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return null;
  // Take the later of written and UTC dates, then exclude same-day publications.
  return [value.slice(0, 10), new Date(value).toISOString().slice(0, 10)].sort()[1];
}
function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) throw new Error('نتيجة حسابية غير صالحة.');
  return Math.round(value * 10 ** digits) / 10 ** digits;
}
export function checkedPrices(input: Price[], label: string): Price[] {
  if (!Array.isArray(input)) throw new Error(`سلسلة ${label} غير صالحة.`);
  const out = [...input];
  for (const p of out) {
    if (!p || !day(p.date) || !numeric(p.close) || p.close <= 0) {
      throw new Error(`تاريخ أو سعر إغلاق غير صالح في ${label}.`);
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < out.length; i++) {
    if (out[i].date === out[i - 1].date) throw new Error(`تاريخ مكرر في ${label}: ${out[i].date}`);
  }
  return out;
}
export function costs(options: BacktestOptions): Costs {
  const result = { feeBps: options.feeBps ?? 0, slippageBps: options.slippageBps ?? 0 };
  for (const v of Object.values(result)) {
    if (!numeric(v) || v < 0 || v > 1000) throw new Error('الرسوم والانزلاق: من 0 إلى 1000 نقطة أساس لكل جانب.');
  }
  return result;
}
export function entryFactor(c: Costs): number { return (1 + c.feeBps / 10000) * (1 + c.slippageBps / 10000); }
export function exitFactor(c: Costs): number { return (1 - c.feeBps / 10000) * (1 - c.slippageBps / 10000); }

/** Strict PIT: no period-end fallback; publications dated asOf are also withheld. */
export function factsKnownAsOf(facts: Fact[], asOf: string): PitResult {
  if (!day(asOf)) throw new Error('asOf يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD.');
  const known: Fact[] = [];
  let invalid = 0;
  for (const f of facts) {
    const published = publicationDay(f.publishedAt);
    const periodEnd = day(f.date);
    if (!published || !periodEnd || published < periodEnd || !numeric(f.value)) { invalid++; continue; }
    if (published < asOf && periodEnd <= asOf) known.push(f);
  }
  return {
    known, approximatedCount: 0, totalInput: facts.length, excludedCount: facts.length - known.length,
    warnings: invalid ? [`استُبعد ${invalid} بنداً بلا تاريخ نشر موثوق أو بتاريخ/قيمة غير صالحة؛ لم يُستخدم تاريخ نهاية الفترة بدلاً منه.`] : [],
  };
}
function revisionOrder(a: Fact, b: Fact): number {
  return Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!);
}
export function pickLatest(known: Fact[], key: string, period: Fact['period']): Fact | null {
  const candidates = known.filter(f => f.key === key && f.period === period && numeric(f.value))
    .sort((a, b) => b.date.localeCompare(a.date) || revisionOrder(b, a));
  const first = candidates[0];
  if (!first) return null;
  if (candidates.some(f => f.date === first.date && revisionOrder(f, first) === 0 && f.value !== first.value)) {
    throw new Error(`حقائق متعارضة للبند ${key} في الفترة ${first.date}.`);
  }
  return first;
}
export function pickPrevious(known: Fact[], key: string, period: Fact['period'], newerThanDate: string): Fact | null {
  return pickLatest(known.filter(f => f.date < newerThanDate), key, period);
}
function financialSnapshot(known: Fact[]): { financials: Financials; periodEnd: string; publishedAt: string } {
  const financials = blankFinancials();
  const annual = known.filter(f => f.period === 'annual');
  const periodEnd = annual.map(f => f.date).sort().at(-1) ?? '';
  const used: Fact[] = [];
  for (const key of Object.keys(financials) as (keyof Financials)[]) {
    if (key === 'previousRevenue') continue;
    // Do not silently combine annual figures from different fiscal years.
    const f = pickLatest(annual.filter(x => x.date === periodEnd), key, 'annual');
    if (f) { financials[key] = f.value; used.push(f); }
  }
  const revenue = pickLatest(used, 'revenue', 'annual');
  if (revenue) {
    const previous = pickPrevious(annual, 'revenue', 'annual', revenue.date);
    if (previous) {
      const gap = (Date.parse(revenue.date) - Date.parse(previous.date)) / DAY_MS;
      if (gap >= 330 && gap <= 400) { financials.previousRevenue = previous.value; used.push(previous); }
    }
  }
  return { financials, periodEnd: used.length ? periodEnd : '', publishedAt: used.map(f => publicationDay(f.publishedAt)!).sort().at(-1) ?? '' };
}

function orderedWindows(records: BacktestRecord[], sessions: number): BacktestRecord[] {
  if (!Number.isInteger(sessions) || sessions <= 0) throw new Error('عدد الجلسات غير صالح.');
  const rows = records.filter(r => r.sessions === sessions).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  rows.forEach((r, i) => {
    if (!day(r.issuedAt) || !day(r.entryDate) || !day(r.actualDate) || r.entryDate <= r.issuedAt || r.actualDate <= r.entryDate) {
      throw new Error('تواريخ نافذة الاختبار غير صالحة.');
    }
    if (i && rows[i - 1].actualDate > r.issuedAt) throw new Error('نوافذ متداخلة داخل الأفق نفسه؛ لا يجوز مضاعفة رأس المال عليها.');
  });
  return rows;
}
/** Close-to-close equity, including idle cash and costs; one horizon at a time. */
function equityCurve(rows: BacktestRecord[], prices: Price[], c: Costs): EquityPoint[] {
  if (!rows.length) return [];
  const start = rows[0].issuedAt, end = rows.at(-1)!.actualDate;
  const series = prices.filter(p => p.date >= start && p.date <= end);
  const dateSet = new Set(series.map(p => p.date));
  for (const r of rows) {
    if (![r.issuedAt, r.entryDate, r.actualDate].every(d => dateSet.has(d))) throw new Error('أسعار تنفيذ نافذة غير متاحة.');
  }
  const buys = rows.filter(r => r.verdict === 'BUY');
  for (const r of buys) {
    const entryIndex = series.findIndex(p => p.date === r.entryDate);
    const exitIndex = series.findIndex(p => p.date === r.actualDate);
    if (series[entryIndex].close !== r.entryPrice || series[exitIndex].close !== r.actualPrice || exitIndex - entryIndex !== r.sessions) {
      throw new Error('سجل الصفقة لا يطابق أسعار السلسلة أو عدد جلسات الاحتفاظ.');
    }
  }
  const entries = new Map(buys.map(r => [r.entryDate, r]));
  let cash = 1, shares = 0, active: BacktestRecord | undefined;
  const curve: EquityPoint[] = [];
  for (const p of series) {
    if (active && p.date === active.actualDate) {
      cash = shares * p.close * exitFactor(c); shares = 0; active = undefined;
    }
    const buy = entries.get(p.date);
    if (buy) {
      if (active) throw new Error('صفقات شراء متداخلة.');
      shares = cash / (p.close * entryFactor(c)); cash = 0; active = buy;
    }
    const value = cash + shares * p.close;
    if (!numeric(value) || value <= 0) throw new Error('سلسلة رأس المال غير صالحة.');
    curve.push({ date: p.date, value });
  }
  if (active) throw new Error('صفقة لم تغلق داخل فترة الاختبار.');
  return curve;
}
export function computeMetrics(records: BacktestRecord[], sessions: number, input: Price[], options: BacktestOptions = {}): PerformanceMetrics {
  const rows = orderedWindows(records, sessions), c = costs(options);
  const curve = equityCurve(rows, checkedPrices(input, 'السهم'), c);
  const trades = rows.filter(r => r.verdict === 'BUY').map(r => {
    if (![r.entryPrice, r.actualPrice].every(x => numeric(x) && x > 0)) throw new Error('سعر صفقة غير صالح.');
    return (r.actualPrice / r.entryPrice * exitFactor(c) / entryFactor(c) - 1) * 100;
  });
  const empty: PerformanceMetrics = { sampleSize: trades.length, dailySampleSize: 0, meanReturnPct: null, stdReturnPct: null,
    sharpe: null, sortino: null, maxDrawdownPct: null, calmar: null, winRatePct: null, profitFactor: null, strategyPct: null, cagrPct: null };
  if (curve.length < 2) return empty;
  const daily = curve.slice(1).map((p, i) => p.value / curve[i].value - 1);
  const meanDaily = daily.reduce((a, b) => a + b, 0) / daily.length;
  const sd = daily.length > 1 ? Math.sqrt(daily.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / (daily.length - 1)) : 0;
  // Target return = 0. Include ALL observations, including non-negative ones.
  const downside = Math.sqrt(daily.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / daily.length);
  let peak = curve[0].value, maxDD = 0;
  for (const p of curve) { peak = Math.max(peak, p.value); maxDD = Math.max(maxDD, 1 - p.value / peak); }
  const growth = curve.at(-1)!.value / curve[0].value;
  const years = (Date.parse(curve.at(-1)!.date) - Date.parse(curve[0].date)) / DAY_MS / 365.25;
  const annual = years >= 1 ? (growth ** (1 / years) - 1) * 100 : null;
  const mean = trades.length ? trades.reduce((a, b) => a + b, 0) / trades.length : null;
  const tradeSD = trades.length > 1 ? Math.sqrt(trades.reduce((s, r) => s + (r - mean!) ** 2, 0) / (trades.length - 1)) : null;
  const profit = trades.reduce((s, r) => s + Math.max(0, r), 0), loss = -trades.reduce((s, r) => s + Math.min(0, r), 0);
  return { ...empty, dailySampleSize: daily.length,
    meanReturnPct: mean === null ? null : round(mean), stdReturnPct: tradeSD === null ? null : round(tradeSD),
    sharpe: daily.length >= 2 && sd > 0 ? round(meanDaily / sd * Math.sqrt(252)) : null,
    sortino: daily.length >= 2 && downside > 0 ? round(meanDaily / downside * Math.sqrt(252)) : null,
    maxDrawdownPct: round(maxDD * 100), strategyPct: round((growth - 1) * 100),
    cagrPct: annual === null ? null : round(annual), calmar: annual !== null && maxDD > 0 ? round(annual / (maxDD * 100)) : null,
    winRatePct: trades.length ? round(trades.filter(r => r > 0).length / trades.length * 100, 2) : null,
    profitFactor: loss > 0 ? round(profit / loss) : null,
  };
}

export function compareToBenchmark(records: BacktestRecord[], prices: Price[], benchmark: BenchmarkInput | undefined,
  horizonSessions: number, currency: string, options: BacktestOptions = {}): BenchmarkComparison | null {
  if (!benchmark) return null;
  if (!benchmark.symbol.trim() || !benchmark.comparableBasisConfirmed || !currency || currency !== benchmark.currency) {
    throw new Error('يجب توثيق تطابق عملة السهم والمؤشر وأساس تعديل أسعارهما قبل المقارنة.');
  }
  const rows = orderedWindows(records, horizonSessions);
  if (!rows.length) return null;
  const series = checkedPrices(benchmark.prices, 'المؤشر');
  const startDate = rows[0].issuedAt, endDate = rows.at(-1)!.actualDate;
  // Exact dates only: no silent use of stale quotations or different endpoints.
  const first = series.find(p => p.date === startDate), last = series.find(p => p.date === endDate);
  if (!first || !last) throw new Error('لا تتوفر أسعار المؤشر في تاريخي بداية الاختبار ونهايته نفسيهما.');
  const curve = equityCurve(rows, checkedPrices(prices, 'السهم'), costs(options));
  const strategy = (curve.at(-1)!.value / curve[0].value - 1) * 100;
  const buyHold = (last.close / first.close - 1) * 100;
  return { symbol: benchmark.symbol, startDate, endDate, benchmarkBuyHoldPct: round(buyHold), strategyPct: round(strategy),
    excessReturnPct: round(strategy - buyHold), daysInPeriod: Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) };
}

export function walkForwardV2(report: MarketReport, mode: BacktestMode = 'technical', options: BacktestOptions = {}): BacktestResult {
  if (mode !== 'technical' && mode !== 'full') throw new Error('وضع الاختبار غير صالح.');
  const prices = checkedPrices(report.prices, 'السهم'), c = costs(options);
  const warmup = options.warmupSessions ?? 504;
  if (!Number.isInteger(warmup) || warmup < 2) throw new Error('فترة التهيئة يجب أن تكون جلستين على الأقل.');
  const horizons = HORIZONS.map(h => ({ name: h.name, sessions: h.sessions }));
  if (!horizons.length || horizons.some(h => !Number.isInteger(h.sessions) || h.sessions < 1) || new Set(horizons.map(h => h.sessions)).size !== horizons.length) {
    throw new Error('آفاق الاختبار يجب أن تحتوي أعداد جلسات موجبة وغير مكررة.');
  }
  const facts = report.facts ?? [], messages = new Set<string>(), records: BacktestRecord[] = [];
  const splits = (report.corporateActions ?? []).filter(a => a.kind === 'split');
  if (splits.some(a => !day(a.date))) throw new Error('تاريخ تجزئة غير صالح.');
  if (!options.pricesAreSplitAdjusted && splits.some(a => prices[0] && a.date >= prices[0].date && a.date <= prices.at(-1)!.date)) {
    throw new Error('توجد تجزئة داخل السلسلة. استخدم أسعاراً موثقة معدلة للتجزئة؛ لا تُحذف نوافذ بناءً على أحداث مستقبلية.');
  }
  if (c.feeBps === 0 && c.slippageBps === 0) messages.add('الرسوم والانزلاق مضبوطان على صفر؛ النتائج ليست محاكاة لتكاليف تنفيذ فعلية.');
  if (!options.benchmark) messages.add('لم تُمرر سلسلة مؤشر مرجعي؛ لا توجد مقارنة TASI/SPY في هذه النتيجة.');
  if (mode === 'technical') messages.add('technical يعيد تشغيل analyze بقوائم فارغة؛ لا يمكن إثبات أنه يعزل الفني دون فحص المحرك الأصلي.');
  if (mode === 'full' && !facts.length) messages.add('full بلا حقائق مالية: ستُحجب النوافذ، ولن يتغير الوضع بصمت إلى technical.');
  for (const h of horizons) {
    // Each window: signal close, next-session entry close, h holding intervals.
    for (let origin = warmup - 1; origin + 1 + h.sessions < prices.length; origin += h.sessions + 1) {
      const signal = prices[origin], entry = prices[origin + 1], actual = prices[origin + 1 + h.sessions];
      const pit = mode === 'full' ? factsKnownAsOf(facts, signal.date) : { known: [], warnings: [] };
      for (const w of pit.warnings) messages.add(w);
      const snapshot = financialSnapshot(pit.known);
      const meta = blankMeta();
      meta.name = report.company.name; meta.symbol = report.company.symbol;
      meta.market = report.company.symbol.endsWith('.SR') ? 'sa' : 'us';
      meta.currency = report.currency || (meta.market === 'sa' ? 'SAR' : 'USD');
      meta.priceCurrency = meta.currency; meta.sector = report.company.sector || 'general';
      meta.asOf = signal.date;
      meta.periodEnd = snapshot.periodEnd;
      meta.publishedAt = snapshot.publishedAt;
      const reasons: string[] = [], warningMessages = [...pit.warnings];
      let trader: number | null = null, investor: number | null = null;
      let verdict: BacktestRecord['verdict'] = 'BLOCKED';
      if (mode === 'full' && !snapshot.periodEnd) reasons.push('لا توجد حقائق سنوية موثوقة ومتاحة قبل تاريخ الإشارة.');
      else {
        const result = analyze(snapshot.financials, prices.slice(0, origin + 1).map(p => ({ ...p })), meta,
          { financial: mode === 'full', prices: true, events: false }, blankEvents());
        reasons.push(...result.blockers.map(String)); warningMessages.push(...result.warnings.map(String));
        trader = numeric(result.trader) ? result.trader : null;
        investor = numeric(result.investor) ? result.investor : null;
        if (!reasons.length && trader === null) reasons.push('درجة المتداول غير متاحة أو غير صالحة.');
        if (!reasons.length) verdict = trader! < 40 ? 'BUY' : 'WAIT';
      }
      const blockers = reasons.length;
      if (!blockers) reasons.push(verdict === 'BUY' ? 'إشارة تجريبية حسب الشرط الأصلي trader < 40.' : 'لم يتحقق شرط الشراء التجريبي؛ الانتظار ليس توقعاً محايداً.');
      const change = (actual.close / signal.close - 1) * 100;
      const netTrade = (actual.close / entry.close * exitFactor(c) / entryFactor(c) - 1) * 100;
      if (!numeric(change) || !numeric(netTrade)) throw new Error('عائد غير صالح.');
      records.push({ horizon: h.name, sessions: h.sessions, issuedAt: signal.date, entryDate: entry.date, actualDate: actual.date,
        anchorPrice: signal.close, entryPrice: entry.close, actualPrice: actual.close, returnPct: change, netTradeReturnPct: netTrade,
        traderScore: trader, investorScore: investor, verdict, actualDirection: change > 1 ? 'صاعد' : change < -1 ? 'هابط' : 'محايد',
        correct: null, blockers, warnings: warningMessages.length, reasons, warningMessages });
    }
  }
  const summaries = horizons.map(h => {
    const rows = records.filter(r => r.sessions === h.sessions);
    if (!rows.length) messages.add(`لا توجد نوافذ مكتملة لأفق ${h.name} بعد التهيئة.`);
    const dist: Record<Direction, number> = { صاعد: 0, محايد: 0, هابط: 0 };
    for (const r of rows) dist[r.actualDirection]++;
    let benchmark: BenchmarkComparison | null = null;
    try { benchmark = compareToBenchmark(records, prices, options.benchmark, h.sessions, report.currency || '', options); }
    catch (error) { messages.add(`مقارنة ${h.name} محجوبة: ${error instanceof Error ? error.message : 'بيانات غير صالحة.'}`); }
    return { period: h.name, sessions: h.sessions, count: rows.length,
      blockedRatio: rows.length ? rows.filter(r => r.verdict === 'BLOCKED').length / rows.length * 100 : 0,
      accuracyExcludingBlocked: null, buyCount: rows.filter(r => r.verdict === 'BUY').length,
      waitCount: rows.filter(r => r.verdict === 'WAIT').length, actualDistribution: dist,
      metrics: computeMetrics(rows, h.sessions, prices, options), benchmark };
  });
  return { model: 'walk-forward-v2-corrected-experimental', symbol: report.company.symbol, mode, createdAt: new Date().toISOString(),
    firstDate: prices[0]?.date ?? '', lastDate: prices.at(-1)?.date ?? '', records, summaries, warnings: [...messages],
    assumptions: { warmupSessions: warmup, ...c, execution: 'next-session-close; cash=0%; rf=0%; 252 sessions/year' },
    limitations: [
      'قاعدة trader < 40 محفوظة من النص المرسل ولم تُراجع مقابل final-decision.ts؛ ليست توصية ميزان النهائية ولا اختبار دقة توقعاته.',
      'لا يعاد تدريب النموذج هنا: هذا تشغيل متتابع لمحرك ثابت، وليس walk-forward optimization.',
      'الوضع full يستخدم حقائق سنوية فقط؛ الربعية وTTM والأحداث والهوية القطاعية التاريخية غير معاد بنائها.',
      'يلزم أرشيف الحقائق بنسخها وتواريخ نشرها الأصلية؛ تاريخ نشر قديم لقيمة معدلة لاحقاً يظل تسرباً للمستقبل.',
      'كاش المصدر مؤقت وليس لقطة ثابتة؛ قد تختلف إعادة التشغيل بعد انتهاء صلاحيته أو تعديل المزود للبيانات.',
      'الأسعار اليومية يجب أن تكون جلسات فعلية مكتملة؛ نوع التعديل والتوزيعات والتجزئة وصحة المزود مسؤولية طبقة البيانات.',
      'اسم الشركة والقطاع الحاليان قد لا يمثلان الماضي. لا يغطي الاختبار الأسهم المشطوبة أو تحيز البقاء.',
      'المقاييس لكل أفق بصورة مستقلة. أقصى الهبوط من إغلاقات الجلسات، ولا يقيس الهبوط اللحظي داخل الجلسة.',
      'Sharpe وSortino من عوائد يومية تشمل النقد؛ تحويلهما السنوي تقريبي. CAGR وCalmar لا يعرضان قبل سنة تقويمية.',
      'Profit Factor هنا نسبة مجموع نسب ربح الصفقات إلى مجموع نسب خسارتها، وليس نسبة الأرباح النقدية.',
      'المؤشر يعرض عائد سلسلة أسعاره الإجمالي قبل الرسوم مقابل الاستراتيجية بعد الرسوم. الفرق عائد زائد وليس Jensen alpha.',
      'لا يتم حفظ الاختبارات في قاعدة البيانات بهذه الوحدة؛ النتيجة تعاد إلى المستدعي فقط.',
    ] };
}

function fmt(value: number | null, suffix = ''): string { return value === null ? 'غير متاح' : `${value.toFixed(3)}${suffix}`; }
export function renderBacktestReport(result: BacktestResult): string {
  const lines = ['ميزان — اختبار تاريخي تجريبي', `الرمز: ${result.symbol} | الوضع: ${result.mode}`,
    `تغطية البيانات: ${result.firstDate} إلى ${result.lastDate}`, 'لا يمثل هذا التقرير دقة توقعات ميزان أو توصية استثمارية.', ''];
  for (const s of result.summaries) {
    const m = s.metrics;
    lines.push(`${s.period} (${s.sessions} جلسة احتفاظ)`, `النوافذ: ${s.count} | المحجوب: ${fmt(s.blockedRatio, '%')}`,
      `شراء: ${s.buyCount} | انتظار: ${s.waitCount}`, 'دقة الاتجاه: غير متاحة — لا يوجد توقع اتجاه صريح في المحرك المرسل.',
      `التوزيع الفعلي: صاعد ${s.actualDistribution.صاعد} / محايد ${s.actualDistribution.محايد} / هابط ${s.actualDistribution.هابط}`,
      `صفقات شراء: ${m.sampleSize} | مشاهدات يومية: ${m.dailySampleSize}`,
      `متوسط صافي عائد الصفقة: ${fmt(m.meanReturnPct, '%')} | انحراف عوائد الصفقات: ${fmt(m.stdReturnPct, '%')}`,
      `صافي عائد الاستراتيجية: ${fmt(m.strategyPct, '%')} | CAGR: ${fmt(m.cagrPct, '%')}`,
      `Sharpe: ${fmt(m.sharpe)} | Sortino: ${fmt(m.sortino)} | Calmar: ${fmt(m.calmar)}`,
      `أقصى هبوط من الإغلاقات: ${fmt(m.maxDrawdownPct, '%')} | الصفقات الرابحة: ${fmt(m.winRatePct, '%')} | Profit Factor: ${fmt(m.profitFactor)}`);
    if (s.benchmark) {
      const b = s.benchmark;
      lines.push(`المؤشر: ${b.symbol} | ${b.startDate} إلى ${b.endDate}`,
        `عائد المؤشر قبل الرسوم: ${fmt(b.benchmarkBuyHoldPct, '%')} | العائد الزائد: ${fmt(b.excessReturnPct, ' نقطة مئوية')}`);
    } else lines.push('مقارنة المؤشر: غير متاحة؛ راجع التحذيرات.');
    lines.push('');
  }
  lines.push('التحذيرات:', ...result.warnings.map(w => `- ${w}`), '', 'حدود الاختبار:', ...result.limitations.map(w => `- ${w}`));
  return lines.join('\n');
}
export function runBacktest(report: MarketReport, mode: BacktestMode = 'technical', options: BacktestOptions = {}): { result: BacktestResult; text: string } {
  const result = walkForwardV2(report, mode, options);
  return { result, text: renderBacktestReport(result) };
}
