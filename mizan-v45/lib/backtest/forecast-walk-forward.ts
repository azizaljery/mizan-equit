/**
 * MIZAN — يقيس forecasts() نفسها تاريخيًا، لا قاعدة trader<40 المستعارة
 * من analysis.ts في all-in-one.ts::walkForwardV2.
 *
 * الفجوة التي يسدّها هذا الملف: walkForwardV2 لا يستدعي forecasts() إطلاقًا
 * (سطر renderBacktestReport فيه يقول حرفيًا "دقة الاتجاه: غير متاحة — لا يوجد
 * توقع اتجاه صريح في المحرك المرسل"). هذا الملف يستدعيها فعليًا ويقيس
 * direction/range الحقيقيين الصادرين عنها.
 *
 * قيد أمانة حاسم: forecasts() تقرأ عوامل السوق والقطاع والنظراء والأخبار من
 * MarketReport.context/peers/news/official. لا أرشيف زمني صادق لهذه الحقول
 * في هذا المستودع (P/E النظراء ومؤشر السوق يُجلبان حاليًا فقط). محاولة
 * "تعبئتها" بقيم اليوم عند إعادة تشغيل تاريخ قديم = تسرب مستقبلي (look-ahead
 * bias) صريح. لذلك نمرّرها غائبة صراحة (null/[]) لا مُلفَّقة — بالضبط كما
 * تتعامل researchFactors() أصلاً مع غيابها: عامل مفقود (signal=null)، لا قيمة
 * مزيَّفة. النتيجة: توقع "مُخفَّض" (بلا سياق سوق/قطاع/نظراء/أخبار) يُقاس
 * بصدق، لا توقع "كامل" يُقاس بغش. contextOmitted في الناتج يوثّق هذا صراحة
 * في كل تشغيلة — لا حاجة لتذكّره خارج الكود.
 *
 * الاقتصاد منفصل عن الدقة عمدًا (راجع تصحيح "و" في مراجعة الخطة): نسبة
 * الإصابة وحدها لا تحكم على الجدوى. 85 فوزًا بوحدة و15 خسارة بعشر وحدات
 * نسبة إصابة 85% لكنها خسارة صافية — لذلك نُبلّغ hit-rate و profitFactor
 * معًا دومًا، ونُصدر تحذيرًا صريحًا عند تعارضهما.
 */
import { forecasts } from '../research-model';
import { forecastMetrics } from '../forecast-metrics';
import { DEFAULT_SETTINGS, type SiteSettings } from '../site-settings';
import { factsKnownAsOf, checkedPrices, costs, entryFactor, exitFactor, day } from './all-in-one';
import type { Fact, MarketReport } from '../market-data';
import type { Price } from '../analysis';

export type ForecastWalkForwardOptions = {
  warmupSessions?: number;
  feeBps?: number;
  slippageBps?: number;
  pricesAreSplitAdjusted?: boolean;
  settings?: SiteSettings;
  horizons?: readonly { name: string; sessions: number }[];
};

export type ForecastWalkForwardRecord = {
  horizon: string; sessions: number; issuedAt: string; entryDate: string; actualDate: string;
  available: boolean; direction: string; confidence: string;
  reference: number | null; predictedPrice: number | null; range: [number, number] | null;
  actualPrice: number;
  metrics: ReturnType<typeof forecastMetrics>;
  /** فقط عند direction==='صاعد' — لا صفقات بيع على المكشوف في هذا المنتج. null يعني لم تُتَّخذ صفقة. */
  tradeReturnPct: number | null;
};

export type ForecastHorizonEvaluation = {
  period: string; sessions: number;
  issuedCount: number; abstainedCount: number;
  /** من بين الصادر فقط — الامتناع لا يُحتسب خطأً ولا صواباً. */
  directionAccuracyPct: number | null;
  rangeCoveragePct: number | null;
  meanAbsoluteErrorPct: number | null;
  trade: { count: number; winRatePct: number | null; meanReturnPct: number | null; profitFactor: number | null; grossReturnPct: number | null };
  warning: string | null;
};

