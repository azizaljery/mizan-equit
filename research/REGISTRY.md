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
| EXP-0004 | نطاق محايد مقيس بالتذبذب `k·σ·√h` | **REJECTED بصيغته المطلقة** | عند k≥0.1 تغطية ≈0% لأن حجم مخرج النموذج أصغر بكثير من σ√h؛ عند k=0 (إشارة فقط) لا تفوق. التفاصيل في RESEARCH-LOG |
| EXP-0004b | امتناع نسبي (أعلى ن% من \|z\|) | EXPLORATORY | قمة 5% عند أفق 5: 57.4% [51.1–63.4] مقابل 52.9% — نافذة واحدة؛ يحتاج Walk-Forward |
| INC-1102 | حادثة CPU في الـWorker | سبب مباشر مُثبت، الخطة بانتظار تأكيد المالك | `research/INCIDENT-1102.md` |
| ACI-REAL | Nonconformity Buffer + Adaptive Alpha + Coverage | مخطط، بعد تثبيت خط الأساس | تغيير عامل واحد في كل مرة |

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

## ترتيب التنفيذ المعتمد
1102 ← تثبيت التشغيل ← EXP-0004 (نطاق محايد مقيس بالتذبذب) ← إعادة قياس خط الأساس ← استبعاد سلبي بلا تحيز بقاء (Walk-Forward + تكاليف) ← ACI ← تقييم بوابات SHARA ← قرار ENFORCE.

## مخرجات إلزامية لكل تجربة اتجاه
الدقة على غير المحايد · التغطية · توزيع صاعد/محايد/هابط · IC · المعايرة (إن أمكن) · عدد المرشحين قبل/بعد SHARA · النتائج حسب الأفق والسوق (لا المتوسط وحده) · المقياس القديم بجانب الجديد.

## أمن
مفاتيح Cloudflare التي ظهرت في لقطة شاشة سابقة تُعامل كمكشوفة وتُدوَّر؛ لا تُحفظ قيمها في المستودع أو التقارير.
