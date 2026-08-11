"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  Eye,
  FlaskConical,
  Gauge,
  Layers,
  Mic,
  MicOff,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";

// ─── Types (mirror of server-side runtime types) ──────────────────────────

type RuntimeState = {
  status: string;
  streamsObserved: number;
  tasksExecuting: number;
  experimentsRunning: number;
  tasksWaitingOnHuman: number;
  validatedOpportunityValue: number;
  activeProposals: Proposal[];
  humanQueue: HumanTask[];
  recentLearnings: string[];
  currentOpportunities: string[];
  consentedStreams: StreamConsent[];
  operators: Operator[];
  experiments: Experiment[];
  updatedAt: string;
};

type Proposal = {
  id: string;
  observation: string;
  inferredGoal: string;
  action: string;
  delegateTo: string;
  reasoning: string;
  expectedValue: number;
  risk: number;
  confidence: number;
  requiresConfirmation: boolean;
  status: string;
  resources: string[];
  createdAt: string;
};

type HumanTask = {
  id: string;
  proposalId: string;
  title: string;
  description: string;
  instruction: string;
  priority: string;
  status: string;
  createdAt: string;
  agentContext: string;
  impactEstimate: number;
};

type StreamConsent = {
  stream: string;
  enabled: boolean;
  grantedAt: string;
  grantedBy: string;
};

type Operator = {
  id: string;
  name: string;
  version: number;
  datasetsProcessed: number;
  humanCorrectionsIncorporated: number;
  fitness: number;
};

type Experiment = {
  id: string;
  hypothesis: string;
  author: string;
  status: string;
  fitnessScore: number;
  compliancePassed: boolean;
  replicationCount: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const DELEGATE_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  agent: { label: "Agent executes", color: "text-emerald-400", icon: Cpu },
  human: { label: "Needs you", color: "text-amber-400", icon: Users },
  research: { label: "Researching", color: "text-blue-400", icon: Eye },
  experiment: { label: "Experiment", color: "text-purple-400", icon: FlaskConical },
  nothing: { label: "Observing", color: "text-muted-foreground", icon: Activity },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "border-red-400/40 bg-red-500/10 text-red-300",
  high: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  medium: "border-blue-400/40 bg-blue-500/10 text-blue-300",
  low: "border-muted-foreground/30 bg-muted/10 text-muted-foreground",
};

const STREAM_LABELS: Record<string, string> = {
  voice: "Voice",
  email: "Email",
  crm: "CRM",
  dataset: "Datasets",
  calendar: "Calendar",
  workspace: "Workspace",
  file: "Files",
  metrics: "Metrics",
  experiment_result: "Experiment Results",
  pipeline_failure: "Pipeline Failures",
  customer_behavior: "Customer Behavior",
  external_signal: "External Signals",
};

// ─── Main Component ───────────────────────────────────────────────────────

