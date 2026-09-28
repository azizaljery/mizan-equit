# تقرير دمج Source Layer وBackground Jobs — 12 سبتمبر 2026

دُمجت المرفقات بالمقارنة مع ميزان الحي، النسخة 32، المصدر `1f830e63fb63fd6c29050da5af8b03b35de657b7`. نجح التحقق البرمجي والتقييم المعزول وعدم التكرار. **قبول Cron الإنتاجي غير مكتمل**: لم يُثبت تسجيل Trigger لدى الاستضافة، ولم يُنفذ Scheduled في الإنتاج.

## المقارنة والقرارات

| المرفق | ما طُبق أو كُيّف |
|---|---|
| MIZAN_READY_TO_APPLY_SOURCES_AND_CRON_AUDITED_V2.txt | المرجع الأعلى عند التعارض: الأنواع، المصادر، المحللات، provenance، الجودة، المحاولات، PIT، وتوقيت كل 6 ساعات. دُمج evaluate-due داخل worker/scheduled الحالي. |
| MIZAN_SOURCES_INTEGRATION_STAGE.txt | الإبقاء على المسار الحالي عندما توجد بيانات، وإضافة الرصد فوق الاستجابة نفسها دون طلبات شبكة إضافية في fetchCompany. |
| MIZAN_LIVE_CORE_SOURCES_FOR_DEVELOPER_FINAL.txt | احترام configuredReader وSEC وAlpaca وresolveFinancialSources الحاليين؛ الفصل بين المصدر المرشح والموصل العامل، وبين نجاح الكود والاتصال. |
| MIZAN_BACKGROUND_JOBS_FOR_DEVELOPER.txt | دمج الجدولة والملخص داخل المهمة القائمة؛ إبقاء الأقفال، المهلة، عد الحفظ الجزئي، ومعاملات D1 الموجودة. لم يُستخدم MarketReport يدوي مصغر. |
| Mizan_Current_Source_with_Backtesting_v2(1).txt | مرجع مقارنة فقط؛ النسخة الحية أحدث في وظائف حرجة. أُبقيت إصلاحاتها والتوقعات والسجلات الحالية. لم تُستبدل الشجرة بهذا التصدير. |
| MIZAN_SOURCES_LAYER_6_FILES.txt | كُيّفت أدوات الوصف والأنواع المتاحة وتجميع الجودة. لم يُفعّل نظام health أو ترجيح مالي موازٍ. |
| MIZAN_SOURCE_LAYER_MATCHED_TO_CURRENT.txt | كُيّفت المحللات والجسر مع MarketReport الحالي؛ تصحيحات V2 تتقدم على بيانات التأخير أو التوقيت المخالفة فيها. |

استُخدمت الجداول الحالية `source_status` و`research_state` و`forecast_records` و`forecast_outcomes` و`evaluation_revisions`. لا migration جديدة ولا جدول source_health. احتُفظ بنوع SourceHealth الاختياري للتوافق فقط؛ لا خدمة أو تخزين أو حساب موثوقية جديد يستخدمه.

المسار المجدول هو `fetchCompany(symbol, configuredReader(...))` ثم `resolveForecasts(db, report)`، مع غلاف مهلة فقط. رُفعت مهلة الجلب من 25 إلى 60 ثانية بعد أن تجاوز الاتصال الحقيقي 25 ثانية؛ بقي قفل الرمز 90 ثانية، وحد الدورة 10 دقائق والقفل العام 15 دقيقة. الحد المجدول 20 رمزًا، والإدارة اليدوية الحالية بقيت في مسارها المحمي.

ربطت Source Layer المحللات بـparseFundamentals وparseChart وparseLiveQuote وparseSECFacts الموجودة. SEC يقدم financials وfilings؛ لم يُسجل كمصدر news. بقي Yahoo غير رسمي، و`knownDelayMinutes=null` حين لا توجد معلومة مؤكدة. تواريخ SEC والتوزيعات لا تدخل في عقوبة التأخر اللحظي. ماليات Yahoo بلا تاريخ نشر لا تمر من PIT.

أصلح الفحص الحي رابط Yahoo الوارد في الحزمة: كان بلا period1/period2 وأعاد صفر بنود صالحة لـ2222.SR. الآن يستخدم بناء الرابط نفسه والحقول نفسها في getFundamentals الحالي. لم تُضعف فحوص الرمز أو العملة أو الفترة لتجاوز الخطأ.

## نتائج الأوامر الفعلية

