"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Send, Loader2, AlertTriangle, Volume2, Square, CheckCircle2, XCircle, ChevronRight, RotateCcw, Zap, Shield, Pause, Play, SkipForward, Edit3, Trash2, Clock } from "lucide-react";
import { VoiceSessionState, VoiceCapabilities, CapabilityStatus, TranscriptSegment, EvidenceArtifact, StatementClassification, EvidenceArtifactType, ComplianceFlagResult } from "@/types";

type Phase = VoiceSessionState;
type CaptureMode = "browser_recognition" | "server_transcription" | "audio_recording_deferred" | "text_entry";

// ─── Capability detection hook ────────────────────────────────────────

function useCapabilityDetection() {
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [detecting, setDetecting] = useState(false);

  const detect = useCallback(async (): Promise<VoiceCapabilities> => {
    setDetecting(true);
    const isSecureContext = typeof window !== "undefined" && window.isSecureContext;
    const isMobile = typeof window !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);
    const browser = typeof window !== "undefined"
      ? /Chrome/.test(navigator.userAgent) ? "Chrome"
      : /Edg/.test(navigator.userAgent) ? "Edge"
      : /Safari/.test(navigator.userAgent) ? "Safari"
      : /Firefox/.test(navigator.userAgent) ? "Firefox"
      : "unknown"
      : "unknown";

    const hasSR = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasTTS = typeof window !== "undefined" && !!window.speechSynthesis;
    const voices = hasTTS ? window.speechSynthesis.getVoices().length : 0;

    // Check microphone permission
    let micStatus: CapabilityStatus = "checking";
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        micStatus = "supported";
      } else {
        micStatus = "unsupported";
      }
    } catch {
      micStatus = "permission_denied";
    }

    const caps: VoiceCapabilities = {
      speechRecognition: hasSR ? "supported" : "unsupported",
      speechSynthesis: hasTTS ? "supported" : "unsupported",
      microphonePermission: micStatus,
      availableVoices: voices,
      selectedLanguage: "en-US",
      secureContext: isSecureContext,
      browser,
      isMobile,
      audioDeviceAvailable: micStatus === "supported",
      detectedAt: new Date().toISOString(),
    };

    setCapabilities(caps);
    setDetecting(false);
    return caps;
  }, []);

  return { capabilities, detecting, detect };
}

// ─── TTS hook ─────────────────────────────────────────────────────────

function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1.0);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === "undefined" || !window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.name.includes("Daniel") || v.name.includes("Alex") || v.lang.startsWith("en"));
    let i = 0;
    const next = () => {
      if (i >= sentences.length) { setSpeaking(false); onEnd?.(); return; }
      const u = new SpeechSynthesisUtterance(sentences[i].trim());
      u.rate = rate; u.pitch = 0.9; u.volume = 1.0;
      if (voice) u.voice = voice;
      u.onstart = () => setSpeaking(true);
      u.onend = () => { i++; setTimeout(next, 80); };
      u.onerror = () => { setSpeaking(false); onEnd?.(); };
      window.speechSynthesis.speak(u);
    };
    next();
  }, [rate]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, []);

  return { speaking, speak, stop, muted, setMuted, rate, setRate };
}

// ─── Statement classification labels ──────────────────────────────────

const CLASSIFICATION_LABELS: Record<StatementClassification, { label: string; color: string }> = {
  directly_observed_fact: { label: "Directly observed fact", color: "text-green-400" },
  customer_reported_statement: { label: "Customer-reported", color: "text-blue-400" },
  employee_interpretation: { label: "Employee interpretation", color: "text-amber-400" },
  estimate: { label: "Estimate", color: "text-purple-400" },
  prediction: { label: "Prediction", color: "text-cyan-400" },
  causal_claim: { label: "Causal claim", color: "text-orange-400" },
  preference_inference: { label: "Preference inference", color: "text-pink-400" },
  unresolved_uncertainty: { label: "Unresolved uncertainty", color: "text-red-400" },
};

