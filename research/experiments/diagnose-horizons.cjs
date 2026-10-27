#!/usr/bin/env node
'use strict';
/** Reproducible trace of the 9 owner symbols: one input snapshot (research-data prices cut at DEV_CUTOFF, last origin), real engine, all six horizons.
 *  usage: node diagnose-horizons.cjs <built-lib-dir> <prices-dir> <out.json> */
const fs = require('fs'), path = require('path');
const N = require('./negsel-lib.cjs'), F = require('./fcst-lib.cjs');
const [, , libDir, priceDir, outFile] = process.argv;
const {forecasts} = require(path.resolve(libDir, 'lib/research-model'));
const {DEFAULT_SETTINGS} = require(path.resolve(libDir, 'lib/site-settings'));
const SYMS = ['1120.SR', '2010.SR', '7010.SR', '1180.SR', '2222.SR', '2280.SR', 'AAPL', 'MSFT', 'NVDA'];
const H = F.HORIZONS.map((s) => ({name: 'h' + s, sessions: s}));
const out = [];
for (const sym of SYMS) {
  const d = JSON.parse(fs.readFileSync(path.join(priceDir, sym + '.json'), 'utf8'));
  const prices = N.cutRows(d.rows, F.DEV_CUTOFF).map((r) => ({date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5]}));
  const o = prices.length - 1, asOf = prices[o].date, c = prices.map((p) => p.close), sig = F.sigma63(c, o), market = sym.endsWith('.SR') ? 'sa' : 'us';
  const slice = {company: {symbol: sym, name: sym, exchange: market === 'sa' ? 'SAU' : 'NMS', instrument: 'EQUITY'}, asOf, retrievedAt: asOf + 'T20:00:00Z', prices, priceSource: 'research-data', quoteTime: null,
    currency: d.currency, facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical', context: {market: null, sector: null}};
  const rows = forecasts(slice, null, Date.parse(asOf + 'T20:00:00Z'), DEFAULT_SETTINGS, H).rows;
  rows.forEach((r, i) => {
    const h = F.HORIZONS[i], dg = r.diagnostics || {}, ce = dg.center || {}, rg = dg.range || {}, S = F.scale(sig, h);
    out.push({symbol: sym, asOf, sessions: prices.length, source: d.symbol && 'research-data/prices', h, reference: rg.reference ?? c[o], state: dg.state, abstain: r.abstainReason ?? null,
      annualLogTilt: ce.annualLogTilt ?? null, requestedLogReturn: ce.requestedLogReturn ?? null, clippedLogReturn: ce.clippedLogReturn ?? null, centerLogReturn: ce.centerLogReturn ?? null,
      clipped: ce.clipped ?? null, maxAbsLogReturn: ce.maxAbsLogReturn ?? null, S: +S.toFixed(5), centerOverS: ce.centerLogReturn != null ? +(ce.centerLogReturn / S).toFixed(4) : null,
      expectedChangePct: r.expectedChangePct ?? null, neutralThresholdPct: r.neutralThresholdPct ?? null, direction: r.direction ?? null, low: rg.low ?? null, high: rg.high ?? null,
      halfWidthOverS: rg.low ? +(Math.log(rg.high / rg.low) / 2 / S).toFixed(3) : null, warnings: r.warnings ?? [], shockWarning: r.shockWarning ?? null});
  });
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const r of out) console.log([r.symbol, r.h, r.reference, 'tilt', r.annualLogTilt?.toFixed(4), 'req', r.requestedLogReturn?.toFixed(5), 'clip', r.clipped, 'ctr', r.centerLogReturn?.toFixed(5), 'ctr/S', r.centerOverS, 'chg%', r.expectedChangePct, 'neut%', r.neutralThresholdPct, 'dir', r.direction, 'hw/S', r.halfWidthOverS, r.state].join(' '));