| الأمر | النتيجة النهائية |
|---|---|
| `npx tsc --noEmit` | PASS، exit 0، 23:23:16 UTC |
| `node --test --import tsx lib/sources/parsers/__tests__/parsers.test.ts` | PASS: 17 ناجحًا، 0 فاشل، 0 متخطى |
| `npm test` | PASS: 156 ناجحًا، 0 فاشل، 0 متخطى، مع مقارنة حقيقية بوحدة النسخة الحية 32 |
| بناء الموقع | PASS، exit 0، تحقق من 25 أصل واجهة مشارًا إليه من الخادم |
| `node scripts/test-background-workerd.mjs` | PASS على آخر حزمة مبنية وD1 محلي؛ بيانات الأسعار والهوية مصطنعة ومعزولة |
| `node scripts/test-sources-live.mjs` | نُفذ باتصال فعلي وSQLite معزولة. فحوص سلامة الكتابة نجحت؛ تقييم السعودية بقي معلقًا لنقص بيانات المرجع، كما هو مفصل أدناه. |

اختبارات npm الحالية شملت فحوص المجالات الموجودة أصلًا؛ لم تُعدّل ملفات الذهب أو التوصيات أو Backtesting أو الواجهة أو المحافظ. لم يُنشأ توقع أو تقييم اختباري في الإنتاج.

## Cron المحلي ونتائج Scheduled

`npx wrangler dev --test-scheduled` شُغّل فعليًا، وفشل أولًا بسبب `uv_interface_addresses EPERM`. الإقلاع احتاج IP ومنفذي الخدمة والفاحص محددين صراحة. مع إعداد الملفات الثابتة المولد وصل استدعاء scheduled إلى خطأ HTTP 500 بلا ملخص مهمة.

لإكمال عزل المشكلة شُغلت **الحزمة نفسها** بإعداد اختبار محلي مشتق يحذف توجيه الملفات الثابتة فقط، مع D1 محلي جديد. لم يُغير إعداد النشر، ولم يُكتب Trigger ثانٍ. Wrangler المثبت 4.92.0 استجاب على `/cdn-cgi/handler/scheduled`؛ المساران `/cdn-cgi/local/scheduled` و`/__scheduled` أعادا 404 في هذه البيئة.

أمر التشغيل المحلي المكتمل، مع مساري config وstate محليين:

```sh
npx wrangler dev --test-scheduled --config .sites-runtime/qa/cron-no-assets.json --ip 127.0.0.1 --port 8787 --inspector-port 9230 --persist-to .sites-runtime/qa/wrangler-final-state --var MIZAN_BACKGROUND_CRON_ENABLED:true
```

| البيئة | التشغيل | الرموز المفحوصة | المحفوظ | الفاشل | المتخطى | HTTP/الحدث | العدد بعد التشغيل |
|---|---:|---:|---:|---:|---:|---|---:|
| Wrangler + محاولة شبكة فعلية | الأول | 2 | 0 | 2 | 0 | 200 / ok | 0 |
| Wrangler + محاولة شبكة فعلية | الثاني | 2 | 0 | 2 | 0 | 200 / ok | 0 |
| الحزمة المبنية / workerd / أسعار مصطنعة | الأول | 5 | 5 | 0 | 0 | outcome=ok | 5 |
| الحزمة المبنية / workerd / أسعار مصطنعة | الثاني | 0 | 0 | 0 | 0 | outcome=ok | 5 |
| scheduledResolution في Node / بيانات سوق فعلية | الأول | 2 | 1 | 0 | 1 | partial | 1 |
| scheduledResolution في Node / بيانات سوق فعلية | الثاني | 1 | 0 | 0 | 1 | partial | 1 |

**نجاح HTTP في Wrangler لا يعني نجاح جلب البيانات**: منعت مشكلة اتصال/DNS في runtime المحلي الوصول للمزودين. لا تُنسب له نتائج workerd ذات الأسعار المصطنعة، ولا نتائج Node التي استخدمت وكيل الشبكة المتاح. الأوامر والملخصات الخام محفوظة في ملف التحقق.

**إثبات عدم التكرار:** في workerd انتقل forecast_outcomes وكذلك evaluation_revisions من 0 إلى 5 ثم بقي 5. السجل السادس غير المستحق بقي دون نتيجة. التوقعات الأصلية لم تتغير، وفحص تكرار المعرفات والإصدارات أعاد صفرًا. وفي الاختبار ذي البيانات الفعلية انتقل forecast_outcomes من 0 إلى 1 ثم بقي 1، ولم يُقيّم السجل السنوي غير المستحق. لم تُحوّل حالة نقص بيانات السعودية إلى نتيجة مصطنعة. بقاء 0 في Wrangler وحده ليس برهانًا كافيًا على idempotency؛ البرهان هو عمليات الحفظ المتبوعة بإعادة التشغيل في الاختبارين الآخرين.

