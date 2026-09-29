# Phase 1 Requirements and Evidence

Project: MIZAN_FINANCIAL
Wave: STABILITY
Phase: 1
Status: IN_PROGRESS

| Requirement | Question / Scope | Evidence state |
|---|---|---|
| FIN-P1-REQ-SOURCE-DEPLOYMENT-PARITY | هل النسخة المنشورة مرتبطة بالمصدر المحدد ومطابقة له ضمن فروق بناء مفسرة؟ | PASS_PENDING_HUMAN_REVIEW — [مقارنة المصدر](evidence/FIN-P1-SOURCE-DEPLOYMENT-PARITY.json)؛ فروق الهوية المولدة موثقة |
| FIN-P1-REQ-ROLLBACK-RUNBOOK | هل إجراء الرجوع محدد ومختبر أو محاكى، مع فصل رجوع الكود عن البيانات؟ | PARTIAL — [إجراء الرجوع](PHASE-1-ROLLBACK-RUNBOOK.md)؛ الرجوع الفعلي ما زال غير مثبت |
| FIN-P1-REQ-LEGACY-SETTINGS | هل الإعدادات القديمة تقرأ مع الحفاظ على الأصل؟ | PASS — [قبول المستخدم](evidence/FIN-P1-OWNER-COMPATIBILITY-ACCEPTANCE.json) |
| FIN-P1-REQ-LEGACY-PORTFOLIOS | هل المحافظ السابقة تستمر وتقرأ دون تغيير غير مقصود؟ | PASS — [قبول المستخدم](evidence/FIN-P1-OWNER-COMPATIBILITY-ACCEPTANCE.json) |
| FIN-P1-REQ-LEGACY-TRADES | هل الصفقات القديمة محفوظة وقابلة للقراءة؟ | PASS — [قبول المستخدم](evidence/FIN-P1-OWNER-COMPATIBILITY-ACCEPTANCE.json) |
| FIN-P1-REQ-LEGACY-FORECASTS | هل تاريخ التوقعات وأصولها محفوظ دون إعادة كتابة؟ | PASS — [قبول المستخدم](evidence/FIN-P1-OWNER-COMPATIBILITY-ACCEPTANCE.json) |
| FIN-P1-REQ-DATABASE-ROLLBACK-SAFETY | سلامة الاستعادة دون فقد السجلات الأحدث | PARTIAL — حفظ صفوف محلي مثبت؛ استعادة نسخة إنتاج معزولة لم تختبر |
| FIN-P1-REQ-HUMAN-REVIEW | مراجعة عبدالعزيز لكل دليل وقرار الإغلاق | PENDING — [صفحة المراجعة](PHASE-1-HUMAN-REVIEW.md) |

لكل دليل: المصدر، البيئة، إجراء التحقق، النتيجة، الحدود، ثم المراجع البشري وتاريخ قراره.
الدليل الجزئي لا يغلق الشرط. تعذر الوصول لا يحسب نجاحًا.

## قاعدة الحوكمة الدائمة

كل شرط إغلاق يحتاج دليلاً.

وكل دليل يحتاج مراجعة بشرية.

ولا تُغلق المرحلة عند اكتمال العمل،
بل عند اكتمال الإثبات.

بعد اكتمال الأدلة والمراجعة يسجل قرار الإغلاق في [القائمة](PHASE-1-CLOSURE-CHECKLIST.md).
لا يبدأ تنفيذ المرحلة الثانية قبل إغلاق الأولى رسميًا وفق اعتماد المستخدم الأحدث؛ يبقى تجهيز معلوماتها عملًا ثانويًا فقط.

## متطلبات منفصلة إضافية

| Requirement | Scope | Evidence state |
|---|---|---|
| FIN-P1-REQ-DATABASE-ROLLBACK-SAFETY | سلامة الاستعادة دون فقد السجلات الأحدث | PARTIAL — حفظ صفوف محلي مثبت؛ استعادة نسخة إنتاج معزولة لم تختبر |
| FIN-P1-REQ-HUMAN-REVIEW | مراجعة عبدالعزيز لكل دليل وقرار الإغلاق | PENDING |

[سجل الأدلة والمؤشر المحسوب](PHASE-1-EVIDENCE-LOG.json): 8 متطلبات صريحة؛ المؤشر للمراقبة فقط، ولا يمنح PASS أو يغلق المرحلة.
