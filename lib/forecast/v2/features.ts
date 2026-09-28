/**
 * هندسة الميزات — 48 علنية + 12 سرية.
 * server-only. لا تُصدَّر إلى العميل.
 */

import type { FeatureVector, ForecastInput, PriceBar } from './types';

// ═══════════════════════════════════════════════════════════════
// أدوات حسابية داخلية
// ═══════════════════════════════════════════════════════════════

const closes = (bars: PriceBar[]): number[] => bars.map((b) => b.close);
const highs = (bars: PriceBar[]): number[] => bars.map((b) => b.high);
const lows = (bars: PriceBar[]): number[] => bars.map((b) => b.low);
const volumes = (bars: PriceBar[]): number[] => bars.map((b) => b.volume);

function returns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    out.push(series[i] / series[i - 1] - 1);
  }
  return out;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = mean(arr);
  const s = std(arr);
  if (s === 0) return 0;
  const n = arr.length;
  return (n / ((n - 1) * (n - 2))) * arr.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0);
}

function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0;
  const m = mean(arr);
  const s = std(arr);
  if (s === 0) return 0;
  const n = arr.length;
  return (
    (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) *
    arr.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0)
  ) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

function sma(series: number[], window: number): number | null {
  if (series.length < window) return null;
  return mean(series.slice(-window));
}

function ema(series: number[], window: number): number {
  if (series.length < window) return series[series.length - 1] ?? 0;
  const k = 2 / (window + 1);
  let e = mean(series.slice(0, window));
  for (let i = window; i < series.length; i++) {
    e = series[i] * k + e * (1 - k);
  }
  return e;
}