## AAPL و2222.SR — اتصال فعلي

استُخدمت وظائف البرنامج مع configuredReader وsource_status وطلبات مزود فعلية عبر وكيل الشبكة المتاح، دون network mocks. إعدادات المصادر كانت افتراضيات البرنامج في قاعدة معزولة؛ تعذر استخراج إعدادات الإنتاج كاملة. هذه نتائج مصدر، وليست توصيات أو قياسًا لدقة نموذج الاستثمار.

| الرمز / النوع | المصدر | النتيجة | الجودة | attempts | fallback | sourceTime UTC |
|---|---|---|---|---:|---|---|
| AAPL / price | Yahoo، غير رسمي | 332.27 USD | weak، 55 | 1 | false | 2026-09-11T20:00:01Z |
| AAPL / history | Yahoo، غير رسمي | 1255 جلسة | good، 85 | 1 | false | 2026-09-11T13:30:00Z |
| AAPL / financials | SEC، رسمي | 860 بندًا؛ 860 بتاريخ نشر | excellent، 100 | 1 | false | 2026-07-31 |
| AAPL / filings | SEC، رسمي | 40 إيداعًا | excellent، 100 | 1 | false | 2026-09-01 |
| 2222.SR / price | Yahoo، غير رسمي | 26.14 SAR | weak، 55 | 1 | false | 2026-09-10T12:18:59Z |
| 2222.SR / history | Yahoo، غير رسمي | 1251 جلسة | good، 85 | 1 | false | 2026-09-10T07:00:00Z |
| 2222.SR / financials | Yahoo، غير رسمي | 234 بندًا؛ صفر بتاريخ نشر؛ غير PIT-safe | good، 85 | 1 | false | null |
| 2222.SR / filings داخل Source Layer | غير متاح | unavailable | invalid، 0 | 0 | false | null |

provenance الكامل، بما فيه URL وretrievedAt وofficial وderived وdelayMinutes، محفوظ لكل نتيجة في `sources-live-2026-09-12.json`. delayMinutes بقي null في جميعها. جودة السعر هنا تعكس عمر آخر سعر في لقطة جُمعت يوم السبت؛ لا تثبت تأخيرًا معلنًا للمزود ولا زمن وصول بيانات البورصة أثناء جلسة مفتوحة.

fetchCompany نفسه نجح للرمزين. سجّل 16 محاولة مصدر لـAAPL و10 لـ2222.SR في القراءة الأولى. نجحت بيانات SEC المنظمة؛ تعذرت قراءة مستندي HTML من Archives بانتهاء المهلة، وظلت محاولتاهما الفاشلتان ظاهرتين. وصل قارئ تداول الحالي إلى قوائم الشركة السعودية الرسمية؛ لم يُستبدل بمحلل Yahoo، ولم نختلق درجة جودة للمسار القديم.

في التقييم المعزول ببيانات حقيقية حُفظ تقييم AAPL. أما مرجع السعودية الحالي `^TASI.SR` فأعاد 453 جلسة تنتهي **2026-07-16**، بينما سلسلة أرامكو تصل إلى 2026-09-10. لهذا لم يجد المقيم الحالي جلسات المرجع اللازمة للتوقع الاختباري الحديث، وأبقى تقييمه معلقًا. لم نغير تقويم القياس أو نبدل المرجع ببيانات غير موثقة لإجبار الحفظ.

## research_state والإنتاج

