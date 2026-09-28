# مجلس ميزان — Mizan Council v1

منصة مستقلة لإدارة عدة نماذج ذكاء اصطناعي من واجهة واحدة، مع مدير مجلس يوزّع المهام ومراجعين مستقلين وموافقة بشرية قبل أي إجراء حساس.

> هذه النسخة **لا تعدّل ميزان الحي** ولا تملك صلاحية نشر أو دمج تلقائي. الغرض منها تأسيس بيئة مجلس مستقلة وآمنة أولاً.

## البنية

- **Flowise Agentflow V2**: الواجهة المرئية، المدير، توزيع المهام، Shared State، Human-in-the-loop.
- **LiteLLM Proxy**: بوابة موحدة للنماذج، بحيث يتصل Flowise بعنوان واحد بدل ربط كل مزود داخل كل Flow.
- **PostgreSQL**: قاعدة مستقلة لـ Flowise وقاعدة مستقلة لـ LiteLLM.
- **GitHub**: لاحقًا كأداة قراءة ومراجعة وفروع تجريبية، وليس كخزنة أسرار.

## الأدوار في النسخة الأولى

1. **Council Manager** — مدير المجلس، يوزع العمل ويجمع النتائج ولا يعتمد النشر.
2. **Developer** — يكتب Patch في فرع تجريبي فقط.
3. **Researcher** — يتحقق من المراجع والادعاءات.
4. **Critic** — يحاول كسر الحل واكتشاف الأخطاء وحالات الفشل.
5. **Verifier** — يشغّل الاختبارات وBuild ويعيد السجلات الخام؛ لا يتخذ قرارًا استثماريًا ولا ينشر.
6. **Owner** — صاحب القرار النهائي؛ أي Merge/Deploy/Secret access حساس يتطلب موافقة صريحة.

## التشغيل المحلي

```bash
cd mizan-council
cp .env.example .env
# ضع المفاتيح الحقيقية في .env محليًا فقط. لا ترفع .env إلى GitHub.
docker compose up -d
```

بعد التشغيل:

- Flowise: `http://127.0.0.1:3000`
- LiteLLM: `http://127.0.0.1:4000`

## ربط Flowise بـ LiteLLM

في Flowise استخدم OpenAI-compatible Chat Model:

- Base URL: `http://litellm:4000`
- Header: `Authorization: Bearer <LITELLM_MASTER_KEY>`
- Model: أحد الأسماء المعرفة في `litellm_config.yaml`

لا تضع مفاتيح OpenAI/Anthropic/Google/DeepSeek داخل العقد نفسها إذا كنت تستخدم LiteLLM كبوابة مركزية.

## بناء Agentflow V2 — النسخة الأولى

أنشئ Flow باسم `Mizan Council v1` بهذا التسلسل:

```text
Start
  ↓
Council Manager
  ├── Researcher
  ├── Critic
  ├── Developer
  └── Verifier
  ↓
Human Approval
  ↓
Final Council Report
```

استخدم وثيقة `roles/COUNCIL_V1.md` كنصوص System لكل دور.

### Shared State المقترح

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
  "owner_approval": false,
  "final_report": ""
}
```

## سياسة أساسية

- الجولة الأولى مستقلة: لا يرى الباحث والناقد رأي بعضهما قبل إتمام المراجعة الأولية.
- الخلاف لا يحسم بالتصويت؛ يحسم باختبار أو دليل يمكن إعادة تشغيله.
- لا يوجد وكيل يملك وحده: كتابة الكود + اعتماده + نشره.
- الأوزان والمعادلات الخاصة ومفاتيح API لا تدخل GitHub ولا الرسائل العامة.
- لا يتم ربط المجلس ببيئة إنتاج ميزان في v1.

## ما الذي لم يُنجز بعد؟

- لم تُدخل مفاتيح المزودين لأن الأسرار لا تحفظ في GitHub.
- لم يُنشأ Agentflow داخل خادم Flowise بعد؛ يتطلب تشغيل Flowise ثم إنشاء/استيراد الـFlow على النسخة الفعلية.
- لم تُربط أدوات GitHub/Build بالمجلس بعد؛ هذه المرحلة التالية بعد التأكد من تشغيل النواة.
- لم يتم نشر Flowise للإنترنت؛ افتراضيًا المنافذ مربوطة بـ localhost فقط.

## الخطوة التالية

1. تشغيل الحاويات والتحقق من الصحة.
2. إدخال مفاتيح المزودين محليًا/Secret Manager.
3. إنشاء `Mizan Council v1` في Agentflow V2.
4. اختبار مهمة غير حساسة واحدة بين Manager/Researcher/Critic.
5. بعدها فقط ربط Developer/Verifier بـ GitHub وبيئة Sandbox.
