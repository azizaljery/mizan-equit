import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response("مفتاح OPENAI_API_KEY غير موجود. أضِفه في ملف ‎.env.local", {
      status: 500,
    });
  }

  const { messages }: { messages: ChatMessage[] } = await req.json();

  const stream = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages,
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode("\n\n[حدث خطأ أثناء توليد الرد]")
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
