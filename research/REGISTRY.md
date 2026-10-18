# سجل البحث والحوكمة — ميزان (يُحدَّث مع كل دفعة)

## مراحل الحالة (لا تُستخدم كلمة «مكتمل» لأي خوارزمية)
`IMPLEMENTED → CODE-TESTED → SHADOW-VALIDATED → RESEARCH-VALIDATED → PRODUCTION-ENFORCED`
- IMPLEMENTED: الكود موجود. CODE-TESTED: اختبارات وحدة/تكامل ناجحة (لا تثبت أي تحسن تنبؤي).
- SHADOW-VALIDATED: يعمل على بيانات حية دون التأثير على القرار، ونتائجه مسجلة.
- RESEARCH-VALIDATED: تحسن مثبت خارج العينة (Walk-Forward، بلا تحيز بقاء، بتكاليف واقعية).
- PRODUCTION-ENFORCED: يؤثر فعلاً على القرار بعد قرار المالك.
مصطلحات إضافية: `EXPLORATORY` (نتيجة أولية)، `REJECTED`، `SOURCE MISSING` (فكرة محفوظة بلا مصدرها الأصلي).

## الخوارزميات والمكوّنات
| المعرّف | المكوّن | الحالة | الدليل / الملاحظة |
|---|---|---|---|
| SHARA-ENGINE | محرك PASS/KILL/SUSPEND (`lib/shara/engine.ts`) | CODE-TESTED | اختبارات حدّية: NaN/Infinity/ناقص/تعارض هوية. لا ادعاء تنبؤي |
| SHARA-PARITY | 8 بوابات تكافئ `candidateExclusion` | SHADOW-VALIDATED (تكافؤ فقط) | تكافؤ على 29 حالة + ظهور المفتاح `shara` في الموقع الحي. لا تغيير في الاختيار |
| SHARA-MARKET | بوابات السيولة/ATR/حداثة السعر | CODE-TESTED، عتباتها **غير مُثبتة** | `SHARA_ENFORCE_MARKET_GATES=false`؛ ممنوع التفعيل قبل تقييم البوابات |
| SHARA-CHAIN | سلسلة تدقيق SHA-256 | CODE-TESTED | غير مربوطة بالإنتاج، في الذاكرة |
| SHARA-LINEAGE | سلالة إصدارات + No Resurrection | CODE-TESTED | غير مربوطة بالإنتاج |
| FORECAST-BASELINE | `forecasts()` الحالي | قياس خط الأساس (EXP-0001) | IC غير معنوي؛ محايد 87–100% |
| EXP-0001 | خط أساس الاتجاه | EXPLORATORY | سعري فقط، 80 سهماً، تحيز بقاء |
| EXP-0002 | IC ميزات سعرية | EXPLORATORY | الزخم متوسط المدى ثابت الإشارة، الحجم صغير |
| HYP-NEGSEL-0001 | الاستبعاد السلبي | EXPLORATORY (سعودي فقط) | **ليس VERIFIED**: تحيز بقاء، بلا تكاليف، بلا مكونات تاريخية |
| EXP-0004 | نطاق محايد مقيس بالتذبذب `k·σ·√h` | **REJECTED بصيغته المطلقة** (سجل: FA-001) | عند k≥0.1 تغطية ≈0% لأن حجم مخرج النموذج أصغر بكثير من σ√h؛ عند k=0 (إشارة فقط) لا تفوق. التفاصيل في RESEARCH-LOG |
| EXP-0004b | امتناع نسبي (أعلى ن% من \|z\|) | EXPLORATORY | قمة 5% عند أفق 5: 57.4% [51.1–63.4] مقابل 52.9% — نافذة واحدة؛ يحتاج Walk-Forward |
| INC-1102 | حادثة CPU في الـWorker | **CLOSED (2026-10-17)** | ترقية المالك إلى Workers Paid + `limits.cpu_ms=30000`؛ 24 ساعة: 719 تشغيلاً كلها success، صفر exceededResources. التفاصيل: `research/INCIDENT-1102.md` |
| ACI-REAL | Nonconformity Buffer + Adaptive Alpha + Coverage | مخطط — **مسار مستقل** بعد الاستبعاد السلبي | لا يُخلط مع تجربة الاستبعاد السلبي ولا مع تغيير الاتجاه؛ كل واحد في تجربة منفصلة |
| NEGSEL-0002 | استبعاد سلبي بأقل تحيز بقاء ممكن | بروتوكول مجمّد (`PROTOCOL-NEGSEL-0002.md`)؛ **CODE-TESTED** (39 اختباراً) · نتيجة Dev/Validation = **INCONCLUSIVE** (n فعّال 42 < حد قوة 60 وضعه المنفّذ ويحتاج اعتماد المالك)؛ **سقف الحالة: SHADOW-VALIDATED** ما دام الكون بلا مشطوبات. **قرار المالك 2026-10-15:** HOLDOUT SEALED · INCONCLUSIVE · حد 60 مؤقت (حد أدنى تشغيلي) · متابعة الجمع الأمامي · إعادة الاختبار بعد تحقق القوة المحددة مسبقاً (`PROTOCOL-NEGSEL-0002-AMEND-1.md`) | تشغيل Development/Validation فقط؛ الـHoldout (30%) مغلق حتى مراجعة المالك لنتائج المرحلة السابقة واختباراتها. النتيجة غير الحاسمة تُسجَّل INCONCLUSIVE دون تغيير البروتوكول |
| DIR-0001 | نموذج اتجاه احتمالي (مكوّن عزيز `probability.mjs`) لأفق 5/21 | **REJECTED** (FA-004، 2026-10-18) | الأساسي: lift +3.26 [−0.19, +6.71]، BSS −0.031. `mom126_5` وحده: دلالة أولية داخل عينة التطوير فقط |
| DIR-0002 | اختبار أمامي لـ`mom126_5` (أعلى 20%) + سجل ترشيحات يومي | **بروتوكول مجمّد** (`PROTOCOL-DIR-0002.md`) — اختبار رسمي فقط عند n_eff ≥ 60 (~60 أسبوعاً)؛ هدف المالك 80% مُعلن كطموح لا كمعيار | قرار المالك 2026-10-18 |
| ARCH-IDENTITY | هوية الورقة المالية وليس الرمز وحده | بند معماري مستقل — تصميم (`DESIGN-INSTRUMENT-SNAPSHOT.md`) | اكتشاف SBNY/BBBY. B ليس حلاً لتحيز البقاء التاريخي؛ بنية تمنع تكراره مستقبلاً |

