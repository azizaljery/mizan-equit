#!/usr/bin/env node
/**
 * scripts/verify-kalman.mjs
 * ------------------------------------------------------------------
 * يُصدِر أثر (trace) مرشّح كالمان الخاص بـ N4 ليتحقّق منه محرّك مستقل.
 *
 *   node scripts/verify-kalman.mjs > /tmp/kalman-trace.json
 *   python3 scripts/verify-kalman.py /tmp/kalman-trace.json
 *
 * فضاء الحالة في N4 (lib/forecast/v2/models.ts):
 *   x = [مستوى, سرعة]      F = [[1, 1], [0, 0.999]]      Q = 1e-4·I
 *   H = [[1, 0]]           R = [[var(returns)·last²]]     z = [close_i]
 *
 * ⚠ كتلة المرشّح أدناه نسخة طبق الأصل من n4Kalman. حتى لا تنزاح عنها
 * بصمت، يقرأ السكربت models.ts ويقارن بصمة الكتلة قبل أي إصدار.
 * تغيّرت البصمة ⇐ الخروج بالرمز 2 مع طلب إعادة المزامنة، لا أثر مضلِّل.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'lib', 'forecast', 'v2', 'models.ts');

/** بصمة كتلة n4Kalman حتى نهاية حلقة المرشّح، بلا تعليقات ولا مسافات. */
const EXPECTED_BLOCK_SHA256 =
  '63b5b9278c56fc0217353fea4e56429a9330b3d2d240cd55947ab695c3e9c9ad';

function assertInSync() {
  let src;
  try {
    src = readFileSync(MODELS, 'utf-8');
  } catch (e) {
    console.error(`[verify-kalman] تعذّرت قراءة ${MODELS}: ${e.message}`);
    process.exit(2);
  }
  const start = src.indexOf('export function n4Kalman');
  const end = src.indexOf('const lastPrice = cs[cs.length - 1];', start);
  if (start < 0 || end < 0) {
    console.error('[verify-kalman] لم أجد كتلة n4Kalman في models.ts.');
    process.exit(2);
  }
  const norm = src
    .slice(start, end)
    .replace(/\/\/.*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sha = createHash('sha256').update(norm).digest('hex');
  if (sha !== EXPECTED_BLOCK_SHA256) {
    console.error(
      '[verify-kalman] تغيّرت n4Kalman في models.ts ولم تُزامَن هذه النسخة.\n' +
        `  المتوقَّع: ${EXPECTED_BLOCK_SHA256}\n` +
        `  الفعلي  : ${sha}\n` +
        '  انقل الكتلة الجديدة إلى runFilter() ثم حدّث EXPECTED_BLOCK_SHA256.',
    );
    process.exit(2);
  }
}

// ═══════════════════════════════════════════════════════════════
// نسخة طبق الأصل من مرشّح n4Kalman
// ═══════════════════════════════════════════════════════════════

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const returns = (s) => {
  const r = [];
  for (let i = 1; i < s.length; i++) r.push(s[i] / s[i - 1] - 1);
  return r;
};

function runFilter(cs) {
  let x0 = cs[0];
  let x1 = 0;
  let P00 = 1;
  let P01 = 0;
  let P11 = 1;

  const Q = 1e-4;
  const decay = 0.999;
  const R_eff = Math.max(std(returns(cs)) ** 2 * cs[cs.length - 1] ** 2, 1e-6);

  const F = [
    [1, 1],
    [0, decay],
  ];
  const Qm = [
    [Q, 0],
    [0, Q],
  ];
  const H = [[1, 0]];
  const Rm = [[R_eff]];

  const steps = [];

  for (let i = 1; i < cs.length; i++) {
    const px0 = x0 + x1;
    const px1 = x1 * decay;

    const pP00 = P00 + 2 * P01 + P11 + Q;
    const pP01 = decay * (P01 + P11);
    const pP11 = decay * decay * P11 + Q;

    const S = pP00 + R_eff;
    const K0 = pP00 / S;
    const K1 = pP01 / S;

    const innovation = cs[i] - px0;
    x0 = px0 + K0 * innovation;
    x1 = px1 + K1 * innovation;

    const oneMinusK0 = 1 - K0;
    P00 = Math.max(oneMinusK0 * oneMinusK0 * pP00 + K0 * K0 * R_eff, 1e-9);
    P01 = oneMinusK0 * (pP01 - K1 * pP00) + K0 * K1 * R_eff;
    P11 = Math.max(pP11 - 2 * K1 * pP01 + K1 * K1 * pP00 + K1 * K1 * R_eff, 1e-9);

    steps.push({
      F,
      Q: Qm,
      H,
      R: Rm,
      z: [cs[i]],
      x_post: [x0, x1],
      P_post: [
        [P00, P01],
        [P01, P11],
      ],
    });
  }

  return { steps };
}

// ═══════════════════════════════════════════════════════════════
// سلسلة أسعار حتمية — بلا Math.random حتى يكون الأثر قابلاً لإعادة الإنتاج
// ═══════════════════════════════════════════════════════════════

function syntheticSeries(n = 120, start = 100, amp = 1) {
  const cs = [start];
  for (let i = 1; i < n; i++) {
    const r = amp * (Math.sin(i * 1.7) * 0.011 + Math.cos(i * 0.43) * 0.007);
    cs.push(cs[i - 1] * (1 + r));
  }
  return cs;
}

assertInSync();

const cs = syntheticSeries(120, 100, 1);
const { steps } = runFilter(cs);

process.stdout.write(
  JSON.stringify(
    {
      source: 'lib/forecast/v2/models.ts :: n4Kalman',
      blockSha256: EXPECTED_BLOCK_SHA256,
      series: { n: cs.length, first: cs[0], last: cs[cs.length - 1] },
      init: { x: [cs[0], 0], P: [[1, 0], [0, 1]] },
      steps,
    },
    null,
    2,
  ) + '\n',
);
