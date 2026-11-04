// FCST-0005 E1 LIMITED HISTORICAL-COVERAGE CHECK (tool only; NOT executed by the author).
// Purpose: for each of the 80 stored symbols, learn what history exists up to a hard end date. It is a READ OF PRICE DATA by an automated process:
// the whole response (timestamps, closes, volumes, events) reaches memory; this code reads only the fields listed in FIELDS_READ, keeps only FIELDS_KEPT,
// prints no price, volume or return, and stores no response. It must NOT be treated as "descriptive data only".
// Hard limits (enforced in code and tested): end date 2019-10-13 (period2 fixed at END_EXCLUSIVE), one host from the approved source profile, no redirect,
// no alternative source, no recent fetch, any row after the end date aborts that symbol, no comparison with the stored 2019-10-14+ window.
// It refuses to run unless the source profile carries a recorded terms review and an approval AND the operator arms it explicitly.
// usage (only after approval, in an environment whose network policy allows the host):
//   COVERAGE_CHECK_ARMED=1 node coverage-check.mjs --profile source-profile.json --symbols coverage-symbols.json --out coverage-report.json
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const END_DATE = '2019-10-13';
export const END_EXCLUSIVE = 1571011200;      // 2019-10-14T00:00:00Z: first instant NOT requested
export const START_EPOCH = 788918400;         // 1995-01-01T00:00:00Z: earliest instant requested
export const FIELDS_READ = ['meta.symbol', 'meta.currency', 'meta.exchangeName', 'meta.exchangeTimezoneName', 'meta.gmtoffset', 'timestamp[]', 'indicators.quote[0].close[] (null test only)', 'indicators.adjclose (presence only)', 'events.splits (count)', 'events.dividends (count)'];
export const FIELDS_KEPT = ['symbol', 'requestUrl', 'httpStatus', 'status', 'anomaly', 'firstDate', 'lastDate', 'rows', 'nullCloseCount', 'longestGapDays', 'hasAdjClose', 'splitCount', 'dividendCount', 'currency', 'exchangeName', 'exchangeTimezoneName'];
const REQUIRED_PROFILE = ['host', 'urlTemplate', 'format', 'termsUrl', 'termsReviewedAt', 'termsSuitability', 'approvedBy', 'approvedAt', 'accessPathRef'];

/** Profile = the operator's record that the source's terms were reviewed and that this use was approved by the owner. Missing/empty fields refuse the run. */
export function checkProfile(p) {
  const missing = REQUIRED_PROFILE.filter(k => !p || typeof p[k] !== 'string' || !p[k].trim());
  if (missing.length) throw new Error('profile incomplete (terms review / approval / access path not recorded): ' + missing.join(', '));
  if (p.format !== 'yahoo-chart-v8') throw new Error('unsupported format ' + p.format + ' (extending the parser needs a design review)');
  if (!/^[a-z0-9.-]+$/i.test(p.host)) throw new Error('bad host');
  if (!p.urlTemplate.startsWith('https://' + p.host + '/') || !p.urlTemplate.includes('{symbol}') || !p.urlTemplate.includes('{period1}') || !p.urlTemplate.includes('{period2}')) throw new Error('urlTemplate must be https://<host>/...{symbol}...{period1}...{period2}');
  if (/range=/.test(p.urlTemplate)) throw new Error('relative ranges are forbidden (they fetch recent data)');
  return true;
}
export function buildUrl(p, symbol) {
  if (!/^[A-Za-z0-9.^=-]{1,15}$/.test(symbol)) throw new Error('bad symbol ' + symbol);
  return p.urlTemplate.replace('{symbol}', encodeURIComponent(symbol)).replace('{period1}', String(START_EPOCH)).replace('{period2}', String(END_EXCLUSIVE));
}
const day = (sec, off) => new Date((sec + off) * 1000).toISOString().slice(0, 10);

