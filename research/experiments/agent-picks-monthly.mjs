#!/usr/bin/env node
/**
 * agent-picks-monthly.mjs — monthly descriptive review of the agent-picks record (Node 20, no deps, NO network).
 *
 *   node research/experiments/agent-picks-monthly.mjs [--dir=research/agent-picks] [--month=YYYY-MM]
 *
 * Default month = the previous calendar month (UTC), because the workflow runs on the 1st.
 * Writes <dir>/reports/monthly-<YYYY-MM>.md (exclusive create; an existing report is never overwritten → -2.md ...).
 * Content: cumulative stats (through the month end), stability by ISO week, failure analysis (largest misses,
 * 'غير متاح' abstention reasons, failed analyze calls), and a "proposed experiments" section that ONLY lists candidate
 * hypotheses for FUTURE frozen protocols. This script changes nothing anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as L from './agent-picks-lib.mjs';
import { readRuns, readOutcomes, writeReport } from './agent-picks-evaluate.mjs';

export function previousMonth(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}
const inMonth = (date, month) => typeof date === 'string' && date.slice(0, 7) === month;
const upTo = (date, month) => typeof date === 'string' && date.slice(0, 7) <= month;

/** Tally of first abstention reasons (numbers masked so identical causes group together). */
export function abstentionReasons(rows) {
  const t = new Map();
  for (const r of rows) {
    if (r.entry.direction !== L.NA) continue;
    const reason = (r.entry.reasons && r.entry.reasons[0]) || 'بلا سبب مذكور';
    const key = String(reason).replace(/[0-9٠-٩]+([.,][0-9٠-٩]+)?/g, '#').slice(0, 140);
    t.set(key, (t.get(key) || 0) + 1);
  }
  return [...t.entries()].sort((a, b) => b[1] - a[1]);
}

export function largestMisses(rows, n = 10) {
  return rows
    .filter((r) => r.outcome && r.outcome.status === 'evaluated' && L.isNum(r.entry.expectedChangePct) && L.isNum(r.outcome.changePct))
    .map((r) => ({ r, miss: r.outcome.changePct - r.entry.expectedChangePct }))
    .sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss))
    .slice(0, n);
}

