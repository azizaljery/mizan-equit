#!/usr/bin/env node
/**
 * EXP-0004 — volatility-scaled neutral band (an EXPERIMENT, not an accuracy fix).
 * usage: node vol-band.cjs <replay.json> [trainFraction=0.6]
 * Rule under test: direction = up if e > k*sigma*sqrt(h), down if e < -k*sigma*sqrt(h), else neutral
 *   (e = model expectedChangePct %, sigma = point-in-time daily sigma %, h = horizon sessions). k=0 means pure sign.
 * Baseline (current production rule): the model's own direction/neutral band — kept side by side.
 * Per horizon x market x k, TEST period only (chronological split, no k tuning on test):
 *   coverage, up/neutral/down shares, hit rate on non-neutral calls vs MATCHED base rate (share of up moves in that subset)
 *   and vs the majority baseline, Wilson CI on an effective n (overlap-corrected), "live-style" accuracy vs the BEST trivial
 *   baseline under the same band (a wider band alone raises live-style accuracy trivially, so only the lift counts),
 *   IC (Spearman, independent of k), hit rate by |z| tercile (calibration proxy).
 */
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((r) => ({sym: r[0], mkt: r[1], date: r[2], h: r[3], avail: r[4] === 1, dir: r[5], e: r[6], thr: r[7], act: r[9], sig: r[10]}))
  .filter((r) => r.avail && Number.isFinite(r.e) && Number.isFinite(r.act) && Number.isFinite(r.sig) && r.sig > 0);
const trainFrac = Number(process.argv[3] || 0.6), STEP = 5, KS = [0, 0.1, 0.25, 0.5, 0.75, 1.0];
const dates = [...new Set(rows.map((r) => r.date))].sort(), cut = dates[Math.floor(dates.length * trainFrac)];
const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - s) / d).toFixed(1), +(100 * (c + s) / d).toFixed(1)]; };
const pct = (k, n) => (n ? +(100 * k / n).toFixed(1) : null);
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const av = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = av; i = j + 1; } return r; };
const spearman = (x, y) => { if (x.length < 30) return null; const a = rank(x), b = rank(y), n = x.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return +(sab / Math.sqrt(saa * sbb)).toFixed(4); };
const dirBand = (v, t) => (v > t ? 'U' : v < -t ? 'D' : 'N');
const legacy = (d) => (d === 'صاعد' ? 'U' : d === 'هابط' ? 'D' : 'N');

function evaluate(set, h, band /* r => threshold % */, predict /* r => 'U'|'D'|'N' */) {
  const n = set.length, eff = Math.max(1, Math.round(n / Math.max(1, h / STEP)));
  const cls = {U: 0, D: 0, N: 0}; let liveOk = 0; const base = {U: 0, D: 0, N: 0}; const nn = [];
  for (const r of set) {
    const p = predict(r), a = dirBand(r.act, band(r)); cls[p]++; base[a]++; if (p === a) liveOk++;
    if (p !== 'N') nn.push({hit: (p === 'U') === (r.act > 0), up: r.act > 0, p});
  }
  const hit = nn.filter((x) => x.hit).length, upInSub = nn.filter((x) => x.up).length;
  const matchedBase = nn.length ? Math.max(upInSub, nn.length - upInSub) / nn.length * 100 : null; // best constant-direction guess on the same subset
  const scale = nn.length ? eff / n : 0;
  const bestTrivialLive = Math.max(base.U, base.D, base.N);
  return {n, nEff: eff, coveragePct: pct(nn.length, n), sharePct: {up: pct(cls.U, n), neutral: pct(cls.N, n), down: pct(cls.D, n)},
    nonNeutral: nn.length, hitRatePct: pct(hit, nn.length), hitWilson95_onNeff: nn.length ? wilson(Math.round(hit * scale), Math.max(1, Math.round(nn.length * scale))) : [null, null],
    matchedBaseRatePct: matchedBase === null ? null : +matchedBase.toFixed(1), liftVsMatchedBasePts: matchedBase === null ? null : +((100 * hit / nn.length) - matchedBase).toFixed(1),
    liveStyleAccuracyPct: pct(liveOk, n), bestTrivialLiveBaselinePct: pct(bestTrivialLive, n), liveStyleLiftPts: +(100 * (liveOk - bestTrivialLive) / n).toFixed(1)};
}
const out = {experiment: 'EXP-0004', cut, trainFraction: trainFrac, ks: KS, note: 'test-only metrics; baseline = production rule; no k is tuned on test', results: []};
for (const h of [1, 5, 21, 63]) for (const mkt of ['all', 'sa', 'us']) {
  const all = rows.filter((r) => r.h === h && (mkt === 'all' || r.mkt === mkt)), test = all.filter((r) => r.date >= cut), train = all.filter((r) => r.date < cut);
  if (test.length < 100) continue;
  const entry = {horizon: h, market: mkt, nTest: test.length, nTrain: train.length, ic: {train: spearman(train.map((r) => r.e), train.map((r) => r.act)), test: spearman(test.map((r) => r.e), test.map((r) => r.act))}, baselineTestBaseRateUpPct: pct(test.filter((r) => r.act > 0).length, test.length)};
  entry.production = evaluate(test, h, (r) => r.thr, (r) => legacy(r.dir));
  entry.production.trainShareNeutralPct = pct(train.filter((r) => legacy(r.dir) === 'N').length, train.length);
  entry.byK = {};
  for (const k of KS) {
    const bandOf = (r) => k * r.sig * Math.sqrt(h);
    const ev = evaluate(test, h, bandOf, (r) => dirBand(r.e, bandOf(r)));
    ev.trainCoveragePct = pct(train.filter((r) => dirBand(r.e, bandOf(r)) !== 'N').length, train.length);
    entry.byK[k] = ev;
  }
  // calibration proxy: sign hit-rate by |z| tercile (cutoffs from TRAIN)
  const z = (r) => Math.abs(r.e) / (r.sig * Math.sqrt(h)), tz = train.map(z).sort((a, b) => a - b);
  if (tz.length > 30) {
    const q = [tz[Math.floor(tz.length / 3)], tz[Math.floor(2 * tz.length / 3)]];
    const bins = [[0, q[0]], [q[0], q[1]], [q[1], Infinity]];
    entry.calibrationByAbsZTercile = bins.map(([lo, hi], i) => { const s = test.filter((r) => z(r) >= lo && z(r) < hi && r.e !== 0), ok = s.filter((r) => (r.e > 0) === (r.act > 0)).length; return {tercile: i + 1, n: s.length, hitRatePct: pct(ok, s.length)}; });
  }
  out.results.push(entry);
}
console.log(JSON.stringify(out));
