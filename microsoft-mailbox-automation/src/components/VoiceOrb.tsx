"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useVoice } from "@/components/useVoice";
import { useVoiceContext } from "@/components/VoiceContext";
import { Volume2, VolumeX, X, Sparkles, Brain, Zap, Eye, Waves, Cpu, Users, DollarSign, CheckCircle2, ArrowRight, AlertCircle } from "lucide-react";

/**
 * VoiceEntity — not a button. A living intelligence presence.
 *
 * Reimagined from "click to talk" to a living entity that:
 *   1. BREATHES — subtle organic animation when dormant
 *   2. LISTENSES AMBIENTLY — always-on with wake word "Foundry"
 *   3. THINKS VISUALLY — neural network animation when processing
 *   4. SPEAKS WITH PERSONALITY — Foundry Voice, not robotic TTS
 *   5. REMEMBERS — conversational threading across commands
 *   6. SUGGESTS — page-aware proactive suggestions
 *   7. ALERTS — speaks up when it detects opportunities
 *   8. SHOWS A WAVEFORM — real-time audio visualization
 *
 * States: dormant → listening → thinking → speaking → alerting
 */

type EntityState = "dormant" | "listening" | "thinking" | "speaking" | "alerting";

interface ConversationTurn {
  role: "user" | "foundry";
  text: string;
  action?: string;
  timestamp: number;
}

// Page-aware suggestions — what might you want to do here?
const PAGE_SUGGESTIONS: Record<string, string[]> = {
  "/today": ["run research", "attack with confounders", "accept mission", "generate derivatives"],
  "/foundry": ["assess for golden node", "generate derivatives"],
  "/experiment": ["record outcome", "generate protocol"],
  "/results": ["generate insight", "audit fairness"],
  "/golden-nodes": ["explain lineage", "reverse falsify"],
  "/inbox": ["analyze inbox", "detect email signals"],
  "/email-lab": ["detect email signals", "generate hypotheses", "run email experiment", "reverse falsify"],
  "/history": ["audit fairness"],
};

// Foundry Voice personality responses
const FOUNDRY_GREETINGS = [
  "Field intelligence online. What are we testing today?",
  "Foundry standing by. Speak the uncertainty.",
  "Ready. What needs falsifying?",
  "Listening. What did the field reveal?",
];

const FOUNDRY_ACKNOWLEDGMENTS = [
  "Processing.",
  "On it.",
  "Running that now.",
  "Let me think about that.",
  "Working through it.",
];

