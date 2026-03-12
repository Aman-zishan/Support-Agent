import { useState, useCallback } from "react";
import { Chat } from "./components/Chat";
import { ThreadSidebar } from "./components/ThreadSidebar";

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
}

function App() {
  const [threads, setThreads] = useState<Thread[]>(() => {
    const saved = localStorage.getItem("support-threads");
    if (saved) return JSON.parse(saved);
    const initial: Thread = {
      id: crypto.randomUUID(),
      title: "New conversation",
      createdAt: Date.now(),
    };
    return [initial];
  });
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);

  const persist = (updated: Thread[]) => {
    setThreads(updated);
    localStorage.setItem("support-threads", JSON.stringify(updated));
  };

  const handleNewThread = useCallback(() => {
    const thread: Thread = {
      id: crypto.randomUUID(),
      title: "New conversation",
      createdAt: Date.now(),
    };
    persist([thread, ...threads]);
    setActiveThreadId(thread.id);
  }, [threads]);

  const handleDeleteThread = useCallback(
    (id: string) => {
      const updated = threads.filter((t) => t.id !== id);
      if (updated.length === 0) {
        handleNewThread();
        return;
      }
      persist(updated);
      if (activeThreadId === id) {
        setActiveThreadId(updated[0].id);
      }
    },
    [threads, activeThreadId, handleNewThread]
  );

  const handleUpdateTitle = useCallback(
    (id: string, title: string) => {
      persist(threads.map((t) => (t.id === id ? { ...t, title } : t)));
    },
    [threads]
  );

  return (
    <div className="flex h-screen bg-background">
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={setActiveThreadId}
        onNew={handleNewThread}
        onDelete={handleDeleteThread}
      />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
              S
            </div>
            <div>
              <h1 className="text-sm font-semibold">Support Agent</h1>
              <p className="text-xs text-muted-foreground">
                Multi-agent customer support
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Memory active
          </div>
        </header>

        <Chat
          key={activeThreadId}
          threadId={activeThreadId}
          onFirstMessage={(msg) =>
            handleUpdateTitle(
              activeThreadId,
              msg.length > 40 ? msg.slice(0, 40) + "..." : msg
            )
          }
        />
      </div>
    </div>
  );
}

export default App;