export default function RuntimeDashboard() {
  const [state, setState] = useState<RuntimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [textInput, setTextInput] = useState("");
  const [processingEvent, setProcessingEvent] = useState(false);
  const [activeTab, setActiveTab] = useState<"now" | "queue" | "operators" | "experiments">("now");

  const recognitionRef = useRef<any>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  // ── Load runtime state ──
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/runtime/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll runtime state every 5 seconds — the runtime is alive
    pollRef.current = window.setInterval(load, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // ── Voice recording (speech = observation, not command) ──
  const startRecording = useCallback(async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition not supported. Type your observation below.");
      return;
    }

    setTranscript("");
    setInterim("");

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) {
        setTranscript((prev) => (prev + " " + finalText).trim());
      }
      setInterim(interimText);
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech") setError(`Recognition error: ${e.error}`);
    };

    recognition.onend = () => {
      if (recording) {
        // Restart if still recording
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [recording]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  // ── Submit observation to runtime ──
  const submitObservation = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setProcessingEvent(true);
    try {
      // Create a diary entry (preserves existing pipeline)
      const diaryRes = await fetch("/api/voice/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          text: text.trim(),
          sessionId: "runtime-page",
          segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      if (!diaryRes.ok) {
        const data = await diaryRes.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${diaryRes.status}`);
      }

      // Process pending events through the runtime loop
      const processRes = await fetch("/api/runtime/process", { method: "POST" });
      const processData = await processRes.json().catch(() => ({}));

      setTranscript("");
      setInterim("");
      setTextInput("");
      load();

      // If the runtime created proposals or human tasks, switch to the right tab
      if (processData.humanTasksCreated > 0) setActiveTab("queue");
      else if (processData.proposalsCreated > 0) setActiveTab("now");
    } catch (e: any) {
      setError(`Failed to submit observation: ${e.message}`);
    } finally {
      setProcessingEvent(false);
    }
  }, [load]);

  // ── Confirm/reject proposal ──
  const confirmProposal = useCallback(async (proposalId: string, decision: "confirm" | "reject") => {
    try {
      await fetch("/api/runtime/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, decision }),
      });
      load();
    } catch (e: any) {
      setError(`Failed to confirm: ${e.message}`);
    }
  }, [load]);

  // ── Resolve human task ──
  const resolveTask = useCallback(async (taskId: string, resolution: "completed" | "declined", result?: string) => {
    try {
      await fetch("/api/runtime/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, resolution, result }),
      });
      load();
    } catch (e: any) {
      setError(`Failed to resolve task: ${e.message}`);
    }
  }, [load]);

  // ── Grant stream consent ──
  const grantStream = useCallback(async (stream: string) => {
    try {
      await fetch("/api/runtime/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream, grantedBy: "runtime-dashboard", note: "Granted from runtime dashboard" }),
      });
      load();
    } catch (e: any) {
      setError(`Failed to grant consent: ${e.message}`);
    }
  }, [load]);

  const fullTranscript = (transcript + " " + interim).trim();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="relative h-3 w-3">
            <div className="absolute inset-0 rounded-full bg-emerald-500 animate-pulse" />
            <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">Ambient Delegation Runtime</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          The cognitive runtime is attached to this workspace. Speak, type, or connect streams —
          the runtime observes, decides, and delegates. You are the scarce resource it allocates.
        </p>
      </div>

      {/* ═══ Runtime State Strip ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <StateChip icon={Eye} label="Streams" value={state?.streamsObserved ?? 0} color="text-blue-400" />
        <StateChip icon={Cpu} label="Executing" value={state?.tasksExecuting ?? 0} color="text-emerald-400" />
        <StateChip icon={FlaskConical} label="Experiments" value={state?.experimentsRunning ?? 0} color="text-purple-400" />
        <StateChip icon={Users} label="Need you" value={state?.tasksWaitingOnHuman ?? 0} color="text-amber-400" />
        <StateChip icon={DollarSign} label="Opportunity" value={`$${state?.validatedOpportunityValue ?? 0}`} color="text-spinor-gold" />
        <StateChip icon={Brain} label="Learned" value={state?.recentLearnings.length ?? 0} color="text-pink-400" />
      </div>

      {/* ═══ Observation Input ═══ */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Observation Input</span>
            <span className="text-[10px] text-muted-foreground">(speech becomes an event, not a command)</span>
          </div>
          {state?.consentedStreams && !state.consentedStreams?.find((s: any) => s.stream === "voice") && (
            <button
              className="btn btn-ghost btn-sm text-xs"
              onClick={() => grantStream("voice")}
            >
              <Zap className="h-3 w-3 mr-1" /> Enable voice stream
            </button>
          )}
        </div>

        {/* Recording button + waveform */}
        <div className="flex items-center gap-4">
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`relative h-14 w-14 rounded-full flex items-center justify-center transition-all ${
              recording
                ? "bg-red-500/20 border-2 border-red-500/50"
                : "bg-primary/20 border-2 border-primary/40 hover:border-primary/60"
            }`}
          >
            {recording ? (
              <>
                <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
                <MicOff className="h-5 w-5 text-red-400 relative z-10" />
              </>
            ) : (
              <Mic className="h-5 w-5 text-primary relative z-10" />
            )}
          </button>
          <div className="flex-1 min-h-[56px] rounded-xl bg-muted/20 border border-border/50 flex items-center px-4">
            {fullTranscript ? (
              <p className="text-sm text-foreground/90">
                {transcript} <span className="text-muted-foreground">{interim}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {recording ? "Listening..." : "Press the mic to speak, or type below"}
              </p>
            )}
          </div>
        </div>

        {/* Text input fallback */}
        <div className="flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitObservation(textInput || transcript);
              }
            }}
            placeholder="Or type your observation here..."
            className="input flex-1"
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => submitObservation(textInput || transcript)}
            disabled={processingEvent || (!textInput.trim() && !transcript.trim())}
          >
            {processingEvent ? (
              <><RefreshCw className="h-3 w-3 animate-spin mr-1" /> Processing</>
            ) : (
              <><Zap className="h-3 w-3 mr-1" /> Submit</>
            )}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        )}
      </div>

      {/* ═══ Stream Consent ═══ */}
      {state?.consentedStreams && state.consentedStreams.length === 0 && (
        <div className="glass-card p-4 border-amber-400/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold">No streams connected</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            The runtime needs consent to observe event streams. Each stream requires explicit consent.
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STREAM_LABELS).map(([key, label]) => (
              <button
                key={key}
                className="btn btn-ghost btn-sm text-xs"
                onClick={() => grantStream(key)}
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Tab Navigation ═══ */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={activeTab === "now"} onClick={() => setActiveTab("now")} icon={Activity} label="Now" count={state?.activeProposals.length ?? 0} />
        <TabButton active={activeTab === "queue"} onClick={() => setActiveTab("queue")} icon={Users} label="Waiting on you" count={state?.humanQueue.length ?? 0} />
        <TabButton active={activeTab === "operators"} onClick={() => setActiveTab("operators")} icon={Layers} label="Operators" count={state?.operators.length ?? 0} />
        <TabButton active={activeTab === "experiments"} onClick={() => setActiveTab("experiments")} icon={FlaskConical} label="Experiments" count={state?.experiments.length ?? 0} />
      </div>

      {/* ═══ Tab Content ═══ */}
      {activeTab === "now" && (
        <div className="space-y-4">
          {/* Active Proposals */}
          {state?.activeProposals && state.activeProposals.length > 0 ? (
            state.activeProposals.map((p) => {
              const del = DELEGATE_LABELS[p.delegateTo] || DELEGATE_LABELS.nothing;
              const DelIcon = del.icon;
              return (
                <div key={p.id} className="glass-card p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <DelIcon className={`h-4 w-4 ${del.color}`} />
                        <span className={`text-xs font-semibold ${del.color}`}>{del.label}</span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(p.createdAt)}</span>
                      </div>
                      <p className="text-sm text-foreground/90">{p.observation}</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div><span className="text-foreground/60">Goal:</span> {p.inferredGoal}</div>
                        <div><span className="text-foreground/60">Action:</span> {p.action}</div>
                        <div><span className="text-foreground/60">Reasoning:</span> {p.reasoning}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-[10px]">
                      <span className="text-emerald-400">Value: {p.expectedValue}</span>
                      <span className="text-red-400">Risk: {p.risk}</span>
                      <span className="text-blue-400">Conf: {Math.round(p.confidence * 100)}%</span>
                    </div>
                  </div>
                  {p.requiresConfirmation && p.status === "proposed" && (
                    <div className="flex gap-2 pt-2 border-t border-border/50">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => confirmProposal(p.id, "confirm")}
                      >
                        <Check className="h-3 w-3 mr-1" /> Confirm
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => confirmProposal(p.id, "reject")}
                      >
                        <X className="h-3 w-3 mr-1" /> Reject
                      </button>
                    </div>
                  )}
                  {p.status === "completed" && (
                    <div className="flex items-center gap-1 text-xs text-emerald-400 pt-2 border-t border-border/50">
                      <CheckCircle2 className="h-3 w-3" /> Completed
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="glass-card p-8 text-center text-muted-foreground text-sm">
              <Activity className="h-6 w-6 mx-auto mb-2 opacity-50" />
              The runtime is observing. No active proposals — submit an observation to trigger action.
            </div>
          )}

          {/* Current Opportunities */}
          {state?.currentOpportunities && state.currentOpportunities.length > 0 && (
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-spinor-gold" />
                <span className="text-sm font-semibold">Opportunities Detected</span>
              </div>
              <div className="space-y-2">
                {state.currentOpportunities.map((opp, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-foreground/80">
                    <ArrowRight className="h-3 w-3 text-spinor-gold" />
                    {opp}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Learnings */}
          {state?.recentLearnings && state.recentLearnings.length > 0 && (
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-pink-400" />
                <span className="text-sm font-semibold">Learned Today</span>
              </div>
              <div className="space-y-2">
                {state.recentLearnings.map((learning, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                    <Check className="h-3 w-3 text-pink-400 mt-0.5" />
                    {learning}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "queue" && (
        <div className="space-y-4">
          {state?.humanQueue && state.humanQueue.length > 0 ? (
            state.humanQueue.map((task) => (
              <div key={task.id} className="glass-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`badge text-[10px] ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}`}>
                        {task.priority}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(task.createdAt)}</span>
                      <span className="text-[10px] text-blue-400">Impact: ~{task.impactEstimate} items</span>
                    </div>
                    <h3 className="text-sm font-semibold">{task.title}</h3>
                    <p className="text-xs text-muted-foreground">{task.agentContext}</p>
                    <div className="text-xs text-foreground/70 bg-muted/20 rounded-lg p-3 border border-border/50">
                      <span className="text-foreground/50 font-semibold">Your task: </span>
                      {task.instruction}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-border/50">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const result = prompt("What did you do? (This becomes a learned rule)");
                      if (result !== null) resolveTask(task.id, "completed", result);
                    }}
                  >
                    <Check className="h-3 w-3 mr-1" /> Completed
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => resolveTask(task.id, "declined")}
                  >
                    <X className="h-3 w-3 mr-1" /> Decline
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="glass-card p-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="h-6 w-6 mx-auto mb-2 opacity-50" />
              Nothing waiting on you. The runtime is handling everything autonomously.
            </div>
          )}
        </div>
      )}

      {activeTab === "operators" && (
        <div className="space-y-4">
          {state?.operators && state.operators.length > 0 ? (
            state.operators.map((op) => (
              <div key={op.id} className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-400" />
                    <span className="text-sm font-semibold">{op.name}</span>
                    <span className="badge text-[10px] border-blue-400/30 bg-blue-500/10 text-blue-300">v{op.version}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{op.datasetsProcessed} datasets</span>
                    <span className="text-muted-foreground">{op.humanCorrectionsIncorporated} corrections</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Gauge className="h-4 w-4 text-emerald-400" />
                  <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                      style={{ width: `${op.fitness}%` }}
                    />
                  </div>
                  <span className="text-xs text-emerald-400 font-mono">{Math.round(op.fitness)}%</span>
                </div>
              </div>
            ))
          ) : (
            <div className="glass-card p-8 text-center text-muted-foreground text-sm">
              <Layers className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No reconciliation operators yet. Create one when you have datasets to merge.
              <div className="mt-3">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    const name = prompt("Operator name (e.g., 'Physician Dataset Reconciliation')");
                    if (name) {
                      await fetch("/api/runtime/operators", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      load();
                    }
                  }}
                >
                  <Zap className="h-3 w-3 mr-1" /> Create Operator
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "experiments" && (
        <div className="space-y-4">
          {state?.experiments && state.experiments.length > 0 ? (
            state.experiments.map((exp) => (
              <div key={exp.id} className="glass-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-purple-400" />
                      <span className="text-xs font-mono text-muted-foreground">{exp.id}</span>
                      <span className={`badge text-[10px] ${exp.compliancePassed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-red-400/30 bg-red-500/10 text-red-300"}`}>
                        {exp.compliancePassed ? "compliant" : "blocked"}
                      </span>
                      <span className="badge text-[10px] border-purple-400/30 bg-purple-500/10 text-purple-300">
                        {exp.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90">{exp.hypothesis}</p>
                    <div className="text-xs text-muted-foreground">
                      by {exp.author} · {exp.replicationCount} replications
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold gradient-text">{Math.round(exp.fitnessScore)}</div>
                    <div className="text-[10px] text-muted-foreground">fitness</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="glass-card p-8 text-center text-muted-foreground text-sm">
              <FlaskConical className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No experiments yet. The runtime will propose experiments from observations.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StateChip({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="glass-card p-3 text-center">
      <Icon className={`h-4 w-4 mx-auto ${color} mb-1`} />
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: any; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count > 0 && (
        <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{count}</span>
      )}
    </button>
  );
}