/** Rule-based candidate hypotheses. Each is a SUGGESTION for a future frozen protocol; nothing is changed. */
export function proposedExperiments(summaries, ctx) {
  const out = [];
  for (const s of summaries) {
    if (!s.recorded) continue;
    const share = (d) => s.byDirection[d] / s.recorded;
    if (share(L.NEUTRAL) >= 0.7) out.push({ id: `CAND-NEUTRAL-${s.market}-h${s.h}`, text: `${L.MARKET_NAME[s.market]}، ${L.HORIZON_NAME[s.h]}: ${(100 * share(L.NEUTRAL)).toFixed(0)}% من التوقعات «محايد». فرضية مرشحة: حد الحياد الثابت مقارنةً بحجم مخرج النموذج يجعل أغلب التوقعات بلا اتجاه.`, baseline: 'حد الحياد الحالي (0.1/0.25/0.5%) على التواريخ نفسها.', caution: 'صيغة النطاق المقيس بالتذبذب رُفضت سابقاً (EXP-0004 / FA-001)؛ أي صيغة جديدة = إصدار جديد ببروتوكول مجمّد، لا تعديل على الإصدار الحالي.' });
    if (share(L.NA) >= 0.3) out.push({ id: `CAND-ABSTAIN-${s.market}-h${s.h}`, text: `${L.MARKET_NAME[s.market]}، ${L.HORIZON_NAME[s.h]}: الامتناع «غير متاح» ${(100 * share(L.NA)).toFixed(0)}%. فرضية مرشحة: سبب الامتناع الغالب (انظر جدول الأسباب) بيانات ناقصة لا ضعف إشارة — يُفحص مصدر البيانات أولاً.`, baseline: 'نسبة الامتناع الحالية لكل سبب.', caution: 'تشغيلي/بيانات قبل أن يكون نموذجياً؛ لا يُخفض حد الثقة لتمرير توقعات.' });
    if (s.upHit.n >= 20 && s.liftPp !== null && s.liftPp > 0) out.push({ id: `CAND-UPLIFT-${s.market}-h${s.h}`, text: `${L.MARKET_NAME[s.market]}، ${L.HORIZON_NAME[s.h]}: إصابة «صاعد» أعلى من نسبة الصعود الأساسية بـ ${s.liftPp.toFixed(1)} نقطة على n_eff = ${s.neff.nEff.toFixed(1)}. مراقبة فقط.`, baseline: 'نسبة الصعود الأساسية من نفس التشغيلات + Permutation بنفس الحجم.', caution: `فرق داخل عينة مراقبة لا يُعد دليلاً؛ اختباره يتطلب بروتوكولاً مجمّداً قبل بيانات جديدة لم تُرَ، وn_eff ≥ ${L.MIN_NEFF}.` });
    if (s.topHalfRise.n >= 20 && s.bottomHalfRise.n >= 20 && s.topHalfRise.pct !== null && s.bottomHalfRise.pct !== null && s.topHalfRise.pct > s.bottomHalfRise.pct) out.push({ id: `OBS-MOM-${s.market}-h${s.h}`, text: `${L.MARKET_NAME[s.market]}، ${L.HORIZON_NAME[s.h]}: صعود نصف الزخم الأعلى ${s.topHalfRise.pct.toFixed(1)}% مقابل ${s.bottomHalfRise.pct.toFixed(1)}%.`, baseline: '—', caution: 'هذه منطقة DIR-0002 القائمة (مجمّد)؛ ليست فرضية جديدة ولا تُختبر هنا، تنتظر اختبارها الرسمي عند n_eff ≥ 60.' });
  }
  if (ctx.analyzeFailRate !== null && ctx.analyzeFailRate > 0.1) out.push({ id: 'OPS-ANALYZE-FAILURES', text: `فشل ${(100 * ctx.analyzeFailRate).toFixed(0)}% من نداءات التحليل هذا الشهر. هذا بند تشغيلي (موثوقية الخدمة/المزود)، وليس فرضية تنبؤية.`, baseline: '—', caution: 'يُعالج تشغيلياً؛ الأيام الفاشلة لا تُعوَّض بأثر رجعي.' });
  if (!out.length) out.push({ id: 'NONE', text: 'لا توجد ملاحظة تستوفي قواعد الترشيح هذا الشهر (أو العينة صغيرة جداً).', baseline: '—', caution: '—' });
  return out;
}

