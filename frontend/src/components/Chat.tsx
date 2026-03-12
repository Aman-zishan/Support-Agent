import { useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { ChatMessage } from "./ChatMessage";

const MASTRA_BASE = "";

interface ChatProps {
  threadId: string;
  onFirstMessage?: (text: string) => void;
}

async function fetchThreadMessages(threadId: string): Promise<UIMessage[]> {
  try {
    const res = await fetch(
      `${MASTRA_BASE}/api/memory/threads/${threadId}/messages`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.messages ?? [];
    return raw
      .map((m: Record<string, unknown>) => {
        const content = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
        if (!content?.parts) return null;
        return {
          id: m.id as string,
          role: m.role as "user" | "assistant",
          parts: content.parts,
        };
      })
      .filter(Boolean) as UIMessage[];
  } catch {
    return [];
  }
}

export function Chat({ threadId, onFirstMessage }: ChatProps) {
  const resourceId = "demo-user";
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  const hasSentFirst = useRef(false);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
    null
  );

  useEffect(() => {
    fetchThreadMessages(threadId).then((msgs) => {
      setInitialMessages(msgs);
      if (msgs.length > 0) hasSentFirst.current = true;
    });
  }, [threadId]);

  if (initialMessages === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <ChatInner
      threadId={threadId}
      resourceId={resourceId}
      initialMessages={initialMessages}
      inputValue={inputValue}
      setInputValue={setInputValue}
      hasSentFirst={hasSentFirst}
      scrollRef={scrollRef}
      inputRef={inputRef}
      onFirstMessage={onFirstMessage}
    />
  );
}

function ChatInner({
  threadId,
  resourceId,
  initialMessages,
  inputValue,
  setInputValue,
  hasSentFirst,
  scrollRef,
  inputRef,
  onFirstMessage,
}: {
  threadId: string;
  resourceId: string;
  initialMessages: UIMessage[];
  inputValue: string;
  setInputValue: (v: string) => void;
  hasSentFirst: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFirstMessage?: (text: string) => void;
}) {
  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `${MASTRA_BASE}/chat`,
      body: { memory: { thread: threadId, resource: resourceId } },
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, scrollRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue("");
    if (!hasSentFirst.current) {
      hasSentFirst.current = true;
      onFirstMessage?.(text);
    }
    await sendMessage({ text });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <svg
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium">How can we help?</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                I'm your support assistant. I can help with billing, technical
                issues, or account questions.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  "I was charged twice (ID: C001)",
                  "API returning 403 errors (ID: C002)",
                  "Reset my password (ID: C003)",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInputValue(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                AI
              </div>
              <div className="rounded-xl bg-muted px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-background px-4 py-3">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-center gap-2"
        >
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe your issue..."
            disabled={isLoading}
            className="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {isLoading ? (
              <svg
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            )}
          </button>
        </form>
        <p className="mx-auto max-w-2xl mt-1.5 text-[10px] text-muted-foreground">
          Powered by Mastra + Groq (Llama 3.3 70B)
        </p>
      </div>
    </div>
  );
}
