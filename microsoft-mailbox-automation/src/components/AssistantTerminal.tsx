"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Terminal, X, Send, Trash2, Loader2, Zap } from "lucide-react";

interface TerminalMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  actions?: Array<{ tool: string; result?: string; success: boolean }>;
  llmUsed?: boolean;
  navigateTo?: string;
  error?: string;
}

export function AssistantTerminal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalMessage[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdIndex, setCmdIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendCommand = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: TerminalMessage = {
      id: `u_${Date.now()}`, role: "user", content: text, timestamp: Date.now(),
    };
    setHistory((p) => [...p, userMsg]);
    setCmdHistory((p) => [...p, text]);
    setCmdIndex(-1);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/llm/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          context: typeof window !== "undefined" ? window.location.pathname : "/",
          conversationId,
          history: history.filter((m) => m.role === "user" || m.role === "assistant").slice(-8).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      setHistory((p) => [...p, {
        id: `a_${Date.now()}`, role: "assistant",
        content: data.speech || data.error || "No response.",
        timestamp: Date.now(),
        actions: data.actionsTaken || [],
        llmUsed: data.llmUsed,
        navigateTo: data.navigateTo,
        error: data.error,
      }]);
      if (data.navigateTo) setTimeout(() => router.push(data.navigateTo), 500);
    } catch (e: any) {
      setHistory((p) => [...p, {
        id: `e_${Date.now()}`, role: "system",
        content: `Error: ${e.message}`, timestamp: Date.now(), error: e.message,
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, conversationId, history, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); sendCommand(input); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const i = cmdIndex === -1 ? cmdHistory.length - 1 : Math.max(0, cmdIndex - 1);
      setCmdIndex(i); setInput(cmdHistory[i]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdIndex === -1) return;
      const i = cmdIndex + 1;
      if (i >= cmdHistory.length) { setCmdIndex(-1); setInput(""); }
      else { setCmdIndex(i); setInput(cmdHistory[i]); }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); setHistory([]); setConversationId(null);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[200] flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary shadow-lg backdrop-blur-md transition-all hover:scale-105 hover:bg-primary/20">
        <Terminal className="h-4 w-4" /> Assistant
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      </button>
    );
  }

  const quickCmds = [
    { l: "Sync mailbox", c: "Sync my mailbox and show new emails" },
    { l: "Analyze", c: "Analyze my inbox for research signals" },
    { l: "KOLs", c: "Show me the top KOL leaders" },
    { l: "Redeploy", c: "Redeploy this application" },
    { l: "Health", c: "Run a system health check" },
    { l: "Experiments", c: "List my active experiments" },
  ];

  return (
    <div className="fixed bottom-0 right-0 z-[200] w-full sm:w-[560px]">
      <div className="flex flex-col rounded-t-xl border border-border/60 bg-background/95 shadow-2xl backdrop-blur-xl" style={{ maxHeight: "70vh" }}>
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Assistant Terminal</span>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setHistory([]); setConversationId(null); }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Clear (Ctrl+L)">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: "200px" }}>
          {history.length === 0 && (
            <div className="text-center py-8">
              <Terminal className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Assistant Terminal ready. Type a command or use quick actions below.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {quickCmds.map((q) => (
                  <button key={q.l} onClick={() => sendCommand(q.c)}
                    className="rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary transition-colors">
                    {q.l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing...
            </div>
          )}
        </div>

        <div className="border-t border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 shrink-0 text-primary/60" />
            <input ref={inputRef} value={input}
              onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask anything, execute commands, navigate pages..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              disabled={loading} />
            <button onClick={() => sendCommand(input)} disabled={loading || !input.trim()}
              className="rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-40">
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: TerminalMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
        isUser ? "bg-primary/10 text-foreground border border-primary/20"
        : isSystem ? "bg-destructive/10 text-destructive border border-destructive/20"
        : "bg-muted/20 text-foreground border border-border/40"
      }`}>
        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        {msg.actions && msg.actions.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
            {msg.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={a.success ? "text-emerald-400" : "text-red-400"}>
                  {a.success ? "✓" : "✗"}
                </span>
                <code className="text-primary/80">{a.tool}</code>
                {a.result && <span className="truncate text-muted-foreground/70">{a.result.slice(0, 80)}</span>}
              </div>
            ))}
          </div>
        )}
        {msg.navigateTo && (
          <div className="mt-1 text-xs text-primary">→ navigating to {msg.navigateTo}</div>
        )}
      </div>
    </div>
  );
}