export function monthlyReport({ runs, outcomesByMarket, month, reportDate }) {
  const runsUpTo = runs.filter(({ data }) => upTo(data.runDate, month));
  const runsMonth = runs.filter(({ data }) => inMonth(data.runDate, month));
  const rowsAll = L.buildRows(runsUpTo, outcomesByMarket);
  const rowsMonth = rowsAll.filter((r) => inMonth(r.runDate, month));
  const lines = [];
  lines.push('<div dir="rtl">', '', `# المراجعة الشهرية لـ«ترشيحات الوكيل» — ${month}`, '');
  lines.push(`> تاريخ الإعداد: ${reportDate} (UTC). ${L.GOVERNANCE_NOTE}`, '> هذه المراجعة وصفية. قسم «التجارب المقترحة» قائمة فرضيات مرشحة لبروتوكولات مستقبلية فقط؛ لا يُغيَّر بموجبها أي شيء.', '');
  lines.push('## Hypothesis (الفرضية)', '', 'لا فرضية تُختبر. المراقبة الوصفية نفسها في التقرير الأسبوعي؛ الفرضية الرسمية للزخم في `PROTOCOL-DIR-0002.md`.', '');
  lines.push('## Baseline (خط الأساس)', '', 'نسبة الصعود الأساسية لكل الأسهم المقيّمة من نفس التشغيلات؛ هدف المالك 80% مرجع طموح فقط.', '');
  const okCalls = runsMonth.reduce((s, r) => s + (r.data.counts ? r.data.counts.ok : 0), 0), selCalls = runsMonth.reduce((s, r) => s + (r.data.counts ? r.data.counts.selected : 0), 0);
  lines.push('## Experiment (التشغيل خلال الشهر)', '', `- تشغيلات الشهر: ${runsMonth.length} (السعودي ${runsMonth.filter((r) => r.data.market === 'sa').length}، الأمريكي ${runsMonth.filter((r) => r.data.market === 'us').length})؛ فجوات (تغطية رتب < 75%): ${runsMonth.filter((r) => r.data.status === 'gap').length}.`, `- نداءات التحليل: ${okCalls} ناجحة من ${selCalls}. إصدارات النموذج المرصودة: ${[...new Set(runsMonth.flatMap((r) => r.data.modelVersions || []))].join('، ') || '—'}.`, '');
  lines.push('## Out-of-sample Result (تراكمي حتى نهاية الشهر)', '');
  const sums = [];
  for (const market of L.MARKETS) {
    const ms = L.HORIZONS.map((h) => L.summarize(rowsAll.filter((r) => r.market === market && r.h === h), market, h));
    sums.push(...ms);
    const t = L.marketTables(ms);
    lines.push(`### ${L.MARKET_NAME[market]}`, '', t.counts, '', t.rates, '');
  }
  lines.push('### الاستقرار حسب الأسبوع (أسبوع تاريخ الترشيح)', '');
  const weeks = [...new Set(rowsAll.map((r) => L.isoWeek(r.runDate)))].sort();
  const stab = [];
  for (const w of weeks) for (const market of L.MARKETS) for (const h of L.HORIZONS) {
    const rs = rowsAll.filter((r) => r.market === market && r.h === h && L.isoWeek(r.runDate) === w);
    if (!rs.length) continue;
    const s = L.summarize(rs, market, h);
    stab.push([w, L.MARKET_NAME[market], L.HORIZON_NAME[h], s.recorded, s.matured, L.fmtPct(s.nonNeutralAccuracy), L.fmtPct(s.upHit), L.fmtPct(s.baseRate), L.fmtSigned(s.liftPp)]);
  }
  lines.push(stab.length ? L.table(['الأسبوع', 'السوق', 'الأفق', 'مسجلة', 'ناضجة', 'دقة غير المحايد', 'إصابة «صاعد»', 'الصعود الأساسي', 'الفرق'], stab) : 'لا بيانات بعد.', '', '> أسبوع واحد = تاريخ أو بضعة تواريخ مترابطة؛ تذبذب الأرقام بين الأسابيع متوقع ولا يحمل دلالة بمفرده.', '');
  lines.push('### تحليل الإخفاقات (ترشيحات هذا الشهر)', '', '**أكبر الفروق بين التغير المتوقع والفعلي (نقطة مئوية):**', '');
  const misses = largestMisses(rowsMonth);
  lines.push(misses.length ? L.table(['السهم', 'السوق', 'الأفق', 'تاريخ المرجع', 'الاتجاه المتوقع', 'التغير المتوقع %', 'التغير الفعلي %', 'الفرق', 'ملاحظة'],
    misses.map(({ r, miss }) => [r.symbol, L.MARKET_NAME[r.market], L.HORIZON_NAME[r.h], r.outcome.refDate, r.entry.direction, L.fmtSigned(r.entry.expectedChangePct, 2), L.fmtSigned(r.outcome.changePct, 2), L.fmtSigned(miss, 2), r.outcome.splitBetween ? 'تجزئة محتملة' : ''])) : 'لا توجد نتائج ناضجة لترشيحات هذا الشهر بعد.', '');
  const wrong = rowsMonth.filter((r) => r.outcome && r.outcome.directionCorrect === false);
  lines.push(`- توقعات اتجاه خاطئة (ناضجة): ${wrong.length}؛ منها «صاعد» لم يصعد: ${wrong.filter((r) => r.entry.direction === L.UP).length}، «هابط» لم يهبط: ${wrong.filter((r) => r.entry.direction === L.DOWN).length}، «محايد» تحرك: ${wrong.filter((r) => r.entry.direction === L.NEUTRAL).length}.`, `- نتائج «غير متاح السعر» (موقوف/مشطوب، تُحسب «لم يصعد»): ${rowsMonth.filter((r) => r.outcome && r.outcome.status === 'unavailable').length}.`, '');
  lines.push('**أسباب الامتناع «غير متاح» (السبب الأول لكل توقع):**', '');
  const ab = abstentionReasons(rowsMonth);
  lines.push(ab.length ? L.table(['السبب', 'العدد'], ab.slice(0, 15)) : 'لا امتناع هذا الشهر.', '');
  const fails = new Map();
  for (const { data } of runsMonth) for (const f of (data.counts && data.counts.failures) || []) { const k = f.reason + (f.detail ? ' — ' + String(f.detail).slice(0, 80) : ''); fails.set(k, (fails.get(k) || 0) + 1); }
  lines.push('**نداءات تحليل فاشلة:**', '', fails.size ? L.table(['السبب', 'العدد'], [...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) : 'لا يوجد.', '');
  lines.push('## Statistical Evidence (الدليل الإحصائي)', '', L.neffNote(sums), '');
  lines.push('## Failure Modes (مصادر الخطأ المعروفة)', '', '- عينة مختارة بالزخم (ليست السوق كله)؛ ترابط الأسهم في التاريخ نفسه؛ سعر مرجعي لحظي متأخر مقابل إغلاق فعلي؛ تجزئات غير معدلة؛ تغيّر إصدار النموذج خلال الشهر (انظر الإصدارات أعلاه — النتائج المختلطة بين إصدارات لا تُنسب لإصدار واحد).', '');
  lines.push('## التجارب المقترحة (فرضيات مرشحة فقط — لا تغيير)', '', '> كل بند أدناه **مرشح** لبروتوكول مستقبلي مجمّد (Hypothesis → Baseline → Experiment → Out-of-sample → Statistical Evidence → Failure Modes → Decision) يُسجَّل بالتوازي من تاريخ تجميده فقط (`PROTOCOL-DIR-0002.md` §8). لم يُنفَّذ أي منها، ولا يغيّر هذا التقرير `forecasts()` أو أي عتبة أو الكون.', '');
  const failRate = selCalls ? (selCalls - okCalls) / selCalls : null;
  for (const c of proposedExperiments(sums, { analyzeFailRate: failRate })) lines.push(`- **${c.id}** — ${c.text}`, `  - خط الأساس المقترح: ${c.baseline}`, `  - تحفّظ: ${c.caution}`);
  lines.push('', '## Decision (القرار)', '', `**لا قرار.** وصفي فقط حتى n_eff ≥ ${L.MIN_NEFF}.`, '', '</div>', '');
  return lines.join('\n');
}

export function runMonthly({ dir, month, now = Date.now }) {
  const nowMs = now();
  month = month || previousMonth(nowMs);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  const runs = readRuns(dir);
  const outcomesByMarket = Object.fromEntries(L.MARKETS.map((m) => [m, readOutcomes(dir, m)]));
  const md = monthlyReport({ runs, outcomesByMarket, month, reportDate: new Date(nowMs).toISOString().slice(0, 10) });
  return { month, reportFile: writeReport(dir, `monthly-${month}`, md) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([a-z-]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
    const res = runMonthly({ dir: typeof opt.dir === 'string' ? opt.dir : 'research/agent-picks', month: typeof opt.month === 'string' ? opt.month : null });
    console.log(JSON.stringify(res));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `report=${res.reportFile}\nmonth=${res.month}\n`);
  } catch (e) { console.error('fatal:', e && e.stack || e); process.exit(1); }
}
