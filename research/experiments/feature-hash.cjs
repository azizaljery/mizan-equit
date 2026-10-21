#!/usr/bin/env node
'use strict';
/**
 * feature-hash.cjs — canonical feature definitions and their sha256 "definition hash".
 *   usage: node research/experiments/feature-hash.cjs            # print table (JSON)
 *          node research/experiments/feature-hash.cjs --verify   # also check FEATURE_DEFINITION_HASH in mizan-v45/lib/daily-picks-universe.ts
 *
 * Canonical string (version "mizan-feature-def/v1"):
 *   line 1 : "mizan-feature-def/v1"
 *   then one line per field in FIELD_ORDER, formatted "<field>=<value>" (value = String(value), no trimming beyond what is
 *   written here), lines joined with "\n" (LF), no trailing newline, UTF-8. hash = sha256(canonical) as lowercase hex.
 * Any change to ANY field (formula, lags, gate, selection rule, tie-break...) yields a new hash => a new feature id/version.
 * Pure: reads no price data. Documented in research/FEATURE-DEFINITIONS.md.
 */
const crypto = require('crypto');

const CANON_VERSION = 'mizan-feature-def/v1';
const FIELD_ORDER = ['id', 'formula', 'num_lag', 'den_lag', 'span_sessions', 'min_closes_formula', 'eligibility_gate', 'data_rule',
  'rank_direction', 'selection_rule', 'tie_break'];

const DEFS = [
  {
    id: 'mom126_5@negsel-v1',
    formula: 'ln(P[t-5]/P[t-126])',
    num_lag: 5, den_lag: 126, span_sessions: 121, min_closes_formula: 127,
    eligibility_gate: 'row index i>=252 and c[i-199..i],c[i-5],c[i-21],c[i-126],c[i-252] finite>0; universe: >=260 clean rows at t',
    data_rule: 'clean rows <= t only; P = unadjusted provider close as stored',
    rank_direction: 'desc',
    selection_rule: 'floor(0.2N)',
    tie_break: 'symbol asc',
  },
  {
    id: 'mom126_5@ledger-v1',
    formula: 'P[t-5]/P[t-131]-1',
    num_lag: 5, den_lag: 131, span_sessions: 126, min_closes_formula: 132,
    eligibility_gate: '>=132 valid closes <= pick_date and a valid close ON pick_date',
    data_rule: 'valid closes <= t only (one per date, first kept)',
    rank_direction: 'desc',
    selection_rule: 'ceil(0.2N)',
    tie_break: 'symbol asc',
  },
  {
    id: 'trend50_200@negsel-v1',
    formula: 'ln(SMA50(P)[t]/SMA200(P)[t])',
    num_lag: 0, den_lag: 199, span_sessions: 200, min_closes_formula: 200,
    eligibility_gate: 'same as mom126_5@negsel-v1 (joint featuresAt gate)',
    data_rule: 'clean rows <= t only',
    rank_direction: 'n/a (model input / composite rank)',
    selection_rule: 'n/a',
    tie_break: 'n/a',
  },
  {
    id: 'mom252_21@negsel-v1',
    formula: 'ln(P[t-21]/P[t-252])',
    num_lag: 21, den_lag: 252, span_sessions: 231, min_closes_formula: 253,
    eligibility_gate: 'same as mom126_5@negsel-v1 (joint featuresAt gate)',
    data_rule: 'clean rows <= t only',
    rank_direction: 'n/a (model input / composite rank)',
    selection_rule: 'n/a',
    tie_break: 'n/a',
  },
  {
    id: 'rev5@dir0001-v1',
    formula: 'ln(P[t]/P[t-5])',
    num_lag: 0, den_lag: 5, span_sessions: 5, min_closes_formula: 6,
    eligibility_gate: 'i>=63 and c[i-63..i] finite>0; universe: >=260 clean rows at t',
    data_rule: 'clean rows <= t only',
    rank_direction: 'n/a (model input)',
    selection_rule: 'n/a',
    tie_break: 'n/a',
  },
  {
    id: 'vol63@dir0001-v1',
    formula: 'sd_sample(ln(P[k]/P[k-1]), k=t-62..t)',
    num_lag: 0, den_lag: 63, span_sessions: 63, min_closes_formula: 64,
    eligibility_gate: 'i>=63 and c[i-63..i] finite>0; universe: >=260 clean rows at t',
    data_rule: 'clean rows <= t only',
    rank_direction: 'n/a (model input)',
    selection_rule: 'n/a',
    tie_break: 'n/a',
  },
];

function canonicalString(def) {
  const lines = [CANON_VERSION];
  for (const k of FIELD_ORDER) {
    if (!(k in def)) throw new Error(`missing field ${k} in ${def.id}`);
    const v = String(def[k]);
    if (/[\n\r]/.test(v)) throw new Error(`newline in ${def.id}.${k}`);
    lines.push(`${k}=${v}`);
  }
  return lines.join('\n');
}
const definitionHash = (def) => crypto.createHash('sha256').update(canonicalString(def), 'utf8').digest('hex');

module.exports = {CANON_VERSION, FIELD_ORDER, DEFS, canonicalString, definitionHash};

if (require.main === module) {
  const out = DEFS.map((d) => ({id: d.id, formula: d.formula, selection_rule: d.selection_rule, sha256: definitionHash(d)}));
  console.log(JSON.stringify(out, null, 1));
  if (process.argv.includes('--verify')) {
    const fs = require('fs'), path = require('path');
    const ts = fs.readFileSync(path.join(__dirname, '..', '..', 'mizan-v45', 'lib', 'daily-picks-universe.ts'), 'utf8');
    const m = ts.match(/FEATURE_DEFINITION_HASH\s*=\s*'([0-9a-f]{64})'/);
    const want = definitionHash(DEFS.find((d) => d.id === 'mom126_5@ledger-v1'));
    if (!m || m[1] !== want) { console.error(`VERIFY FAILED: daily-picks-universe.ts has ${m ? m[1] : 'no hash'}, expected ${want}`); process.exit(1); }
    console.error('VERIFY OK: FEATURE_DEFINITION_HASH matches mom126_5@ledger-v1');
  }
}
