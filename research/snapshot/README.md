<div dir="rtl">

# جامع اللقطة اليومية (Point-in-Time) — الإصدار الأول

> **الحالة: CODE-TESTED على بيانات اصطناعية فقط (offline).** لم يُشغَّل على Yahoo الحقيقي. أداة بحثية مستقلة تماماً عن الإنتاج: لا تلمس `mizan-v45/` ولا الـWorker ولا D1، ولا تغيّر أي سلوك إنتاجي. **لا تُزيل تحيّز البقاء التاريخي** — هي تبدأ سجلاً جديداً من أول يوم تعمل فيه فقط. قرار المالك: «نجمع لقطات يومية جديدة، والـHoldout يبقى مغلقاً».

## ماذا يُجمع
نفس كون البحث (80 رمزاً = 40 سعودياً `*.SR` + 40 أمريكياً، مطابق لـ`fetch-research-prices.yml` ويفحصه اختبار). لكل رمز في كل تشغيل:
- **الهوية** من `meta` كما أعادها Yahoo فعلاً: `symbol, exchangeName, fullExchangeName, currency, instrumentType, longName, shortName, firstTradeDate, exchangeTimezoneName, timezone, gmtoffset, regularMarketTime` (المفقود = `null`، لا اختلاق) + قائمة مفاتيح `meta` التي وصلت.
- **الشموع اليومية** منذ آخر لقطة كما وردت (OHLC، `adjclose`، الحجم)، مع علامات الجودة (`close_missing`، `ohlc_inconsistent`…) وأحداث التجزئة/التوزيع إن وُجدت. الشمعة التي تغيّرت قيمتها لاحقاً تُخزَّن صفاً جديداً بعلامة `restated` (القديم يبقى).
- **instrument_id** داخلي ثابت يُسنَد عند أول رؤية عبر `identity.cjs`؛ **الرمز ليس مفتاحاً**.
- **Provenance**: نقطة المصدر **بلا أي مفتاح/رمز**، `retrieved_at`، حالة HTTP، SHA-256 لجسم الرد، عدد المحاولات، إصدار الجامع.
- **الفشل يُسجَّل ولا يُحذف**: `failed` (سبب + حالة HTTP + محاولات)، و`identity_unresolved` (حقول هوية ناقصة أو رمز مخالف للمطلوب) — حذفه يعيد تحيّز البقاء.
- **الحجر (Quarantine)**: تعارض هوية صلب (اسم/عملة/بورصة/بداية تاريخ/قفزة سعر+قيمة تداول) ⇒ `instrument_id` جديد، القديم يُنهى بحالة `ended_identity_conflict`، وسجل `quarantine` في اللقطة نفسها بالأدلة كاملة. **لا دمج ولا استبدال صامت**؛ الخلافة قرار بشري لاحق.
- **كون التشغيل نفسه** (`universe`) وبصمته.

## أين
فرع يتيم **`research-snapshots`** فقط (ليس `mizan-aziz-deploy` ولا تحت `mizan-v45/`):
```
snapshots/YYYY/YYYY-MM-DD.json   ملف لكل تاريخ UTC (يُنشأ مرة واحدة، لا يُعاد كتابته)
snapshots/chain.jsonl            فهرس إلحاقي: سطر لكل تشغيل {seq, file, file_sha256, content_hash, prev_hash, chain_hash}
snapshots/HEAD.json              رأس السلسلة (مشتق)
```
الجدولة: `22:37 UTC` من الاثنين إلى الجمعة (بعد إغلاق السوق الأمريكي شتاءً 21:00 وصيفاً 20:00، والسعودي مغلق منذ 12:00 UTC؛ شمعة الأحد السعودية تُجمع في تشغيل الاثنين). الـcron لا يعمل إلا من **الفرع الافتراضي** للمستودع.

## كيف تتحقق من السلسلة
```
git worktree add snap-state origin/research-snapshots      # أو أي نسخة من الفرع
node research/snapshot/collect.cjs verify --dir snap-state
node research/snapshot/collect.cjs verify --dir snap-state --anchor-seq N --anchor-hash <chain_hash مسجّل خارجياً>
```
رمز الخروج `0` سليم، `2` فشل التحقق (تعديل/حذف/إعادة ترتيب/ملف غير مدرج/رأس مخالف). **بتر الذيل أو إعادة حساب السلسلة كاملة لا يُكشف دون مرساة خارجية**: سجّل `chain_hash` الأخير (يطبعه سير العمل في ملخص التشغيل) في مكان خارج الفرع بين حين وآخر؛ وحماية الفرع من الـforce-push مفيدة. هذا كشف عبث لا منع عبث.