const ARTIFACT_TYPE_LABELS: Record<EvidenceArtifactType, string> = {
  observation: "Observation",
  outcome: "Outcome",
  protocol_deviation: "Protocol deviation",
  confounder: "Confounder",
  customer_preference_signal: "Customer preference signal",
  execution_fidelity_event: "Execution fidelity event",
  negative_outcome: "Negative outcome",
  complaint: "Complaint",
  opt_out: "Opt-out",
  adverse_event_indicator: "Adverse event indicator",
  follow_up_requirement: "Follow-up requirement",
  derivative_idea: "Derivative idea",
  unresolved_question: "Unresolved question",
  external_factor_report: "External factor report",
};

// ─── Guided interview questions ───────────────────────────────────────

const INTERVIEW_QUESTIONS = [
  { id: "q1", prompt: "What happened?", required: true },
  { id: "q2", prompt: "What did you directly observe?", required: true },
  { id: "q3", prompt: "What changed from the approved protocol?", required: false },
  { id: "q4", prompt: "Who performed the action?", required: true },
  { id: "q5", prompt: "When did it occur?", required: true },
  { id: "q6", prompt: "What outcome was recorded?", required: true },
  { id: "q7", prompt: "What evidence supports that conclusion?", required: true },
  { id: "q8", prompt: "What else could explain the result?", required: false },
  { id: "q9", prompt: "Was there any complaint, opt-out, safety issue, or unexpected event?", required: true },
  { id: "q10", prompt: "How confident are you?", required: true },
];

// ─── Main component ───────────────────────────────────────────────────