export function VoiceOrb() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [entityState, setEntityState] = useState<EntityState>("dormant");
  const [expanded, setExpanded] = useState(false);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [processing, setProcessing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ambientMode, setAmbientMode] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(new Array(32).fill(0));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hasGreeted, setHasGreeted] = useState(false);
  const [proximityHover, setProximityHover] = useState(false);
  const [runtimeState, setRuntimeState] = useState<any>(null);
  const [directorAssessment, setDirectorAssessment] = useState<any>(null);
  const pathnameRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const conversationRef = useRef<ConversationTurn[]>([]);

  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const { currentPage, executeAction, getStatus } = useVoiceContext();

  // Update page-aware suggestions from VoiceContext (real capabilities)
  useEffect(() => {
    if (currentPage?.actions) {
      const available = currentPage.actions.filter((a) => a.available);
      const next = available.map((a) => a.label);
      setSuggestions((prev) => {
        const prevSorted = [...prev].sort().join(",");
        const nextSorted = [...next].sort().join(",");
        return prevSorted === nextSorted ? prev : next;
      });
    } else {
      setSuggestions(PAGE_SUGGESTIONS[pathname] || []);
    }
  }, [pathname, currentPage]);

  // Keep conversation ref in sync
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);

  // ─── Runtime state polling ──────────────────────────────────────────
  // The orb is a runtime presence, not just a chat bubble. It shows live
  // state: streams observed, tasks executing, tasks waiting on the human.
  useEffect(() => {
    let poll: number | null = null;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/runtime/state", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setRuntimeState(data);
          if (data.tasksWaitingOnHuman > 0 && entityState === "dormant" && !processing) {
            setEntityState("alerting");
          }
        }
        const dirRes = await fetch("/api/runtime/director", { cache: "no-store" });
        if (dirRes.ok) {
          const dirData = await dirRes.json();
          setDirectorAssessment(dirData);
        }
      } catch {
        // Runtime API not available — orb still works as voice interface
      }
    };
    fetchState();
    poll = window.setInterval(fetchState, 5000);
    return () => { if (poll) clearInterval(poll); };
  }, [entityState, processing]);

  // ─── Waveform visualization via Web Audio API ───────────────────
  useEffect(() => {
    if (entityState !== "listening") {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setWaveform(new Array(32).fill(0));
      return;
    }

    async function setupAudio() {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioContext();
        }
        if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRef.current = stream;
        const source = audioCtxRef.current.createMediaStreamSource(stream);
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          analyser.getByteFrequencyData(dataArray);
          const bars = Array.from(dataArray.slice(0, 32)).map(v => v / 255);
          setWaveform(bars);
          animFrameRef.current = requestAnimationFrame(update);
        };
        update();
      } catch {
        // Fallback: synthetic waveform
        let frame = 0;
        const update = () => {
          frame++;
          const bars = new Array(32).fill(0).map((_, i) =>
            0.3 + 0.3 * Math.sin(frame * 0.1 + i * 0.5) + 0.2 * Math.random()
          );
          setWaveform(bars);
          animFrameRef.current = requestAnimationFrame(update);
        };
        update();
      }
    }
    setupAudio();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRef.current) {
        mediaRef.current.getTracks().forEach(t => t.stop());
        mediaRef.current = null;
      }
    };
  }, [entityState]);

  // ─── Greet on first interaction ─────────────────────────────────
  useEffect(() => {
    if (!hasGreeted && ambientMode && entityState === "dormant") {
      const greeting = FOUNDRY_GREETINGS[Math.floor(Math.random() * FOUNDRY_GREETINGS.length)];
      setTimeout(() => {
        if (!muted) voice.speak(greeting, { rate: 0.95, pitch: 0.85 });
        setHasGreeted(true);
      }, 500);
    }
  }, [ambientMode, hasGreeted, entityState, muted]);

  // ─── Command handler ────────────────────────────────────────────
  // Speech is now an observation, not a command. The runtime decides what to do.
  // The orb still supports direct commands for backward compatibility, but
  // the primary path is: speak → emit event → runtime proposes action → confirm.

  const handleTranscript = useCallback(async (text: string) => {
    if (!text) return;
    setEntityState("thinking");
    setProcessing(true);

    // Add to conversation
    const userTurn: ConversationTurn = { role: "user", text, timestamp: Date.now() };
    setConversation(prev => [...prev, userTurn]);

    try {
      // ── First: emit as a runtime event (speech = observation) ──
      // The runtime will process it and propose an action.
      try {
        await fetch("/api/voice/diary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            text,
            sessionId: "voice-orb",
            segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          }),
        });
        // Process through the runtime loop
        const processRes = await fetch("/api/runtime/process", { method: "POST" });
        const processData = await processRes.json().catch(() => ({}));

        if (processData.proposalsCreated > 0) {
          const latestProposal = processData.proposals[processData.proposals.length - 1];
          const speech = latestProposal
            ? `I observed: ${latestProposal.observation}. I propose: ${latestProposal.action}. ${latestProposal.requiresConfirmation ? "Should I proceed?" : "Executing now."}`
            : "I've processed your observation.";

          if (!muted) {
            setEntityState("speaking");
            voice.speak(speech, { rate: 0.95, pitch: 0.85, onEnd: () => setEntityState("dormant") });
          }
          setConversation(prev => [...prev, { role: "foundry", text: speech, action: latestProposal?.action, timestamp: Date.now() }]);
          setProcessing(false);
          return;
        }
      } catch {
        // Runtime API not available — fall through to direct command execution
      }

      // ── Fallback: direct command execution (backward compatibility) ──
      // Include conversation context for threading
      const recentContext = conversationRef.current
        .slice(-4)
        .map(t => `${t.role}: ${t.text}`)
        .join("\n");

      // Check for "status" / "what's here" / "summarize" commands first — these read from VoiceContext
      const lower = text.toLowerCase().trim();
      if (lower.includes("status") || lower.includes("what's here") || lower.includes("what is here") || lower.includes("summarize") || lower.includes("what do i have") || lower.includes("what am i looking at")) {
        const status = getStatus();
        if (!muted) {
          setEntityState("speaking");
          voice.speak(status, { rate: 0.95, pitch: 0.85, onEnd: () => setEntityState("dormant") });
        }
        setConversation(prev => [...prev, { role: "foundry", text: status, action: "status", timestamp: Date.now() }]);
        setProcessing(false);
        return;
      }

      const res = await fetch("/api/llm/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          context: pathnameRef.current,
          conversation: recentContext,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Execute the action via VoiceContext (deep integration) or fallback to event dispatch
      let actionSpeech = data.speech || data.action || "Done.";

      if (data.action === "navigate" && data.target) {
        router.push(data.target);
        setTimeout(() => {
          setSuggestions(PAGE_SUGGESTIONS[data.target] || []);
        }, 500);
      } else if (data.action && data.action !== "speak" && data.action !== "unknown") {
        // Try VoiceContext first — this is the real integration
        const result = await executeAction(data.action);
        if (result) {
          actionSpeech = result.speech;
          // Also dispatch the event for backward compatibility with useVoiceCommand
          window.dispatchEvent(new CustomEvent("voice-command", { detail: { action: data.action } }));
        } else {
          // No page handler — say so honestly
          actionSpeech = `That action isn't available here. Try navigating to the right page first.`;
        }
      }

      // Speak with Foundry personality
      if (!muted) {
        setEntityState("speaking");
        voice.speak(actionSpeech, {
          rate: 0.95,
          pitch: 0.85,
          onEnd: () => setEntityState("dormant"),
        });
      } else {
        setEntityState("dormant");
      }

      // Add Foundry response to conversation
      const foundryTurn: ConversationTurn = {
        role: "foundry",
        text: actionSpeech,
        action: data.action,
        timestamp: Date.now(),
      };
      setConversation(prev => [...prev, foundryTurn]);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Command failed";
      const foundryTurn: ConversationTurn = {
        role: "foundry",
        text: `That didn't work. ${errorMsg}`,
        timestamp: Date.now(),
      };
      setConversation(prev => [...prev, foundryTurn]);
      if (!muted) voice.speak("That didn't work. Try again.", { rate: 0.95, pitch: 0.85 });
      setEntityState("dormant");
    } finally {
      setProcessing(false);
    }
  }, [muted, getStatus, executeAction, router]);

  const voice = useVoice({ onTranscript: handleTranscript, continuous: ambientMode, wakeWord: "foundry" });

  // Sync entity state with voice state
  useEffect(() => {
    if (processing) return; // Don't override thinking state
    if (voice.listening) setEntityState("listening");
    else if (voice.speaking) setEntityState("speaking");
    else if (entityState !== "alerting") setEntityState("dormant");
  }, [voice.listening, voice.speaking, processing]);

  // ─── Spacebar push-to-talk ──────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !expanded) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        if (voice.supported && !voice.listening) voice.startListening();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !expanded) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        if (voice.supported && voice.listening) voice.stopListening();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [voice, expanded]);

  const handleClick = () => {
    if (!voice.supported) { setExpanded(true); return; }
    if (voice.listening) voice.stopListening();
    else voice.startListening();
  };

  const toggleAmbient = () => {
    const next = !ambientMode;
    setAmbientMode(next);
    if (next && voice.supported) {
      voice.startListening();
      if (!hasGreeted && !muted) {
        const greeting = FOUNDRY_GREETINGS[Math.floor(Math.random() * FOUNDRY_GREETINGS.length)];
        setTimeout(() => voice.speak(greeting, { rate: 0.95, pitch: 0.85 }), 300);
        setHasGreeted(true);
      }
    } else {
      voice.stopListening();
    }
  };

  // ─── Visual properties by state ─────────────────────────────────
  const stateConfig: Record<EntityState, {
    color: string;
    glow: string;
    label: string;
    icon: any;
    ringCount: number;
  }> = {
    dormant: {
      color: "radial-gradient(circle at 35% 35%, hsl(240 60% 55%), hsl(260 70% 35%) 60%, hsl(280 80% 20%))",
      glow: "0 0 8px hsl(260 60% 40% / 0.3)",
      label: runtimeState ? (ambientMode ? "OBSERVING · say \"Foundry\"" : "OBSERVING · tap or Space") : (ambientMode ? "Ambient · say \"Foundry\"" : "Tap or hold Space"),
      icon: Brain,
      ringCount: 0,
    },
    listening: {
      color: "radial-gradient(circle at 35% 35%, hsl(160 80% 50%), hsl(180 80% 40%) 50%, hsl(200 90% 30%))",
      glow: "0 0 32px hsl(170 80% 50% / 0.6), 0 0 64px hsl(170 80% 50% / 0.3)",
      label: "Listening...",
      icon: Waves,
      ringCount: 3,
    },
    thinking: {
      color: "radial-gradient(circle at 35% 35%, hsl(270 80% 60%), hsl(280 80% 45%) 50%, hsl(290 90% 30%))",
      glow: "0 0 24px hsl(280 80% 50% / 0.5), 0 0 48px hsl(280 80% 50% / 0.2)",
      label: "Thinking...",
      icon: Sparkles,
      ringCount: 2,
    },
    speaking: {
      color: "radial-gradient(circle at 35% 35%, hsl(45 90% 60%), hsl(30 90% 50%) 50%, hsl(15 90% 40%))",
      glow: "0 0 28px hsl(35 90% 55% / 0.5), 0 0 56px hsl(35 90% 55% / 0.25)",
      label: "Speaking...",
      icon: Volume2,
      ringCount: 2,
    },
    alerting: {
      color: "radial-gradient(circle at 35% 35%, hsl(0 90% 60%), hsl(350 90% 45%) 50%, hsl(340 90% 30%))",
      glow: "0 0 32px hsl(0 90% 50% / 0.6), 0 0 64px hsl(0 90% 50% / 0.3)",
      label: "Alert",
      icon: Zap,
      ringCount: 3,
    },
  };

  const cfg = stateConfig[entityState];
  const orbSize = entityState === "listening" ? 56 : entityState === "dormant" ? 44 : 50;

  return (
    <>
      {/* ═══ Expanded Conversation Panel ═══ */}
      {expanded && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]">
          <div className="glass-card p-5 fade-in" style={{ animation: "cmdk-in 0.25s ease-out" }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="relative h-8 w-8 rounded-full" style={{ background: cfg.color, boxShadow: cfg.glow }}>
                  <div className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: cfg.color }} />
                </div>
                <div>
                  <p className="text-sm font-semibold gradient-text">Foundry</p>
                  <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAmbient}
                  className={`text-[10px] px-2 py-1 rounded-full transition-colors ${ambientMode ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-muted/20 text-muted-foreground border border-border"}`}
                  title="Always listening for wake word"
                >
                  {ambientMode ? "AMBIENT ON" : "AMBIENT"}
                </button>
                <button onClick={() => setMuted(!muted)} className="text-muted-foreground hover:text-foreground" title={muted ? "Unmute" : "Mute"}>
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ═══ Director / Executor Panel ═══ */}
            {runtimeState && (
              <div className="mb-4 p-3 rounded-xl bg-muted/10 border border-border/50 space-y-3">
                {/* Status header — OBSERVING, not RECORDING */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Runtime</span>
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    OBSERVING
                  </span>
                </div>

                {/* Compact stats row */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <Eye className="h-3 w-3 mx-auto text-blue-400 mb-0.5" />
                    <div className="text-sm font-bold text-blue-400">{runtimeState.streamsObserved}</div>
                    <div className="text-[8px] text-muted-foreground">observing</div>
                  </div>
                  <div>
                    <Cpu className="h-3 w-3 mx-auto text-emerald-400 mb-0.5" />
                    <div className="text-sm font-bold text-emerald-400">{runtimeState.tasksExecuting}</div>
                    <div className="text-[8px] text-muted-foreground">executing</div>
                  </div>
                  <div>
                    <Users className="h-3 w-3 mx-auto text-amber-400 mb-0.5" />
                    <div className="text-sm font-bold text-amber-400">{runtimeState.tasksWaitingOnHuman}</div>
                    <div className="text-[8px] text-muted-foreground">need you</div>
                  </div>
                  <div>
                    <DollarSign className="h-3 w-3 mx-auto text-spinor-gold mb-0.5" />
                    <div className="text-sm font-bold text-spinor-gold">${runtimeState.validatedOpportunityValue}</div>
                    <div className="text-[8px] text-muted-foreground">opportunity</div>
                  </div>
                </div>

                {/* I'M DOING — active work (Director: what's happening) */}
                {runtimeState.activeWork?.length > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] text-emerald-400 mb-1 flex items-center gap-1">
                      <Cpu className="h-2.5 w-2.5" /> I'M DOING
                    </p>
                    {runtimeState.activeWork.slice(0, 3).map((work: any) => (
                      <div key={work.id} className="text-[10px] text-foreground/70 flex items-start gap-1">
                        <ArrowRight className="h-2.5 w-2.5 text-emerald-400 mt-0.5" />
                        <span className="truncate">{work.title} <span className="text-muted-foreground">— {work.agentAction}</span></span>
                      </div>
                    ))}
                    {runtimeState.activeWork.length > 3 && (
                      <p className="text-[9px] text-muted-foreground">+{runtimeState.activeWork.length - 3} more</p>
                    )}
                  </div>
                )}

                {/* I NEED FROM YOU — delegation queue (Executor: human tasks) */}
                {runtimeState.tasksWaitingOnHuman > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] text-amber-400 mb-1 flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" /> I NEED FROM YOU
                    </p>
                    {runtimeState.humanQueue?.slice(0, 2).map((task: any) => (
                      <div key={task.id} className="text-[10px] text-foreground/70 flex items-start gap-1">
                        <ArrowRight className="h-2.5 w-2.5 text-amber-400 mt-0.5" />
                        <span>{task.title}</span>
                      </div>
                    ))}
                    {runtimeState.humanQueue?.length > 2 && (
                      <p className="text-[9px] text-muted-foreground">+{runtimeState.humanQueue.length - 2} more</p>
                    )}
                  </div>
                )}

                {/* I DISCOVERED — recent learnings */}
                {runtimeState.recentLearnings?.length > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] text-pink-400 mb-1 flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" /> I DISCOVERED
                    </p>
                    {runtimeState.recentLearnings.slice(0, 2).map((l: string, i: number) => (
                      <div key={i} className="text-[10px] text-foreground/60 flex items-start gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5 text-pink-400 mt-0.5" />
                        <span className="truncate">{l}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Director: what's neglected */}
                {directorAssessment?.whatIsNeglected?.length > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] text-red-400 mb-1 flex items-center gap-1">
                      <AlertCircle className="h-2.5 w-2.5" /> NEGLECTED
                    </p>
                    {directorAssessment.whatIsNeglected.slice(0, 2).map((item: string, i: number) => (
                      <div key={i} className="text-[10px] text-foreground/60 flex items-start gap-1">
                        <ArrowRight className="h-2.5 w-2.5 text-red-400 mt-0.5" />
                        <span className="truncate">{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Safeguard violations */}
                {runtimeState.safeguardViolations?.length > 0 && (
                  <div className="pt-2 border-t border-red-500/30 bg-red-500/5 rounded-lg p-2">
                    <p className="text-[10px] text-red-400 mb-1 flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5" /> SAFEGUARD
                    </p>
                    {runtimeState.safeguardViolations.slice(0, 2).map((v: any, i: number) => (
                      <div key={i} className="text-[10px] text-foreground/60 flex items-start gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full mt-1 ${v.severity === "critical" ? "bg-red-500" : "bg-amber-500"}`} />
                        <span className="truncate">{v.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Conversation thread */}
            <div className="space-y-3 max-h-64 overflow-y-auto scrollbar-thin mb-4">
              {conversation.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-2">Speak to Foundry</p>
                  <p className="text-[10px] text-muted-foreground/60">Hold Space, tap the entity, or enable Ambient mode and say "Foundry, ..."</p>
                </div>
              ) : (
                conversation.slice(-8).map((turn, i) => (
                  <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      turn.role === "user"
                        ? "bg-accent/15 border border-accent/20 text-foreground"
                        : "bg-muted/20 border border-border text-foreground/90"
                    }`}>
                      <p className="text-[10px] text-muted-foreground mb-0.5">{turn.role === "user" ? "You" : "Foundry"}</p>
                      <p>{turn.text}</p>
                      {turn.action && turn.action !== "speak" && turn.action !== "unknown" && (
                        <p className="text-[9px] text-accent mt-1">→ {turn.action.replace(/_/g, " ")}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
              {/* Live transcript */}
              {(voice.interimTranscript || voice.transcript) && !processing && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm bg-accent/10 border border-accent/15 text-foreground/70">
                    <p className="text-[10px] text-muted-foreground mb-0.5">You (speaking...)</p>
                    <p>{voice.transcript || voice.interimTranscript}<span className="stream-cursor" /></p>
                  </div>
                </div>
              )}
            </div>

            {/* Page-aware suggestions */}
            {suggestions.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">Suggested for this page</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleTranscript(s)}
                      className="text-[11px] px-2.5 py-1 rounded-full bg-muted/20 border border-border text-muted-foreground hover:border-accent hover:text-accent transition-colors"
                    >
                      "{s}"
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {voice.error && <p className="text-xs text-destructive mb-2">{voice.error}</p>}

            {/* Help */}
            <div className="pt-3 border-t border-border text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span><kbd className="rounded border border-border px-1">Space</kbd> hold to talk</span>
                <span>·</span>
                <span>"Foundry, ..." in ambient mode</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ The Living Entity ═══ */}
      <div
        className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-2"
        onMouseEnter={() => setProximityHover(true)}
        onMouseLeave={() => setProximityHover(false)}
      >
        {/* Label tooltip */}
        {(proximityHover || entityState !== "dormant") && !expanded && (
          <div className="glass-card px-3 py-1.5 text-[11px] text-muted-foreground fade-in mb-1 whitespace-nowrap">
            {cfg.label}
          </div>
        )}

        {/* The entity itself */}
        <button
          onClick={handleClick}
          onDoubleClick={() => setExpanded(!expanded)}
          className="relative flex items-center justify-center transition-all duration-300"
          style={{ width: orbSize + 20, height: orbSize + 20 }}
          title="Observing · Click to speak · Double-click for runtime panel"
        >
          {/* Pulsing rings */}
          {cfg.ringCount > 0 && Array.from({ length: cfg.ringCount }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: orbSize,
                height: orbSize,
                border: `1.5px solid ${entityState === "listening" ? "hsl(170 80% 50% / " : entityState === "alerting" ? "hsl(0 90% 50% / " : "hsl(280 80% 50% / "}${0.5 / (i + 1)})`,
                animation: `entity-ring ${1.2 + i * 0.4}s ease-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}

          {/* Breathing aura (dormant) */}
          {entityState === "dormant" && (
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                width: orbSize + 8,
                height: orbSize + 8,
                background: cfg.color,
                opacity: 0.15,
                filter: "blur(8px)",
                animation: "entity-breathe 4s ease-in-out infinite",
              }}
            />
          )}

          {/* Waveform visualization (listening) */}
          {entityState === "listening" && (
            <div className="absolute inset-0 flex items-center justify-center gap-0.5 pointer-events-none">
              {waveform.slice(0, 12).map((v, i) => (
                <div
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 2,
                    height: Math.max(2, v * 24),
                    background: "hsl(170 80% 60%)",
                    opacity: 0.8,
                    transition: "height 0.05s",
                  }}
                />
              ))}
            </div>
          )}

          {/* Neural network particles (thinking) */}
          {entityState === "thinking" && (
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-violet-400"
                  style={{
                    width: 3,
                    height: 3,
                    top: "50%",
                    left: "50%",
                    animation: `entity-neuron-${i} 1s ease-out infinite`,
                  }}
                />
              ))}
              <style>{`
                ${Array.from({ length: 6 }).map((_, i) => {
                  const angle = (i * 60) * Math.PI / 180;
                  const dist = 25;
                  const x = Math.cos(angle) * dist;
                  const y = Math.sin(angle) * dist;
                  return `@keyframes entity-neuron-${i} {
                    0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
                    50% { transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1); opacity: 0.8; }
                    100% { transform: translate(calc(-50% + ${x * 1.5}px), calc(-50% + ${y * 1.5}px)) scale(0); opacity: 0; }
                  }`;
                }).join("\n")}
              `}</style>
            </div>
          )}

          {/* Core orb */}
          <div
            className="relative rounded-full transition-all duration-300"
            style={{
              width: orbSize,
              height: orbSize,
              background: cfg.color,
              boxShadow: cfg.glow,
              animation: entityState === "dormant"
                ? "entity-breathe 4s ease-in-out infinite"
                : entityState === "speaking"
                ? "entity-speak 0.4s ease-in-out infinite"
                : "none",
            }}
          >
            {/* Inner highlight */}
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                top: "15%", left: "20%", width: "30%", height: "30%",
                background: "radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)",
              }}
            />

            {/* State icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <cfg.icon className="h-5 w-5 text-white/80" />
            </div>
          </div>

          {/* Ambient indicator */}
          {ambientMode && entityState === "dormant" && (
            <div
              className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400"
              style={{ animation: "entity-breathe 2s ease-in-out infinite" }}
            />
          )}

          {/* Runtime badge — shows count of tasks waiting on the human */}
          {runtimeState?.tasksWaitingOnHuman > 0 && !expanded && (
            <div
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 flex items-center justify-center text-[10px] font-bold text-white shadow-lg"
              style={{ animation: "entity-breathe 1.5s ease-in-out infinite" }}
            >
              {runtimeState.tasksWaitingOnHuman}
            </div>
          )}
        </button>
      </div>

      {/* ═══ Animations ═══ */}
      <style>{`
        @keyframes entity-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
        @keyframes entity-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes entity-speak {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
    </>
  );
}
