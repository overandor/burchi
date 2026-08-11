"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Terminal, X, Send, Trash2, Loader2, Zap, Wrench } from "lucide-react";

interface TerminalMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  actions?: Array<{ tool: string; result?: string; success: boolean }>;
  llmUsed?: boolean;
  navigateTo?: string;
  error?: string;
  pageAction?: { type: string; selector?: string; result?: string };
}

const STORAGE_KEY = "assistant-terminal-state";

interface PersistedState {
  open: boolean;
  history: TerminalMessage[];
  cmdHistory: string[];
  conversationId: string | null;
}

function loadPersistedState(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function savePersistedState(state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, history: state.history.slice(-20) }));
    } catch {}
  }
}

function extractPageContext(): {
  pathname: string; title: string; headings: string[]; buttons: string[];
  errors: string[]; forms: Array<{ action: string; fields: string[] }>; textSummary: string;
} {
  if (typeof document === "undefined")
    return { pathname: "", title: "", headings: [], buttons: [], errors: [], forms: [], textSummary: "" };
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((el) => el.textContent?.trim() || "").filter(Boolean).slice(0, 10);
  const buttons = Array.from(document.querySelectorAll("button, a[role='button']"))
    .map((el) => el.textContent?.trim() || "").filter(Boolean).slice(0, 20);
  const errors = Array.from(document.querySelectorAll("[class*='error'], [class*='destructive'], [role='alert']"))
    .map((el) => el.textContent?.trim() || "").filter(Boolean).slice(0, 10);
  const forms = Array.from(document.querySelectorAll("form"))
    .map((form) => ({
      action: form.action || form.getAttribute("action") || "",
      fields: Array.from(form.querySelectorAll("input, select, textarea"))
        .map((f) => f.getAttribute("name") || f.getAttribute("placeholder") || f.getAttribute("id") || "unknown")
        .filter(Boolean),
    })).slice(0, 5);
  const bodyText = document.body?.innerText || "";
  return { pathname: window.location.pathname, title: document.title, headings, buttons, errors, forms, textSummary: bodyText.slice(0, 3000) };
}

function clickElement(selector: string): { success: boolean; message: string } {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { success: false, message: `Element not found: ${selector}` };
    el.click();
    return { success: true, message: `Clicked: ${selector}` };
  } catch (e: any) {
    return { success: false, message: `Click failed: ${e.message}` };
  }
}

function clickButtonByText(text: string): { success: boolean; message: string } {
  try {
    const buttons = Array.from(document.querySelectorAll("button, a[role='button'], a"));
    const match = buttons.find((b) => (b.textContent?.trim().toLowerCase() || "").includes(text.toLowerCase()));
    if (!match) return { success: false, message: `No button found with text: "${text}"` };
    (match as HTMLElement).click();
    return { success: true, message: `Clicked button: "${text}"` };
  } catch (e: any) {
    return { success: false, message: `Button click failed: ${e.message}` };
  }
}

function fillFormField(selector: string, value: string): { success: boolean; message: string } {
  try {
    const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return { success: false, message: `Field not found: ${selector}` };
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, message: `Filled ${selector} with "${value.slice(0, 50)}"` };
  } catch (e: any) {
    return { success: false, message: `Fill failed: ${e.message}` };
  }
}

function detectPageErrors(): { errors: string[]; hasErrors: boolean } {
  const errorEls = Array.from(document.querySelectorAll("[class*='error'], [class*='destructive'], [role='alert']"));
  const errors = errorEls.map((el) => el.textContent?.trim() || "")
    .filter((t) => t.length > 5 && !t.includes("✓")).slice(0, 10);
  return { errors, hasErrors: errors.length > 0 };
}

