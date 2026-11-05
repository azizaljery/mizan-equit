// FCST-0005 E1 PLANNING over assumed history starts (no price data read). usage: node design.mjs <stage1.json> <variance.json> <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {H, MK, M_FAMILY, N_SIM, SEED, C_CRIT, CASES, THETA, TARGET, cell} from './power-core.mjs';
const [, , stage1Path, varPath, outPath] = process.argv;
const R = JSON.parse(readFileSync(stage1Path, 'utf8')), V = JSON.parse(readFileSync(varPath, 'utf8'));
const years = (Date.parse('2024-09-04') - Date.parse('2019-10-14')) / 864e5 / 365.25, spy = {};
for (const m of MK) { const rows = R.manifest.filter(f => f.file.endsWith('.SR.json') === (m === 'sa')).map(f => f.rows).sort((a, b) => a - b); spy[m] = rows[Math.floor(rows.length / 2)] / years; }
const noise = Object.fromEntries(Object.entries(V.plan).map(([k, v]) => [k, {n: v.n, sePlan: v.sePlan, from: v.from, seBoot: v.seBoot, seNW: v.seNW, maxYearRatio: v.maxYearRatio}]));
const SCEN = {V_only_2015: Date.UTC(2015, 0, 1), A_plus_V_2010: Date.UTC(2010, 0, 1), A_plus_V_2005: Date.UTC(2005, 0, 1)};
const out = {kind: 'planning only; noise = max(block-bootstrap, Newey-West) on the development slice C; no earlier data read; powers are model-based estimates, not guarantees', familyM: M_FAMILY, critZ: C_CRIT, nSim: N_SIM, seed: SEED, cases: CASES, thetaGrid: THETA, target: TARGET, sessionsPerYear: spy, noise, scenarios: {}};
for (const [name, start] of Object.entries(SCEN)) { out.scenarios[name] = {}; for (const m of MK) for (const h of H) out.scenarios[name][`${m}/${h}`] = cell(start, spy[m], h, noise[`${m}/${h}`]); }
writeFileSync(outPath, JSON.stringify(out, null, 1));
for (const [n, s] of Object.entries(out.scenarios)) { console.log(n); for (const [k, v] of Object.entries(s)) console.log(' ', k, `no=${v.nonOverlap} P1.5 opt/mod/sev=${['optimistic', 'moderate', 'severe'].map(c => (100 * v.grid[c]['power_0.015']).toFixed(0)).join('/')} ${v.status}`); }
