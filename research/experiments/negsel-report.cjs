#!/usr/bin/env node
'use strict';
/**
 * Builds research/NEGSEL-0002-DEV-REPORT.md (Arabic) mechanically from research/results/NEGSEL-0002-dev.json.
 * Every number in the report is copied from the JSON; the text contains no interpretation beyond the protocol's decision rules.
 * usage: node research/experiments/negsel-report.cjs [in.json] [out.md]
 */
const fs = require('fs');
const path = require('path');

const inPath = process.argv[2] || path.join(__dirname, '..', 'results', 'NEGSEL-0002-dev.json');
const outPath = process.argv[3] || path.join(__dirname, '..', 'NEGSEL-0002-DEV-REPORT.md');
const J = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const f = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : (x >= 0 ? '+' : '') + Number(x).toFixed(d));
const u = (x, d = 3) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(d));
const ci = (a, d = 3) => (a && a[0] !== null ? `[${f(a[0], d)} ، ${f(a[1], d)}]` : 'n/a');
const mname = (m) => (m === 'sa' ? 'السعودي' : 'الأمريكي');
const yn = (b) => (b === true ? 'تحقق' : b === false ? 'لم يتحقق' : 'غير قابل للتقييم');
const key = (m, h, q) => `${m}|h${h}|q${q}`;
const R = (m, h, q) => J.results.find((x) => x.key === key(m, h, q));
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const P = J.primary_test, PR = R('sa', 21, 0.3), D = J.decision, prm = J.parameters;
const c25 = (r) => r.composite.net_excess_pct_by_cost.c25bps;
const lines = [];
const out = (s = '') => lines.push(s);

out('<div dir="rtl">');
out();
out('# NEGSEL-0002 — تقرير مرحلة التطوير/التحقق (Development/Validation فقط)');
out();
out(table(['البند', 'القيمة'], [
  ['حالة الكود', 'CODE-TESTED (اختبارات الوحدة لا تُثبت أي قدرة تنبؤية؛ حالة منفصلة عن نتيجة التجربة)'],
  ['نتيجة التجربة (مرحلة التطوير)', `**${D.decision}**`],
  ['الـHoldout (آخر 30% من التواريخ)', `لم يُفتح (\`holdout_opened: ${J.holdout_opened}\`)، ولا يوجد في الكود مسار يقرأه`],
  ['آخر تاريخ تطوير (cutoff)', `${J.dev_cutoff.date}`],
  ['البروتوكول', `\`research/PROTOCOL-NEGSEL-0002.md\` — commit \`${J.protocol.commit}\` — sha256 \`${J.protocol.sha256}\``],
  ['المخرجات الخام', '`research/results/NEGSEL-0002-dev.json`'],
  ['المنفّذ / الاختبارات', '`research/experiments/negsel-0002.cjs` و`negsel-lib.cjs` / `research/tests/negsel-0002.test.cjs`'],
]));
out();
out('> ملاحظة منهجية: لا يوجد معامل يُضبط في هذه التجربة سوى عتبة السيولة (تُحسب لكل طية من بيانات سابقة لها). الطيّات تقيس الاستقرار فقط. القيم التي لم يحدد البروتوكول رقمها (بند 8 أدناه) ثُبّتت في الكود قبل أول تشغيل ولم تتغير بعده.');
out();

// ---------------------------------------------------------------- 1
out('## 1. Hypothesis');
out('- **H1 (أساسية):** في السوق السعودي، استبعاد أضعف نسبة q من الأسهم بحسب مركّب ثابت يُقاس عند t (ببيانات ≤ t) يرفع العائد الزائد للناجين خلال الأفق التالي h مقارنة بكامل الكون، بعد التكاليف وخارج العينة.');
out('- **H0:** لا فرق أو فرق سالب.');
out('- **H2 (ثانوية):** السوق الأمريكي، يُعرض منفصلاً ولا يُدمج مع السعودي.');
out(`- **الاختبار الأساسي الوحيد:** السعودي، h=${prm.primary.h}، q=${prm.primary.q}، العائد الزائد بعد ${prm.base_cost_bps} نقطة أساس؛ ينجح إذا كان الحد الأدنى لفترة الثقة 95% أكبر من صفر.`);
out('- المركّب: متوسط الرتب المقطعية لـ`mom126_5` و`trend50_200` و`mom252_21`. لا يوجد ضبط لأي معامل.');
out();