## Placeholders — `SOURCE MISSING` (لا تُخترع من الذاكرة)
| المعرّف | الفكرة | الحالة | المطلوب |
|---|---|---|---|
| IAI | Independent Agreement / Consensus Gate | SOURCE MISSING | النسخة الأصلية أو إعادة بناء بوصفها إصداراً جديداً مُعلناً، لا «استعادة» |
| HYPER-SELECTIVE | Hyper-Selective gates | SOURCE MISSING | كذلك |
| ULTRA-SELECTIVE | Ultra-Selective sequential defensive gates | SOURCE MISSING | كذلك |
| STRUCTURAL-EDGES | مسار Structural Edges المستقل | SOURCE MISSING | كذلك + تحديد البيانات المطلوبة |
| EQ-80 | ~80 معادلة بحثية قديمة | SOURCE MISSING | الملفات الأصلية |
| VOSA-EXT-20 | الامتدادات العشرون (`vosa_20_extensions.py` في الحزمة فارغ) | SOURCE MISSING | الملف الأصلي |
| ACI-ORACLE | `Mizan-Conformal-Oracle.ts` | مُلتقَط، معطوب (`conformalMultiplier` غير معرّف) | لا يُدمج؛ يُعاد بناؤه كإصدار جديد |

## قرارات المالك المعتمدة (2026-10-15)
- `forecasts()` لا يُغيَّر الآن. SHARA يبقى ظلياً ولا تُفعَّل بوابات KILL الجديدة.
- 1102: السبب المباشر CPU exceeded (مُثبت). كون الحد 10ms سببه الخطة المجانية **UNVERIFIED** حتى يفحص المالك نوع الخطة؛ لا يُبنى قرار نهائي عليه.
- المحاولات الفاشلة تُحفظ في `FAILED-ATTEMPTS.md` ولا تُحذف.
- كل نتيجة جديدة تُعرض: Hypothesis → Baseline → Experiment → Out-of-sample Result → Statistical Evidence → Failure Modes → Decision.
- المعيار: لا نبحث عن عتبة تُمرر الأسهم؛ نبحث عن Edge يصمد خارج العينة بعد إزالة مصادر التحيز المعروفة.

## قرارات المالك (2026-10-15، الدفعة الثانية)
- اعتماد A + B بالتوازي: A = تجربة على البيانات الحالية (Dev/Validation فقط)، B = تصميم لقطة يومية Point-in-Time بهوية ورقة وprovenance.
- الترتيب: NEGSEL implementation/tests → Development/Validation → مراجعة النتائج → قرار فتح Holdout مرة واحدة → ثم ACI (لا ACI بالتوازي).
- شروط النجاح في البروتوكول لا تتغير بعد رؤية النتائج.

## ترتيب التنفيذ المعتمد
1102 ← تثبيت التشغيل ← EXP-0004 (نطاق محايد مقيس بالتذبذب) ← إعادة قياس خط الأساس ← استبعاد سلبي بلا تحيز بقاء (Walk-Forward + تكاليف) ← ACI ← تقييم بوابات SHARA ← قرار ENFORCE.

## مخرجات إلزامية لكل تجربة اتجاه
الدقة على غير المحايد · التغطية · توزيع صاعد/محايد/هابط · IC · المعايرة (إن أمكن) · عدد المرشحين قبل/بعد SHARA · النتائج حسب الأفق والسوق (لا المتوسط وحده) · المقياس القديم بجانب الجديد.

## أمن
مفاتيح Cloudflare التي ظهرت في لقطة شاشة سابقة تُعامل كمكشوفة وتُدوَّر؛ لا تُحفظ قيمها في المستودع أو التقارير.