export function AssistantTerminal() {
  const router = useRouter();
  const persisted = useRef<Partial<PersistedState>>(loadPersistedState());
  const [open, setOpen] = useState(persisted.current.open ?? false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalMessage[]>(persisted.current.history ?? []);
  const [cmdHistory, setCmdHistory] = useState<string[]>(persisted.current.cmdHistory ?? []);
  const [cmdIndex, setCmdIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(persisted.current.conversationId ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    savePersistedState({ open, history, cmdHistory, conversationId });
  }, [open, history, cmdHistory, conversationId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const executePageAction = useCallback((action: string, args: Record<string, string>): { success: boolean; message: string } => {
    switch (action) {
      case "click": return clickElement(args.selector || "");
      case "clickButton": return clickButtonByText(args.text || args.selector || "");
      case "fill": return fillFormField(args.selector || "", args.value || "");
      case "inspect": {
        const ctx = extractPageContext();
        return { success: true, message: `Page: ${ctx.title}\nPath: ${ctx.pathname}\nHeadings: ${ctx.headings.join(", ")}\nButtons: ${ctx.buttons.slice(0, 10).join(", ")}\nErrors: ${ctx.errors.length ? ctx.errors.join(" | ") : "none"}\nForms: ${ctx.forms.length}` };
      }
      case "detectErrors": {
        const { errors, hasErrors } = detectPageErrors();
        return { success: !hasErrors, message: hasErrors ? `Errors found: ${errors.join(" | ")}` : "No errors detected on page." };
      }
      case "readPage": {
        const ctx = extractPageContext();
        return { success: true, message: ctx.textSummary.slice(0, 1500) };
      }
      default: return { success: false, message: `Unknown page action: ${action}` };
    }
  }, []);

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

    // Local page actions (executed client-side, no server round-trip)
    const lowerText = text.toLowerCase().trim();
    const pageActionMatch = lowerText.match(/^(inspect|read page|detect errors|click button|click|fill)\s*(.*)/);
    if (pageActionMatch) {
      const action = pageActionMatch[1];
      const rest = pageActionMatch[2].trim();
      let result: { success: boolean; message: string };
      if (action === "inspect") {
        result = executePageAction("inspect", {});
      } else if (action === "read page") {
        result = executePageAction("readPage", {});
      } else if (action === "detect errors") {
        result = executePageAction("detectErrors", {});
      } else if (action === "click button") {
        result = executePageAction("clickButton", { text: rest });
      } else if (action === "click") {
        result = executePageAction("click", { selector: rest });
      } else if (action === "fill") {
        const fillMatch = rest.match(/([\w\-\.#]+)\s+(.*)/);
        result = executePageAction("fill", { selector: fillMatch?.[1] || "", value: fillMatch?.[2] || "" });
      } else {
        result = { success: false, message: "Unknown page action" };
      }
      setHistory((p) => [...p, {
        id: `pa_${Date.now()}`, role: "assistant",
        content: result.message, timestamp: Date.now(),
        pageAction: { type: action, selector: rest, result: result.message },
      }]);
      setLoading(false);
      return;
    }

    // Extract page context to send with the command
    const pageCtx = extractPageContext();
    const pageContextSummary = `Page: ${pageCtx.title} | Path: ${pageCtx.pathname}\nHeadings: ${pageCtx.headings.join(", ")}\nButtons: ${pageCtx.buttons.slice(0, 15).join(", ")}\nErrors: ${pageCtx.errors.length ? pageCtx.errors.join(" | ") : "none"}\nForms: ${pageCtx.forms.map((f) => f.fields.join(",")).join("; ")}\nContent preview: ${pageCtx.textSummary.slice(0, 800)}`;

    try {
      const res = await fetch("/api/llm/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          context: typeof window !== "undefined" ? window.location.pathname : "/",
          pageContent: pageContextSummary,
          conversationId,
          history: history.filter((m) => m.role === "user" || m.role === "assistant").slice(-8).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);

      // Execute page action if the agent requested one
      let pageActionResult: string | undefined;
      if (data.pageAction) {
        const paResult = executePageAction(data.pageAction.type, data.pageAction.args || {});
        pageActionResult = paResult.message;
      }

      setHistory((p) => [...p, {
        id: `a_${Date.now()}`, role: "assistant",
        content: data.speech || data.error || "No response.",
        timestamp: Date.now(),
        actions: data.actionsTaken || [],
        llmUsed: data.llmUsed,
        navigateTo: data.navigateTo,
        error: data.error,
        pageAction: pageActionResult ? { type: data.pageAction?.type, result: pageActionResult } : undefined,
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
  }, [loading, conversationId, history, router, executePageAction]);

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
    { l: "Inspect", c: "inspect" },
    { l: "Errors", c: "detect errors" },
    { l: "Read page", c: "read page" },
    { l: "Sync", c: "Sync my mailbox and show new emails" },
    { l: "Analyze", c: "Analyze my inbox for research signals" },
    { l: "Health", c: "Run a system health check" },
    { l: "Experiments", c: "List my active experiments" },
    { l: "Redeploy", c: "Redeploy this application" },
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
              <p className="mt-3 text-sm text-muted-foreground">Assistant Terminal ready. Persists across navigation. Type a command or use quick actions below.</p>
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
        {msg.pageAction && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Wrench className="h-3 w-3" /> {msg.pageAction.type}: {msg.pageAction.result?.slice(0, 120)}
          </div>
        )}
      </div>
    </div>
  );
}
