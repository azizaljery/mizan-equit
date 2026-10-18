#!/usr/bin/env node
/**
 * agent-picks-run.mjs — one "agent picks" run for a market (Node 20, no dependencies).
 *
 *   node research/experiments/agent-picks-run.mjs <sa|us> <count> <out-dir> [--require-session-today] [--spacing-ms=3000]
 *        [--deadline-min=45] [--session-wait-min=10] [--site=https://mizan-aziz.aljeryabod.workers.dev]
 *
 * (a) selection: ranks the market's frozen 40-stock universe (mizan-v45/lib/daily-picks-universe.ts) by
 *     mom126_5 = close[t-5]/close[t-131]-1 from Yahoo daily charts (identity validated), takes the top <count>
 *     (count >= 40 → whole universe; ranks still stored);
 * (b) for each selected symbol, sequentially (spacing >= 2 s, timeout 150 s, up to 2 retries on 5xx/network/timeout),
 *     calls the live POST /api/company/analyze — which ALSO records the forecast in production D1 (intended: "store") —
 *     and extracts horizons 1, 5, 21;
 * (c) writes <out-dir>/<market>/<YYYY-MM-DD>.json (UTC date), exclusive create: an existing file is NEVER overwritten
 *     (<date>-2.json, <date>-3.json ...).
 *
 * Exit codes: 0 = file written (even with per-symbol failures) or no session today (nothing written);
 *             3 = file written but every analyze call failed (the failure itself is recorded); 1 = fatal.
 * Status: EXPLORATORY descriptive record — see agent-picks-lib.mjs GOVERNANCE_NOTE. Live runs happen in CI only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as L from './agent-picks-lib.mjs';

export const DEFAULT_SITE = 'https://mizan-aziz.aljeryabod.workers.dev';
export const ANALYZE_TIMEOUT_MS = 150000;
export const MIN_SPACING_MS = 2000;
export const ANALYZE_RETRIES = 2;

/** Default analyze transport: POST {symbol} → {status, text}. */
export function defaultAnalyze(site = DEFAULT_SITE) {
  return async (symbol) => {
    const r = await fetch(`${site}/api/company/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'mizan-agent-picks/1 (github-actions)' }, body: JSON.stringify({ symbol }), redirect: 'manual', signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS) });
    return { status: r.status, text: await r.text() };
  };
}

/** One analyze call with retries (5xx, network error, timeout → retry; 4xx/non-JSON → final). Never throws. */
export async function analyzeWithRetry({ analyze, symbol, sleep, retries = ANALYZE_RETRIES, backoffMs = 10000, now = Date.now }) {
  const t0 = now();
  let last = null;
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await analyze(symbol);
      const status = L.isNum(res && res.status) ? res.status : 0;
      let json = null;
      try { json = JSON.parse(res.text); } catch { /* non-JSON */ }
      if (status >= 500 || status === 0) {
        last = { ok: false, http: status, reason: 'http_' + status, detail: L.clip(json && json.error, 200), attempts: a + 1 };
      } else if (status !== 200) {
        return { ok: false, http: status, reason: 'http_' + status, detail: L.clip(json && json.error, 200), attempts: a + 1, ms: now() - t0 };
      } else if (!json) {
        return { ok: false, http: status, reason: 'non_json', detail: null, attempts: a + 1, ms: now() - t0 };
      } else {
        return { ok: true, http: status, json, attempts: a + 1, ms: now() - t0 };
      }
    } catch (e) {
      last = { ok: false, http: 0, reason: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network_error', detail: L.clip(e && (e.cause && e.cause.code || e.name), 60), attempts: a + 1 };
    }
    if (a < retries) await sleep(backoffMs * (a + 1));
  }
  return { ...last, ms: now() - t0 };
}

function gitSha(cwd) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

/** Write JSON exclusively under dir/<base>[-n].json; never overwrites. Returns the file name. */
export function writeExclusive(dir, base, obj) {
  fs.mkdirSync(dir, { recursive: true });
  for (let tries = 0; tries < 50; tries++) {
    const name = L.nextFreeName(fs.readdirSync(dir), base);
    try { fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 1) + '\n', { flag: 'wx' }); return name; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not find a free file name for ' + base);
}

/**
 * Main run (all I/O injectable). Returns {status:'written'|'gap'|'no_session', file, summary}.
 */
export async function runAgentPicks({
  market, count, outDir, net = L.defaultNet(), analyze = null, sleep = L.realSleep, now = Date.now, log = () => {},
  spacingMs = 3000, deadlineMs = 45 * 60000, requireSessionToday = false, sessionWaitMs = 10 * 60000, site = DEFAULT_SITE,
  meta = {},
}) {
  if (!L.MARKETS.includes(market)) throw new Error('market must be sa|us');
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  spacingMs = Math.max(MIN_SPACING_MS, spacingMs);
  analyze = analyze || defaultAnalyze(site);
  const startedMs = now(), startedAt = new Date(startedMs).toISOString();
  const tz = L.MARKET_TZ[market], universe = L.UNIVERSE[market];
  const todayLocal = L.localDate(startedMs, tz);

  // (a) momentum for the whole universe (+ the calendar symbols, for "is there a session today")
  const charts = {};
  for (const symbol of universe) {
    charts[symbol] = await L.fetchChart({ net, symbol, market, range: '1y', sleep });
    await sleep(300);
  }
  const sessionSeen = () => Object.values(charts).some((c) => c.ok && ((c.parsed.bars.length && c.parsed.bars[c.parsed.bars.length - 1].date === todayLocal) || (L.isNum(c.parsed.meta.regularMarketTime) && L.localDate(c.parsed.meta.regularMarketTime * 1000, tz) === todayLocal)));
  let sessionToday = sessionSeen();
  if (!sessionToday && requireSessionToday && sessionWaitMs > 0) {
    log(`no ${market} session seen for ${todayLocal}; waiting ${Math.round(sessionWaitMs / 60000)} min and re-checking the calendar symbols`);
    await sleep(sessionWaitMs);
    for (const symbol of L.CALENDAR_SYMBOLS[market]) {
      const c = await L.fetchChart({ net, symbol, market, range: '1y', sleep });
      if (universe.includes(symbol)) charts[symbol] = c; else charts['__cal_' + symbol] = c;
    }
    sessionToday = sessionSeen();
  }
  if (!sessionToday && requireSessionToday) {
    log(`no ${market} trading session today (${todayLocal}, ${tz}) — nothing called, nothing written`);
    return { status: 'no_session', file: null, summary: { market, todayLocal } };
  }

  const items = universe.map((symbol) => {
    const c = charts[symbol];
    if (!c.ok) return { symbol, value: null, reason: 'chart_' + c.reason };
    const m = L.momentum126_5(c.parsed.bars);
    return { symbol, value: m.value, reason: m.reason, m };
  });
  const ranking = L.rankByMomentum(items);
  const coverage = ranking.rankedCount / universe.length;
  const momBySym = Object.fromEntries(items.map((x) => [x.symbol, x]));
  const rankBySym = Object.fromEntries(ranking.ranked.map((r) => [r.symbol, r]));
  const universeRanking = universe.map((symbol) => {
    const r = rankBySym[symbol], it = momBySym[symbol];
    return { symbol, mom126_5: r ? r.mom126_5 : null, rank: r ? r.rank : null, percentile: r ? r.percentile : null, top20: r ? r.top20 : false, lastBarDate: it.m ? it.m.t : null, excludedReason: r ? null : it.reason };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.symbol < b.symbol ? -1 : 1));

  const runDate = startedAt.slice(0, 10);
  const doc = {
    schema: L.SCHEMA_RUN,
    market,
    runDate,
    marketLocalDate: todayLocal,
    sessionToday,
    startedAt,
    finishedAt: null,
    gitSha: meta.gitSha ?? null,
    workflowSha: meta.workflowSha ?? null,
    trigger: meta.trigger ?? null,
    ciRun: meta.ciRun ?? null,
    site,
    status: null,
    governance: L.GOVERNANCE_NOTE,
    selection: {
      version: L.SELECTION_VERSION,
      feature: 'mom126_5 = close[t-5]/close[t-131] - 1 (t = last daily bar from Yahoo chart range=1y, exchange-local dates; identity validated)',
      rule: count >= universe.length ? 'whole universe (ranks stored)' : `top ${count} by mom126_5 (desc; ties by symbol)`,
      requestedCount: count,
      universeSize: universe.length,
      rankedCount: ranking.rankedCount,
      coverage,
      coverageOk: coverage >= L.MIN_RANK_COVERAGE,
      excluded: ranking.excluded,
    },
    modelVersions: [],
    counts: { selected: 0, ok: 0, failed: 0, failures: [] },
    universeRanking,
    picks: [],
  };

  if (coverage < L.MIN_RANK_COVERAGE) {
    // PROTOCOL-DIR-0002 note: fewer than 75% ranked → gap (no picks, no analyze calls). The gap itself is recorded.
    doc.status = 'gap';
    doc.finishedAt = new Date(now()).toISOString();
    const file = writeExclusive(path.join(outDir, market), runDate, doc);
    log(`gap: only ${ranking.rankedCount}/${universe.length} ranked → ${market}/${file}`);
    return { status: 'gap', file: `${market}/${file}`, summary: { ranked: ranking.rankedCount } };
  }

  // (b) analyze, sequentially
  const selected = L.selectPicks(ranking, count, universe);
  doc.counts.selected = selected.length;
  const versions = new Set();
  for (let i = 0; i < selected.length; i++) {
    const symbol = selected[i];
    const r = rankBySym[symbol];
    const pick = { symbol, momentum: { mom126_5: r ? r.mom126_5 : null, rank: r ? r.rank : null, percentile: r ? r.percentile : null, top20: r ? r.top20 : false, lastBarDate: momBySym[symbol].m ? momBySym[symbol].m.t : null }, analyze: null, forecasts: null };
    if (now() - startedMs > deadlineMs) {
      pick.analyze = { ok: false, reason: 'skipped_time_budget', attempts: 0 };
    } else {
      const res = await analyzeWithRetry({ analyze, symbol, sleep, now });
      if (res.ok) {
        const ex = L.extractForecasts(res.json);
        if (ex.ok) {
          pick.analyze = { ok: true, http: res.http, attempts: res.attempts, ms: res.ms, modelVersion: ex.modelVersion, recorded: ex.recorded, snapshotId: ex.snapshotId, price: ex.price, priceTime: ex.priceTime, currency: ex.currency };
          pick.forecasts = {};
          for (const h of L.HORIZONS) pick.forecasts[h] = { ...ex.forecasts[h], refDate: L.refDateOf(ex.forecasts[h].priceTime, market) };
          if (ex.modelVersion) versions.add(ex.modelVersion);
        } else {
          pick.analyze = { ok: false, http: res.http, attempts: res.attempts, ms: res.ms, reason: ex.reason, detail: ex.detail };
        }
      } else {
        pick.analyze = { ok: false, http: res.http, attempts: res.attempts, ms: res.ms, reason: res.reason, detail: res.detail };
      }
      log(`${i + 1}/${selected.length} ${symbol}: ${pick.analyze.ok ? 'ok' : 'FAILED ' + pick.analyze.reason} (${pick.analyze.ms ?? 0} ms)`);
    }
    if (!pick.analyze.ok) doc.counts.failures.push({ symbol, reason: pick.analyze.reason, detail: pick.analyze.detail ?? null });
    doc.picks.push(pick);
    if (i < selected.length - 1) await sleep(spacingMs);
  }
  doc.counts.ok = doc.picks.filter((p) => p.analyze.ok).length;
  doc.counts.failed = doc.picks.length - doc.counts.ok;
  doc.modelVersions = [...versions];
  doc.status = doc.counts.ok ? 'written' : 'all_failed';
  doc.finishedAt = new Date(now()).toISOString();

  // (c) write (append-only)
  const file = writeExclusive(path.join(outDir, market), runDate, doc);
  return { status: doc.status, file: `${market}/${file}`, summary: { selected: doc.counts.selected, ok: doc.counts.ok, failed: doc.counts.failed, modelVersions: doc.modelVersions } };
}

// ------------------------------------------------------------------------------------------------ CLI
function parseArgs(argv) {
  const pos = [], opt = {};
  for (const a of argv) { const m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) opt[m[1]] = m[2] === undefined ? true : m[2]; else pos.push(a); }
  return { pos, opt };
}
function ghOutput(kv) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(kv).map(([k, v]) => `${k}=${String(v ?? '').replace(/\n/g, ' ')}`).join('\n') + '\n');
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [market, countS, outDir] = pos;
  if (!L.MARKETS.includes(market) || !countS || !outDir) { console.error('usage: agent-picks-run.mjs <sa|us> <count> <out-dir> [--require-session-today] [--spacing-ms=N] [--deadline-min=N] [--session-wait-min=N] [--site=URL]'); process.exit(1); }
  const res = await runAgentPicks({
    market, count: Number(countS), outDir,
    spacingMs: opt['spacing-ms'] ? Number(opt['spacing-ms']) : 3000,
    deadlineMs: (opt['deadline-min'] ? Number(opt['deadline-min']) : 45) * 60000,
    requireSessionToday: !!opt['require-session-today'],
    sessionWaitMs: (opt['session-wait-min'] !== undefined ? Number(opt['session-wait-min']) : 10) * 60000,
    site: typeof opt.site === 'string' ? opt.site.replace(/\/$/, '') : DEFAULT_SITE,
    log: (s) => console.error(s),
    meta: {
      gitSha: gitSha(process.cwd()), workflowSha: process.env.GITHUB_SHA || null, trigger: process.env.GITHUB_EVENT_NAME || 'manual',
      ciRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT || 1}` : null,
    },
  });
  console.log(JSON.stringify(res));
  ghOutput({ outcome: res.status, file: res.file || '', ok: res.summary.ok ?? '', failed: res.summary.failed ?? '', selected: res.summary.selected ?? '' });
  process.exit(res.status === 'all_failed' ? 3 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error('fatal:', e && e.stack || e); process.exit(1); });
}
