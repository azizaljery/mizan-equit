# Com — محادثة مباشرة مع OpenAI

تطبيق **Next.js** بسيط يعرض ردود OpenAI **مباشرة (Streaming)** — النص يظهر كلمة كلمة وقت توليده.

## التشغيل

### ١. ثبّت الحزم
```bash
npm install
```

### ٢. ضع مفتاح OpenAI
انسخ ملف المثال ثم ضع مفتاحك الحقيقي:
```bash
cp .env.example .env.local
```
افتح `.env.local` وضع المفتاح:
```
OPENAI_API_KEY=sk-...
```
احصل على المفتاح من: <https://platform.openai.com/api-keys>

### ٣. شغّل
```bash
npm run dev
```
افتح <http://localhost:3000>

## بنية المشروع

| الملف | الوظيفة |
|---|---|
| `app/api/chat/route.ts` | الخادم — يستدعي OpenAI بـ `stream: true` ويبثّ النص |
| `app/page.tsx` | الواجهة — تقرأ البثّ أول بأول وتعرضه فوراً |
| `app/layout.tsx` | التخطيط العام (اتجاه RTL + عربي) |
| `.env.example` | نموذج المتغيّرات (لا يحوي مفاتيح حقيقية) |

## المفتاح التقني للـ Streaming

- **الخادم**: `stream: true` + `ReadableStream` لبثّ كل جزء.
- **الواجهة**: `reader.read()` في حلقة لقراءة الأجزاء ودمجها في الرسالة.
