<div dir="rtl">

# مقترح جداول D1 لعزيز — سجل الإصدار والنتائج ونسخ الأسعار (للمراجعة، غير مطبّق)

**الحالة:** مقترح للمراجعة فقط. لا يوجد ملف ترحيل في `drizzle/`، فلا يطبقه النشر. التطبيق يحتاج موافقة منفصلة.
**المواصفة:** المرحلتان 1 و4 من مواصفة 2026-10-21. **قاعدة البيانات:** `mizan-equity-db`.
**قيود ثابتة:** لا جدولة تلقائية، لا تغيير في `forecasts()` أو `forecast_records`، لا كتابة من GET، لا قراءة من الـHoldout.

## 1. الجداول الثلاثة

### أ. `aziz_forecast_issues` — الإصدار (لا يُعاد كتابته)

| العمود | النوع | المعنى |
|---|---|---|
| id | TEXT PK | forecastId (UUID) |
| parent_forecast_id | TEXT | للجسر 5→21: معرف توقع الأصل |
| issue_type | TEXT CHECK (direct, bridge_5_to_21) | نوع الإصدار |
| market / symbol / instrument_id / currency / price_basis | TEXT | الهوية الكاملة (price_basis: split_adjusted أو total_return) |
| issued_at / target_session | TEXT | وقت الإصدار (UTC) وجلسة الهدف على تقويم السوق |
| initial_horizon / elapsed_sessions / remaining_sessions | INTEGER | 5 أو 21؛ للجسر: 5 و16 |
| calendar_id / calendar_version | TEXT | تقويم السوق المستخدم (proxy يُوسم كذلك) |
| input_hash / artifact_id / artifact_hash / policy_hash / feature_schema_version / model_version | TEXT | بصمات قابلة لإعادة الإنتاج |
| original_forecast_id / original_point | TEXT / REAL | توقع ميزان الأصلي على نفس الحالة (للمقارنة الزوجية) |
| ref_price / ref_price_session / source_id / data_revision | REAL / TEXT | السعر المرجعي ومصدره ونسخته |
| predicted_log_return / point_price | REAL | NULL عند الامتناع |
| probability_up / interval_low / interval_high / calibration_version | REAL / TEXT | NULL حتى تثبت المعايرة |
| monitor_state_version / eligibility_json / risk_json | TEXT | حالة المراقب والأهلية والمخاطر (منفصلة عن الاحتمال) |
| mode | TEXT CHECK (REPLAY, SHADOW) | لا ASSIST ولا ACTIVE في هذا المقترح |
| recorded / abstention_code / abstention_message | INTEGER / TEXT | امتناع مسجل بسبب مكتوب |
| created_at | TEXT | |

قيود: `UNIQUE(symbol, market, issue_type, initial_horizon, target_session, model_version, artifact_id)` تمنع تكرار الإصدار عند الاستئناف. **Trigger** `BEFORE UPDATE` يرفض أي تحديث (RAISE ABORT)؛ **Trigger** `BEFORE DELETE` يرفض الحذف.

### ب. `aziz_forecast_outcomes` — النتيجة (صف منفصل، نسخة لكل تصحيح)

| العمود | النوع | المعنى |
|---|---|---|
| id | TEXT PK | |
| forecast_id | TEXT FK → issues | |
| outcome_revision | INTEGER | 1 للأولى؛ تصحيح المصدر = صف جديد بزيادة الرقم، لا محو |
| observed_at / available_at / evaluated_at | TEXT | وقت الجلسة، وقت الإتاحة، وقت التقييم |
| actual_price / price_basis / source_id / data_revision | REAL / TEXT | |
| point_loss / direction_outcome / brier / interval_hit / interval_score | REAL / INTEGER | NULL لما لم يُصدر (نطاق لم يُصدر ⇒ interval_hit NULL) |
| event_key | TEXT UNIQUE | `forecast_id:target_session:outcome_revision` — إعادة الإرسال لا تزيد العينة |

قيود: `UNIQUE(forecast_id, outcome_revision)`، وTrigger يرفض UPDATE/DELETE.

