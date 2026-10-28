#!/usr/bin/env node
'use strict';
// usage: node make-report-fcst0001.cjs <results.json> <out.html>  — RTL HTML report generated from the results file only.
const fs = require('fs');
const [, , inF, outF] = process.argv;
const o = JSON.parse(fs.readFileSync(inF, 'utf8'));
const MK = {sa: 'السعودي', us: 'الأمريكي'}, f = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : (+v).toFixed(d)), pc = (v) => (v == null ? '—' : (100 * v).toFixed(1) + '%');
const table = (head, rows) => `<div class="w"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const verdict = (c) => (c.nEff < 60 ? 'لم تثبت (n_eff دون 60: لا استدلال)' : c.relReductionOfAvsB >= 0.01 && c.pHolm <= 0.05 && c.ci95[1] < 0 ? 'ثبتت' : 'لم تثبت (العينة تسمح بالحكم؛ لا تحسن ≥1%)');
const sec = o.secondary;
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير FCST-0001</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;direction:rtl;text-align:right;max-width:1100px;margin:0 auto;padding:16px;line-height:1.8;color:#111;background:#fff}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #bbb;padding:5px 8px;text-align:right}th{background:#eee}.w{overflow-x:auto}h2{margin-top:28px;border-bottom:2px solid #333}.note{background:#fff7e0;border:1px solid #e0c060;padding:8px 12px}</style></head><body>
<h1>تقرير تقييم FCST-0001 (قابل لإعادة الإنتاج)</h1>
<p>مُولَّد آليًا من <code>research/results/FCST-0001.json</code> بالأمر <code>node research/experiments/make-report-fcst0001.cjs</code>. البروتوكول المجمّد: <code>PROTOCOL-FCST-0001.md</code> (إيداع 21e8d43) والملحق <code>AMEND-1</code> (وصفي، أُضيف بعد رؤية النتائج).</p>
<h2>1. البيانات والتواريخ والتقسيم</h2>
<ul><li>الأسهم: ${o.meta.symbols.sa} سعودي + ${o.meta.symbols.us} أمريكي (${o.symbols} رمزًا لها سجلات)؛ أسعار إغلاق يومية من فرع <code>research-data</code>.</li>
<li>أول تاريخ أصل: ${o.meta.firstOrigin}؛ آخر تاريخ هدف محقَّق: ${o.meta.lastLabel}؛ القطع الصلب ${o.devCutoff} (ما بعده محذوف قبل أي حساب؛ Holdout لم يُفتح).</li>
<li>تدريب موسَّع بأصول كل 5 جلسات؛ استبعاد (purge) كل مثال هدفه ≥ بداية الطية؛ بلا ضبط معاملات (λ ثابت).</li>
<li>طيات الاختبار (سجلات أفق 5): ${o.meta.foldRecords.map((x) => `${x.id} (${x.start}→${x.end}): ${x.records}`).join('؛ ')}.</li>
<li>أفق 252 له طيتان فقط (2023H1، 2023H2)؛ طيتا 2022H2 و2024H1 تعذّر تقييمهما (لا تدريب أو لا هدف قبل القطع).</li>
<li>الوحدة الإحصائية: أسبوع الأصل (متوسط الأسهم في الأسبوع مشاهدة واحدة)؛ بوتستراب كتل دائرية B=2000، بذرة ${2026102701}.</li></ul>
<h2>2. خطأ المركز المطبَّع مقابل السعر الحالي (R0) — النموذج المقترح M1</h2>
<p>NAE = |الفعلي − المتوقع| ÷ (σ63·√h). الفرق = M1 − R0 (سالب = M1 أفضل). الحكم وفق قاعدة القبول المجمّدة.</p>
${table(['السوق', 'الأفق', 'سجلات', 'أسابيع', 'n_eff', 'NAE للسعر الحالي', 'NAE لـM1', 'تحسن نسبي', 'الفرق [CI95]', 'p أحادي', 'p بعد Holm', 'طيات أفضل', 'الحكم'],
  sec.map((c) => [MK[c.markets], c.h, c.nRecords, c.nWeeks, f(c.nEff, 1), f(c.maeB, 4), f(c.maeA, 4), pc(c.relReductionOfAvsB), `${f(c.diff, 4)} [${f(c.ci95[0], 4)}, ${f(c.ci95[1], 4)}]`, f(c.pOneSided, 3), f(c.pHolm, 3), `${c.foldsBetter}/${c.foldsTotal}`, verdict(c)]))}
<p>الأولي (أفق 5، السعودي+الأمريكي): تحسن نسبي ${pc(o.primary.relReductionOfAvsB)}، الفرق ${f(o.primary.diff, 4)} [${f(o.primary.ci95[0], 4)}, ${f(o.primary.ci95[1], 4)}]، p=${f(o.primary.pOneSided, 3)}، n_eff=${f(o.primary.nEff, 1)}، طيات ${o.primary.foldsBetter}/${o.primary.foldsTotal} ⇒ لم تثبت.</p>
<h2>3. المحرك الحالي (C0) مقابل السعر الحالي — وصفي</h2>
${table(['السوق', 'الأفق', 'n_eff', 'تحسن نسبي لـC0 (موجب = أفضل)', 'الفرق [CI95]', 'ملاحظة'],
  o.descriptive.filter((c) => c.a === 'C0' && c.b === 'R0').map((c) => [MK[c.markets], c.h, f(c.nEff, 1), pc(c.relReductionOfAvsB), `${f(c.diff, 4)} [${f(c.ci95[0], 4)}, ${f(c.ci95[1], 4)}]`, c.nEff < 60 ? 'n_eff دون 60: لا استدلال' : 'الفرق ضمن ±1% تقريبًا']))}
<h2>4. التقييم الاتجاهي (AMEND-1، وصفي)</h2>
<p>دقة إشارة المركز مقابل مرجع الأغلبية بأثر رجعي (مرجع متحفظ عمدًا). «حالات غير محايدة» = ما كان سيُعرض صاعدًا/هابطًا بحدود الحياد.</p>
${table(['السوق', 'الأفق', 'النموذج', 'n_eff', 'دقة الإشارة', 'مرجع الأغلبية', 'الفرق [CI95]', 'حالات غير محايدة', 'دقتها [Wilson]'],
  o.direction.map((d) => [MK[d.market], d.h, d.model, f(d.nEff, 1), pc(d.signAcc), pc(d.baselineAcc), `${pc(d.gainOverMajority)} [${pc(d.ci95[0])}, ${pc(d.ci95[1])}]`, d.nDirectional, d.dirAccWilson ? `${pc(d.dirAcc)} [${pc(d.dirAccWilson[0])}, ${pc(d.dirAccWilson[1])}]` : '— (لا حالات)']))}
<p class="note">لا خلية ينجح فيها C0 أو M1 في تجاوز مرجع الأغلبية. في الخلايا ذات n_eff ≥ 60 (أفقا 1 و5) الحد الأعلى لـCI لا يتجاوز ~+5 نقاط مئوية، أي أن المقدّر لا يظهر ميزة، لكن هذا لا يستبعد ميزة صغيرة. في الآفاق ≥ 21 العينة لا تسمح بأي حكم.</p>
<h2>5. التغطية والعرض ودرجة Winkler (80% اسميًا لـR0/R1/M1؛ نطاق C0 كما يصدره، بلا ادعاء معايرة)</h2>
${table(['السوق', 'الأفق', 'النموذج', 'تغطية [Wilson]', 'العرض/σ√h', 'Winkler', 'نسبة الحياد', 'NAE: هدوء / صدمة'],
  Object.entries(o.profiles).flatMap(([k, v]) => { const [m, h] = k.split('|'); return Object.entries(v).filter(([, p]) => p).map(([mod, p]) => [MK[m], h, mod, `${pc(p.coverage)} [${pc(p.coverageCI95[0])}, ${pc(p.coverageCI95[1])}]`, f(p.width, 2), f(p.winkler, 2), pc(p.neutralShare), `${p.calm ? f(p.calm.nae, 3) : '—'} / ${p.shock ? f(p.shock.nae, 3) + ' (n=' + p.shock.n + ')' : '—'}`]); }))}
<h2>6. الصياغة: «لم تثبت» ≠ «ثبت العدم»</h2>
<ul><li>العبارة المعروضة في الموقع: «لا توجد أفضلية اتجاهية مثبتة لهذا الأفق» = <b>لم تثبت أفضلية</b>. لا تعني أن الأفضلية معدومة.</li>
<li>حيث n_eff ≥ 60 (أفقا 1 و5) المقدّر لا يظهر ميزة؛ الآفاق ≥ 21: العينة غير كافية للحكم في أي اتجاه.</li>
<li>قوة التجربة: σ_d(أفق 5)=${f((o.design.find((x) => x.h === 5) || {}).sigmaD, 3)} ⇒ أصغر فرق قابل للكشف ≈ 2.5·σ_d/√n_eff ≈ ${f(2.485 * (o.design.find((x) => x.h === 5) || {}).sigmaD / Math.sqrt(o.primary.nEff), 3)} (≈ ${pc(2.485 * (o.design.find((x) => x.h === 5) || {}).sigmaD / Math.sqrt(o.primary.nEff) / o.primary.maeB)} نسبيًا) أكبر من حد 1% المجمّد.</li></ul>
<h2>7. الحدود</h2><p>تحيز بقاء (قائمة حالية بلا مشطوب)، نظام سوق واحد (2022–2024)، C0 بلا سياق سوق/قطاع/أخبار/قوائم، بواقي النطاق من التدريب داخل العينة، سعودي بـ39 سهمًا فقط مع بيانات، أسابيع الأصل تحمل ارتباطًا مقطعيًا لا يُزال كليًا. اختبارات الكود ≠ دقة. لا Holdout.</p>
</body></html>`;
fs.writeFileSync(outF, html);
console.log('ok', outF);
