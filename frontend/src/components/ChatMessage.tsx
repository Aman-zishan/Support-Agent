import type { UIMessage } from "ai";

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (!text && isUser) return null;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-primary text-primary-foreground"
        }`}
      >
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {text.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < text.split("\n").length - 1 && <br />}
          </span>
        ))}

        {/* Show tool invocations */}
        {message.parts
          .filter(
            (p): p is Extract<typeof p, { type: "dynamic-tool" }> =>
              p.type === "dynamic-tool"
          )
          .map((part) => (
            <div
              key={part.toolCallId}
              className="mt-2 rounded-md border border-border/50 bg-background/50 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-medium">
                {part.state === "output-available" ? "Used" : "Using"} tool:
              </span>{" "}
              {part.toolName}
              {part.state !== "output-available" && (
                <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
