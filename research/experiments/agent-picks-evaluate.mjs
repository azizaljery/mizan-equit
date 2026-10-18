#!/usr/bin/env node
/**
 * agent-picks-evaluate.mjs — matures recorded agent-picks forecasts and writes the weekly report (Node 20, no deps).
 *
 *   node research/experiments/agent-picks-evaluate.mjs [--dir=research/agent-picks] [--no-report] [--today=YYYY-MM-DD]
 *
 * For every (run file, symbol, horizon ∈ {1,5,21}) entry without an outcome:
 *   target = h-th session strictly after the reference-price date on the market calendar
 *            (SA: union of the dates of 2222.SR, 1120.SR, 2010.SR from Yahoo; US: SPY);
 *   matured when the target date is in the calendar AND is before today (exchange-local) — so its close is final;
 *   actual = Yahoo daily close of the symbol on the target date.
 *   No bar on the target date: waits; after ≥ 10 sessions past the target (and only if ≥ 75% of the needed symbols were
 *   fetched in the same run — a provider outage never penalises a stock) it is written as 'unavailable' = «لم يصعد».
 * Outcomes go to <dir>/outcomes/<market>.json keyed "<run file>|<symbol>|h<h>". APPEND-ONLY: existing outcome entries are
 * never modified (checked byte-for-byte before writing). Reports are written with exclusive create (never overwritten).
 * Status: EXPLORATORY descriptive record; no conclusion before n_eff ≥ 60 (AMEND-1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as L from './agent-picks-lib.mjs';

// ------------------------------------------------------------------------------------------------ file I/O
export function readRuns(dir) {
  const runs = [];
  for (const market of L.MARKETS) {
    const d = path.join(dir, market);
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d).filter((n) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.json$/.test(n)).sort(cmpRunName)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(d, name), 'utf8'));
        if (data && data.schema === L.SCHEMA_RUN && data.market === market) runs.push({ file: `${market}/${name}`, data });
      } catch { /* unreadable file: skipped, reported by count */ }
    }
  }
  return runs;
}
/** 2026-10-18.json < 2026-10-18-2.json < 2026-10-18-10.json < 2026-10-19.json */
export function cmpRunName(a, b) {
  const pa = a.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/), pb = b.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/);
  if (!pa || !pb) return a < b ? -1 : 1;
  return pa[1] < pb[1] ? -1 : pa[1] > pb[1] ? 1 : Number(pa[2] || 1) - Number(pb[2] || 1);
}
export function readOutcomes(dir, market) {
  const f = path.join(dir, 'outcomes', `${market}.json`);
  if (!fs.existsSync(f)) return { schema: L.SCHEMA_OUTCOMES, market, updatedAt: null, count: 0, outcomes: {} };
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (j.schema !== L.SCHEMA_OUTCOMES || j.market !== market || typeof j.outcomes !== 'object') throw new Error('unexpected outcomes file ' + f);
  return j;
}
export function writeOutcomes(dir, market, before, mergedOutcomes, nowIso) {
  L.assertAppendOnly(before.outcomes, mergedOutcomes);
  const d = path.join(dir, 'outcomes');
  fs.mkdirSync(d, { recursive: true });
  const doc = { schema: L.SCHEMA_OUTCOMES, market, updatedAt: nowIso, count: Object.keys(mergedOutcomes).length, note: 'Append-only: entries are added, never modified. Key = <run file>|<symbol>|h<horizon>.', outcomes: mergedOutcomes };
  const f = path.join(d, `${market}.json`), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n');
  // re-read and re-verify the file that is about to replace the old one
  L.assertAppendOnly(before.outcomes, JSON.parse(fs.readFileSync(tmp, 'utf8')).outcomes);
  fs.renameSync(tmp, f);
  return f;
}
export function writeReport(dir, base, md) {
  const d = path.join(dir, 'reports');
  fs.mkdirSync(d, { recursive: true });
  for (let t = 0; t < 50; t++) {
    const name = L.nextFreeName(fs.readdirSync(d), base, '.md');
    try { fs.writeFileSync(path.join(d, name), md, { flag: 'wx' }); return name; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('no free report name');
}

// ------------------------------------------------------------------------------------------------ evaluation
/** Pending entries of one market: [{key, runFile, symbol, h, entry, refDate}] (no outcome yet, usable reference price). */
export function pendingEntries(runs, market, outcomes) {
  const out = [];
  for (const { file, data } of runs) {
    if (data.market !== market || !Array.isArray(data.picks)) continue;
    for (const p of data.picks) {
      if (!p.analyze || !p.analyze.ok || !p.forecasts) continue;
      for (const h of L.HORIZONS) {
        const entry = p.forecasts[h];
        if (!entry || !L.isNum(entry.price) || entry.price <= 0) continue;
        const refDate = L.isDate(entry.refDate) ? entry.refDate : L.refDateOf(entry.priceTime, market);
        if (!refDate) continue;
        const key = L.outcomeKey(file, p.symbol, h);
        if (!Object.prototype.hasOwnProperty.call(outcomes, key)) out.push({ key, runFile: file, symbol: p.symbol, h, entry, refDate });
      }
    }
  }
  return out;
}

/**
 * Pure decision for one pending entry given the calendar and the symbol's chart result.
 * Returns an outcome object or null (not matured / wait).
 */
export function decideOutcome({ p, calendar, todayLocal, chart, providerHealthy, evaluatedAt }) {
  const target = L.targetSession(calendar, p.refDate, p.h);
  if (!target || target >= todayLocal) return null;
  const late = L.sessionsAfter(calendar, target) >= L.UNAVAILABLE_AFTER_SESSIONS;
  if (chart && chart.ok) {
    const bar = chart.parsed.bars.find((b) => b.date === target);
    const splitBetween = chart.parsed.splits.some((d) => d > p.refDate && d <= target);
    if (bar) return L.evaluateOutcome({ entry: p.entry, h: p.h, refDate: p.refDate, targetDate: target, actual: bar, splitBetween, evaluatedAt });
    return late && providerHealthy ? L.evaluateOutcome({ entry: p.entry, h: p.h, refDate: p.refDate, targetDate: target, actual: null, splitBetween, evaluatedAt }) : null;
  }
  if (chart && chart.final && late && providerHealthy) return { ...L.evaluateOutcome({ entry: p.entry, h: p.h, refDate: p.refDate, targetDate: target, actual: null, evaluatedAt }), unavailableReason: chart.reason };
  return null;
}

export async function evaluateMarket({ market, runs, outcomesDoc, net, sleep, nowMs, log, todayOverride }) {
  const pend = pendingEntries(runs, market, outcomesDoc.outcomes);
  const res = { market, pending: pend.length, added: {}, calendarSessions: 0, fetched: 0, fetchFailed: [], waiting: 0 };
  if (!pend.length) return res;
  const tz = L.MARKET_TZ[market];
  const todayLocal = todayOverride || L.localDate(nowMs, tz);
  const oldest = pend.map((p) => p.refDate).sort()[0];
  const range = L.rangeForDays((Date.parse(todayLocal) - Date.parse(oldest)) / 86400000 + 10);
  const calCharts = [];
  for (const symbol of L.CALENDAR_SYMBOLS[market]) {
    const c = await L.fetchChart({ net, symbol, market, range, sleep });
    if (c.ok) calCharts.push(c.parsed.bars); else log(`calendar ${symbol}: ${c.reason}`);
    await sleep(300);
  }
  const calendar = L.unionCalendar(calCharts).filter((d) => d <= todayLocal);
  res.calendarSessions = calendar.length;
  if (calendar.length < 20) { log(`${market}: calendar unavailable (${calendar.length} sessions) — nothing evaluated`); res.waiting = pend.length; return res; }
  const due = pend.filter((p) => { const t = L.targetSession(calendar, p.refDate, p.h); return t && t < todayLocal; });
  const symbols = [...new Set(due.map((p) => p.symbol))];
  const charts = {};
  for (const symbol of symbols) {
    charts[symbol] = await L.fetchChart({ net, symbol, market, range, sleep });
    if (charts[symbol].ok) res.fetched++; else res.fetchFailed.push({ symbol, reason: charts[symbol].reason });
    await sleep(300);
  }
  const providerHealthy = symbols.length ? res.fetched / symbols.length >= L.MIN_RANK_COVERAGE : true;
  const evaluatedAt = new Date(nowMs).toISOString();
  for (const p of pend) {
    const o = decideOutcome({ p, calendar, todayLocal, chart: charts[p.symbol], providerHealthy, evaluatedAt });
    if (o) res.added[p.key] = { runFile: p.runFile, symbol: p.symbol, horizon: p.h, ...o };
    else res.waiting++;
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ weekly report
export function weeklyReport({ runs, outcomesByMarket, reportDate, week, evalResults = [] }) {
  const rows = L.buildRows(runs, outcomesByMarket);
  // the 7 UTC days ending on the report date (a Saudi Sunday run belongs to the previous ISO week; it must not be skipped)
  const from = L.addDays(reportDate, -6);
  const weekRuns = runs.filter(({ data }) => data.runDate >= from && data.runDate <= reportDate);
  const lines = [];
  lines.push(`<div dir="rtl">`, '');
  lines.push(`# تقرير «ترشيحات الوكيل» الأسبوعي — ${week}`, '');
  lines.push(`> تاريخ الإعداد: ${reportDate} (UTC). ${L.GOVERNANCE_NOTE}`, '> الأرقام وصفية تراكمية منذ أول تشغيل؛ لا تُقرأ كنجاح أو فشل، ولا تُغيَّر بناءً عليها أي معادلة أو عتبة.', '');
  lines.push('## Hypothesis (الفرضية)', '', 'لا فرضية تُختبر في هذا التقرير. يُراقَب سؤالان وصفيان فقط: هل اتجاه توقعات `forecasts()` للأسهم المختارة بالزخم يطابق الحركة الفعلية؟ وهل نسبة صعود توقعات «صاعد» أعلى من نسبة صعود كل الأسهم المقيّمة؟ (الفرضية الرسمية للزخم موجودة في `PROTOCOL-DIR-0002.md` وتُختبر هناك فقط.)', '');
  lines.push('## Baseline (خط الأساس)', '', 'نسبة الصعود الأساسية = نسبة كل الأسهم المقيّمة من نفس التشغيلات التي أغلقت فوق سعرها المرجعي (= اختيار عشوائي من نفس المجموعة). هدف المالك 80% يُعرض كمرجع طموح فقط، وليس معيار نجاح.', '');
  lines.push('## Experiment (التشغيل)', '');
  lines.push(`- تشغيلات آخر 7 أيام (${from} → ${reportDate}): ${weekRuns.length} (السعودي ${weekRuns.filter((r) => r.data.market === 'sa').length}، الأمريكي ${weekRuns.filter((r) => r.data.market === 'us').length}). إجمالي التشغيلات المسجلة: ${runs.length}.`);
  for (const e of evalResults) lines.push(`- تقييم ${L.MARKET_NAME[e.market]}: نتائج جديدة ${Object.keys(e.added).length}، بانتظار النضج ${e.waiting}، جلسات التقويم ${e.calendarSessions}${e.fetchFailed.length ? `، تعذر جلب ${e.fetchFailed.length} سهماً (${e.fetchFailed.slice(0, 6).map((f) => f.symbol + ':' + f.reason).join('، ')})` : ''}.`);
  lines.push('');
  if (weekRuns.length) {
    lines.push(L.table(['التاريخ (UTC)', 'السوق', 'الملف', 'الحالة', 'نجح/مختار', 'فشل', 'إصدار النموذج'],
      weekRuns.map(({ file, data }) => [data.runDate, L.MARKET_NAME[data.market], '`' + file + '`', data.status, `${data.counts.ok}/${data.counts.selected}`, data.counts.failed, (data.modelVersions || []).join('، ') || '—'])), '');
  }
  lines.push('## Out-of-sample Result (نتيجة أمامية وصفية)', '');
  const allSummaries = [];
  for (const market of L.MARKETS) {
    const sums = L.HORIZONS.map((h) => L.summarize(rows.filter((r) => r.market === market && r.h === h), market, h));
    allSummaries.push(...sums);
    const t = L.marketTables(sums);
    lines.push(`### ${L.MARKET_NAME[market]}`, '', '**الأعداد**', '', t.counts, '', '**النسب** (القيمة بين القوسين = عدد/مقام)', '', t.rates, '');
  }
  lines.push('### التعريفات', '', L.DEFINITIONS_MD, '');
  lines.push('## Statistical Evidence (الدليل الإحصائي)', '', L.neffNote(allSummaries), '', 'لا تُحسب قيم p ولا فترات ثقة هنا عمداً: الملاحظات في التاريخ نفسه مترابطة والعينة صغيرة، وأي فترة ثقة على عدد الأسهم ستكون مضللة.', '');
  lines.push('## Failure Modes (مصادر الخطأ المعروفة)', '', '- السعر المرجعي لحظي متأخر (حتى 15 دقيقة) بينما السعر الفعلي إغلاق؛ للأفق اليومي هذا الفرق مؤثر.', '- الاختيار بالزخم يجعل العينة غير ممثلة للسوق؛ نسبة الصعود الأساسية محسوبة من نفس المجموعة المختارة لا من السوق كله.', '- الأمريكي: موعد 14:00 UTC يكون قبل الافتتاح في التوقيت الشتوي (EST) فيكون السعر المرجعي إغلاق اليوم السابق.', '- تجزئة سهم بين المرجع والهدف تُقيَّم بالسعر غير المعدّل (عمود «تجزئة محتملة»).', '- أعطال المزود: الأيام بلا تشغيل فجوات لا تُعوَّض بأثر رجعي.', '');
  lines.push('## Decision (القرار)', '', `**لا قرار.** وصفي فقط حتى n_eff ≥ ${L.MIN_NEFF}. لا يُغيَّر \`forecasts()\` ولا أي عتبة بناءً على هذا التقرير.`, '', '</div>', '');
  return lines.join('\n');
}

export async function evaluateAll({ dir, net = L.defaultNet(), sleep = L.realSleep, now = Date.now, log = () => {}, report = true, todayOverride = null }) {
  const nowMs = now(), nowIso = new Date(nowMs).toISOString();
  const runs = readRuns(dir);
  const outcomesByMarket = {}, evalResults = [], written = [];
  for (const market of L.MARKETS) {
    const before = readOutcomes(dir, market);
    const snapshot = JSON.parse(JSON.stringify(before));
    const r = await evaluateMarket({ market, runs, outcomesDoc: before, net, sleep, nowMs, log, todayOverride });
    evalResults.push(r);
    const { merged, added } = L.mergeOutcomes(before.outcomes, r.added);
    if (added.length) written.push(writeOutcomes(dir, market, snapshot, merged, nowIso));
    outcomesByMarket[market] = { ...before, outcomes: merged };
    log(`${market}: pending ${r.pending}, added ${added.length}, waiting ${r.waiting}`);
  }
  let reportFile = null;
  if (report) {
    const reportDate = nowIso.slice(0, 10), week = L.isoWeek(reportDate);
    reportFile = writeReport(dir, `weekly-${week}`, weeklyReport({ runs, outcomesByMarket, reportDate, week, evalResults }));
  }
  return { runs: runs.length, evalResults: evalResults.map((e) => ({ market: e.market, pending: e.pending, added: Object.keys(e.added).length, waiting: e.waiting, fetchFailed: e.fetchFailed.length })), written, reportFile };
}

async function main() {
  const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([a-z-]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
  const dir = typeof opt.dir === 'string' ? opt.dir : 'research/agent-picks';
  const res = await evaluateAll({ dir, report: !opt['no-report'], todayOverride: typeof opt.today === 'string' ? opt.today : null, log: (s) => console.error(s) });
  console.log(JSON.stringify(res));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `report=${res.reportFile || ''}\nadded=${res.evalResults.reduce((s, e) => s + e.added, 0)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('fatal:', e && e.stack || e); process.exit(1); });
}