## ما لا يفعله
- لا يُصلح تاريخاً سابقاً: كل شمعة قبل `first_seen` تحمل `is_backfill=true` وليست Point-in-Time.
- لا يضمن اكتمال كون يوم معيّن: الكون هنا قائمة ثابتة من 80 رمزاً (لا دليل إدراج)؛ **الشطب لا يُستنتج** (فشل `not_found` يُسجَّل فقط، دون حالة `candidate_delisted`).
- عتبات الهوية كلها PROVISIONAL؛ معدلات الإيجابية/السلبية الكاذبة UNKNOWN (إيجابية كاذبة تقسم السلسلة وتحتاج تأكيد خلافة يدوي).
- لا معرّفات قوية (ISIN/CIK) من Yahoo `chart`؛ لا تُعامَل أحداث الشركات معالجة كاملة.
- ليس ميزة إنتاجية، ولا يغذّي `forecasts()` ولا أي مسار حي.

## سلوك التشغيل
- **نفس التاريخ مرتين** ⇒ يرفض برسالة واضحة، رمز خروج `3`، بلا جلب وبلا تعديل (سير العمل يعتبرها إشعاراً لا فشلاً).
- فشل رموز فردية ⇒ لا يفشل التشغيل (اللقطة `partial`). فشل **كل** الرموز ⇒ لا يُكتب شيء ويفشل التشغيل (رمز `4`) ويبقى اليوم قابلاً للجمع.
- لا تُسجَّل أجسام الردود في السجلات: أعداد وحالات وبصمات فقط.
- تشغيل يدوي بـ`publish=false`، أو أي push يعدّل ملف سير العمل ⇒ **تجربة جافة**: يُجمع ولا يُدفع شيء، وتُرفق اللقطة كـartifact للفحص.

## قائمة فحص التشغيل الأول (للمراجع)
1. تأكد أن الملف موجود على **الفرع الافتراضي** (وإلا لن يعمل الـcron)؛ ثم `workflow_dispatch` بـ`publish=false` لتجربة جافة، ونزّل الـartifact.
2. افحص في الملف: `header.status`، `http_status_summary`، `ok_count/failed_count/identity_unresolved_count`؛ هل أعاد Yahoo كل الحقول الاسمية؟ (`meta_keys_seen`، `meta_invalid_fields`، `warnings` لكل سجل: `exchange_from_fullExchangeName`, `name_from_shortName`, `adjclose_absent`, `exchange_unmapped`).
3. تحقق من قيم `exchangeName` للسعودي (المتوقع `SAU`) والأمريكي (`NMS`/`NYQ`…) وأنها داخل جدول `exchangeAliases`، وأن `firstTradeDate` موجود، وأن تاريخ آخر شمعة = تاريخ جلسة السوق.
4. تحقق أن `quarantined_count = 0` في اليوم الأول (لا مرجع سابق) وأن أي حجر لاحق سببه حقيقي لا ضجيج مصدر.
5. `workflow_dispatch` بـ`publish=true` لينشأ الفرع `research-snapshots`؛ ثم `verify` على نسخة منه، وسجّل `chain_hash` الأول مرساةً خارجية.
6. أعد التشغيل في اليوم نفسه وتأكد من الرفض (رمز 3 / إشعار) ومن أن الملف لم يتغيّر.
7. بعد أول تشغيل مجدول ناجح: راجع أن اليوم الثاني يخزّن شمعة جديدة فقط (`bars_summary.stored`) وأن `instrument_id` ثابت.

## الملفات
`research/snapshot/collect.cjs` · `research/tests/snapshot-collect.test.cjs` (`node --test research/tests/snapshot-collect.test.cjs`) · `.github/workflows/snapshot-daily.yml` · المرجع: `identity.cjs`، `schema.sql`، `../DESIGN-INSTRUMENT-SNAPSHOT.md`.

</div>
