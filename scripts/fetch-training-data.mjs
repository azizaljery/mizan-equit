#!/usr/bin/env node
/**
 * scripts/fetch-training-data.mjs
 * ------------------------------------------------------------------
 * جالب بيانات التدريب لـ Mizan Forecast v2.
 *
 *   node scripts/fetch-training-data.mjs AAPL,MSFT,2222.SR,2010.SR,4013.SR 5
 *   node scripts/fetch-training-data.mjs --self-test     # بلا شبكة
 *
 * المخرجات:
 *   data/training/<TICKER>.json   — شموع OHLCV + الإغلاق المعدَّل
 *   data/training/manifest.json   — ملخّص النجاح/الفشل والأعداد
 *
 * العقد مع corpus-builder.ts:
 *   { ticker, years, count, fetchedAt, bars[] }
 *   bar = { t: 'YYYY-MM-DD', o, h, l, c, v, adj }
 *
 * المصدر: نقطة Yahoo Finance العامة للرسم البياني. بلا مفتاح.
 * ملاحظة: البيانات هنا للتدريب دون الاتصال فقط. أي رقم يُعرض للمستخدم
 * يجب أن يأتي من المصدر الرسمي (تداول / الجهة المصدِرة)، لا من هنا.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (compatible; MizanTrainingFetcher/1.0)';
const RETRY = 3;
const RETRY_DELAY_MS = 1500;
const BETWEEN_TICKERS_MS = 400;
/** أقل من سنة تداول واحدة = غير كافٍ للتدريب، لكنه يُكتب مع تحذير. */
const MIN_BARS = 252;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const tickers = (argv[2] || 'AAPL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const years = Number(argv[3] || 5);
  if (!Number.isFinite(years) || years < 1 || years > 20) {
    throw new Error(`عدد سنوات غير صالح: ${argv[3]} (المتوقَّع 1..20)`);
  }
  return { tickers, years };
}

/** خطأ لا يُعاد معه المحاولة (رمز عميل غير 429). */
class PermanentError extends Error {}

async function fetchTicker(ticker, years) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - Math.floor(years * 365.25 * 86400);
  const url =
    `${YF}/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${now}` +
    `&interval=1d&events=div,splits&includeAdjustedClose=true`;

  let lastErr;
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        // 404 رمز غير معروف، 401/403 حجب — إعادة المحاولة لا تغيّر شيئاً.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new PermanentError(`HTTP ${res.status}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const err = json?.chart?.error;
      if (err) throw new PermanentError(err.description || err.code || 'خطأ من Yahoo');
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('chart.result فارغ');
      return normalize(result);
    } catch (e) {
      lastErr = e;
      if (e instanceof PermanentError) break;
      if (attempt < RETRY) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

/** يحوّل رد Yahoo إلى شموع نظيفة: مرتَّبة، بلا تكرار، وبقيم صالحة. */
export function normalize(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || q.close || [];

  const bars = [];
  let dropped = 0;

  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];

    // فجوات Yahoo تأتي null. وسعر صفري أو سالب أو high<low بيانات تالفة.
    const vals = [o, h, l, c];
    if (vals.some((v) => v == null || !Number.isFinite(v) || v <= 0) || h < l) {
      dropped++;
      continue;
    }
    const t = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    const a = adj[i];
    bars.push({
      t,
      o,
      h,
      l,
      c,
      v: Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0,
      adj: Number.isFinite(a) && a > 0 ? a : c,
    });
  }

  bars.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  // إزالة التكرار بالتاريخ — يُبقى الأخير.
  const dedup = [];
  for (const b of bars) {
    if (dedup.length && dedup[dedup.length - 1].t === b.t) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }

  return { bars: dedup, dropped, duplicates: bars.length - dedup.length };
}

// ═══════════════════════════════════════════════════════════════
// اختبار ذاتي بلا شبكة — يتحقّق من normalize وحدها
// ═══════════════════════════════════════════════════════════════