// ---------------------------------------------------------------- 2
out('## 2. Baseline');
out('1. كامل الكون بأوزان متساوية عند t (العائد الزائد له صفر بالتعريف).');
out(`2. استبعاد عشوائي بالنسبة نفسها (Permutation، ${J.permutation_iterations} تكرار، بذرة ثابتة).`);
out('3. المركّب المنفرد `mom126_5` بالنسبة نفسها وبالتواريخ نفسها.');
out();

// ---------------------------------------------------------------- 3
out('## 3. Experiment');
out('**البيانات والقطع.** حُدد الـcutoff من قوائم التواريخ فقط، ثم حُذفت فعلياً كل الصفوف اللاحقة له قبل حساب أي ميزة أو عتبة أو رتبة أو عائد أو إحصاء. اختبار الكود يعطّل (NaN/قيم هائلة/سالبة) كل سعر وحجم بعد الـcutoff ويتحقق من تطابق الإخراج بايت ببايت.');
out();
out(table(['السوق', 'رموز المدخل', 'رموز مقبولة', 'مرفوضة', 'تواريخ التطوير', 'من', 'إلى', 'أقصى فجوة (جلسات)'],
  ['sa', 'us'].map((m) => { const d = J.data.markets[m]; return [mname(m), d.n_symbols_input, d.n_symbols_accepted, d.rejected.length, d.n_dev_calendar_dates, d.first_date, d.last_date, d.max_gap_sessions_overall]; })));
out();
out(`- تواريخ التقويم الكامل قبل القطع: ${J.dev_cutoff.per_calendar.map((c) => `${c.name}=${c.n_dates} (cutoff ${c.dev_cutoff})`).join('، ')}؛ المعتمد الأبكر: ${J.dev_cutoff.date}.`);
out(`- سجل تواريخ الإدراج المعروفة: ${J.data.listing_registry_size} رمزاً (لا مصدر دون اتصال)، لذلك حارس «البدء بعد الإدراج» وحارس الاسم غير فعّالين على البيانات الحقيقية؛ حارس الفجوات (> ${20} جلسة) وحارس العملة فعّالان. عدد الرموز المرفوضة: ${J.data.markets.sa.rejected.length + J.data.markets.us.rejected.length}.`);
out(`- الكون عند t: سلسلة نظيفة ≥ ${prm.min_history_sessions} جلسة، ووسيط قيمة التداول (إغلاق×حجم) لـ20 جلسة ≥ ${prm.liq_fraction} × الوسيط العام للسوق محسوباً من بيانات سابقة لسنة الطية فقط، وحد أدنى ${prm.min_universe} سهماً في التاريخ.`);
out('- حدود السيولة المحسوبة لكل طية:');
out();
out(table(['السوق', ...Object.keys(J.data.markets.sa.liquidity_thresholds_by_fold)], ['sa', 'us'].map((m) => [mname(m), ...Object.keys(J.data.markets.sa.liquidity_thresholds_by_fold).map((y) => J.data.markets[m].liquidity_thresholds_by_fold[y] ?? 'n/a')])));
out();
out(`- النسب q ∈ {${prm.q.join('، ')}} (الأولية ${prm.primary.q})، الآفاق h ∈ {${prm.h.join('، ')}} (الأولي ${prm.primary.h} سعودي)، التكاليف c ∈ {${prm.costs_bps.join('، ')}} نقطة أساس للرحلة الكاملة (الأساس ${prm.base_cost_bps}) مخصومة كـ دوران × c.`);
out('- الطيّات: السنة التقويمية لتاريخ التقييم، نافذة توسعية. التواريخ غير المتداخلة (تباعد ≥ h جلسة):');
out();
const hs = prm.h;
out(table(['السوق', ...hs.map((h) => `h=${h}`)], ['sa', 'us'].map((m) => [mname(m), ...hs.map((h) => { const d = J.data.markets[m].nonoverlapping_dates[`h${h}`]; return `${d.n_nonoverlapping} (${d.first} → ${d.last})`; })])));
out();
out(`- فترة الثقة: Bootstrap بكتل دائرية على التواريخ، طول الكتلة ⌈n^(1/3)⌉، ${J.bootstrap_resamples} إعادة، بذرة ثابتة لكل تركيبة. الاختبارات الثانوية (17) بتصحيح Holm. حساسية الشطب: φ ∈ {${prm.phi.map((x) => x * 100).join('، ')}}% سنوياً بعائد ${prm.delist_return * 100}% و p_ex ∈ {${prm.p_ex.join('، ')}}.`);
out();

