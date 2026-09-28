# طلب تحقق إنتاجي من Cron — ميزان

الحالة: **NOT SENT**. لم يُعثر في المراسلات المتاحة على مستلم دعم موثق للمشروع. لا تُرسل هذه البيانات إلى عنوان مُخمّن.

إلى مسؤول استضافة Sites الذي يدير مورد Cloudflare الخاص بالموقع:

الموضوع: تأكيد تسجيل وربط Cron لتقييم توقعات ميزان المستحقة

نرجو فحص الموقع https://mizan-equity.aljeryabod.chatgpt.site، المشروع `appgprj_6a9bd7353ed4819193fcd5363ed1d38f`.

أظهرت سجلات الإنتاج اسم Worker الفعلي `site---6a9bd7353ed4819193fcd5363ed1d38f` داخل dispatch namespace باسم `production`. الاسم المفترض `mizan` لم يثبت أنه اسم المورد المنشور. يرجى تحديد المورد والحساب الصحيحين من جهة الاستضافة.

نحتاج مخرجات JSON تشمل:

1. قائمة Triggers الفعلية، والتصريح بأن `0 */6 * * *` مسجل أو غير مسجل، وأي Trigger آخر على المورد نفسه.
2. آخر 20 استدعاء **scheduled** متاحة خلال آخر 7 أيام: UTC، التعبير، النتيجة، المدة، ومعرف إصدار Worker. إذا كانت السجلات أقل أو خاضعة لأخذ عينات، يرجى التصريح بذلك.
3. تأكيد أن الحدث يصل إلى `worker/index.ts` ثم `scheduledResolution` في النسخة المنشورة، وأن متغير التشغيل `MIZAN_BACKGROUND_CRON_ENABLED` يمرر إلى ذلك المورد.
4. بيان ما إذا كان مسار نشر Sites ينقل `triggers.crons` الموجود في مخرجات البناء إلى المورد داخل dispatch namespace، أم أن تسجيله يتطلب إجراءً آخر لدى المنصة. لا نريد Trigger ثانيًا أو مجدولًا موازيًا.
5. مطابقة وقت التشغيل ومعرفه مع `job:evaluate-due:last-cron` في D1، وحقول `triggeredBy`, `cron`, `scheduledTime`, `status`, `stateSaved`, `finishedAt`, `evaluationsSaved`, `symbolsScanned`, `symbolsFailed`.

مصدر تعريف التعبير داخل المشروع هو `vite.config.ts`؛ ملف Wrangler الناتج مخرج بناء وليس مصدرًا ثانيًا للتعديل. آخر نشر مثبت قبل هذه الجولة كان 2026-09-12 23:27:57 UTC. يرجى استخدام النسخة الحية الأحدث عند الفحص.

التحقق المتاح لنا قرأ 11 حدثًا من نافذة آخر 7 أيام، كلها `fetch`؛ لم يتضمن الرد أحداث scheduled. هذه عينة متاحة وليست برهانًا على عدم تشغيل Cron أو عدم تسجيله.

لـWorker عادي فقط، توثق Cloudflare قراءة الجداول عبر `GET /accounts/{account_id}/workers/scripts/{script_name}/schedules`. يرجى تحديد المسار المناسب لمورد dispatch الفعلي من جهتكم، دون تطبيق اسم أو Account ID مُفترض. [مرجع API الرسمي](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/).

أداة Wrangler المثبتة 4.92.0 تعرض `triggers deploy` ولا تعرض `triggers list`. الأول يغيّر الإعدادات؛ ليس بديلًا لقراءة التسجيل. كما أن `deployments list` يعرض النشرات، وليس آخر استدعاءات scheduled. [أوامر Wrangler الرسمية](https://developers.cloudflare.com/workers/wrangler/commands/).

لا يتضمن هذا الطلب كلمات مرور أو cookies أو رموز وصول. إكمال القراءة المحلية ووجود المعالج في الكود لا يُقدّمان كتأكيد تسجيل إنتاجي.
