# عقد تكامل مقترح للمراجعة، بلا تطبيق على ميزان

## مدخلات مشتركة

- `schemaVersion: 1`, `market: SA|US`, `symbol`, `currency`, `priceBasis`، ومعرّف تقويم الجلسات.
- `base.id`, `issuedAt`, `shortTargetAt`, `targetAt`, `shortPrice`, `longPrice`, `shortHorizon=5`, `longHorizon=21`.
- `snapshot.asOf`, `observedThrough`, `elapsedSessions=5`, `remainingSessions=16`, `currentPrice.value`, `currentPrice.availableAt`, و`context[key].availableAt`.
- لكل نتيجة: `forecastId`, `targetAt`, `observedAt`, `availableAt`, `price`, نموذج ونسخة الإصدار؛ ولكل ميزة احتمالية `featuresAvailableAt`.

## استدعاءات منفصلة

- `buildBridgeInputs(snapshot,base)` يتحقق من الزمن والهوية وأساس السعر ولا يغير الأصل.
- `replayKalman(events,asOf,config)` يستخدم الأخطاء المنشورة والناضجة فقط.
- `fitBridge`, `trainDirection`, `fitProbabilityCalibration`, `calibrateInterval` تبنى على مراحل زمنية منفصلة.
- `observeMonitor` (التنفيذ الوحيد للمراقب) و`updateAci(state,outcome,asOf)` يحتاجان تخزين حالة ذريًا ومنع تكرار معرف الحدث؛ الدوال نفسها خالية من الكتابة.
- `assessEligibility` و`assessRisk` حدود تجريبية ينبغي وصلها بالخدمات الحالية لا تكرار قواعدها.
- `selectEffectiveForecast(base,candidate,monitor,mode='OFF',context)` يرجع إلى الأصل مع `reason` ما لم يكن الوضع ACTIVE والمراقب normal وتطابقت الهوية (الرمز، السوق، العملة، أساس السعر، إصدار النموذج) والصلاحية والاعتماد والأهلية؛ `context={asOf,approval,eligibility}`. التفاصيل في `FIXES-2026-10-21.md`.

## قبول قبل الوصل

فحص النسخة الحية قراءةً، خريطة توافق مع خدماتها، عينات سجلات حقيقية من السوقين منزوعة الأسرار، تحقق تعديل الأسعار وتقويم الجلسات، تجربة فشل حالة/مهلة/تكرار نتيجة، وحدود أداء، ثم تقرير Walk-Forward مختوم مقارنةً بالأصل وبالمرجع الحسابي. لا تُحوّل ملفات هذه الحزمة إلى مسار الإنتاج تلقائيًا.