### ج. `aziz_price_revisions` — نسخ الأسعار as-of (لا upsert)

| العمود | النوع | المعنى |
|---|---|---|
| id | TEXT PK | |
| symbol_id | TEXT FK → aziz_symbols | |
| session_date | TEXT | يوم الجلسة |
| revision | INTEGER | يزيد مع كل جلب يغيّر القيمة |
| opened/high/low/closed/adjusted_close/volume | REAL | |
| observed_at / published_at / received_at | TEXT | وقوع الجلسة / نشر المزود (NULL إن لم يُعرف) / الاستلام |
| availability_basis | TEXT CHECK (retrieval_time_only, provider_published_time) | |
| provider / dataset_id / raw_hash | TEXT | |

قيود: `UNIQUE(symbol_id, provider, session_date, revision)`. الاستعلام as-of: أعلى `revision` بحيث `received_at ≤ t` (أو `published_at ≤ t` حين يكون موثقًا). الجدول القائم `aziz_market_bars` يبقى كما هو، ويضاف إليه الإدراج في `aziz_price_revisions` من نفس مسار الاستيراد اليدوي (لا upsert جديد).

## 1-مكرر. الملف الفعلي والاختبار المتكامل (أُضيف 2026-10-22)
- **DDL الكامل للمراجعة:** `research/drafts/0017_aziz_issue_ledger.DRAFT.sql` — خارج `drizzle/` عمدًا، فلا يطبقه النشر.
- **قيود منع التكرار:** `UNIQUE(symbol, market, issue_type, initial_horizon, target_session, model_version, artifact_id)` على الإصدار؛ `UNIQUE(forecast_id, outcome_revision)` و`event_key UNIQUE` على النتيجة؛ `UNIQUE(symbol_id, provider, session_date, revision)` على الأسعار.
- **ربط النتيجة بالإصدار:** مفتاح أجنبي إلى `aziz_forecast_issues`، وTrigger يرفض نتيجة لإصدار ممتنع (`recorded=0`)، وTrigger يرفض Brier بلا احتمال مُصدر أو إصابة نطاق بلا نطاق مُصدر.
- **فصل الامتناع عن الدقة:** قيد CHECK يلزم الامتناع بكود وبلا نقطة، والإصدار بنقطة وبلا كود؛ عينة الدقة المرجعية تأخذ `recorded=1` وآخر نسخة نتيجة فقط؛ الامتناع يبقى في مقام `IssueRate`.
- **as-of:** وقت المعرفة هو `received_at` حصرًا (أو `published_at` حين يوثقه المزود). `session_date` ليس وقت معرفة. سعر 2021 مستورد اليوم يحمل `received_at` = اليوم، فأي استعلام as-of لتاريخ أقدم يعيد «غير معلوم». وقيد `data_as_of ≤ issued_at` يمنع ادعاء معرفة بعد وقت الإصدار.
- **إعادة الإرسال (تصحيح 2026-10-22):** الطلب المطابق **ينجح بلا أثر** ويعيد السجل المحفوظ (`status:'unchanged'`) دون صف جديد. نفس الهوية بمحتوى مختلف = **تعارض صريح** (`conflict`) ولا يُكتب شيء. الأساس: عمود `payload_hash` (sha256 للمحتوى القانوني دون حقول التسليم مثل `created_at`) — طبقة الكتابة `lib/aziz/ledger.ts`. القيود الفريدة في القاعدة خط دفاع ثانٍ إن تجاوز أحد طبقة الكتابة.
- **منع التسرب على مستوى كل مُدخل:** جدول رابع `aziz_issue_inputs` يسجل كل نسخة سعر استُخدمت في الإصدار. طبقة الكتابة ترفض نسخة `received_at` لها بعد `data_as_of`، وترفض إصدارًا مسجلًا بلا مدخلات، وتكتب الإصدار ومدخلاته في دفعة ذرية واحدة. وTrigger في القاعدة يرفض المدخل المتأخر حتى لو تُجووزت طبقة الكتابة. فالقيد `data_as_of ≤ issued_at` لم يعد وحده.
- **سياسة احتساب الدقة (معلنة):** نتيجة واحدة لكل إصدار مسجل = أعلى `outcome_revision` متاحة (`available_at`) حتى وقت قطع التقرير C. التصحيحات اللاحقة لـC لا تغيّر تقريرًا قُطع، والتقرير اللاحق يستخدمها ويصرّح بذلك. كل النسخ محفوظة؛ العينة تعدّ الإصدارات لا النسخ. العرض `aziz_scored_outcomes` والاستعلام `SCORED_AS_OF_SQL`.
- **الاختبار المتكامل:** `mizan-v45/tests/aziz-ledger-draft.test.mjs` (7/7) يثبت: إصدار محفوظ ← نتيجة عند الاستحقاق ← تصحيح كنسخة جديدة مع بقاء القديمة ← إعادة الإرسال (بنفس المفتاح أو بمعرف تسليم جديد) مرفوضة والعينة ثابتة ← الاستئناف لا يكرر الإصدار ← لا UPDATE/DELETE على الجداول الثلاثة ← الامتناع لا يدخل الدقة ← as-of بالاستلام.

