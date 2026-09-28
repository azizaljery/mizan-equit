"use client";

import { useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo(0, listRef.current.scrollHeight);
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    scrollToBottom();

    // نضيف رسالة مساعد فارغة نملأها أثناء الـ streaming
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.body) throw new Error("لا يوجد رد");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: copy[copy.length - 1].content + chunk,
          };
          return copy;
        });
        scrollToBottom();
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "تعذّر الاتصال بالخادم.",
        };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="wrap">
      <div className="header">
        مساعدي الذكي
        <span>OpenAI · Streaming</span>
      </div>

      <div className="messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty">اكتب رسالة وابدأ المحادثة…</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content || "…"}
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          rows={1}
          value={input}
          placeholder="اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button onClick={send} disabled={loading || !input.trim()}>
          {loading ? "…" : "إرسال"}
        </button>
      </div>
    </div>
  );
}