/** سلسلة EMA كاملة عبر الزمن — لازمة لبناء خط MACD ثم إشارته. */
function emaSeries(series: number[], window: number): number[] {
  if (!series.length) return [];
  const k = 2 / (window + 1);
  const seed = Math.min(window, series.length);
  let e = mean(series.slice(0, seed));
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < seed) {
      out.push(e);
      continue;
    }
    e = series[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(series: number[], window = 14): number {
  if (series.length < window + 1) return 50;
  const diffs: number[] = [];
  for (let i = 1; i < series.length; i++) diffs.push(series[i] - series[i - 1]);
  const recent = diffs.slice(-window);
  let gain = 0;
  let loss = 0;
  for (const d of recent) {
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= window;
  loss /= window;
  if (loss === 0 && gain === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(bars: PriceBar[], window = 14): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return mean(trs.slice(-window));
}

/**
 * MACD قياسي: الخط = EMA12 - EMA26، والإشارة = EMA9 على سلسلة الخط.
 * الإشارة تحتاج سلسلة الخط عبر الزمن، لا رقمه النهائي فقط.
 */
function macd(series: number[]): { line: number; signal: number; hist: number } {
  if (series.length < 26) return { line: 0, signal: 0, hist: 0 };
  const e12 = emaSeries(series, 12);
  const e26 = emaSeries(series, 26);
  const lineSeries = series.map((_, i) => e12[i] - e26[i]);
  const signalSeries = emaSeries(lineSeries, 9);
  const line = lineSeries[lineSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  return { line, signal, hist: line - signal };
}

function linearSlope(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(series);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (series[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const aa = a.slice(-n);
  const bb = b.slice(-n);
  const ma = mean(aa);
  const mb = mean(bb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = aa[i] - ma;
    const xb = bb[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

// ═══════════════════════════════════════════════════════════════
// الميزات العلنية — 48
// ═══════════════════════════════════════════════════════════════

export function extractPublicFeatures(input: ForecastInput): {
  names: string[];
  values: number[];
} {
  const names: string[] = [];
  const values: number[] = [];

  const push = (name: string, value: number) => {
    names.push(name);
    values.push(Number.isFinite(value) ? value : 0);
  };

  const cs = closes(input.prices);
  const vs = volumes(input.prices);
  const rets = returns(cs);
  const last = cs[cs.length - 1] ?? 0;

  // 1-6: عوائد عبر 6 نوافذ
  for (const w of [1, 5, 21, 63, 126, 252]) {
    const past = cs[cs.length - 1 - w] ?? cs[0] ?? 1;
    push(`ret_${w}d`, last / past - 1);
  }

  // 7-10: تذبذب عبر 4 نوافذ
  for (const w of [5, 21, 63, 252]) {
    const r = rets.slice(-w);
    push(`vol_${w}d`, std(r) * Math.sqrt(252));
  }

  // 11-12: تشكيل
  push('skew_21d', skewness(rets.slice(-21)));
  push('kurt_21d', kurtosis(rets.slice(-21)));

  // 13-14: نسبة SMA
  const s50 = sma(cs, 50);
  const s200 = sma(cs, 200);
  push('sma50_rel', s50 ? last / s50 - 1 : 0);
  push('sma200_rel', s200 ? last / s200 - 1 : 0);

  // 15-18: تقنية
  push('atr14_rel', last > 0 ? atr(input.prices, 14) / last : 0);
  push('rsi14', rsi(cs, 14) / 100);
  const m = macd(cs);
  push('macd_rel', last > 0 ? m.line / last : 0);
  push('macd_hist_rel', last > 0 ? m.hist / last : 0);

  // 19-21: نسبة الحجم
  for (const w of [5, 20, 60]) {
    const recent = vs.slice(-w);
    const baseline = vs.slice(-w * 3, -w);
    const r = mean(recent);
    const b = mean(baseline);
    push(`vr_${w}d`, b > 0 ? r / b : 1);
  }

  // 22-23: انحراف الحجم-السعر
  const rv5 = rets.slice(-5);
  const vv5 = returns(vs).slice(-5);
  push('vol_diverge_5d', correlation(rv5, vv5));
  const rv20 = rets.slice(-20);
  const vv20 = returns(vs).slice(-20);
  push('vol_diverge_20d', correlation(rv20, vv20));

  // 24-25
  push('turnover_log', Math.log(Math.max(1, mean(vs.slice(-20)))));
  push('vol_trend_20d', linearSlope(vs.slice(-20)) / Math.max(1, mean(vs.slice(-20))));

  // 26: حجم غير طبيعي
  const recentV = vs[vs.length - 1] ?? 0;
  push('abnormal_vol', mean(vs.slice(-20)) > 0 ? recentV / mean(vs.slice(-20)) : 1);

  // 27-32: بنية الشمعة
  const lastBar = input.prices[input.prices.length - 1];
  if (lastBar) {
    const range = lastBar.high - lastBar.low;
    const a = atr(input.prices);
    push('range_atr', a > 0 ? range / a : 0);
    push('upper_shadow', range > 0 ? (lastBar.high - Math.max(lastBar.open, lastBar.close)) / range : 0);
    push('lower_shadow', range > 0 ? (Math.min(lastBar.open, lastBar.close) - lastBar.low) / range : 0);
    push('body_ratio', range > 0 ? Math.abs(lastBar.close - lastBar.open) / range : 0);

    let gaps = 0;
    let dojis = 0;
    for (let i = Math.max(1, input.prices.length - 20); i < input.prices.length; i++) {
      const b = input.prices[i];
      const prev = input.prices[i - 1];
      if (prev && Math.abs(b.open / prev.close - 1) > 0.005) gaps++;
      const br = b.high - b.low;
      if (br > 0 && Math.abs(b.close - b.open) / br < 0.1) dojis++;
    }
    push('gap_freq20', gaps / 20);
    push('doji_freq20', dojis / 20);
  } else {
    push('range_atr', 0);
    push('upper_shadow', 0);
    push('lower_shadow', 0);
    push('body_ratio', 0);
    push('gap_freq20', 0);
    push('doji_freq20', 0);
  }

  // 33-42: النظراء والقطاع
  const benchCloses = closes(input.context.benchmark);
  const benchRets = returns(benchCloses);

  push('sector_beta', computeBeta(rets, benchRets, 60));
  push('bench_corr20', correlation(rets.slice(-20), benchRets.slice(-20)));
  push('bench_corr60', correlation(rets.slice(-60), benchRets.slice(-60)));

  for (const w of [5, 20, 60]) {
    const myR = rets.slice(-w).reduce((a, b) => a + b, 0);
    const bR = benchRets.slice(-w).reduce((a, b) => a + b, 0);
    push(`rel_strength_${w}d`, myR - bR);
  }

  if (input.context.peers?.length) {
    const peerRets = input.context.peers.map((p) => {
      const c = closes(p);
      return c.length > 1 ? c[c.length - 1] / c[c.length - 2] - 1 : 0;
    });
    push('peer_momentum', mean(peerRets));
    push('peer_dispersion', std(peerRets));
  } else {
    push('peer_momentum', 0);
    push('peer_dispersion', 0);
  }

  push('lead_lag', correlation(rets.slice(-1), benchRets.slice(-10)));
  push('cross_momentum', rets.slice(-21).reduce((a, b) => a + b, 0));

  // 43-48: السياق
  push('vix_level', input.context.vixLevel ?? 20);
  push('vix_proxy', rets.slice(-20).length > 0 ? std(rets.slice(-20)) * Math.sqrt(252) : 0);
  push('market_breadth', input.context.marketBreadth ?? 0.5);
  push('market_accel', linearSlope(benchRets.slice(-20)));
  push('market_trend', benchRets.slice(-21).reduce((a, b) => a + b, 0));

  // اتجاه القطاع من سلسلته الفعلية؛ صفر فقط عند غيابها.
  const sectorCloses = input.context.sector ? closes(input.context.sector) : [];
  const sectorRets = returns(sectorCloses);
  push('sector_trend', sectorRets.length ? sectorRets.slice(-21).reduce((a, b) => a + b, 0) : 0);

  return { names, values };
}

function computeBeta(assetRets: number[], benchRets: number[], window: number): number {
  const a = assetRets.slice(-window);
  const b = benchRets.slice(-window);
  const n = Math.min(a.length, b.length);
  if (n < 3) return 1;
  const aa = a.slice(-n);
  const bb = b.slice(-n);
  const ma = mean(aa);
  const mb = mean(bb);
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < n; i++) {
    cov += (aa[i] - ma) * (bb[i] - mb);
    varb += (bb[i] - mb) ** 2;
  }
  return varb === 0 ? 1 : cov / varb;
}

// ═══════════════════════════════════════════════════════════════
// الميزات السرية — 12
// ═══════════════════════════════════════════════════════════════
//
// تركيبات غير منشورة من الميزات العامة. تبقى داخل الخادم.

export function extractSecretFeatures(input: ForecastInput): {
  names: string[];
  values: number[];
} {
  const names: string[] = [];
  const values: number[] = [];
  const push = (name: string, value: number) => {
    names.push(name);
    values.push(Number.isFinite(value) ? value : 0);
  };

  const cs = closes(input.prices);
  const vs = volumes(input.prices);
  const rets = returns(cs);
  const last = cs[cs.length - 1] ?? 0;

  // S1: زخم مرجّح بالحجم مع تلاشٍ أسّي
  {
    let s = 0;
    let w = 0;
    for (let i = Math.max(1, cs.length - 63); i < cs.length; i++) {
      const r = cs[i] / cs[i - 1] - 1;
      const age = cs.length - i;
      const weight = Math.exp(-age / 21) * Math.log(1 + (vs[i] ?? 0));
      s += r * weight;
      w += weight;
    }
    push('s1', w > 0 ? s / w : 0);
  }

  // S2: نسبة تذبذب قصير إلى طويل
  {
    const recentVol = std(rets.slice(-10));
    const longVol = std(rets.slice(-60));
    push('s2', longVol > 0 ? recentVol / longVol : 1);
  }

  // S3: تماسك الزخم عبر الآفاق
  {
    const r5 = cs.length > 5 ? last / cs[cs.length - 6] - 1 : 0;
    const r21 = cs.length > 21 ? last / cs[cs.length - 22] - 1 : 0;
    const r63 = cs.length > 63 ? last / cs[cs.length - 64] - 1 : 0;
    const sign = Math.sign(r5) + Math.sign(r21) + Math.sign(r63);
    const mag = (Math.abs(r5) + Math.abs(r21) + Math.abs(r63)) / 3;
    push('s3', (sign * mag) / 3);
  }

  // S4: عدم تناسق ظلال الشموع
  {
    const bars = input.prices.slice(-20);
    let up = 0;
    let dn = 0;
    for (const b of bars) {
      const range = b.high - b.low;
      if (range === 0) continue;
      up += (b.high - Math.max(b.open, b.close)) / range;
      dn += (Math.min(b.open, b.close) - b.low) / range;
    }
    push('s4', up + dn > 0 ? (up - dn) / (up + dn) : 0);
  }

  // S5: انحراف السعر عن المتوسط المرجّح بالحجم
  {
    const w = input.prices.slice(-21);
    if (w.length) {
      let num = 0;
      let den = 0;
      for (const b of w) {
        num += b.close * b.volume;
        den += b.volume;
      }
      const vw = den > 0 ? num / den : last;
      push('s5', vw > 0 ? last / vw - 1 : 0);
    } else {
      push('s5', 0);
    }
  }

  // S6: توافق RSI عبر ثلاث نوافذ
  {
    const r1 = rsi(cs, 5);
    const r2 = rsi(cs, 14);
    const r3 = rsi(cs, 28);
    const align = (Math.sign(r1 - 50) + Math.sign(r2 - 50) + Math.sign(r3 - 50)) / 3;
    push('s6', align * ((r1 + r2 + r3) / 300 - 0.5));
  }

  // S7: الموضع بين الدعم والمقاومة
  {
    const w = input.prices.slice(-63);
    if (w.length >= 20) {
      const lowsArr = lows(w);
      const highsArr = highs(w);
      const supWindow = lowsArr.slice(-40, -5);
      const resWindow = highsArr.slice(-40, -5);
      if (supWindow.length && resWindow.length) {
        const sup = Math.max(...supWindow);
        const res = Math.min(...resWindow);
        const toSup = last > 0 ? (last - sup) / last : 0;
        const toRes = last > 0 ? (res - last) / last : 0;
        push('s7', toSup + toRes > 0 ? (toRes - toSup) / (toSup + toRes) : 0);
      } else {
        push('s7', 0);
      }
    } else {
      push('s7', 0);
    }
  }

  // S8: قوة نسبية معدّلة بفارق التذبذب
  {
    const benchRets = returns(closes(input.context.benchmark));
    const r20my = rets.slice(-20).reduce((a, b) => a + b, 0);
    const r20bm = benchRets.slice(-20).reduce((a, b) => a + b, 0);
    const volRatio = std(rets.slice(-20)) / Math.max(0.001, std(benchRets.slice(-20)));
    push('s8', (r20my - r20bm) * Math.tanh(volRatio - 1));
  }

  // S9: PEAD — انجراف ما بعد إعلان الأرباح.
  // بلا تقويم إفصاحات تبقى صفراً صراحةً؛ لا تخمين من السعر.
  {
    const earnings = input.context.earnings;
    const now = Date.parse(input.asOf);

    if (
      !earnings ||
      !Number.isFinite(now) ||
      (!earnings.lastAnnouncement && !earnings.nextAnnouncement)
    ) {
      push('s9', 0);
    } else {
      let score = 0;
      let active = false;

      // 1) الانجراف بعد آخر إعلان — يتلاشى خطياً على 60 يوماً (نافذة PEAD المعتادة).
      if (earnings.lastAnnouncement) {
        const last = Date.parse(earnings.lastAnnouncement);
        const daysSince = (now - last) / 86400000;
        if (Number.isFinite(daysSince) && daysSince >= 0 && daysSince <= 60) {
          const surprise = Number.isFinite(earnings.lastSurprise as number)
            ? (earnings.lastSurprise as number)
            : 0;
          const decay = Math.max(0, 1 - daysSince / 60);
          const magnitude = Math.tanh(Math.abs(surprise) * 3);
          score += Math.sign(surprise) * magnitude * decay * 0.9;
          active = true;
        }
      }

      // 2) خفض قبل الإعلان القادم — العائد حول الإفصاح عشوائي الاتجاه.
      if (active && earnings.nextAnnouncement) {
        const next = Date.parse(earnings.nextAnnouncement);
        const daysUntil = (next - now) / 86400000;
        if (Number.isFinite(daysUntil) && daysUntil >= 0) {
          if (daysUntil <= 5) score *= 0.25;
          else if (daysUntil <= 14) score *= 0.6;
        }
      }

      push('s9', active ? Math.max(-1, Math.min(1, score)) : 0);
    }
  }

  // S10: تقارب اتجاه النظراء
  {
    if (input.context.peers?.length) {
      let same = 0;
      const myDir = Math.sign(rets.slice(-5).reduce((a, b) => a + b, 0));
      for (const p of input.context.peers) {
        const pc = closes(p);
        if (pc.length < 6) continue;
        const pr = pc[pc.length - 1] / pc[pc.length - 6] - 1;
        if (Math.sign(pr) === myDir) same++;
      }
      push('s10', same / input.context.peers.length);
    } else {
      push('s10', 0.5);
    }
  }

  // S11: ضغط الارتداد للمتوسط
  {
    const s21 = sma(cs, 21);
    if (s21 && last > 0) {
      const dev = (last - s21) / s21;
      push('s11', -dev * (1 - Math.min(1, Math.abs(dev) * 5)));
    } else {
      push('s11', 0);
    }
  }

  // S12: استنفاد الاتجاه بعد سلسلة متصلة
  {
    const r10 = rets.slice(-10);
    if (r10.length === 10) {
      const signSum = r10.reduce((acc, r) => acc + Math.sign(r), 0);
      push('s12', Math.abs(signSum) === 10 ? -Math.sign(r10[9]) : 0);
    } else {
      push('s12', 0);
    }
  }

  return { names, values };
}

export function extractFeatures(input: ForecastInput): FeatureVector {
  const pub = extractPublicFeatures(input);
  const sec = extractSecretFeatures(input);
  return {
    names: [...pub.names, ...sec.names],
    public: pub.values,
    secret: sec.values,
  };
}