// ---------------------------------------------------------------- 4
out('## 4. Out-of-sample Result');
out('«خارج العينة» هنا = تقييم السير الأمامي على بيانات التطوير (لا معاملات مُدرَّبة غير عتبة السيولة). **لم تُستخدم أي بيانات Holdout.**');
out();
out('### 4.1 الاختبار الأساسي (سعودي، h=21، q=0.3)');
out();
out(table(['المقياس', 'القيمة', 'فترة الثقة 95%'], [
  ['عدد التواريخ غير المتداخلة n', P.n_dates_eff, `${PR.first_date} → ${PR.last_date}`],
  ['العائد الزائد للناجين قبل التكاليف (%)', f(P.gross_excess_pct.mean), ci(P.gross_excess_pct.ci95)],
  [`العائد الزائد بعد التكاليف c=${prm.base_cost_bps} (%)`, f(P.net25_excess_pct.mean), ci(P.net25_excess_pct.ci95)],
  ['رفع نسبة الإصابة (نقطة مئوية)', f(PR.composite.hit_rate_lift_pts.mean, 2), ci(PR.composite.hit_rate_lift_pts.ci95, 2)],
  ['متوسط عائد المستبعَدين مقابل الكل (%)', f(PR.composite.excluded_minus_all_ret_pct.mean), ci(PR.composite.excluded_minus_all_ret_pct.ci95)],
  ['متوسط الدوران أحادي الاتجاه', u(PR.composite.mean_one_way_turnover, 4), ''],
  ['المرشحون قبل الاستبعاد (متوسط / أدنى / أعلى)', `${PR.candidates.mean_before} / ${PR.candidates.min_before} / ${PR.candidates.max_before}`, ''],
  ['المرشحون بعد الاستبعاد (متوسط) والمستبعَدون (متوسط)', `${PR.candidates.mean_after} / ${PR.candidates.mean_excluded}`, ''],
]));
out();
out(`- الاستبعاد العشوائي (Permutation، تجميع إجمالي قبل التكاليف): المُلاحَظ ${f(100 * P.permutation.observed, 4)}% ، متوسط التوزيع الصفري ${f(100 * P.permutation.null_mean, 4)}% ، انحرافه المعياري ${u(100 * P.permutation.null_sd, 4)}% ، p أحادي = ${u(P.permutation.p_one_sided, 4)} (الحد الأدنى الممكن ${u(1 / (J.permutation_iterations + 1), 4)}).`);
out();
out('### 4.2 نتيجة طية بطية (الأساسي)');
out();
out(table(['الطية (السنة)', 'عدد التواريخ', 'عائد زائد إجمالي %', `صافٍ c=${prm.base_cost_bps} %`, 'رفع الإصابة (نقطة)', 'موجب بعد التكاليف'],
  P.folds.map((x) => [x.fold, x.n_dates, f(x.gross_excess_pct), f(x.net25_excess_pct), f(x.hit_lift_pts, 2), x.positive_net25 ? 'نعم' : 'لا'])));
