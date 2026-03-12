import type { Thread } from "../App";

interface ThreadSidebarProps {
  threads: Thread[];
  activeThreadId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ThreadSidebar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onDelete,
}: ThreadSidebarProps) {
  return (
    <div className="flex w-64 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Threads
        </span>
        <button
          onClick={onNew}
          className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => (
          <div
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            className={`group flex items-center justify-between px-4 py-2.5 cursor-pointer border-b border-border/50 transition-colors ${
              thread.id === activeThreadId
                ? "bg-accent"
                : "hover:bg-accent/50"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{thread.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(thread.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(thread.id);
              }}
              className="ml-2 hidden rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="border-t px-4 py-2">
        <p className="text-[10px] text-muted-foreground text-center">
          Each thread has its own memory
        </p>
      </div>
    </div>
  );
}
