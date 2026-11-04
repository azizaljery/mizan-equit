// FCST-0005 E1 DRAFT manifest: fingerprints of every source file the E1 evaluation would execute (transitive relative imports from the roots),
// plus the frozen-parameter values read from the modules themselves. A DRAFT is not a freeze: any later edit changes a file hash and
// invalidates it; the freeze commit must regenerate and re-record this file.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, relative} from 'node:path';
import * as C from '../candidate.mjs';
import * as R from '../runner.mjs';

const APP = resolve(new URL('../../..', import.meta.url).pathname), HERE = resolve(new URL('..', import.meta.url).pathname);
const roots = ['candidate.mjs', 'runner.mjs', 'dev-input-guard.mjs', 'engine-bias.ts', 'run-c.ts'].map(f => resolve(HERE, f));
const EXT = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts'];
const seen = new Map();
function visit(file) {
  if (seen.has(file)) return; const text = readFileSync(file, 'utf8'); seen.set(file, text);
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), m[1]); const hit = EXT.map(e => base + e).find(p => existsSync(p) && !p.endsWith('/') && /\.(ts|tsx|mjs|js)$/.test(p));
    if (hit) visit(hit); else if (!/\.(json|css)$/.test(m[1])) throw new Error('unresolved import ' + m[1] + ' in ' + file);
  }
}
roots.forEach(visit);
const git = (...a) => execFileSync('git', ['-C', APP, ...a]).toString().trim();
const files = [...seen.entries()].map(([f, t]) => ({path: relative(resolve(APP, '..'), f), sha256: createHash('sha256').update(t).digest('hex'), gitBlob: git('hash-object', f), bytes: Buffer.byteLength(t)})).sort((a, b) => a.path < b.path ? -1 : 1);
const aggregate = createHash('sha256').update(files.map(f => f.path + ':' + f.sha256).join('\n')).digest('hex');
const engine = readFileSync(resolve(HERE, 'engine-bias.ts'), 'utf8');
const out = {status: 'DRAFT — not a freeze; regenerate and record at the freeze commit', baseCommit: git('rev-parse', 'HEAD'), workingTreeClean: git('status', '--porcelain', '--', '.').length === 0,
  roots: roots.map(f => relative(resolve(APP, '..'), f)), fileCount: files.length, aggregateSha256: aggregate, files,
  frozenParameters: {kappa: C.KAPPA, delta: C.DELTA, horizonsRun: R.RUN_HORIZONS, models: R.MODELS, familyM_protocol: R.FAMILY_M, seeds: R.SEEDS, bootstrapB: R.B_DEFAULT,
    engineWindowSessions: +/WINDOW\s*=\s*(\d+)/.exec(engine)[1], features: ['mom126_5 = ln(C[t-5]/C[t-126])', 'trend50_200 = ln(SMA50/SMA200)', 'mom252_21 = ln(C[t-21]/C[t-252])'], featureWarmupSessions: 252,
    scale: 'S = sigma63 * sqrt(h), sigma63 = sample sd of the last 63 daily log returns', target: 'z = ln(C[t+h]/C[t]) / S, estimand = conditional median, loss = pinball(0.5) = NAE', ladIrls: {eps: 1e-6, iters: 200},
    retrain: 'once per calendar year; training rows need target index <= firstTestIndex - h - 1 (purge plus gap of h sessions); at least 30*h training dates', blockRule: 'max(ceil(h/gridStep), first autocorrelation lag with |rho| < 0.1, capped at 20)'},
  candidates: {Q0: 'kappa * weighted median of z (no features)', Q1: 'kappa * LAD(z ~ 1 + standardised 3 features), fitted per horizon', Q2: 'kappa * sqrt(h) * LAD on pooled horizons 1,5,21 (one coefficient set)', QE: 'kappa * LAD(z ~ 1 + engine bias) where bias is the production price-only bias',
    references: {R0: 'zero centre', C_pub: 'production centre (researchFactors + forecastWeights + adjustedWeights + scenarioCenter) on price-only historical reports'}}};
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(out.fileCount, 'files', out.aggregateSha256, 'clean=' + out.workingTreeClean);