out();
out(`حصة الطيّات الموجبة: ${u(P.folds_positive_share, 2)}.`);
out();
out('### 4.3 كل التركيبات (سوق × أفق × q)');
out();
out(table(['السوق', 'h', 'q', 'n', 'إجمالي %', `صافٍ c=25 %`, 'CI95 للصافي', 'رفع الإصابة (نقطة)', 'مستبعَد−كل %', 'دوران', 'p تبديل', 'طيّات موجبة', 'مرشحون قبل→بعد'],
  J.results.map((r) => [mname(r.market), r.horizon, r.q, r.n_dates_eff, f(r.composite.gross_excess_pct.mean), f(c25(r).mean), ci(c25(r).ci95), f(r.composite.hit_rate_lift_pts.mean, 2), f(r.composite.excluded_minus_all_ret_pct.mean), u(r.composite.mean_one_way_turnover, 3), u(r.permutation_random_exclusion && r.permutation_random_exclusion.p_one_sided, 4), `${r.folds.filter((x) => x.positive_net25).length}/${r.folds.length}`, `${r.candidates.mean_before}→${r.candidates.mean_after}`])));
out();
out('### 4.4 خطوط الأساس');
out();
out(table(['السوق', 'h', 'q', 'متوسط عائد الكون المتساوي % (لكل أفق)', 'إصابة الكون %', 'mom126_5 منفرد: صافٍ c=25 %', 'CI95', 'المركّب − المنفرد (صافٍ) %', 'CI95 للفرق'],
  J.results.map((r) => [mname(r.market), r.horizon, r.q, f(r.baselines.universe_equal_weight.mean_fwd_ret_pct), u(r.baselines.universe_equal_weight.hit_rate_pct, 2), f(r.baselines.single_mom126_5.net25_excess_pct.mean), ci(r.baselines.single_mom126_5.net25_excess_pct.ci95), f(r.baselines.composite_minus_single_net25_pct.mean), ci(r.baselines.composite_minus_single_net25_pct.ci95)])));
out();
out('### 4.5 حساسية التكاليف (الأساسي، عائد زائد % لكل c)');
out();
out(table(['c (نقطة أساس)', 'المتوسط %', 'CI95'], [0, 10, 25, 50].map((c) => { const x = PR.composite.net_excess_pct_by_cost[`c${c}bps`]; return [c, f(x.mean), ci(x.ci95)]; })));
out();
out('حساسية التكاليف لبقية التركيبات في `NEGSEL-0002-dev.json` (`results[].composite.net_excess_pct_by_cost`).');
out();
out('### 4.6 حساسية الشطب (الأساسي، صافٍ c=25 %)');
out();
out(table(['φ (% سنوياً)', 'p_ex', 'العائد الزائد %', 'CI95'], PR.delisting_sensitivity.grid.map((g) => [g.phi_pct_per_year, g.p_ex, f(g.net25_excess_pct), ci(g.ci95)])));
out();
out(`نقطة التعادل (φ التي يصبح عندها المتوسط ≤ 0، بحث على شبكة حتى ${PR.delisting_sensitivity.scan_range_pct_per_year[1]}% سنوياً): p_ex=0.3 → ${PR.delisting_sensitivity.break_even_phi_pct_per_year['p_ex_0.3'] === null ? 'لا توجد ضمن المدى' : PR.delisting_sensitivity.break_even_phi_pct_per_year['p_ex_0.3']}؛ p_ex=0.6 → ${PR.delisting_sensitivity.break_even_phi_pct_per_year['p_ex_0.6'] === null ? 'لا توجد ضمن المدى' : PR.delisting_sensitivity.break_even_phi_pct_per_year['p_ex_0.6']}. هذه حدود لا تصحيح.`);
out();