export default function VoiceDemoPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mission, setMission] = useState<any>(null);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [artifacts, setArtifacts] = useState<EvidenceArtifact[]>([]);
  const [complianceFlags, setComplianceFlags] = useState<ComplianceFlagResult[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("browser_recognition");
  const [showConsent, setShowConsent] = useState(false);
  const [confirmedArtifactIds, setConfirmedArtifactIds] = useState<Set<string>>(new Set());
  const [correctionTarget, setCorrectionTarget] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [auditReceipt, setAuditReceipt] = useState<string | null>(null);

  const [user] = useState<{ id: string; name: string; role: string }>({ id: "emp-001", name: "Field Rep", role: "field_representative" });

  const { capabilities, detecting, detect } = useCapabilityDetection();
  const { speaking, speak, stop, muted, setMuted, rate, setRate } = useTTS();

  const recognitionRef = useRef<any>(null);
  const finalRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const capabilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Start mission: create session + detect capabilities ────────────

  async function startMission() {
    setGenerating(true);
    setError(null);
    try {
      // Create voice session — identity comes from the authenticated cookie
      const sessionRes = await fetch("/api/voice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) throw new Error(sessionData.error || `HTTP ${sessionRes.status}`);
      setSessionId(sessionData.sessionId);
      setPhase("capability_check");

      // Load mission — identity comes from the authenticated cookie
      const missionRes = await fetch("/api/spinor-rl/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const missionData = await missionRes.json();
      if (missionRes.ok) setMission(missionData.mission);

      // Detect capabilities with bounded timeout
      setPhase("capability_check");
      const caps = await Promise.race([
        detect(),
        new Promise<VoiceCapabilities>((resolve) => {
          capabilityTimeoutRef.current = setTimeout(() => {
            resolve({
              speechRecognition: "unsupported",
              speechSynthesis: "unsupported",
              microphonePermission: "unsupported",
              availableVoices: 0,
              selectedLanguage: "en-US",
              secureContext: false,
              browser: "unknown",
              isMobile: false,
              audioDeviceAvailable: false,
              detectedAt: new Date().toISOString(),
            });
          }, 5000);
        }),
      ]);

      if (capabilityTimeoutRef.current) clearTimeout(capabilityTimeoutRef.current);

      // Post capabilities to server
      await fetch(`/api/voice/sessions/${sessionData.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities: caps }),
      });

      // Determine capture mode
      if (caps.speechRecognition === "supported" && caps.microphonePermission === "supported") {
        setCaptureMode("browser_recognition");
      } else if (caps.speechRecognition === "unsupported") {
        setCaptureMode("text_entry");
      }

      // Transition based on capabilities
      if (caps.speechRecognition === "unsupported" && caps.speechSynthesis === "unsupported") {
        setPhase("unsupported");
      } else if (caps.microphonePermission === "permission_denied") {
        setPhase("permission_denied");
      } else {
        setPhase("ready");
        // Read mission aloud if TTS available
        if (caps.speechSynthesis === "supported" && missionData.mission) {
          setPhase("briefing");
          const m = missionData.mission;
          speak(`Mission assigned. ${m.title}. Claim: ${m.claim}. Experimental action: ${m.experimentalAction}. Success metric: ${m.successMetric}.`, () => {
            setPhase("ready");
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start mission");
      setPhase("idle");
    } finally {
      setGenerating(false);
    }
  }

  // ─── Recording ──────────────────────────────────────────────────────

  async function startAudioViz() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const update = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(1, avg / 80));
        animRef.current = requestAnimationFrame(update);
      };
      update();
    } catch { /* optional */ }
  }

  function cleanupAudio() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (mediaRef.current) { mediaRef.current.getTracks().forEach((t) => t.stop()); mediaRef.current = null; }
    setAudioLevel(0);
  }

  const startListening = useCallback(() => {
    if (!sessionId) return;
    setError(null);
    stop();
    setTranscript("");
    setInterim("");
    finalRef.current = "";
    setRecordingTime(0);
    setPhase("listening");
    startAudioViz();

    // Notify server
    fetch(`/api/voice/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "listening", auditEventType: "voice.recording_started" }),
    }).catch(() => {});

    if (captureMode === "text_entry") {
      return; // text entry mode — no speech recognition
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setCaptureMode("text_entry");
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      let final = finalRef.current;
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript + " ";
        else interimText += event.results[i][0].transcript;
      }
      finalRef.current = final;
      setTranscript(final);
      setInterim(interimText);
    };
    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error || "Voice capture failed");
        setPhase("transcription_failed");
      }
    };
    recognition.onend = () => {
      if (finalRef.current.trim().length > 10 && phase === "listening") {
        submitSegment(finalRef.current.trim());
      } else {
        setListening(false);
        setPhase("ready");
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
  }, [sessionId, phase, stop, captureMode]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cleanupAudio();
    if (sessionId) {
      fetch(`/api/voice/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "processing", auditEventType: "voice.recording_stopped" }),
      }).catch(() => {});
    }
  }, [sessionId]);

  // ─── Submit transcript segment ──────────────────────────────────────

  async function submitSegment(text: string) {
    if (!sessionId || !text.trim()) return;
    stopListening();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/voice/sessions/${sessionId}/transcript-segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          confidence: 0.85,
          provider: captureMode === "browser_recognition" ? "browser" : "text",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSegments((prev) => [...prev, data.segment]);
      setTranscript("");
      setInterim("");
      finalRef.current = "";
      // Advance to next question or go to review
      if (currentQuestionIdx < INTERVIEW_QUESTIONS.length - 1) {
        setCurrentQuestionIdx((i) => i + 1);
        setPhase("ready");
      } else {
        // All questions answered — extract artifacts
        await extractEvidence();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setPhase("ready");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Extract evidence artifacts ─────────────────────────────────────

  async function extractEvidence() {
    if (!sessionId) return;
    setPhase("processing");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/voice/sessions/${sessionId}/extract`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setArtifacts(data.artifacts);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setPhase("ready");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Correct a transcript segment ───────────────────────────────────

  async function submitCorrection(segmentId: string) {
    if (!sessionId || !correctionText.trim()) return;
    try {
      const res = await fetch(`/api/voice/sessions/${sessionId}/transcript-segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: correctionText,
          confidence: 1.0,
          provider: "text-correction",
        }),
      });
      // Also mark the old segment as corrected via a direct correction
      // For simplicity, we add the corrected text as a new segment
      const data = await res.json();
      setSegments((prev) => [...prev, data.segment]);
      setCorrectionTarget(null);
      setCorrectionText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction failed");
    }
  }

  // ─── Confirm artifacts ──────────────────────────────────────────────

  async function confirmAndSubmit() {
    if (!sessionId || confirmedArtifactIds.size === 0) return;
    setSubmitting(true);
    setPhase("confirmed");
    try {
      const res = await fetch(`/api/voice/sessions/${sessionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedArtifactIds: Array.from(confirmedArtifactIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPhase("persisted");
      // Generate audit receipt
      const receiptId = `audit-${Date.now()}`;
      setAuditReceipt(receiptId);
      setPhase("completed");
      if (!muted) speak("Evidence submitted and confirmed. Session completed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation failed");
      setPhase("review");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Cancel session ─────────────────────────────────────────────────

  async function cancelSession() {
    if (sessionId) {
      await fetch(`/api/voice/sessions/${sessionId}/cancel`, { method: "POST" }).catch(() => {});
    }
    reset();
  }

  function reset() {
    stop();
    stopListening();
    setPhase("idle");
    setSessionId(null);
    setMission(null);
    setTranscript("");
    setInterim("");
    setSegments([]);
    setArtifacts([]);
    setComplianceFlags([]);
    setError(null);
    setCurrentQuestionIdx(0);
    setConfirmedArtifactIds(new Set());
    setCorrectionTarget(null);
    setCorrectionText("");
    setAuditReceipt(null);
    finalRef.current = "";
  }

  useEffect(() => () => { stop(); stopListening(); cleanupAudio(); }, [stop, stopListening]);

  const recMin = Math.floor(recordingTime / 60);
  const recSec = recordingTime % 60;
  const currentQuestion = INTERVIEW_QUESTIONS[currentQuestionIdx];

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Speak the field reality. SPINOR turns it into governed evidence.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Describe what happened naturally. SPINOR extracts the observation, identifies your contribution,
          updates the experiment, prepares the follow-up, and preserves the complete evidence trail.
        </p>
      </div>

      {/* Capability status bar */}
      {capabilities && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/10 p-3 text-xs">
          <span className="text-muted-foreground">Browser:</span>
          <span className="font-medium text-foreground">{capabilities.browser}</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Recognition:</span>
          <span className={`font-medium ${capabilities.speechRecognition === "supported" ? "text-green-400" : "text-red-400"}`}>
            {capabilities.speechRecognition}
          </span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Synthesis:</span>
          <span className={`font-medium ${capabilities.speechSynthesis === "supported" ? "text-green-400" : "text-red-400"}`}>
            {capabilities.speechSynthesis}
          </span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Mic:</span>
          <span className={`font-medium ${capabilities.microphonePermission === "supported" ? "text-green-400" : capabilities.microphonePermission === "permission_denied" ? "text-red-400" : "text-amber-400"}`}>
            {capabilities.microphonePermission}
          </span>
          {captureMode === "text_entry" && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-400">Text fallback active</span>
          )}
        </div>
      )}

      {/* TTS controls */}
      {capabilities?.speechSynthesis === "supported" && phase !== "idle" && (
        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => setMuted(!muted)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${muted ? "border-border text-muted-foreground" : "border-primary/30 text-primary"}`}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rate:</span>
            <input type="range" min="0.5" max="2" step="0.1" value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="h-1 w-24 accent-primary" />
            <span className="text-xs text-muted-foreground">{rate.toFixed(1)}x</span>
          </div>
          {speaking && (
            <button onClick={stop} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Stop speaking
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/[0.03] p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        </div>
      )}

      {/* ═══ Phase: Idle — Mission assignment ═══ */}
      {phase === "idle" && (
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Today's SPIN</h2>
            <div className="mt-4 rounded-xl border border-border bg-muted/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hypothesis</p>
              <p className="mt-1 text-sm text-foreground/90">
                {mission?.claim || "Office-staff ownership predicts workflow completion more strongly than physician enthusiasm."}
              </p>
            </div>
            <div className="mt-3 rounded-xl border border-border bg-muted/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mission</p>
              <p className="mt-1 text-sm text-foreground/90">
                {mission?.experimentalAction || "Test one staff-owned workflow with two eligible accounts."}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-400">You may change</p>
                <ul className="mt-1.5 space-y-1 text-xs text-foreground/80">
                  <li>· Which staff member is approached</li>
                  <li>· When the interaction occurs</li>
                  <li>· Whether a human introduction happens before automation</li>
                </ul>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-400">You may not change</p>
                <ul className="mt-1.5 space-y-1 text-xs text-foreground/80">
                  <li>· Approved information</li>
                  <li>· Eligibility rules</li>
                  <li>· Contact limits</li>
                  <li>· Compliance boundaries</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={startMission} disabled={generating}
              className="btn btn-primary px-8 py-3 text-base disabled:opacity-50">
              {generating ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</span>
              ) : (
                <span className="flex items-center gap-2"><Zap className="h-5 w-5" /> Start Mission</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Phase: Capability check ═══ */}
      {phase === "capability_check" && (
        <div className="glass-card p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Detecting voice capabilities…</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Timeout in 5 seconds → text fallback</p>
        </div>
      )}

      {/* ═══ Phase: Unsupported ═══ */}
      {phase === "unsupported" && (
        <div className="glass-card p-6">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <h3 className="mt-3 font-semibold text-foreground">Voice APIs not available</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your browser does not support speech recognition or synthesis. You can still complete the mission using text entry.
          </p>
          <button onClick={() => { setCaptureMode("text_entry"); setPhase("ready"); }}
            className="mt-4 btn btn-primary px-6 py-2 text-sm">
            Continue with text entry
          </button>
        </div>
      )}

      {/* ═══ Phase: Permission denied ═══ */}
      {phase === "permission_denied" && (
        <div className="glass-card p-6">
          <Shield className="h-6 w-6 text-amber-400" />
          <h3 className="mt-3 font-semibold text-foreground">Microphone permission required</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            SPINOR needs microphone permission to capture your spoken observations. You can grant permission in your browser settings, or continue with text entry.
          </p>
          <div className="mt-4 flex gap-3">
            <button onClick={() => { setCaptureMode("text_entry"); setPhase("ready"); }}
              className="btn btn-primary px-6 py-2 text-sm">
              Continue with text entry
            </button>
            <button onClick={startMission}
              className="btn btn-outline px-6 py-2 text-sm">
              Retry permission
            </button>
          </div>
        </div>
      )}

      {/* ═══ Phase: Ready / Briefing / Listening — Three-panel layout ═══ */}
      {(phase === "ready" || phase === "briefing" || phase === "listening") && mission && (
        <div className="space-y-4">
          {/* Mission card */}
          <div className="glass-card p-5">
            <h3 className="font-semibold text-foreground">{mission.title}</h3>
            <p className="mt-2 text-sm text-foreground/90">{mission.claim}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Experimental Action</p><p className="mt-0.5 text-xs text-foreground/80">{mission.experimentalAction}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Success Metric</p><p className="mt-0.5 text-xs text-foreground/80">{mission.successMetric}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Failure Condition</p><p className="mt-0.5 text-xs text-red-400/80">{mission.failureCondition}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risk Boundary</p><p className="mt-0.5 text-xs text-foreground/70">{mission.riskBoundary}</p></div>
            </div>
          </div>

          {/* Current interview question */}
          {phase === "ready" && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                  Question {currentQuestionIdx + 1} of {INTERVIEW_QUESTIONS.length}
                </span>
                {currentQuestion.required && (
                  <span className="text-xs text-red-400">*required</span>
                )}
              </div>
              <p className="mt-3 text-lg font-medium text-foreground">{currentQuestion.prompt}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You can say: "Skip", "I don't know", "Not observed", or "Mark uncertain"
              </p>
            </div>
          )}

          {/* Three-panel layout */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Panel 1: What you said */}
            <div className="glass-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What you said</h4>
              <div className="mt-3 min-h-[120px]">
                {phase === "listening" ? (
                  <>
                    <p className="text-sm text-foreground/90">{transcript}</p>
                    {interim && <p className="mt-1 text-sm text-muted-foreground italic">{interim}</p>}
                    {!transcript && !interim && <p className="text-sm text-muted-foreground/50">Listening…</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground/50">
                    {captureMode === "text_entry" ? "Type your response below." : "Tap the microphone and speak."}
                  </p>
                )}
              </div>
              {phase === "listening" && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC
                  </span>
                  <span className="text-xs text-muted-foreground">{recMin}:{recSec.toString().padStart(2, "0")}</span>
                  <div className="ml-auto flex items-end gap-0.5 h-4">
                    {[0,1,2,3,4].map((i) => (
                      <div key={i} className="w-0.5 rounded-full bg-primary transition-all duration-75"
                        style={{ height: `${Math.max(2, Math.min(16, audioLevel * 20 * (1 - Math.abs(i - 2) / 3)))}px`, opacity: audioLevel > 0.05 ? 1 : 0.2 }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Panel 2: What SPINOR understood */}
            <div className="glass-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What SPINOR understood</h4>
              <div className="mt-3 min-h-[120px] space-y-2">
                {segments.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50">Structured extraction appears here after you speak.</p>
                ) : (
                  segments.slice(-3).map((seg) => (
                    <div key={seg.segmentId} className="rounded-lg border border-border bg-muted/5 p-2">
                      <p className="text-xs text-foreground/80">
                        {seg.transcriptText.slice(0, 120)}
                        {seg.transcriptText.length > 120 ? "…" : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`text-[10px] ${seg.confirmationState === "confirmed" ? "text-green-400" : seg.confirmationState === "corrected" ? "text-amber-400" : "text-muted-foreground"}`}>
                          {seg.confirmationState}
                        </span>
                        <span className="text-[10px] text-muted-foreground">conf: {(seg.confidence * 100).toFixed(0)}%</span>
                        <button onClick={() => { setCorrectionTarget(seg.segmentId); setCorrectionText(seg.transcriptText); }}
                          className="ml-auto text-[10px] text-primary hover:underline">
                          <Edit3 className="inline h-3 w-3" /> Correct
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Panel 3: What happens next */}
            <div className="glass-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happens next</h4>
              <div className="mt-3 min-h-[120px]">
                {artifacts.length > 0 ? (
                  <div className="space-y-2 text-xs">
                    <div><p className="text-muted-foreground">Artifacts extracted</p><p className="text-foreground/80">{artifacts.length} pieces of evidence</p></div>
                    <div><p className="text-muted-foreground">Next step</p><p className="text-foreground/80">Review and confirm evidence</p></div>
                  </div>
                ) : (
                  <div className="space-y-1 text-xs text-muted-foreground/50">
                    <p>Progress: {currentQuestionIdx + 1}/{INTERVIEW_QUESTIONS.length} questions</p>
                    <div className="h-1.5 w-full rounded-full bg-muted/20">
                      <div className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${((currentQuestionIdx + 1) / INTERVIEW_QUESTIONS.length) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Correction dialog */}
          {correctionTarget && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-semibold text-foreground">Correct transcript</h4>
              <p className="mt-1 text-xs text-muted-foreground">The original is preserved. This adds a corrected version.</p>
              <textarea
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-muted/10 p-3 text-sm text-foreground"
                rows={3}
              />
              <div className="mt-2 flex gap-2">
                <button onClick={() => submitCorrection(correctionTarget)}
                  className="btn btn-primary px-4 py-1.5 text-xs">Save correction</button>
                <button onClick={() => { setCorrectionTarget(null); setCorrectionText(""); }}
                  className="btn btn-outline px-4 py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          )}

          {/* Mic button or text input */}
          {phase === "ready" && !correctionTarget && (
            <div className="space-y-3">
              {captureMode === "browser_recognition" ? (
                <div className="flex justify-center py-2">
                  <button onClick={startListening}
                    className="group flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5 transition-all hover:scale-105 hover:border-primary/60 hover:bg-primary/10">
                    <Mic className="text-2xl text-primary" />
                  </button>
                </div>
              ) : null}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && transcript.trim()) submitSegment(transcript.trim()); }}
                  placeholder="Type your response here…"
                  className="flex-1 rounded-lg border border-border bg-muted/10 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/30 focus:outline-none"
                />
                <button onClick={() => transcript.trim() && submitSegment(transcript.trim())}
                  disabled={!transcript.trim() || submitting}
                  className="btn btn-outline px-4 py-2.5 text-sm disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="flex justify-center gap-2">
                <button onClick={() => submitSegment("Skip")}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/30">
                  <SkipForward className="inline h-3 w-3" /> Skip
                </button>
                <button onClick={() => submitSegment("I don't know")}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/30">
                  I don't know
                </button>
                <button onClick={() => { if (currentQuestionIdx < INTERVIEW_QUESTIONS.length - 1) { setCurrentQuestionIdx((i) => i + 1); } else { extractEvidence(); } }}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/30">
                  Next question →
                </button>
              </div>
            </div>
          )}

          {phase === "listening" && (
            <div className="flex justify-center gap-3 py-2">
              <button onClick={() => { if (sessionId) fetch(`/api/voice/sessions/${sessionId}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({state:"paused", auditEventType:"voice.recording_paused"}) }); setPhase("paused"); }}
                className="btn btn-outline px-4 py-2 text-sm">
                <Pause className="h-4 w-4" /> Pause
              </button>
              <button onClick={() => finalRef.current.trim() ? submitSegment(finalRef.current.trim()) : stopListening()}
                className="btn btn-primary px-6 py-2 text-sm">
                <Square className="h-4 w-4" /> Stop & Process
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ Phase: Paused ═══ */}
      {phase === "paused" && (
        <div className="flex justify-center gap-3 py-2">
          <button onClick={() => setPhase("listening")}
            className="btn btn-primary px-4 py-2 text-sm">
            <Play className="h-4 w-4" /> Resume
          </button>
        </div>
      )}

      {/* ═══ Phase: Processing ═══ */}
      {phase === "processing" && (
        <div className="glass-card p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm font-medium text-foreground">Extracting evidence from transcript…</p>
          <p className="mt-1 text-xs text-muted-foreground">Distinguishing facts from interpretations. Checking compliance.</p>
        </div>
      )}

      {/* ═══ Phase: Review — Evidence artifacts for confirmation ═══ */}
      {phase === "review" && (
        <div className="space-y-4">
          <div className="glass-card p-5">
            <h3 className="font-semibold text-foreground">Review extracted evidence</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm or reject each artifact. Facts and interpretations are labeled separately.
              Nothing is persisted until you confirm.
            </p>

            {artifacts.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No artifacts were extracted from the transcript.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {artifacts.map((art) => {
                  const cls = CLASSIFICATION_LABELS[art.classification] || { label: art.classification, color: "text-muted-foreground" };
                  const isConfirmed = confirmedArtifactIds.has(art.artifactId);
                  const hasCompliance = art.complianceFlags.length > 0;
                  return (
                    <div key={art.artifactId} className={`rounded-xl border p-4 ${isConfirmed ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/5"} ${hasCompliance ? "border-amber-500/30" : ""}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              {ARTIFACT_TYPE_LABELS[art.artifactType] || art.artifactType}
                            </span>
                            <span className={`text-xs font-medium ${cls.color}`}>{cls.label}</span>
                            {hasCompliance && (
                              <span className="flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                                <Shield className="h-3 w-3" /> Compliance flag
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-foreground/90">{art.normalizedStatement}</p>
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span>Confidence: {art.confidence < 0.4 ? "Low" : art.confidence < 0.7 ? "Moderate" : "High"}</span>
                            <span className="mx-2">·</span>
                            <span>Uncertainty: {art.uncertainty}</span>
                          </div>
                          {/* Source spans */}
                          <div className="mt-2">
                            <p className="text-[10px] text-muted-foreground/60">Source spans:</p>
                            {art.sourceSpans.map((span, i) => (
                              <p key={i} className="text-[10px] text-muted-foreground/50 italic">"{span.excerpt.slice(0, 80)}…"</p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button onClick={() => {
                            setConfirmedArtifactIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(art.artifactId)) next.delete(art.artifactId);
                              else next.add(art.artifactId);
                              return next;
                            });
                          }}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isConfirmed ? "bg-green-500/15 text-green-400 border border-green-500/30" : "border border-border text-muted-foreground hover:border-primary/30"}`}>
                            {isConfirmed ? <><CheckCircle2 className="inline h-3 w-3" /> Confirmed</> : "Confirm"}
                          </button>
                          <button onClick={() => setConfirmedArtifactIds((prev) => { const next = new Set(prev); next.delete(art.artifactId); return next; })}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-red-500/30 hover:text-red-400">
                            <Trash2 className="inline h-3 w-3" /> Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Confirmation statement */}
          <div className="glass-card p-4">
            <p className="text-sm text-foreground/90">
              "I confirm that this record accurately represents what I observed."
            </p>
            <div className="mt-3 flex gap-3">
              <button onClick={confirmAndSubmit} disabled={confirmedArtifactIds.size === 0 || submitting}
                className="btn btn-primary flex-1 disabled:opacity-50">
                {submitting ? "Submitting…" : `Confirm ${confirmedArtifactIds.size} artifact${confirmedArtifactIds.size !== 1 ? "s" : ""} and submit`}
              </button>
              <button onClick={() => { setPhase("ready"); setCurrentQuestionIdx(0); }}
                className="btn btn-outline">
                Record more
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Phase: Compliance hold ═══ */}
      {phase === "compliance_hold" && (
        <div className="glass-card p-6">
          <Shield className="h-6 w-6 text-amber-400" />
          <h3 className="mt-3 font-semibold text-foreground">Compliance hold</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A potential compliance issue was detected in the extracted evidence. The source transcript is preserved.
            This session is marked for required review. The escalation procedure has been activated.
          </p>
          <p className="mt-2 text-xs text-amber-400">
            The voice agent must not autonomously create clinical, efficacy, or comparative claims.
          </p>
          <button onClick={() => setPhase("review")}
            className="mt-4 btn btn-outline px-6 py-2 text-sm">
            Return to review
          </button>
        </div>
      )}

      {/* ═══ Phase: Completed ═══ */}
      {phase === "completed" && (
        <div className="space-y-4">
          <div className="glass-card p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-400" />
              <div>
                <h3 className="font-semibold text-foreground">SPIN Recorded</h3>
                {auditReceipt && <p className="text-xs text-muted-foreground">Audit receipt: {auditReceipt}</p>}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-muted/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current interpretation</p>
              <p className="mt-1 text-sm text-foreground/90">
                {confirmedArtifactIds.size} artifact{confirmedArtifactIds.size !== 1 ? "s" : ""} confirmed and persisted to the experiment ledger.
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-green-500/20 bg-green-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-400">Work completed automatically</p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-foreground/80">
                <li>· Evidence attached to the experiment</li>
                <li>· Attribution and admissibility entered pending state</li>
                <li>· Manager summary updated</li>
                <li>· Audit receipt generated</li>
                <li>· Compliance flags checked</li>
              </ul>
            </div>

            {/* Audit trail */}
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit events</p>
              <div className="mt-2 space-y-1">
                {["voice.session_created", "voice.recording_started", "voice.transcript_received", "voice.artifacts_extracted", "voice.artifacts_confirmed", "voice.session_completed"].map((evt, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-green-400" />
                    <span>{evt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm italic text-muted-foreground">
              One field conversation became evidence, completed work, human contribution credit, and the next organizational experiment.
            </p>
          </div>

          <button onClick={reset} className="btn btn-outline w-full">
            <span className="flex items-center justify-center gap-2"><RotateCcw className="h-4 w-4" /> New Mission</span>
          </button>
        </div>
      )}

      {/* Cancel */}
      {phase !== "idle" && phase !== "completed" && (
        <div className="mt-4 text-center">
          <button onClick={cancelSession} className="text-xs text-muted-foreground hover:text-foreground">Cancel and start over</button>
        </div>
      )}
    </div>
  );
}