function selfTest() {
  const day = 86400;
  const base = Date.UTC(2026, 0, 5) / 1000;
  const fixture = {
    timestamp: [base + 2 * day, base, base + day, base + day, base + 3 * day, base + 4 * day],
    indicators: {
      quote: [
        {
          open: [102, 100, 101, 101.5, null, 104],
          high: [103, 101, 102, 102.5, 105, 103],
          low: [101, 99, 100, 100.5, 104, 105],
          close: [102.5, 100.5, 101.5, 102, 104.5, 104],
          volume: [1200, 1000, 1100, 1150, 1300, null],
        },
      ],
      adjclose: [{ adjclose: [102.4, 100.4, 101.4, 101.9, 104.4, 104] }],
    },
  };

  const { bars, dropped, duplicates } = normalize(fixture);
  const checks = [
    ['مرتَّبة تصاعدياً', bars.every((b, i) => i === 0 || bars[i - 1].t <= b.t)],
    ['بلا تواريخ مكرّرة', new Set(bars.map((b) => b.t)).size === bars.length],
    ['التكرار يُبقي الأخير', bars.find((b) => b.t === '2026-01-06')?.c === 102],
    ['شمعة بإغلاق null مُسقَطة', dropped >= 1 && !bars.some((b) => b.c == null)],
    ['شمعة high<low مُسقَطة', !bars.some((b) => b.h < b.l)],
    ['حجم null يصير صفراً', bars.every((b) => Number.isFinite(b.v))],
    ['عدد الشموع الباقية = 3', bars.length === 3],
    ['duplicates = 1', duplicates === 1],
  ];

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
    if (!pass) ok = false;
  }
  console.log(`[self-test] ${ok ? 'نجح' : 'فشل'} — ${bars.length} شمعة، أُسقطت ${dropped}`);
  return ok ? 0 : 1;
}

// ═══════════════════════════════════════════════════════════════

async function main() {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  }

  const { tickers, years } = parseArgs(process.argv);
  const outDir = join(process.cwd(), 'data', 'training');
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  console.log(`[fetch] الرموز=${tickers.length} السنوات=${years} ← ${outDir}`);
  const manifest = { fetchedAt: new Date().toISOString(), years, tickers: {} };

  for (const [i, tk] of tickers.entries()) {
    if (i > 0) await sleep(BETWEEN_TICKERS_MS);
    process.stdout.write(`  → ${tk.padEnd(10)} `);
    try {
      const { bars, dropped, duplicates } = await fetchTicker(tk, years);
      const note =
        (dropped ? ` (أُسقطت ${dropped})` : '') + (duplicates ? ` (مكرّر ${duplicates})` : '');
      if (bars.length < MIN_BARS) console.log(`⚠ ${bars.length} شمعة (<${MIN_BARS})${note}`);
      else console.log(`✓ ${bars.length} شمعة${note}`);

      const safe = tk.replace(/[^A-Za-z0-9._-]/g, '_');
      const file = join(outDir, `${safe}.json`);
      await writeFile(
        file,
        JSON.stringify(
          { ticker: tk, years, count: bars.length, fetchedAt: new Date().toISOString(), bars },
          null,
          2,
        ),
      );
      manifest.tickers[tk] = {
        ok: true,
        file,
        count: bars.length,
        dropped,
        duplicates,
        sufficient: bars.length >= MIN_BARS,
        first: bars[0]?.t ?? null,
        last: bars[bars.length - 1]?.t ?? null,
      };
    } catch (e) {
      const msg = e?.message || String(e);
      console.log(`✗ ${msg}`);
      manifest.tickers[tk] = { ok: false, error: msg };
    }
  }

  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const entries = Object.values(manifest.tickers);
  const okCount = entries.filter((t) => t.ok).length;
  const thinCount = entries.filter((t) => t.ok && !t.sufficient).length;
  console.log(`[fetch] تم: ${okCount}/${tickers.length} ناجح${thinCount ? `، ${thinCount} دون ${MIN_BARS} شمعة` : ''}`);
  console.log(`[fetch] البيان: ${join(outDir, 'manifest.json')}`);
  process.exit(okCount === tickers.length ? 0 : 1);
}

main().catch((e) => {
  console.error('[fetch] خطأ قاتل:', e?.message || e);
  process.exit(1);
});