## 2. مسار التطبيق الفعلي وحمايته (تصحيح 2026-10-22)
| المسار | هل يلتقط المسودة؟ | الحماية |
|---|---|---|
| خطوة النشر `wrangler d1 migrations apply` في `deploy-mizan-aziz.yml` و`deploy-mizan-equity.yml` (القاعدة مشتركة) | لا: تنسخ `mizan-v45/drizzle/` فقط، و`migrations_dir: "drizzle"` في `vite.config.ts:40` | اختبار `aziz-ledger-guard` يفشل إن ظهرت جداول السجل في أي ملف داخل `drizzle/` أو أشار أي workflow إلى `research/drafts` |
| تطبيق يدوي: `wrangler d1 execute --file`، أو لوحة D1 في Cloudflare، أو sqlite3 | ممكن نظريًا لمن يملك الصلاحية | سطر حارس أول في الملف يشير لجدول غير موجود، فيفشل التنفيذ على العبارة الأولى قبل أي CREATE (مختبَر) |
| التطبيق المعتمد (بعد موافقتك) | — | نسخ الملف إلى `mizan-v45/drizzle/0017_aziz_issue_ledger.sql` مع حذف سطر الحارس وحده، في PR منفصل؛ دمجه = تطبيقه بخطوة النشر على القاعدة المشتركة |

## 2-ب. الترحيل
- ملف واحد `drizzle/0017_aziz_issue_ledger.sql`: `CREATE TABLE IF NOT EXISTS` ×3 + فهارس + Triggers. **إضافي فقط**؛ لا ALTER ولا DROP ولا تعديل جدول قائم.
- يُطبّق تلقائيًا بخطوة `wrangler d1 migrations apply` الموجودة في النشر عند دمجه — لذلك لا يُدمج قبل موافقتك.
- بعد التطبيق: فحص `d1-job-state.yml` يُضاف إليه استعلام عدّ للجداول الثلاثة (قراءة فقط).

## 3. خطة التراجع
- قبل الدمج: لا شيء يُطبّق.
- بعد الدمج: الجداول الثلاثة مستقلة ولا يقرأها أي مسار إنتاجي؛ تعطيل المكوّن = عدم استدعائه، والجداول تبقى (لا فقد سجلات). إزالتها الكاملة تحتاج ترحيلًا لاحقًا بـDROP بموافقة صريحة، بعد تصدير محتواها.
- لا يمكن تطبيق الترحيل جزئيًا: ثلاث عبارات CREATE IF NOT EXISTS مستقلة، وفشل أي منها يوقف النشر قبل الاستبدال.

## 4. ما لا يشمله هذا المقترح
- أي كود يكتب في هذه الجداول (مسار REPLAY/SHADOW اليدوي) — خطوة لاحقة بطلب صريح، تشغيلها يدوي.
- أي تدريب أو معايرة؛ لا يوجد نموذج مقبول ليُصدر منه.

**القرار المطلوب:** الموافقة على المخطط كما هو (أو تعديله)، ثم موافقة ثانية على الدمج الذي يطبّقه.

</div>