export type ForecastWalkForwardResult = {
  symbol: string; createdAt: string; firstDate: string; lastDate: string;
  records: ForecastWalkForwardRecord[];
  summaries: ForecastHorizonEvaluation[];
  warnings: string[]; limitations: string[];
  assumptions: { warmupSessions: number; feeBps: number; slippageBps: number; contextOmitted: string[] };
};

function numeric(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function round(v: number, d = 3): number { return Math.round(v * 10 ** d) / 10 ** d; }

/** توقّع محرك forecasts() على شريحة تاريخية "غائبة السياق صراحةً"، لا مُلفَّقة. */
function historicalSlice(base: MarketReport, prices: Price[], origin: number, facts: Fact[], asOf: string): MarketReport {
  return {
    company: base.company, asOf, retrievedAt: new Date(Date.parse(asOf + 'T20:00:00Z')).toISOString(),
    prices: prices.slice(0, origin + 1), priceSource: 'backtest-replay', quoteTime: null,
    currency: base.currency, facts, official: null, news: [], peers: [],
    checks: [], warnings: [], mode: 'historical' as const,
    context: { market: null, sector: null },
  };
}

export function evaluateForecastsWalkForward(
  report: MarketReport, options: ForecastWalkForwardOptions = {},
): ForecastWalkForwardResult {
  const prices = checkedPrices(report.prices, 'السهم');
  const c = costs(options);
  const warmup = options.warmupSessions ?? 504;
  if (!Number.isInteger(warmup) || warmup < 2) throw new Error('فترة التهيئة يجب أن تكون جلستين على الأقل.');
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const horizons = options.horizons ?? [
    { name: 'أسبوع', sessions: 5 }, { name: 'شهر', sessions: 21 }, { name: '3 أشهر', sessions: 63 },
  ];
  if (!horizons.length || horizons.some(h => !Number.isInteger(h.sessions) || h.sessions < 1)) {
    throw new Error('آفاق الاختبار يجب أن تحتوي أعداد جلسات موجبة.');
  }
  const facts = report.facts ?? [];
  const splits = (report.corporateActions ?? []).filter(a => a.kind === 'split');
  if (splits.some(a => !day(a.date))) throw new Error('تاريخ تجزئة غير صالح.');
  if (!options.pricesAreSplitAdjusted && splits.some(a => prices[0] && a.date >= prices[0].date && a.date <= prices.at(-1)!.date)) {
    throw new Error('توجد تجزئة داخل السلسلة. استخدم أسعاراً موثقة معدلة للتجزئة.');
  }
  const messages = new Set<string>(), records: ForecastWalkForwardRecord[] = [];
  for (const h of horizons) {
    for (let origin = warmup - 1; origin + 1 + h.sessions < prices.length; origin += h.sessions + 1) {
      const signal = prices[origin], entry = prices[origin + 1], actual = prices[origin + 1 + h.sessions];
      const pit = factsKnownAsOf(facts, signal.date);
      for (const w of pit.warnings) messages.add(w);
      const slice = historicalSlice(report, prices, origin, pit.known, signal.date);
      const out = forecasts(slice, null, Date.parse(signal.date + 'T20:00:00Z'), settings, [h]);
      const row: any = out.rows[0];
      const metrics = forecastMetrics({
        reference: row.price ?? signal.close, predicted: row.predictedPrice ?? null, actual: actual.close,
        range: row.range ?? null, direction: row.direction, neutralThresholdPct: row.neutralThresholdPct ?? 0,
      });
      let tradeReturnPct: number | null = null;
      if (row.available && row.direction === 'صاعد') {
        if (![entry.close, actual.close].every(x => numeric(x) && x > 0)) throw new Error('سعر صفقة غير صالح.');
        tradeReturnPct = round((actual.close / entry.close * exitFactor(c) / entryFactor(c) - 1) * 100);
      }
      records.push({
        horizon: h.name, sessions: h.sessions, issuedAt: signal.date, entryDate: entry.date, actualDate: actual.date,
        available: !!row.available, direction: row.direction, confidence: row.confidence,
        reference: row.price ?? null, predictedPrice: row.predictedPrice ?? null, range: row.range ?? null,
        actualPrice: actual.close, metrics, tradeReturnPct,
      });
    }
  }
  const summaries: ForecastHorizonEvaluation[] = horizons.map(h => {
    const rows = records.filter(r => r.sessions === h.sessions);
    if (!rows.length) messages.add(`لا توجد نوافذ مكتملة لأفق ${h.name} بعد التهيئة.`);
    const issued = rows.filter(r => r.available), abstained = rows.filter(r => !r.available);
    const withDirCheck = issued.filter(r => r.metrics.directionCorrect !== null);
    const directionAccuracyPct = withDirCheck.length
      ? round(withDirCheck.filter(r => r.metrics.directionCorrect).length / withDirCheck.length * 100, 2) : null;
    const withRangeCheck = issued.filter(r => r.metrics.endRangeHit !== null);
    const rangeCoveragePct = withRangeCheck.length
      ? round(withRangeCheck.filter(r => r.metrics.endRangeHit).length / withRangeCheck.length * 100, 2) : null;
    const withError = issued.filter(r => r.metrics.relativeErrorPct !== null);
    const meanAbsoluteErrorPct = withError.length
      ? round(withError.reduce((s, r) => s + r.metrics.relativeErrorPct!, 0) / withError.length, 3) : null;
    const trades = issued.filter(r => r.tradeReturnPct !== null).map(r => r.tradeReturnPct!);
    const winRatePct = trades.length ? round(trades.filter(t => t > 0).length / trades.length * 100, 2) : null;
    const meanReturnPct = trades.length ? round(trades.reduce((a, b) => a + b, 0) / trades.length, 3) : null;
    const profit = trades.reduce((s, t) => s + Math.max(0, t), 0), loss = -trades.reduce((s, t) => s + Math.min(0, t), 0);
    const profitFactor = loss > 0 ? round(profit / loss) : null;
    // عائد مركَّب (compounded)، لا مجموع بسيط — يطابق تسلسل الصفقات الفعلي على رأس مال واحد يُعاد استثماره.
    const grossReturnPct = trades.length ? round((trades.reduce((acc, t) => acc * (1 + t / 100), 1) - 1) * 100, 3) : null;
    let warning: string | null = null;
    if (winRatePct !== null && profitFactor !== null && winRatePct >= 60 && profitFactor < 1) {
      warning = `تحذير: نسبة إصابة ${winRatePct}% لكن Profit Factor ${profitFactor} أقل من 1 — الخسائر الفردية أكبر من الأرباح الفردية؛ الاستراتيجية خاسرة صافيًا رغم الإصابة العالية.`;
    }
    return {
      period: h.name, sessions: h.sessions, issuedCount: issued.length, abstainedCount: abstained.length,
      directionAccuracyPct, rangeCoveragePct, meanAbsoluteErrorPct,
      trade: { count: trades.length, winRatePct, meanReturnPct, profitFactor, grossReturnPct }, warning,
    };
  });
  return {
    symbol: report.company.symbol, createdAt: new Date().toISOString(),
    firstDate: prices[0]?.date ?? '', lastDate: prices.at(-1)?.date ?? '',
    records, summaries, warnings: [...messages],
    assumptions: {
      warmupSessions: warmup, feeBps: c.feeBps, slippageBps: c.slippageBps,
      contextOmitted: ['market', 'sector', 'peers', 'news/events'],
    },
    limitations: [
      'تحذير حاسم مؤكَّد تجريبيًا (لا نظريًا): forecasts() لا تعيد توزيع وزن العامل الغائب على البقية — "مقام مساهمات الأوزان 100 دائماً" (تعليق داخل research-model.ts نفسها). حذف 4 من 12 عاملاً هنا (سوق/قطاع/تقييم/أحداث) يُصفّر bias عملياً في أغلب الحالات، فيخرج direction="محايد" حتى مع اتجاه سعري صاعد واضح وحقيقي — تحقّقت من هذا على ثلاث تركيبات اصطناعية مختلفة (اتجاه صافٍ، اتجاه+ضجيج واقعي، دوري). دقة الاتجاه المنخفضة الناتجة عن هذا القياس تعكس تصميم "السياق المخفَّض عمداً"، لا جودة النموذج الحقيقية عند توفر السياق الكامل — لا تُقرأ كرقم دقة ميزان الفعلي.',
      'هذا قياس forecasts() نفسها، لا قاعدة trader<40 في walkForwardV2 — لكنه بسياق مُخفَّض: عوامل السوق والقطاع والنظراء والأحداث غائبة عمداً (لا أرشيف زمني صادق لها)، فالثقة ونطاق النموذج هنا أضعف مما قد يظهر في تحليل حي كامل السياق.',
      'اسم الشركة والقطاع الحاليان قد لا يمثلان الماضي؛ لا يغطي الاختبار الأسهم المشطوبة أو تحيز البقاء.',
      'الصفقات هنا مستوى-الصفقة (trade-level: ربح/خسارة/Profit Factor)، وليست منحنى رأس مال (equity curve) — لا Sharpe ولا Sortino ولا أقصى هبوط هنا؛ استخدم walkForwardV2 لتلك المقاييس على قاعدة القرار الأخرى.',
      'صفقات طويلة فقط عند direction=صاعد؛ لا نموذج بيع على المكشوف. اتجاه هابط يُقاس دقة، لا يُحوَّل صفقة.',
      'لا يعاد تدريب النموذج هنا: تشغيل متتابع لمحرك ثابت (settings كما وردت)، وليس walk-forward optimization.',
      'مقاييس كل أفق مستقلة؛ نوافذ الأفق نفسه غير متداخلة، لكن نوافذ آفاق مختلفة على نفس السهم قد تتداخل زمنياً — لا تُجمَع صفقات آفاق مختلفة في رقم واحد.',
    ],
  };
}

export function renderForecastWalkForwardReport(result: ForecastWalkForwardResult): string {
  const fmt = (v: number | null, suffix = '') => v === null ? 'غير متاح' : `${v}${suffix}`;
  const lines = ['ميزان — قياس forecasts() تاريخيًا (تجريبي)', `الرمز: ${result.symbol}`,
    `تغطية البيانات: ${result.firstDate} إلى ${result.lastDate}`,
    `سياق محذوف من هذا القياس: ${result.assumptions.contextOmitted.join('، ')}`, ''];
  for (const s of result.summaries) {
    lines.push(`${s.period} (${s.sessions} جلسة)`,
      `صادر: ${s.issuedCount} | ممتنع: ${s.abstainedCount}`,
      `دقة الاتجاه: ${fmt(s.directionAccuracyPct, '%')} | احتواء النطاق: ${fmt(s.rangeCoveragePct, '%')} | متوسط الخطأ النسبي: ${fmt(s.meanAbsoluteErrorPct, '%')}`,
      `صفقات: ${s.trade.count} | نسبة إصابة: ${fmt(s.trade.winRatePct, '%')} | متوسط عائد الصفقة: ${fmt(s.trade.meanReturnPct, '%')} | Profit Factor: ${fmt(s.trade.profitFactor)}`);
    if (s.warning) lines.push(s.warning);
    lines.push('');
  }
  lines.push('التحذيرات:', ...result.warnings.map(w => `- ${w}`), '', 'حدود القياس:', ...result.limitations.map(w => `- ${w}`));
  return lines.join('\n');
}
