"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoicePage } from "@/components/VoiceContext";
import {
  AlertCircle,
  ArrowRight,
  Aperture,
  BookOpen,
  Clapperboard,
  Clock,
  Film,
  Filter,
  Link2,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

type ExtractedEntities = {
  accounts?: string[];
  outcomes?: string[];
  uncertainties?: string[];
};

type PipelineLink = { type: string; description: string };

type DiaryEntry = {
  id: string;
  text: string;
  type: string;
  tags?: string[];
  timestamp: string;
  processed: boolean;
  processedAt?: string;
  audioUrl?: string;
  extractedEntities?: ExtractedEntities;
  pipelineLinks?: PipelineLink[];
};

type DiaryStats = {
  total: number;
  todayCount: number;
  unprocessed: number;
  pipelineLinks: number;
  processed: number;
};

const TYPE_COLORS: Record<string, string> = {
  field_observation: "border-blue-400/40 bg-blue-500/10 text-blue-300",
  experiment_outcome: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  customer_interaction: "border-purple-400/40 bg-purple-500/10 text-purple-300",
  compliance_event: "border-red-400/40 bg-red-500/10 text-red-300",
  hypothesis_insight: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  golden_node_evidence: "border-spinor-gold/40 bg-spinor-gold/10 text-spinor-gold",
  reverse_falsification_result: "border-pink-400/40 bg-pink-500/10 text-pink-300",
  uncategorized: "border-muted-foreground/30 bg-muted/10 text-muted-foreground",
};

const TYPE_LABELS: Record<string, string> = {
  field_observation: "Field Observation",
  experiment_outcome: "Experiment Outcome",
  customer_interaction: "Customer Interaction",
  compliance_event: "Compliance Event",
  hypothesis_insight: "Hypothesis Insight",
  golden_node_evidence: "Golden Node Evidence",
  reverse_falsification_result: "Reverse Falsification",
  uncategorized: "Uncategorized",
};

const LINK_COLORS: Record<string, string> = {
  email_signal: "text-blue-400",
  experiment: "text-emerald-400",
  experiment_outcome: "text-emerald-400",
  golden_node: "text-amber-400",
  reverse_test: "text-pink-400",
  unlinked: "text-muted-foreground",
};

const TypeIcon = ({ type }: { type: string }) => {
  if (type === "customer_interaction") return <Sparkles className="h-3.5 w-3.5" />;
  if (type === "field_observation") return <Aperture className="h-3.5 w-3.5" />;
  if (type === "experiment_outcome") return <Zap className="h-3.5 w-3.5" />;
  if (type === "golden_node_evidence") return <BookOpen className="h-3.5 w-3.5" />;
  return <Film className="h-3.5 w-3.5" />;
};

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const startRef = useRef(0);
  const fromRef = useRef(0);
  const toRef = useRef(0);

  useEffect(() => {
    fromRef.current = value;
    toRef.current = target;
    startRef.current = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(fromRef.current + (toRef.current - fromRef.current) * eased);
      setValue(current);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  const cs = Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}.${cs}`;
}

function WaveformCanvas({
  active,
  analyserRef,
  dataRef,
}: {
  active: boolean;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  dataRef: React.MutableRefObject<Uint8Array | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const barCount = 96;

    const draw = () => {
      if (!active) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (analyserRef.current && dataRef.current) {
        analyserRef.current.getByteFrequencyData(dataRef.current as any);
        const step = Math.max(1, Math.floor((dataRef.current as any).length / barCount));
        const barWidth = w / barCount;

        for (let i = 0; i < barCount; i++) {
          const idx = i * step;
          const raw = dataRef.current[idx] || 0;
          const damped = raw * (0.6 + (i / barCount) * 0.4);
          const pct = damped / 255;
          const barHeight = Math.max(2, pct * h * 0.92);

          const hue = 160 + (i / barCount) * 120 + Math.sin(Date.now() / 1000) * 10;
          const alpha = 0.25 + pct * 0.75;
          const grad = ctx.createLinearGradient(0, h - barHeight, 0, h);
          grad.addColorStop(0, `hsla(${hue}, 90%, 70%, ${alpha})`);
          grad.addColorStop(1, `hsla(${hue}, 90%, 55%, ${alpha * 0.4})`);

          const x = i * barWidth + barWidth * 0.1;
          const bw = barWidth * 0.8;
          const y = h - barHeight;

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, bw, barHeight, 3);
          ctx.fill();
        }
      } else {
        // Idle shimmer when analyser not ready
        const t = Date.now() / 800;
        for (let i = 0; i < barCount; i++) {
          const x = i * (w / barCount);
          const bw = w / barCount * 0.8;
          const h1 = Math.max(3, (Math.sin(t + i * 0.35) + 1) * h * 0.18);
          const h2 = Math.max(3, (Math.cos(t * 0.7 + i * 0.2) + 1) * h * 0.1);
          const barHeight = h1 + h2;
          const y = h - barHeight;
          ctx.fillStyle = `hsla(190, 80%, 60%, 0.12)`;
          ctx.beginPath();
          ctx.roundRect(x, y, bw, barHeight, 3);
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, analyserRef, dataRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full rounded-xl"
      aria-hidden="true"
    />
  );
}

function StatPanel({
  icon: Icon,
  label,
  value,
  delay,
}: {
  icon: any;
  label: string;
  value: number;
  delay: number;
}) {
  const count = useCountUp(value, 1400);
  return (
    <div
      className="glass-card p-5 text-center relative overflow-hidden cinematic-stat"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <Icon className="h-5 w-5 mx-auto text-accent mb-2" />
      <div className="text-3xl font-bold tracking-tight gradient-text">{count}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function SceneCard({
  entry,
  index,
  processing,
  onProcess,
  onDelete,
}: {
  entry: DiaryEntry;
  index: number;
  processing: string | null;
  onProcess: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const color = TYPE_COLORS[entry.type] || TYPE_COLORS.uncategorized;
  const label = TYPE_LABELS[entry.type] || entry.type.replace(/_/g, " ");

  return (
    <div className="relative pl-8 sm:pl-12 scene-card-wrapper">
      <div className="absolute left-3 sm:left-5 top-6 h-3 w-3 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.6)] timeline-dot" />
      <div className="absolute left-[14px] sm:left-[22px] top-9 bottom-0 w-px bg-gradient-to-b from-primary/40 via-border to-transparent" />

      <div className="glass-card p-5 sm:p-6 scene-card" style={{ animationDelay: `${index * 80}ms` }}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge gap-1.5 ${color}`}>
              <TypeIcon type={entry.type} />
              {label}
            </span>
            {entry.tags?.map((tag) => (
              <span key={tag} className="text-[10px] text-muted-foreground">
                #{tag}
              </span>
            ))}
            {entry.processed ? (
              <span className="badge gap-1 border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                <Clapperboard className="h-3 w-3" /> processed
              </span>
            ) : (
              <span className="badge gap-1 border-amber-400/30 bg-amber-500/10 text-amber-300">
                <Clock className="h-3 w-3" /> unprocessed
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
            {new Date(entry.timestamp).toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-mono text-muted-foreground">SCENE {String(index + 1).padStart(3, "0")}</span>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>

        <p className="text-sm sm:text-base leading-relaxed mb-4 text-foreground/90">{entry.text}</p>

        {entry.audioUrl && (
          <div className="mb-4">
            <audio src={entry.audioUrl} controls preload="none" className="w-full h-8 opacity-80" />
          </div>
        )}

        {entry.extractedEntities &&
          (entry.extractedEntities.accounts?.length ||
            entry.extractedEntities.outcomes?.length ||
            entry.extractedEntities.uncertainties?.length) && (
            <div className="flex flex-wrap gap-2 mb-4">
              {entry.extractedEntities.accounts?.map((a) => (
                <span key={a} className="entity-chip account-chip">
                  account: {a}
                </span>
              ))}
              {entry.extractedEntities.outcomes?.map((o) => (
                <span key={o} className="entity-chip outcome-chip">
                  outcome: {o}
                </span>
              ))}
              {entry.extractedEntities.uncertainties?.map((u) => (
                <span key={u} className="entity-chip uncertainty-chip">
                  uncertainty: {u}
                </span>
              ))}
            </div>
          )}

        {entry.pipelineLinks && entry.pipelineLinks.length > 0 && (
          <div className="border-t border-border/50 pt-4 mt-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Link2 className="h-3 w-3" /> Pipeline Connections
            </p>
            <div className="space-y-2">
              {entry.pipelineLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <ArrowRight className={`h-3 w-3 ${LINK_COLORS[link.type] || LINK_COLORS.unlinked}`} />
                  <span className={LINK_COLORS[link.type] || LINK_COLORS.unlinked}>
                    {link.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-muted-foreground">→ {link.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          {!entry.processed && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onProcess(entry.id)}
              disabled={processing === entry.id}
            >
              {processing === entry.id ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1" /> Processing…
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3 mr-1" /> Process into Pipeline
                </>
              )}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm text-muted-foreground hover:text-destructive ml-auto"
            onClick={() => onDelete(entry.id)}
            title="Delete scene"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiaryDocumentaryPage() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [processing, setProcessing] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [textInput, setTextInput] = useState("");

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const sessionIdRef = useRef<string>("");
  const segmentIdRef = useRef<string>("");
  const transcriptRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<any>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, statsRes] = await Promise.all([
        fetch("/api/voice/diary?action=list", { cache: "no-store" }),
        fetch("/api/voice/diary?action=stats", { cache: "no-store" }),
      ]);
      if (!entriesRes.ok) throw new Error(`Failed to load entries (${entriesRes.status})`);
      if (!statsRes.ok) throw new Error(`Failed to load stats (${statsRes.status})`);
      const entriesData = await entriesRes.json();
      const statsData = await statsRes.json();
      setEntries(entriesData.entries || []);
      setStats(statsData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (recording) {
      const start = Date.now();
      const tick = () => {
        setRecordingMs(Date.now() - start);
        recordingTimerRef.current = window.setTimeout(tick, 50);
      };
      tick();
    } else {
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      setRecordingMs(0);
    }
    return () => {
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    };
  }, [recording]);

  const submitDiaryEntry = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      const res = await fetch("/api/voice/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          text: text.trim(),
          sessionId: "diary-page",
          segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      load();
      setTranscript("");
      setInterim("");
      transcriptRef.current = "";
    } catch (e: any) {
      setError(`Failed to create scene: ${e.message}`);
    }
  }, [load]);

  const submitRecording = useCallback(async (blob: Blob, text: string) => {
    const form = new FormData();
    form.append("audio", blob, `recording.${blob.type?.includes("ogg") ? "ogg" : "webm"}`);
    if (text.trim()) form.append("text", text.trim());
    form.append("sessionId", sessionIdRef.current);
    form.append("segmentId", segmentIdRef.current);

    try {
      const res = await fetch("/api/voice/diary/audio", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      load();
    } catch (e: any) {
      setError(`Failed to upload recording: ${e.message}`);
    }
  }, [load]);

  const startRecording = useCallback(async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition not supported. Use Safari on iPhone or Chrome on desktop, or type below.");
      return;
    }

    audioChunksRef.current = [];
    sessionIdRef.current = `diary-${Date.now()}`;
    segmentIdRef.current = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    transcriptRef.current = "";
    setTranscript("");
    setInterim("");

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blobType = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        if (blob.size > 0) {
          submitRecording(blob, transcriptRef.current);
        } else if (transcriptRef.current.trim()) {
          submitDiaryEntry(transcriptRef.current.trim());
        }
        audioChunksRef.current = [];
        stream?.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

      // Audio visualiser
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
    } catch (e: any) {
      console.warn("[diary] could not start MediaRecorder:", e.message);
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += part;
        else interimText += part;
      }
      if (finalText) {
        transcriptRef.current = (transcriptRef.current + " " + finalText).trim();
        setTranscript(transcriptRef.current);
      }
      setInterim(interimText);
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(`Speech recognition error: ${event.error}`);
      setRecording(false);
    };

    recognition.onend = () => setRecording(false);

    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
    setError(null);
  }, [submitDiaryEntry, submitRecording]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    mediaRecorderRef.current = null;

    if (audioCtxRef.current?.state !== "closed") {
      try { audioCtxRef.current?.close(); } catch { /* noop */ }
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;

    setRecording(false);
  }, []);

  const handleTextInput = useCallback(() => {
    if (!textInput.trim()) return;
    submitDiaryEntry(textInput.trim());
    setTextInput("");
  }, [textInput, submitDiaryEntry]);

  const processEntry = useCallback(async (entryId: string) => {
    setProcessing(entryId);
    try {
      const res = await fetch("/api/voice/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process", entryId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.linksCreated > 0) load();
      else {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, processed: true, processedAt: new Date().toISOString(), pipelineLinks: data.entry?.pipelineLinks || [] }
              : e
          )
        );
      }
    } catch (e: any) {
      setError(`Failed to process scene: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }, [load]);

  const processAll = useCallback(async () => {
    setProcessing("all");
    try {
      const res = await fetch("/api/voice/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_all" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      load();
    } catch (e: any) {
      setError(`Failed to process scenes: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  }, [load]);

  const deleteEntry = useCallback(async (entryId: string) => {
    try {
      const res = await fetch("/api/voice/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", entryId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      load();
    } catch (e: any) {
      setError(`Failed to delete scene: ${e.message}`);
    }
  }, [load]);

  useVoicePage({
    pageId: "diary",
    title: "Voice Diary",
    summary: stats
      ? `Diary has ${stats.total} scene${stats.total !== 1 ? "s" : ""}. ${stats.unprocessed} unprocessed. ${stats.pipelineLinks} pipeline links. ${stats.todayCount} today.`
      : "Loading diary...",
    actions: [
      {
        name: "process_all",
        label: "process all into pipeline",
        available: stats ? stats.unprocessed > 0 && processing !== "all" : false,
        handler: async () => {
          await processAll();
          return { success: true, speech: `Processed all unprocessed scenes into the pipeline.` };
        },
      },
    ],
  });

  const filteredEntries = filter === "all" ? entries : entries.filter((e) => e.type === filter);
  const typeFilters = ["all", ...new Set(entries.map((e) => e.type))];

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Cinematic aurora backdrop */}
      <div className="aurora-bg" />
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30 film-grain" />

      <div className="relative z-10 page-enter max-w-6xl mx-auto">
        {/* Hero */}
        <section className="relative rounded-3xl border border-white/[0.06] bg-card/40 backdrop-blur-2xl p-8 sm:p-12 mb-10 overflow-hidden mission-hero">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.12),transparent_60%)]" />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-primary mb-2">
                <Film className="h-3.5 w-3.5" />
                Advantage Foundry — Voice Documentary
              </div>
              <h1 className="text-4xl sm:text-6xl font-bold tracking-tight gradient-text-gold text-balance">
                Field Evidence Log
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base mt-3 max-w-xl text-pretty">
                Speak your field notes. Every scene is transcribed, classified, and woven into the
                experimental pipeline — email signals, outcomes, golden node evidence.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">System capturing voice evidence</span>
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="glass-card p-3 mb-6 flex items-start gap-2 border-red-500/30 animate-fade-in-up">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground text-xs">
              dismiss
            </button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
            <StatPanel icon={BookOpen} label="Scenes" value={stats.total} delay={0} />
            <StatPanel icon={Clock} label="Today" value={stats.todayCount} delay={80} />
            <StatPanel icon={Zap} label="Unprocessed" value={stats.unprocessed} delay={160} />
            <StatPanel icon={Link2} label="Pipeline Links" value={stats.pipelineLinks} delay={240} />
            <StatPanel icon={Sparkles} label="Processed" value={stats.processed} delay={320} />
          </div>
        )}

        {/* Recorder */}
        <section className="glass-card p-1 mb-10 overflow-hidden relative recording-stage">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
          <div className="relative p-6 sm:p-10">
            <div className="flex flex-col lg:flex-row gap-8 items-stretch">
              {/* Controls */}
              <div className="flex flex-col items-center justify-center gap-6 lg:w-72 shrink-0">
                <button
                  onClick={recording ? stopRecording : startRecording}
                  className={`relative flex items-center justify-center rounded-full w-28 h-28 transition-all duration-500 ${
                    recording ? "recording-orb-active" : "recording-orb-idle"
                  }`}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                >
                  <span className="relative z-10 flex items-center justify-center">
                    {recording ? <MicOff className="h-8 w-8" /> : <Mic className="h-9 w-9" />}
                  </span>
                  {recording && <span className="absolute inset-0 rounded-full recording-pulse" />}
                </button>

                <div className="text-center">
                  <p className="text-2xl font-mono font-bold tracking-widest text-foreground">
                    {formatDuration(recordingMs)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest">
                    {recording ? "Recording scene…" : "Press to record a scene"}
                  </p>
                </div>

                {stats && stats.unprocessed > 0 && (
                  <button
                    className="btn btn-primary w-full"
                    onClick={processAll}
                    disabled={processing === "all"}
                  >
                    {processing === "all" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin mr-1" /> Processing…
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-1" /> Process {stats.unprocessed} Scenes
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Waveform / transcript area */}
              <div className="flex-1 flex flex-col gap-4 min-h-[220px]">
                <div className="relative flex-1 rounded-2xl border border-white/[0.06] bg-black/20 overflow-hidden">
                  <WaveformCanvas active={recording} analyserRef={analyserRef} dataRef={dataArrayRef} />

                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {!recording && !transcript && !interim && (
                      <div className="text-center text-muted-foreground/60">
                        <Aperture className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-xs uppercase tracking-widest">Awaiting field audio</p>
                      </div>
                    )}
                  </div>

                  {(transcript || interim) && (
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/70 to-transparent">
                      <p className="text-sm sm:text-base leading-relaxed">
                        {transcript}
                        {interim && <span className="text-muted-foreground/80"> {interim}</span>}
                        {recording && <span className="stream-cursor" />}
                      </p>
                    </div>
                  )}
                </div>

                {/* Typed fallback */}
                {!recording && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Or type a scene description…"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleTextInput()}
                      className="input flex-1"
                      maxLength={10000}
                    />
                    <button className="btn btn-primary" onClick={handleTextInput} disabled={!textInput.trim()}>
                      <Sparkles className="h-4 w-4 mr-1" /> Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Filters */}
        {entries.length > 0 && (
          <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-thin pb-1">
            <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            {typeFilters.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`text-xs px-3.5 py-1.5 rounded-full border transition-all flex-shrink-0 ${
                  filter === t
                    ? "border-primary bg-primary/10 text-primary shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                }`}
              >
                {t === "all" ? "All Scenes" : TYPE_LABELS[t] || t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}

        {/* Timeline */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <Clapperboard className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Scene Timeline</h2>
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-card p-6">
                  <div className="skeleton h-5 w-32 rounded-full mb-3" />
                  <div className="skeleton h-4 w-full rounded mb-2" />
                  <div className="skeleton h-4 w-3/4 rounded" />
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="glass-card p-12 text-center cinematic-empty">
              <Aperture className="h-14 w-14 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground max-w-md mx-auto">
                {entries.length === 0
                  ? "No scenes recorded yet. Speak or type your first field observation to begin the documentary."
                  : "No scenes match this filter."}
              </p>
            </div>
          ) : (
            <div className="space-y-6 pb-16">
              {filteredEntries.map((entry, i) => (
                <SceneCard
                  key={entry.id}
                  entry={entry}
                  index={i}
                  processing={processing}
                  onProcess={processEntry}
                  onDelete={deleteEntry}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
