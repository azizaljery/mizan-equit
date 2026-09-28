import type { PriceBar } from '../types';
import type { TrainingSample, TrainingCorpus } from './types';

export type SymbolData = {
  symbol: string;
  market: 'sa' | 'us';
  prices: PriceBar[];
};

export type BuildCorpusOptions = {
  horizon: number;
  minHistory: number;
  stepSessions: number;
};

export const DEFAULT_BUILD_OPTIONS: BuildCorpusOptions = {
  horizon: 21,
  minHistory: 252,
  stepSessions: 5,
};

/**
 * بناء corpus تدريب آمن للـPIT:
 * - كل عينة تستخدم فقط بيانات <= asOf.
 * - القيمة الفعلية (actualReturn) من بعد asOf بـhorizon.
 * - التحقق من تطابق تواريخ المرجع والنظراء.
 */
export function buildCorpus(
  symbols: SymbolData[],
  benchmark: PriceBar[],
  peerProvider: (symbol: string, market: 'sa' | 'us') => PriceBar[][],
  options: Partial<BuildCorpusOptions> = {},
): TrainingCorpus {
  const opt = { ...DEFAULT_BUILD_OPTIONS, ...options };
  const samples: TrainingSample[] = [];

  // فهرس المرجع بحسب التاريخ لتسريع البحث
  const benchmarkByDate = new Map<string, number>();
  benchmark.forEach((b, i) => benchmarkByDate.set(b.date, i));

  for (const sd of symbols) {
    const { prices, symbol, market } = sd;
    if (prices.length < opt.minHistory + opt.horizon + 1) continue;

    for (
      let t = opt.minHistory;
      t + opt.horizon < prices.length;
      t += opt.stepSessions
    ) {
      const anchor = prices[t];
      const end = prices[t + opt.horizon];
      if (!anchor || !end || anchor.close <= 0 || end.close <= 0) continue;

      const actualReturn = end.close / anchor.close - 1;

      // نافذة history بطول opt.minHistory جلسة تنتهي بـanchor نفسه (شامل).
      // كانت مثبَّتة على 252 حرفياً بصرف النظر عن opt.minHistory — لو مرّر
      // المستدعي minHistory أكبر (مثلاً 500 لتاريخ أطول)، كانت النافذة الفعلية
      // تبقى 252 مهما تغيّر الخيار. الآن تتبع opt.minHistory فعلاً.
      const historyStart = Math.max(0, t - opt.minHistory + 1);
      const history = prices.slice(historyStart, t + 1);
      if (history.length < 60) continue;

      // المرجع: من نفس تاريخ بداية history إلى anchor
      const histStartDate = history[0].date;
      const anchorDate = anchor.date;
      const benchHistory = benchmark.filter(
        (b) => b.date >= histStartDate && b.date <= anchorDate,
      );

      // نحتاج تاريخين للمرجع: عند anchor وعند end
      const benchAnchorIdx = benchmarkByDate.get(anchorDate);
      const benchEndIdx = benchmarkByDate.get(end.date);
      if (
        benchAnchorIdx === undefined ||
        benchEndIdx === undefined ||
        benchAnchorIdx >= benchEndIdx
      ) {
        continue;
      }

      const benchAtAnchor = benchmark[benchAnchorIdx];
      const benchAtEnd = benchmark[benchEndIdx];
      if (benchAtAnchor.close <= 0) continue;

      const benchmarkReturn = benchAtEnd.close / benchAtAnchor.close - 1;

      // النظراء
      const peerHistories: PriceBar[][] = [];
      try {
        const peers = peerProvider(symbol, market);
        for (const peerPrices of peers) {
          const slice = peerPrices.filter(
            (b) => b.date >= histStartDate && b.date <= anchorDate,
          );
          if (slice.length >= 60) peerHistories.push(slice);
        }
      } catch {
        // نظير فشل → نتجاهله، لا نُفشل العينة
      }

      samples.push({
        symbol,
        market,
        asOf: anchorDate,
        history,
        benchmark: benchHistory,
        peers: peerHistories,
        actualReturn,
        benchmarkReturn,
        horizon: opt.horizon,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    symbols: symbols.map((s) => s.symbol),
    horizon: opt.horizon,
    samples,
  };
}
