مرجع متطلبات المستخدم: [تعليمات مشروع ميزان](PROJECT_INSTRUCTIONS.md). النص محفوظ بالكامل، بما فيه فواصل الشارت. توثيقه لا يعني اكتمال تنفيذ جميع بنوده أو اعتماد ملاءمة شخصية لم تُجمع معاييرها.

# ميزان — تحليل مخاطر الأسهم

تطبيق عربي من اليمين إلى اليسار لتحليل ملفات الشركات والأسعار اليومية، وخطة المركز، وشروط الفحص الشرعي، وتوليد توصيات مشروطة. جميع الحسابات وقراءة ملفات المستخدم تتم في المتصفح. التطبيق لا يتصل بوسيط ولا ينفذ أوامر ولا يجلب أسعارًا حية.

## القدرات

- قراءة PDF النصي (حتى 350 صفحة / 35 MiB) مع صفحة وسطر الدليل، وكشف سطور مالية محتملة للمراجعة. لا يوجد OCR أو تفسير آلي كامل لكل الإيضاحات.
- استيراد بنود مالية CSV أو JSON، واستيراد OHLCV يومي، مع رفض التواريخ المكررة والشموع غير الصحيحة والأرقام الملتبسة.
- التحليل المالي، النمو والنقد الحر وجودة الأرباح والمديونية، 3 سنوات من البيانات، الهوامش، تفكيك دوبونت باستخدام المتوسطات، ومقارنة مكررات القطاع.
- SMA50/200، Wilder RSI14 وATR14، MACD12/26/9، التراجع الأقصى والتقلب والحجم والقمم/القيعان المؤكدة.
- فحص شرعي من مرجع المستخدم بجهة ومنهج وتاريخ وآخر ربع وتطهير، وتسجيل اختلاف الجهات دون خلط نسبها.
- حاسبة حجم مركز بمخاطرة 1% بعد التكاليف والحد النقدي، والعائد للمخاطرة، وفرضية الدخول وشرط إبطالها.
- توصية مشروطة شراء / بيع أو تخفيف / انتظار بعد اكتمال البيانات؛ درجات خطر خمس. قواعد السيناريوهات معلنة في التطبيق.
- حفظ ملف JSON قابل للاستعادة وإعادة الاعتماد؛ طباعة الخلاصة عبر المتصفح.

## حدود الإصدار

قواعد الخطر والتوصيات استرشادية غير معايرة أو مختبرة تاريخيًا. ليست احتمال خسارة، وليست شهادة توافق مع جميع المعايير. البنوك والتأمين والصناديق العقارية محجوبة عن النموذج العام حتى إضافة نماذج قطاعية. لا توجد بيانات حية أو مصادر شرعية متزامنة أو تحويل عملات أو OCR. نطاق القيمة من مضاعفات أرباح مدخلة، وليس DCF أو إثبات قيمة عادلة. مستويات الأسعار المرجعية ليست أوامر جاهزة ولا تُقرّب تلقائيًا لحجم تكة السوق.

للتطوير إلى نظام إنتاجي: عقد مزود بيانات مرخّص لكل سوق، محرك إجراءات رأسمالية وتقويم جلسات ومواعيد إفصاحات، قراءة موثقة للقوائم القطاعية، مراجعة شرعية متخصصة، ثم معايرة واختبار زمني خارج العينة مع التكاليف وانحياز البقاء والنظر إلى المستقبل. هذه القدرات ليست موصوفة على أنها منفذة في هذا الإصدار.

## التحقق

`npm test` يختبر الحسابات والحالات الحدية وقواعد الحجب. البناء من خلال مسار Sites. لم يُطلب أو يُنفذ اختبار بصري أو متصفح.

- `lib/analysis.ts`: الحسابات الأساسية والتحقق والمخاطر.
- `lib/readiness.ts`: قائمة الشروط والخطة ودوبونت.
- `lib/recommendations.ts`: التوصيات المشروطة والمستويات المرجعية.
- `lib/documents.ts`: القراءة والأدلة؛ PDF.js 5.6.205 في `public/vendor/pdfjs` مع الترخيص.
- `app/page.tsx`: مساحة العمل العربية.

المصادر العامة المذكورة في صفحة المنهجية تشرح التعريفات؛ لا تعني اعتماد نموذج ميزان.


## Search-first workflow (September 2026)

The main page resolves a company or ETF by name/ticker and market through server routes. Saudi Exchange supplies the Saudi directory, company profile, bid/offer snapshots, financial summaries and announcements; Yahoo Finance supplies daily prices, dated annual/quarterly/TTM facts, US/global symbol discovery and related news. No API secrets are shipped to the browser. These are public, best-effort sources, not a contracted real-time consolidated feed. The US market filter includes the Yahoo exchange codes for Nasdaq, NYSE, NYSE Arca, American, Cboe and OTC when returned by search. No claim of complete coverage is made.

`lib/automatic-analysis.ts` keeps annual, quarterly and TTM periods separate. It calculates supported ratios without guessing missing fields. EV/EBITDA is withheld without all enterprise value components. Company scores are not applied to banks, insurers, REITs or ETFs. Peer comparisons are limited illustrative groups and are labeled as such. Price/statement staleness gates, unknown Sharia/purification, incomplete calendars and unresolved source differences prevent strong recommendations. The score is a heuristic summary, not a return forecast or a validated risk model.

Optional XLSX/XLS parsing runs in a disposable on-device Worker with size, row and time limits. CSV uses a quoted-field parser; PDF text remains on-device with page and time limits and no OCR. Files never overwrite fetched facts: comparisons require matching symbol, period, currency and units. The advanced manual workspace remains at `/manual`.

Validation: 21 deterministic numerical/parser/integrity tests; direct live-source integration against a Saudi equity, AAPL and SPY; XLSX and legacy XLS binary workbook parsing through the same worker code. No browser QA performed. Hosted upstream availability can differ from the development environment; source failures must remain visible.