// ---------------------------------------------------------------- 5
out('## 5. Statistical Evidence');
out();
out('### 5.1 معايير القرار (بند 8 من البروتوكول)، على الاختبار الأساسي');
out();
const crit = D.criteria;
out(table(['المعيار', 'القياس', 'الحالة'], [
  ['الحد الأدنى لـCI95 للعائد الزائد بعد c=25 > 0', `${ci(P.net25_excess_pct.ci95)}`, yn(crit.primary_ci_lower_gt_0_net25)],
  ['علامة موجبة في ≥ 70% من الطيّات', `${u(P.folds_positive_share, 2)} (${P.folds.filter((x) => x.positive_net25).length} من ${P.folds.length})`, yn(crit.positive_in_ge_70pct_of_folds)],
  ['بقاء الأثر عند (φ=2%، p_ex=0.3) — قراءة صارمة: الحد الأدنى لـCI95 > 0', `${f(P.delisting_phi2_pex0_3.net25_excess_pct)} ${ci(P.delisting_phi2_pex0_3.ci95)}`, yn(crit.survives_delisting_phi2_pex0_3)],
  ['Permutation p < 0.05', `${u(P.permutation.p_one_sided, 4)}`, yn(crit.permutation_p_lt_0_05)],
  [`قوة كافية: n ≥ ${D.power_min_n_eff}`, `n = ${D.n_eff}`, D.n_eff >= D.power_min_n_eff ? 'تحقق' : 'لم يتحقق'],
]));
out();
out(`القوة: انحراف معياري للعائد الزائد الصافي لكل تاريخ = ${u(P.power.sd_net25_pct)}%، الخطأ المعياري = ${u(P.power.se_pct)}%، أصغر أثر قابل للكشف (قوة 80%، α=0.05 ثنائي) = ${u(P.power.mde80_pct)}% لكل ${prm.primary.h} جلسة (للإفصاح فقط؛ لا يدخل القرار).`);
out();
out('### 5.2 الاختبارات الثانوية (17) — Holm');
out();
out(table(['السوق', 'h', 'q', 'n', 'صافٍ c=25 %', 'CI95', 'p ثنائي (Bootstrap)', 'p بعد Holm', 'معنوي بعد Holm', 'p تبديل'],
  J.secondary_tests.map((t) => [mname(t.market), t.horizon, t.q, t.n_dates_eff, f(t.net25_excess_pct), ci(t.ci95), u(t.p_two_sided_bootstrap, 4), u(t.p_holm, 4), t.significant_after_holm ? 'نعم' : 'لا', u(t.permutation_p_one_sided, 4)])));
out();
const sig = J.secondary_tests.filter((t) => t.significant_after_holm);
out(`عدد الاختبارات الثانوية المعنوية بعد Holm: ${sig.length}${sig.length ? ' (' + sig.map((t) => `${mname(t.market)} h=${t.horizon} q=${t.q}`).join('، ') + ')' : ''}. ${sig.length ? 'لا يترتب على أي نجاح ثانوي تغيير القرار الأساسي.' : ''}`);
out();

