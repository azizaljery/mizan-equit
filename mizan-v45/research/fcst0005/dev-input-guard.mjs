// FCST-0005 dev-input guard: the ONLY way research code may read stored price files.
// The cut is applied AT THE SOURCE TEXT: row values after the cutoff date are never parsed, never returned, never hashed.
// Only the DATES of later rows are scanned (a regex on the date token) so that an unsorted file fails closed.
import {createHash} from 'node:crypto';

export const CUTOFF = '2024-09-04';           // last date of the exposed development window C (inclusive)
export const WINDOW_START = '2019-10-14';     // C starts here (earlier rows are allowed but unused by the protocol)
const DATE = /\["(\d{4}-\d{2}-\d{2})",/g;

/** Parse one stored price file (raw text) keeping only rows with date <= cutoff.
 * Returns {symbol, rows, digest, firstDate, lastDate, laterRowCount}. laterRowCount counts date tokens only. */
export function loadTruncated(rawText, cutoff = CUTOFF) {
  if (typeof rawText !== 'string') throw new TypeError('raw text required');
  const at = rawText.indexOf('"rows":[');
  if (at < 0) throw new Error('guard: no rows array');
  const head = rawText.slice(0, at);
  const body = rawText.slice(at + '"rows":['.length);
  let cutAt = -1, prev = '', later = 0, kept = 0;
  DATE.lastIndex = 0;
  for (let m; (m = DATE.exec(body));) {
    const d = m[1];
    if (cutAt < 0) {
      if (d > cutoff) { cutAt = m.index; later++; }
      else { if (d <= prev) throw new Error('guard: rows not strictly ascending before the cutoff'); prev = d; kept++; }
    } else {
      later++;
      if (d <= cutoff) throw new Error('guard: unsorted file: a row dated <= cutoff appears after a later one');
    }
  }
  let text = cutAt < 0 ? body : body.slice(0, cutAt);
  text = text.replace(/[\s,]+$/, '');
  if (cutAt < 0) { const e = text.search(/\](?=\s*(?:\}|,\s*"))/); if (e >= 0) text = text.slice(0, e); } // file ends inside the cutoff: drop the array closing and any trailer
  const rows = JSON.parse('[' + text + ']');
  if (rows.length !== kept) throw new Error('guard: row count mismatch ' + rows.length + ' vs ' + kept);
  for (const r of rows) if (!(typeof r[0] === 'string' && r[0] <= cutoff)) throw new Error('guard: a row beyond the cutoff survived');
  let symbol = null; const sm = /"symbol"\s*:\s*"([^"]+)"/.exec(head); if (sm) symbol = sm[1];
  const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return {symbol, rows, digest, firstDate: rows[0]?.[0] ?? null, lastDate: rows.at(-1)?.[0] ?? null, laterRowCount: later, cutoff};
}
/** Close series [dates, opens, highs, lows, closes, volumes] with strict validation (no zero/NaN closes). */
export function toSeries(loaded) {
  const out = {dates: [], open: [], high: [], low: [], close: [], volume: []};
  for (const [d, o, h, l, c, v] of loaded.rows) {
    if (![o, h, l, c].every(x => Number.isFinite(x) && x > 0) || !Number.isFinite(v) || v < 0) continue; // dropped rows are counted by the caller
    out.dates.push(d); out.open.push(o); out.high.push(h); out.low.push(l); out.close.push(c); out.volume.push(v);
  }
  return out;
}