/** Reads ONLY the declared fields. Returns {ok:true, rec} or {ok:false, anomaly}. Nothing from the price arrays other than null-ness leaves this function. */
export function analyse(body, symbol) {
  const r = body?.chart?.result?.[0];
  if (!r || !Array.isArray(r.timestamp) || !r.timestamp.length) return {ok: false, anomaly: 'no-data'};
  const off = Number.isFinite(r.meta?.gmtoffset) ? r.meta.gmtoffset : 0, ts = r.timestamp;
  if (r.meta?.symbol !== symbol) return {ok: false, anomaly: 'symbol-mismatch'};
  for (let i = 0; i < ts.length; i++) if (!(ts[i] < END_EXCLUSIVE) || day(ts[i], off) > END_DATE) return {ok: false, anomaly: 'row-after-end-date'};
  for (let i = 1; i < ts.length; i++) if (!(ts[i] > ts[i - 1])) return {ok: false, anomaly: 'unsorted'};
  const close = r.indicators?.quote?.[0]?.close, nulls = Array.isArray(close) ? close.reduce((n, v) => n + (v === null || v === undefined ? 1 : 0), 0) : null;
  let gap = 0; for (let i = 1; i < ts.length; i++) gap = Math.max(gap, Math.round((ts[i] - ts[i - 1]) / 86400));
  return {ok: true, rec: {symbol, firstDate: day(ts[0], off), lastDate: day(ts[ts.length - 1], off), rows: ts.length, nullCloseCount: nulls, longestGapDays: gap, hasAdjClose: Array.isArray(r.indicators?.adjclose?.[0]?.adjclose),
    splitCount: Object.keys(r.events?.splits ?? {}).length, dividendCount: Object.keys(r.events?.dividends ?? {}).length, currency: r.meta?.currency ?? null, exchangeName: r.meta?.exchangeName ?? null, exchangeTimezoneName: r.meta?.exchangeTimezoneName ?? null}};
}
/** fetchImpl(url, opts) -> {status, json()}; redirects are never followed (redirect:'manual' and any 3xx aborts). Exactly one host. */
export async function runCheck({profile, symbols, fetchImpl, env = {}, sleep = () => Promise.resolve()}) {
  if (env.COVERAGE_CHECK_ARMED !== '1') throw new Error('not armed: set COVERAGE_CHECK_ARMED=1 only after the owner approved this run');
  checkProfile(profile);
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > 80) throw new Error('symbol list must contain 1..80 symbols');
  const records = [], requests = [];
  for (const symbol of symbols) {
    const url = buildUrl(profile, symbol); if (new URL(url).host !== profile.host) throw new Error('host mismatch');
    requests.push(url);
    let res = null, err = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {   // one same-URL retry on network error or 5xx; never another source
      try { const x = await fetchImpl(url, {method: 'GET', redirect: 'manual', headers: {accept: 'application/json'}}); if (x.status >= 500 && attempt === 0) { await sleep(1000); continue; } res = x; } catch (e) { err = String(e?.message ?? e).slice(0, 80); await sleep(1000); }
    }
    const base = {symbol, requestUrl: url, httpStatus: res?.status ?? null};
    if (!res) { records.push({...base, status: 'failed', anomaly: err ?? 'no-response'}); continue; }
    if (res.status >= 300 && res.status < 400) { records.push({...base, status: 'aborted', anomaly: 'redirect-not-followed'}); continue; }
    if (res.status !== 200) { records.push({...base, status: 'failed', anomaly: 'http-' + res.status}); continue; }
    let body; try { body = await res.json(); } catch { records.push({...base, status: 'failed', anomaly: 'bad-json'}); continue; }
    const a = analyse(body, symbol); body = null;
    records.push(a.ok ? {...base, status: 'ok', ...a.rec} : {...base, status: 'aborted', anomaly: a.anomaly});
    await sleep(1000);
  }
  const ok = records.filter(r => r.status === 'ok'), startsBy = y => ok.filter(r => r.firstDate <= y + '-01-01').length;
  return {tool: 'FCST-0005 coverage-check', endDate: END_DATE, fieldsRead: FIELDS_READ, fieldsKept: FIELDS_KEPT, source: {host: profile.host, termsUrl: profile.termsUrl, termsReviewedAt: profile.termsReviewedAt, approvedBy: profile.approvedBy, approvedAt: profile.approvedAt, accessPathRef: profile.accessPathRef},
    requested: requests.length, ok: ok.length, aborted: records.filter(r => r.status === 'aborted').length, failed: records.filter(r => r.status === 'failed').length,
    startingOnOrBefore: {'2005-01-01': startsBy(2005), '2010-01-01': startsBy(2010), '2015-01-01': startsBy(2015)}, records};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const profile = JSON.parse(readFileSync(arg('profile'), 'utf8')), symbols = JSON.parse(readFileSync(arg('symbols'), 'utf8')).symbols;
  const out = await runCheck({profile, symbols, fetchImpl: (u, o) => fetch(u, o), env: process.env, sleep: ms => new Promise(r => setTimeout(r, ms))});
  writeFileSync(arg('out'), JSON.stringify(out, null, 1)); console.log(`requested ${out.requested}, ok ${out.ok}, aborted ${out.aborted}, failed ${out.failed}; starting <=2005: ${out.startingOnOrBefore['2005-01-01']}, <=2010: ${out.startingOnOrBefore['2010-01-01']}, <=2015: ${out.startingOnOrBefore['2015-01-01']}`);
}