// ---------------------------------------------------------------- 6
out('## 6. Failure Modes');
const sm = J.data.markets.sa, um = J.data.markets.us;
const big = [...sm.large_daily_moves_over_25pct, ...um.large_daily_moves_over_25pct];
const usSig = J.secondary_tests.filter((t) => t.market === 'us' && t.significant_after_holm).length;
const comb = PR.baselines.composite_minus_single_net25_pct;
out(`1. **تحيز البقاء وتعارض الهوية:** الكون = 80 ورقة حيّة اليوم؛ لا مشطوبات. الرفض بحارس الهوية: ${sm.rejected.length + um.rejected.length}. حارسا الإدراج والاسم غير فعّالين (لا سجل). حدود الشطب في 4.6 حدود لا تصحيح.`);
out(`2. **عضوية الكون:** الكون = سيولة عند t ضمن أسهم مختارة اليوم؛ لم تُقَس أي عضوية تاريخية.`);
out(`3. **نظام سوق واحد:** نافذة التطوير ${sm.first_date} → ${J.dev_cutoff.date}؛ متوسط عائد الكون المتساوي السعودي لكل 21 جلسة = ${f(PR.baselines.universe_equal_weight.mean_fwd_ret_pct)}% ونسبة الإصابة ${u(PR.baselines.universe_equal_weight.hit_rate_pct, 1)}%.`);
out(`4. **قلة التواريخ المستقلة:** n الأساسي = ${D.n_eff} (الحد المعلن ${D.power_min_n_eff}). عند h=63: ${sm.nonoverlapping_dates.h63.n_nonoverlapping} تاريخاً سعودياً و${um.nonoverlapping_dates.h63.n_nonoverlapping} أمريكياً.`);
out(`5. **تعدد الاختبارات:** 18 تركيبة (1 أساسية + 17 ثانوية)؛ طُبق Holm على الـ17.`);
out(`6. **تكاليف السيولة:** التكاليف معاملات حساسية فقط (دوران أساسي ${u(PR.composite.mean_one_way_turnover, 3)}) بلا أثر سعري ولا انزلاق مرتبط بالحجم.`);
out(`7. **المركّب زخم / انهيار الزخم:** عدد الطيّات في الأساسي ${P.folds.length}؛ أصغرها ${Math.min(...P.folds.map((x) => x.n_dates))} تواريخ. فرق المركّب عن \`mom126_5\` المنفرد (صافٍ c=25) = ${f(comb.mean)}% ${ci(comb.ci95)} — ${comb.ci95[0] <= 0 && comb.ci95[1] >= 0 ? 'فترة الثقة تشمل الصفر' : 'فترة الثقة لا تشمل الصفر'}.`);
out('8. **حدود السعر اليومية وتأخر تحديث البيانات:** غير مُنمذجة.');
out(`9. **التوزيعات والتجزئة:** العوائد سعرية (إغلاق) دون تعديل توزيعات. حركات يومية > 25% في نافذة التطوير (بلا أي تنظيف أو حذف): ${big.map((b) => `${b.symbol} ${b.date} ${f(b.ret_pct, 2)}%`).join('؛ ')}. في \`1211.SR\` عاد الإغلاق إلى مستواه السابق في الجلسة التالية (قراءة واحدة مخالفة لما قبلها وما بعدها).`);
out(`10. **الاعتماد على سوق بلا تكرار في آخر:** السوق الأمريكي: عدد التركيبات المعنوية بعد Holm = ${usSig} من 9؛ أكبر صافٍ ${f(Math.max(...J.results.filter((r) => r.market === 'us').map((r) => c25(r).mean)))}%.`);
out('11. **تداخل مع استكشاف سابق:** نافذة التطوير تتقاطع مع الفترة التي فحصها EXP-0003 (المركّب ومستويات q نفسها)، ومنطقة الـHoldout رُئيت فيه إحصائياً مجمّعة؛ لذا لا تُعد نتائج التطوير مستقلة عن ذلك الاستكشاف.');
out();

// ---------------------------------------------------------------- 7
out('## 7. Decision');
out();
out(`**${D.decision}**`);
out();
out(`- السبب (آلي): \`${D.reason}\`.`);
out(`- المعايير الأربعة: ${Object.entries(crit).map(([k, v]) => `${k} = ${yn(v)}`).join('؛ ')}.`);
out(`- n الفعّال = ${D.n_eff} مقابل الحد المعلن ${D.power_min_n_eff}.`);
out('- الحالة القصوى الممكنة لهذه التجربة: SHADOW-VALIDATED؛ RESEARCH-VALIDATED غير ممكن ما دام الكون بلا مشطوبات. لا ترقية إلى الإنتاج؛ لا تغيير في `forecasts()` أو بوابات SHARA.');
out('- الـHoldout لم يُفتح؛ يُفتح مرة واحدة فقط بعد مراجعة المالك لهذه النتائج واختباراتها (قرار المالك المسجّل في `REGISTRY.md`).');
out(D.decision === 'REJECTED' ? '- يُسجَّل في `FAILED-ATTEMPTS.md` وفق البروتوكول (بند 8).' : '- القرار ليس REJECTED، فلا إدخال في `FAILED-ATTEMPTS.md` من هذه المرحلة.');
out();

// ---------------------------------------------------------------- 8
out('## 8. خيارات التفسير (حيث لم يحدد البروتوكول أو احتمل أكثر من قراءة)');
out();
for (const n of J.interpretation_notes) out(`- **${n.id} — ${n.topic}:** ${n.note_ar}`);
out();
out('### قيود معروفة');
for (const k of J.known_limitations_ar) out(`- ${k}`);
out();
out('</div>');

fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`wrote ${outPath} (${lines.length} lines)`);
