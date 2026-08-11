"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useVoice } from "@/components/useVoice";
import { useVoiceContext } from "@/components/VoiceContext";
import {
  Bot,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Sparkles,
  Target,
  FlaskConical,
  Beaker,
  BarChart3,
  Award,
  Inbox,
  Mail,
  Calendar,
  RefreshCw,
  GitBranch,
  Workflow,
} from "lucide-react";

type CommandLog = {
  id: string;
  role: "user" | "autopilot";
  text: string;
  action?: string;
  ts: number;
};

const QUICK_ACTIONS = [
  { label: "Go to Today", command: "go to today", icon: Calendar },
  { label: "Run Research", command: "run research", icon: Sparkles },
  { label: "Open Foundry", command: "open foundry", icon: FlaskConical },
  { label: "Record Outcome", command: "record outcome", icon: Beaker },
  { label: "View Results", command: "go to results", icon: BarChart3 },
  { label: "Golden Nodes", command: "go to golden nodes", icon: Award },
  { label: "Analyze Inbox", command: "analyze inbox", icon: Inbox },
  { label: "Email Lab", command: "go to email lab", icon: Mail },
  { label: "SPIN Lifecycle", command: "go to spin lifecycle", icon: RefreshCw },
  { label: "SPINOR-RL", command: "go to spinor-rl", icon: GitBranch },
  { label: "Workteleport", command: "go to workteleport", icon: Workflow },
  { label: "Help", command: "help", icon: Target },
];

export default function AutopilotPage() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { executeAction, getStatus } = useVoiceContext();
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [muted, setMuted] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const idCounterRef = useRef(0);

  const makeId = useCallback(() => `log-${++idCounterRef.current}`, []);

  const addLog = useCallback((entry: CommandLog) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const executeCommand = useCallback(
    async (text: string, source: "voice" | "text") => {
      if (!text.trim()) return;
      addLog({ id: makeId(), role: "user", text, ts: Date.now() });
      setProcessing(true);

      try {
        const res = await fetch("/api/llm/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            context: pathname,
            conversation: logs
              .slice(-6)
              .map((l) => `${l.role}: ${l.text}`)
              .join("\n"),
          }),
        });

        const data = await res.json();

        // Execute action
        let executed = false;
        if (data.action === "navigate" && data.target) {
          router.push(data.target);
          executed = true;
        } else if (data.action === "status") {
          const status = getStatus();
          data.speech = status;
          executed = true;
        } else if (data.action && data.action !== "speak" && data.action !== "unknown") {
          // Try VoiceContext direct execution
          const result = await executeAction(data.action);
          if (result.success) {
            data.speech = result.speech;
          }
          // Also dispatch for useVoiceCommand listeners
          window.dispatchEvent(
            new CustomEvent("voice-command", { detail: { action: data.action, params: data.params } })
          );
          executed = true;
        }

        const responseText = data.speech || data.action || "Done.";
        addLog({
          id: makeId(),
          role: "autopilot",
          text: responseText,
          action: data.action,
          ts: Date.now(),
        });

        if (!muted && data.speech) {
          voice.speak(data.speech);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Command failed";
        addLog({ id: makeId(), role: "autopilot", text: `Error: ${msg}`, ts: Date.now() });
      } finally {
        setProcessing(false);
      }
    },
    [addLog, pathname, logs, router, executeAction, getStatus, muted]
  );

  const voice = useVoice({ onTranscript: (text) => executeCommand(text, "voice") });

  // Expose autopilot actions to the VoiceOrb via the VoiceContext dispatcher.
  // We intentionally do NOT call registerPage here to avoid the update loop
  // caused by the context object changing on every registration.

  // Scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!manualInput.trim() || processing) return;
    executeCommand(manualInput, "text");
    setManualInput("");
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground">
            <Bot className="h-8 w-8 text-primary" />
            AI App Controller
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Autopilot for Advantage Foundry. Speak or type a command. The autopilot will navigate,
            run actions, and report back.
          </p>
        </div>
        <button
          onClick={() => setMuted(!muted)}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Command log + input */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card flex h-[420px] flex-col">
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {logs.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-muted-foreground">
                  <p>
                    Say &quot;Foundry, go to today&quot; or type a command below.
                    <br />
                    <span className="text-xs text-muted-foreground/60">
                      Try &quot;run research&quot;, &quot;record outcome&quot;, or &quot;analyze inbox&quot;.
                    </span>
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`flex ${log.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl border px-4 py-3 text-sm ${
                          log.role === "user"
                            ? "border-primary/20 bg-primary/10 text-foreground"
                            : "border-border bg-muted/20 text-foreground/90"
                        }`}
                      >
                        {log.role === "autopilot" && log.action && (
                          <p className="mb-1 text-[10px] uppercase tracking-wider text-accent">
                            {log.action}
                          </p>
                        )}
                        <p>{log.text}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>

            {/* Input bar */}
            <form onSubmit={handleSubmit} className="border-t border-border p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())}
                  className={`rounded-lg p-2.5 transition-colors ${
                    voice.listening
                      ? "bg-red-500/20 text-red-400"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                  title={voice.listening ? "Stop listening" : "Hold Space or click to speak"}
                >
                  {voice.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <input
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) handleSubmit();
                  }}
                  placeholder="Type a command…"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
                />
                <button
                  type="submit"
                  disabled={!manualInput.trim() || processing}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {processing ? <Sparkles className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              {voice.error && <p className="mt-2 text-xs text-destructive">{voice.error}</p>}
            </form>
          </div>
        </div>

        {/* Quick actions */}
        <div className="space-y-4">
          <div className="glass-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Quick Commands</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.command}
                    onClick={() => executeCommand(action.command, "text")}
                    disabled={processing}
                    className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-card p-4 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">Status</p>
            <p>{getStatus()}</p>
            <p className="mt-2">Voice supported: {voice.supported ? "yes" : "no"}</p>
            <p>Current route: {pathname}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
