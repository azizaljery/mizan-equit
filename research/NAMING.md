# سجل الاسم: VOSA → SHARA (2026-10-14)

قرار المالك: تغيير الاسم الرسمي من VOSA (فوسا) إلى **SHARA**.
هذا يلغي سياسة التسمية في `VOSA_Official_Naming_Policy_AR.docx` (التي ثبّتت VOSA ومنعت SHARA)؛ تنص السياسة على أن التغيير يتطلب إصداراً رئيسياً وخطة ترحيل — هذا السجل هو خطة الترحيل.

| العنصر | قبل | بعد |
|---|---|---|
| مجلد المكتبة | `lib/vosa/` | `lib/shara/` |
| الكلاسات والأنواع | `VosaEngine`، `VosaGate`… | `SharaEngine`، `SharaGate`… |
| ثوابت | `VOSA_ENFORCE_MARKET_GATES`… | `SHARA_ENFORCE_MARKET_GATES`… |
| ملف الفرز | `lib/screener-vosa.ts` | `lib/screener-shara.ts` |
| مفتاح JSON في نتيجة الفرز | `vosa` | `shara` |
| عدّاد الاستبعاد | `vosa_market_gate` | `shara_market_gate` |
| إصدار خط الفرز | `vosa-screener-1` | `shara-screener-1` |
| اختبارات / workflow | `vosa-*.test.ts`، `verify-vosa-live.yml` | `shara-*.test.ts`، `verify-shara-live.yml` |

توافق رجعي: النتائج المؤرشفة التي تحمل المفتاح القديم `vosa` تُقرأ وتُدمج، ولا يُكتب المفتاح القديم أبداً (اختبار مخصص).
لم يُغيَّر عمداً: `inspect-old-worker.yml` (يبحث في الـWorker القديم عن الاسم القديم)، وسجلات `ci-diagnostics/` والوثائق التاريخية في `research/` (تحتفظ بالاسم الذي كان مستخدماً وقتها).
سلوك الفرز لم يتغير (الطبقة ما زالت ظلية).