- تأكد حفظ `job:evaluate-due:last` بعد كل تشغيل محلي، وstateSaved=true. توجد أيضًا `job:evaluate-due:last-cron` لحماية إثبات Cron من أن يستبدله تشغيل يدوي.
- اختبار الحالة يؤكد أن تشغيل الإدارة اليدوي لا يجعل Scheduler configured=true. القراءة لا تفترض التفعيل لمجرد وجود الدالة أو الجدول في الكود.
- مصدر جدول `0 */6 * * *` الوحيد المؤلف هو vite.config.ts، باستخدام الثابت المشترك في lib/jobs/schedule.ts؛ ملف Wrangler المولد ناتج بناء فقط. لا إعداد Trigger آخر في المشروع.
- الإنتاج: Scheduled **NOT RUN**. متغير التمكين لم يُضبط في الإنتاج، ولا إثبات على تسجيل Trigger. تشغيل الكود أو إضافته للأرشيف لا يكفي لإثبات الجدولة، كما تميز [وثائق Cloudflare](https://developers.cloudflare.com/workers/configuration/cron-triggers/) بين handler وإعداد Trigger.
- قراءة research_state الإنتاجي جُربت وفشلت: `A single D1 row is too large to display safely`. لا يمكن تأكيد وجود المفتاح هناك أو نفيه.
- عدد forecast_outcomes الإنتاجي المقروء فعليًا قبل النشر: **11**، صفحة كاملة. ليست هذه نتائج الاختبارات المحلية، ولم تُجرَ دورة تقييم على الإنتاج.
- الكتالوج الحالي يحوي 40 مصدرًا مرشحًا. لم يُعلن أنها 40 اتصالًا عاملًا. فحص بقية الخدمات المدفوعة، ومنها Alpaca بلا مفاتيح وخطة متاحة: **NOT RUN**. حالة كل مرشح واحتياجاته محفوظة في ملف التحقق.

## العوائق الحقيقية

1. واجهات الاستضافة الحالية لا تعرض تسجيل Cron أو قراءة الـTriggers؛ التفعيل الإنتاجي واختبار Scheduled الإنتاجي غير منجزين.
2. Wrangler المحلي احتاج تجاوز مشكلة توجيه assets في إعداد الاختبار فقط، وما زال الجلب الخارجي من runtime المحلي يفشل. لذلك اختبار Wrangler مع جلب ناجح وتقييم محفوظ لم ينجح.
3. تغطية مرجع السعودية من المزود الحالي تنتهي في 16 يوليو 2026؛ تمنع تقييم التوقع الاختباري السعودي الحديث وفق السياسة الحالية.
4. لم تُربط filings سعودية داخل Source Layer. القارئ الرسمي السعودي الموجود بقي فعالًا في fetchCompany.
5. تعذرت قراءة مستندي SEC الأصليين، رغم نجاح submissions وcompanyfacts. الوصول الكامل إلى مستندات الشركة غير مثبت.
6. قراءة سجل المجدول وإعدادات المصادر الإنتاجية كاملة تعذرت عبر واجهة البيانات المتاحة. لا يوجد دليل يسمح بإعلان قبول المرحلة الإنتاجية مكتملًا.

## ملفات الأدلة

- `sources-cron-validation-2026-09-12.json`: الأوامر وأكواد الخروج وWrangler والكتالوج وحالة التحقق الإنتاجي.
- `sources-cron-workerd-2026-09-12.json`: تشغيلان على الحزمة المبنية وD1 المحلي، والأعداد وفحوص التكرار.
- `sources-live-2026-09-12.json`: نتائج المصدر الفعلية وprovenance والجودة والمحاولات وsource_status والتقييم المعزول وسجل research_state.

## الملفات المعدلة والمضافة

| الملف | التغيير |
|---|---|
| `.gitignore` | تعديل |
| `app/api/admin/research/route.ts` | تعديل |
| `app/api/forecast-tests/route.ts` | تعديل |
| `lib/market-data.ts` | تعديل |
| `lib/source-probe.ts` | تعديل |
| `lib/source-status.ts` | تعديل |
| `scripts/test-background-workerd.mjs` | تعديل |
| `tests/background-jobs.test.mjs` | تعديل |
| `tests/calculations.test.mjs` | تعديل |
| `tests/export.ts` | تعديل |
| `vite.config.ts` | تعديل |
| `worker/index.ts` | تعديل |
| `worker/scheduled.ts` | تعديل |
| `docs/qa/sources-cron-final-2026-09-12.md` | إضافة |
| `docs/qa/sources-cron-validation-2026-09-12.json` | إضافة |
| `docs/qa/sources-cron-workerd-2026-09-12.json` | إضافة |
| `docs/qa/sources-live-2026-09-12.json` | إضافة |
| `lib/jobs/schedule.ts` | إضافة |
| `lib/sources/bridge.ts` | إضافة |
| `lib/sources/conflict.ts` | إضافة |
| `lib/sources/endpoints.ts` | إضافة |
| `lib/sources/fallback.ts` | إضافة |
| `lib/sources/integration.ts` | إضافة |
| `lib/sources/parsers/__tests__/parsers.test.ts` | إضافة |
| `lib/sources/parsers/index.ts` | إضافة |
| `lib/sources/parsers/pit.ts` | إضافة |
| `lib/sources/parsers/sec.ts` | إضافة |
| `lib/sources/parsers/types.ts` | إضافة |
| `lib/sources/parsers/yahoo.ts` | إضافة |
| `lib/sources/quality.ts` | إضافة |
| `lib/sources/registry.ts` | إضافة |
| `lib/sources/resolver.ts` | إضافة |
| `lib/sources/types.ts` | إضافة |
| `scripts/test-sources-live.mjs` | إضافة |

لا حذف لملفات المشروع. المرفقات الأصلية محفوظة دون تعديل. الوثائق الأقدم تُركت كسجل تاريخي؛ هذا التقرير هو مرجع هذه الدفعة.
