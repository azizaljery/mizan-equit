#!/usr/bin/env node
/** usage: node analyze-direction.cjs <replay.json> [trainFraction=0.6]  — chronological split, no look-ahead; prints JSON + readable tables. */
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((r) => ({sym: r[0], mkt: r[1], date: r[2], h: r[3], avail: r[4] === 1, dir: r[5], exp: r[6], thr: r[7], conf: r[8], act: r[9], sig: r[10]}));
const trainFrac = Number(process.argv[3] || 0.6), STEP = 5;
const dates = [...new Set(rows.map((r) => r.date))].sort(), cut = dates[Math.floor(dates.length * trainFrac)];
const dirOf = (c, t) => (c > t ? 'صاعد' : c < -t ? 'هابط' : 'محايد');
const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [100 * (c - s) / d, 100 * (c + s) / d]; };
const pct = (k, n) => (n ? +(100 * k / n).toFixed(1) : null);
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const av = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = av; i = j + 1; } return r; };
const spearman = (x, y) => { if (x.length < 30) return null; const a = rank(x), b = rank(y), n = x.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return +(sab / Math.sqrt(saa * sbb)).toFixed(4); };
const out = {cut, trainFrac, horizons: {}};
for (const h of [1, 5, 21, 63]) {
  const all = rows.filter((r) => r.h === h && r.avail && r.exp !== null);
  const eff = (n) => Math.round(n / Math.max(1, h / STEP));
  const res = {};
  for (const [label, set] of [['train', all.filter((r) => r.date < cut)], ['test', all.filter((r) => r.date >= cut)]]) {
    const n = set.length, cls = {up: 0, down: 0, flat: 0};
    let liveOk = 0, upOk = 0, flatOk = 0;
    for (const r of set) {
      const actualDir = dirOf(r.act, r.thr), d = r.dir;
      cls[d === 'صاعد' ? 'up' : d === 'هابط' ? 'down' : 'flat']++;
      if (d === actualDir) liveOk++; if (actualDir === 'صاعد') upOk++; if (actualDir === 'محايد') flatOk++;
    }
    const nn = set.filter((r) => r.dir !== 'محايد'), nnOk = nn.filter((r) => (r.dir === 'صاعد') === (r.act > 0)).length;
    const signAll = set.filter((r) => r.exp !== 0), signOk = signAll.filter((r) => (r.exp > 0) === (r.act > 0)).length, baseUp = set.filter((r) => r.act > 0).length;
    const ic = spearman(set.map((r) => r.exp), set.map((r) => r.act));
    // volatility-normalised score
    const z = set.map((r) => (r.sig > 0 ? r.exp / (r.sig * Math.sqrt(h)) : 0));
    res[label] = {n, nEffApprox: eff(n), share: {up: pct(cls.up, n), down: pct(cls.down, n), neutral: pct(cls.flat, n)},
      liveDirectionAccuracy: pct(liveOk, n), baselineAlwaysUp_live: pct(upOk, n), baselineAlwaysNeutral_live: pct(flatOk, n),
      nonNeutralCalls: nn.length, nonNeutralHitRate: pct(nnOk, nn.length), nonNeutralWilson95: wilson(nnOk, nn.length).map((v) => v && +v.toFixed(1)),
      signOnlyHitRate_allRows: pct(signOk, signAll.length), baseRateUp: pct(baseUp, n), spearmanIC: ic, zStd: +Math.sqrt(z.reduce((a, b) => a + b * b, 0) / (z.length || 1)).toFixed(4)};
  }
  // selective abstention: cutoffs from TRAIN quantiles of |z|, applied to TEST
  const trainSet = all.filter((r) => r.date < cut && r.sig > 0), testSet = all.filter((r) => r.date >= cut && r.sig > 0);
  const zOf = (r) => Math.abs(r.exp / (r.sig * Math.sqrt(h)));
  const tz = trainSet.map(zOf).sort((a, b) => a - b);
  res.selective = [];
  for (const keep of [1, 0.5, 0.3, 0.2, 0.1, 0.05]) {
    const c = tz.length ? tz[Math.min(tz.length - 1, Math.floor(tz.length * (1 - keep)))] : Infinity, sel = testSet.filter((r) => zOf(r) >= c);
    const ok = sel.filter((r) => (r.exp > 0) === (r.act > 0)).length, up = sel.filter((r) => r.act > 0).length, predUp = sel.filter((r) => r.exp > 0).length;
    res.selective.push({keep, cutoffZ: +c.toFixed(4), nTest: sel.length, nEffApprox: eff(sel.length), hitRate: pct(ok, sel.length), wilson95: wilson(ok, sel.length).map((v) => v && +v.toFixed(1)),
      baseRateUpInSubset: pct(up, sel.length), sharePredictedUp: pct(predUp, sel.length)});
  }
  out.horizons[h] = res;
}
// per-market live accuracy on test
out.byMarketTest = {};
for (const m of ['sa', 'us']) for (const h of [1, 5, 21, 63]) {
  const s = rows.filter((r) => r.mkt === m && r.h === h && r.avail && r.date >= cut), ok = s.filter((r) => r.dir === dirOf(r.act, r.thr)).length;
  out.byMarketTest[`${m}-${h}`] = {n: s.length, liveAccuracy: pct(ok, s.length), neutralShare: pct(s.filter((r) => r.dir === 'محايد').length, s.length), upShare: pct(s.filter((r) => r.dir === 'صاعد').length, s.length)};
}
// realised market drift in the test period (so a reader sees if the sample is a bull/bear window)
out.testPeriodBaseRateUp = {}; for (const h of [1, 5, 21, 63]) { const s = rows.filter((r) => r.h === h && r.date >= cut); out.testPeriodBaseRateUp[h] = pct(s.filter((r) => r.act > 0).length, s.length); }
console.log(JSON.stringify(out, null, 1));
