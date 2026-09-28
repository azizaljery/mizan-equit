# Flowise Agentflow V2 — Mizan Council v1

الغرض: إنشاء مجلس مرئي يمكن للمالك رؤية مراحله والتدخل قبل الإجراءات الحساسة.

## 1. Start Node

Flow State:

```json
{
  "task_id": "",
  "task": "",
  "repo_ref": "",
  "research_report": "",
  "critic_report": "",
  "developer_report": "",
  "verification_report": "",
  "disagreements": "",
  "requires_test": false,
  "requires_code": false,
  "owner_approval": false,
  "final_report": ""
}
```

## 2. Manager Agent

Model alias: `council-manager`

System prompt: قسم `Council Manager` من `roles/COUNCIL_V1.md`.

مهمته الأولى تصنيف الطلب إلى واحدة أو أكثر من:
- research
- critique
- code
- verify

ولا يستدعي Merge/Deploy في v1.

## 3. Researcher Agent

Model alias: `council-researcher`

يعمل في الجولة الأولى دون تمرير `critic_report` له. يكتب النتيجة في `research_report`.

## 4. Critic Agent

Model alias: `council-critic`

يعمل في الجولة الأولى دون تمرير `research_report` له. يكتب النتيجة في `critic_report`.

## 5. Reconciliation / Manager

بعد اكتمال المراجعتين، يحصل Manager على التقريرين معًا ويملأ:
- `disagreements`
- `requires_test`
- `requires_code`

القاعدة: الخلاف القابل للاختبار لا يُحسم بتصويت النماذج.

## 6. Developer Agent

Model alias: `council-developer`

لا يُستدعى إلا إذا `requires_code=true`.

في v1 يبقى بلا write tool إلى GitHub إلى أن ينجح اختبار المجلس نفسه. عند إضافة GitHub لاحقًا يجب تقييده بفرع تجربة فقط.

## 7. Verifier

في المرحلة الأولى يكون Verifier Tool/HTTP/Sandbox وليس نموذجًا صاحب قرار. مهمته تشغيل أوامر مسموحة وإرجاع:
- command
- commit/ref
- exit code
- stdout/stderr

ولا يكتب إصلاحات أثناء عملية التحقق نفسها.

## 8. Human Approval

أضف Human-in-the-loop قبل أي عقدة مستقبلية تملك:
- GitHub write
- Merge
- Deploy
- Secret access موسع
- حذف أو تعديل دائم

في v1 يجب أن ينتهي المسار بتقرير دون أي نشر تلقائي.

## 9. Final Council Report

يتضمن دائمًا:
- المهمة.
- رأي كل دور.
- الأدلة.
- الخلافات.
- الاختبارات المنفذة فعلًا.
- ما لم يُختبر.
- الحالة: `RESEARCH_ONLY | NEEDS_TEST | READY_FOR_OWNER_REVIEW`.

## ربط النماذج عبر LiteLLM

في كل Chat Model داخل Flowise:

- Base Path: `http://litellm:4000`
- Authorization Header: `Bearer <LITELLM_MASTER_KEY>`
- Model alias حسب الدور.

لا تدخل مفاتيح المزودين داخل كل Node.

## أول اختبار قبول للمجلس

المهمة الأولى المقترحة لا تحتاج أسرارًا:

> راجع خوارزمية PAVA مصغرة، واجعل Researcher يذكر الخصائص الرياضية، وCritic يقدم حالة مضادة، ثم اطلب من Manager تحديد تجربة فاصلة دون أن يغيّر أي ملف.

النجاح يعني:
1. استقلال الجولة الأولى.
2. ظهور الخلاف بوضوح.
3. عدم ادعاء تشغيل اختبار لم يحدث.
4. توقف المسار قبل أي إجراء حساس.
