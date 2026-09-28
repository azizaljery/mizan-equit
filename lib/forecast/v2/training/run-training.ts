/**
 * CLI: تدريب فعلي.
 * يقرأ من data/training/ (صيغة fetch-training-data.mjs)
 *
 * التشغيل:
 *   npx tsx lib/forecast/v2/training/run-training.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCorpus, type SymbolData } from './corpus-builder';
import { trainAll } from './offline-trainer';
import { DEFAULT_TRAINING_CONFIG } from './types';
import type { PriceBar } from '../types';

const MANIFEST = resolve(process.cwd(), 'data/training/manifest.json');
const OUT = process.env.MIZAN_ARTIFACT_OUT || './mizan-training-artifact.json';

type RawBar = { t: string; o: number; h: number; l: number; c: number; v: number; adj?: number };

function toPriceBars(rawBars: RawBar[], useAdjusted = false): PriceBar[] {
  return rawBars.map((b) => ({
    date: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: useAdjusted && typeof b.adj === 'number' ? b.adj : b.c,
    volume: b.v,
  }));
}

function loadTickerFile(filePath: string): RawBar[] {
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  return Array.isArray(data.bars) ? data.bars : [];
}

function loadTrainingData(): {
  symbols: SymbolData[];
  benchmark: PriceBar[];
} {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `manifest غير موجود: ${MANIFEST}\nشغّل: node scripts/fetch-training-data.mjs AAPL,MSFT,2222.SR 5`,
    );
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
  const tickers = manifest.tickers as Record<string, { ok: boolean; file: string; count: number }>;

  const symbols: SymbolData[] = [];
  let benchmark: PriceBar[] = [];

  const benchCandidates = ['^TASI.SR', '^GSPC', '^IXIC'];

  for (const [ticker, info] of Object.entries(tickers)) {
    if (!info.ok) continue;

    const rawBars = loadTickerFile(info.file);
    if (rawBars.length < 300) continue;

    const bars = toPriceBars(rawBars, true);

    if (benchCandidates.includes(ticker)) {
      if (ticker === '^TASI.SR' || benchmark.length === 0) {
        benchmark = bars;
      }
      continue;
    }

    symbols.push({
      symbol: ticker,
      market: ticker.endsWith('.SR') ? 'sa' : 'us',
      prices: bars,
    });
  }

  if (!benchmark.length) {
    if (symbols.length > 0) benchmark = symbols[0].prices;
    else throw new Error('لا يوجد benchmark ولا أسهم.');
  }

  return { symbols, benchmark };
}

async function main() {
  console.log('▸ تحميل البيانات...');
  const { symbols, benchmark } = loadTrainingData();
  console.log(`  ${symbols.length} سهم صالح`);
  console.log(`  benchmark: ${benchmark.length} شمعة`);

  if (symbols.length < 2) {
    throw new Error('يجب سهمان على الأقل للتدريب.');
  }

  const peerProvider = (symbol: string, market: 'sa' | 'us'): PriceBar[][] =>
    symbols
      .filter((s) => s.symbol !== symbol && s.market === market)
      .map((s) => s.prices);

  console.log('\n▸ بناء corpus...');
  const corpus = buildCorpus(symbols, benchmark, peerProvider, {
    horizon: DEFAULT_TRAINING_CONFIG.horizon,
    minHistory: 252,
    stepSessions: 5,
  });
  console.log(`  ${corpus.samples.length} عينة`);

  if (corpus.samples.length < 100) {
    throw new Error(`عينات غير كافية (${corpus.samples.length} < 100). جِب المزيد من الأسهم أو سنوات.`);
  }

  console.log('\n▸ بدء التدريب...\n');
  const { artifact, report } = trainAll(corpus, DEFAULT_TRAINING_CONFIG);
  console.log(report);

  writeFileSync(resolve(process.cwd(), OUT), JSON.stringify(artifact, null, 2), 'utf-8');
  const sizeKB = (JSON.stringify(artifact).length / 1024).toFixed(1);
  console.log(`\n✅ الـartifact (${sizeKB} KB) → ${OUT}`);
  console.log('\n▸ للاستخدام في الإنتاج:');
  console.log(`  npx wrangler secret put MIZAN_FORECAST_ARTIFACT < ${OUT}`);
}

main().catch((e) => {
  console.error('\n✗ فشل:', e instanceof Error ? e.message : e);
  process.exit(1);
});
