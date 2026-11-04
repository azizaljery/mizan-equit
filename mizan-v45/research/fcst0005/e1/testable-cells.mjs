// FCST-0005 E1: mechanical, pre-specified mapping from an ACTUAL coverage report to the testable-cell table. No judgement, no design change.
// Rule: market start = the MEDIAN firstDate of the symbols of that market with status 'ok' (clamped to >= 1995-01-01); symbols that start later enter from their own start.
// A cell is 'testable' iff (a) >= 60 non-overlapping test periods after the split rule and (b) joint power >= 80% at a true 1.5% improvement in the MODERATE case; the SEVERE case is printed beside it.
// usage: node testable-cells.mjs <coverage-report.json> <variance.json> <stage1.json> <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {H, MK, cell} from './power-core.mjs';
export function medianStart(records, market) {
  const d = records.filter(r => r.status === 'ok' && (r.symbol.endsWith('.SR') === (market === 'sa'))).map(r => r.firstDate).sort(); if (!d.length) return null;
  const med = d[Math.floor(d.length / 2)]; return Math.max(Date.parse(med + 'T00:00:00Z'), Date.UTC(1995, 0, 1));
}
export function cellsFromCoverage(report, planNoise, spy) {
  const out = {};
  for (const m of MK) { const start = medianStart(report.records, m); for (const h of H) out[`${m}/${h}`] = start === null ? {status: 'no coverage for this market'} : {startDate: new Date(start).toISOString().slice(0, 10), ...cell(start, spy[m], h, planNoise[`${m}/${h}`])}; }
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , covPath, varPath, stagePath, outPath] = process.argv, V = JSON.parse(readFileSync(varPath, 'utf8')), R = JSON.parse(readFileSync(stagePath, 'utf8'));
  const years = (Date.parse('2024-09-04') - Date.parse('2019-10-14')) / 864e5 / 365.25, spy = {};
  for (const m of MK) { const rows = R.manifest.filter(f => f.file.endsWith('.SR.json') === (m === 'sa')).map(f => f.rows).sort((a, b) => a - b); spy[m] = rows[Math.floor(rows.length / 2)] / years; }
  const res = cellsFromCoverage(JSON.parse(readFileSync(covPath, 'utf8')), Object.fromEntries(Object.entries(V.plan).map(([k, v]) => [k, {n: v.n, sePlan: v.sePlan}])), spy);
  writeFileSync(outPath, JSON.stringify(res, null, 1)); for (const [k, v] of Object.entries(res)) console.log(k, v.startDate ?? '-', v.nonOverlap ?? '-', v.status);
}
