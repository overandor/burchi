"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  SpinorOrganism,
  SpinorOrganismNode,
  SpinorSignatureAction,
  SpinorMaturityStage,
} from "@/types";
import {
  STAGE_LABEL,
  STAGE_GLYPH,
  EVIDENCE_LABEL,
  ACTION_LABEL,
} from "@/lib/spinor/scoring";
import { RadarChart } from "@/components/RadarChart";
import { useStreamingText } from "@/components/useAnimations";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";

const COLOR_HEX: Record<SpinorOrganismNode["color"], string> = {
  blue: "#38bdf8", violet: "#a78bfa", green: "#34d399", gold: "#fbbf24", red: "#f87171", gray: "#94a3b8",
};

const STAGE_COLOR: Record<SpinorMaturityStage, string> = {
  seed: "#94a3b8", sprout: "#34d399", branch: "#a78bfa", grove: "#38bdf8", golden_node: "#fbbf24", infrastructure: "#f59e0b", spinout: "#fb923c",
};

export default function FoundryPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-8"><div className="skeleton h-10 w-72 rounded-lg" /><div className="bento-grid mt-6"><div className="bento-item bento-span-2"><div className="skeleton h-80 w-full rounded-xl" /></div><div className="bento-item bento-span-2"><div className="skeleton h-80 w-full rounded-xl" /></div></div></div>}>
      <FoundryPageInner />
    </Suspense>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * DCS progress ring — animated SVG circular gauge (0..100).
 * ─────────────────────────────────────────────────────────────────────────── */
function DcsProgressRing({ score, color = "#fbbf24" }: { score: number; color?: string }) {
  const size = 120;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circumference);
  const clamped = Math.max(0, Math.min(100, score));

  useEffect(() => {
    // Animate from empty to filled.
    const t = setTimeout(() => {
      setOffset(circumference - (clamped / 100) * circumference);
    }, 150);
    return () => clearTimeout(t);
  }, [clamped, circumference]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted) / 0.4)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 1.6s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 6px ${color}aa)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-foreground leading-none">{clamped}</span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">DCS</span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * OrganismCanvas — interactive particle network on an HTML canvas.
 * Particles flow along edges between the core and each node. The core
 * pulses, nodes glow, and hovering a node shows a floating tooltip.
 * ─────────────────────────────────────────────────────────────────────────── */
interface Particle {
  nodeIndex: number;
  /** 0 = at core, 1 = at node. */
  progress: number;
  /** +1 outbound (core -> node), -1 inbound (node -> core). */
  direction: 1 | -1;
  speed: number;
  size: number;
}

interface NodePos {
  x: number;
  y: number;
  node: SpinorOrganismNode;
  color: string;
}

function OrganismCanvas({
  nodes,
  maturityColor,
  maturityLabel,
  selectedNode,
  onSelectNode,
}: {
  nodes: SpinorOrganismNode[];
  maturityColor: string;
  maturityLabel: string;
  selectedNode: SpinorOrganismNode | null;
  onSelectNode: (n: SpinorOrganismNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<NodePos[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const hoverRef = useRef<number | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Seed particles: a few per node, staggered.
  useEffect(() => {
    const parts: Particle[] = [];
    nodes.forEach((_, i) => {
      const count = 3;
      for (let k = 0; k < count; k++) {
        parts.push({
          nodeIndex: i,
          progress: k / count,
          direction: Math.random() > 0.5 ? 1 : -1,
          speed: 0.0025 + Math.random() * 0.0025,
          size: 1.5 + Math.random() * 1.5,
        });
      }
    });
    particlesRef.current = parts;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas || !wrap) return;
      const w = wrap.clientWidth;
      const h = Math.max(420, Math.min(560, w * 0.62));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      computePositions(w, h);
    }

    function computePositions(w: number, h: number) {
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.32;
      const pos: NodePos[] = nodes.map((node, i) => {
        const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          node,
          color: COLOR_HEX[node.color] || "#94a3b8",
        };
      });
      positionsRef.current = pos;
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function draw(now: number) {
      if (!canvas) return;
      if (startRef.current === 0) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;

      ctx!.clearRect(0, 0, w, h);

      const positions = positionsRef.current;

      // Edges with subtle gradient + flowing particles.
      positions.forEach((p) => {
        const grad = ctx!.createLinearGradient(cx, cy, p.x, p.y);
        grad.addColorStop(0, `${maturityColor}55`);
        grad.addColorStop(1, `${p.color}33`);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(p.x, p.y);
        ctx!.stroke();
      });

      // Particles traveling along edges.
      const particles = particlesRef.current;
      particles.forEach((part) => {
        part.progress += part.speed * part.direction;
        if (part.progress >= 1) {
          part.progress = 1;
          part.direction = -1;
        } else if (part.progress <= 0) {
          part.progress = 0;
          part.direction = 1;
        }
        const p = positions[part.nodeIndex];
        if (!p) return;
        const px = cx + (p.x - cx) * part.progress;
        const py = cy + (p.y - cy) * part.progress;
        const color = part.direction === 1 ? p.color : maturityColor;
        // Glow halo.
        ctx!.beginPath();
        ctx!.arc(px, py, part.size + 2, 0, Math.PI * 2);
        ctx!.fillStyle = `${color}22`;
        ctx!.fill();
        // Core dot.
        ctx!.beginPath();
        ctx!.arc(px, py, part.size, 0, Math.PI * 2);
        ctx!.fillStyle = color;
        ctx!.shadowBlur = 8;
        ctx!.shadowColor = color;
        ctx!.fill();
        ctx!.shadowBlur = 0;
      });

      // Pulsing core.
      const pulse = 1 + Math.sin(elapsed * 2) * 0.12;
      const coreR = 12 * pulse;
      // Outer halo.
      const halo = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 60);
      halo.addColorStop(0, `${maturityColor}44`);
      halo.addColorStop(1, `${maturityColor}00`);
      ctx!.fillStyle = halo;
      ctx!.beginPath();
      ctx!.arc(cx, cy, 60, 0, Math.PI * 2);
      ctx!.fill();
      // Core rings.
      ctx!.fillStyle = `${maturityColor}33`;
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreR + 10, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = `${maturityColor}66`;
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreR + 4, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = maturityColor;
      ctx!.shadowBlur = 16;
      ctx!.shadowColor = maturityColor;
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.shadowBlur = 0;

      // Nodes.
      positions.forEach((p, i) => {
        const isHover = hoverRef.current === i;
        const isSelected = selectedNode?.id === p.node.id;
        const nodePulse = p.node.pulse ? 1 + Math.sin(elapsed * 4 + i) * 0.18 : 1;
        const baseR = 9 * nodePulse;
        // Glow.
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, baseR + (isHover || isSelected ? 14 : 9), 0, Math.PI * 2);
        ctx!.fillStyle = `${p.color}22`;
        ctx!.fill();
        // Mid.
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, baseR + 4, 0, Math.PI * 2);
        ctx!.fillStyle = `${p.color}55`;
        ctx!.fill();
        // Core.
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, baseR, 0, Math.PI * 2);
        ctx!.fillStyle = p.color;
        ctx!.shadowBlur = isHover || isSelected ? 14 : 6;
        ctx!.shadowColor = p.color;
        ctx!.fill();
        ctx!.shadowBlur = 0;
        // Ring on hover/select.
        if (isHover || isSelected) {
          ctx!.strokeStyle = p.color;
          ctx!.lineWidth = 1.5;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, baseR + 8, 0, Math.PI * 2);
          ctx!.stroke();
        }
        // Label.
        ctx!.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx!.fillStyle = "hsl(var(--foreground))";
        ctx!.textAlign = "center";
        ctx!.fillText(p.node.label, p.x, p.y - baseR - 10);
      });

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    function onMove(e: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseRef.current = { x: mx, y: my };
      let found: number | null = null;
      positionsRef.current.forEach((p, i) => {
        const dx = p.x - mx;
        const dy = p.y - my;
        if (Math.sqrt(dx * dx + dy * dy) < 18) found = i;
      });
      if (found !== hoverRef.current) {
        hoverRef.current = found;
        setHoverIndex(found);
      }
      if (found !== null) {
        setMousePos({ x: mx, y: my });
      }
    }

    function onLeave() {
      hoverRef.current = null;
      setHoverIndex(null);
      setMousePos(null);
    }

    function onClick() {
      const idx = hoverRef.current;
      if (idx === null) return;
      const p = positionsRef.current[idx];
      if (p) onSelectNode(p.node);
    }

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [nodes, maturityColor, selectedNode, onSelectNode]);

  const hovered = hoverIndex !== null ? positionsRef.current[hoverIndex]?.node : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas ref={canvasRef} className="block w-full cursor-pointer" />
      {/* Floating tooltip */}
      {hovered && mousePos && (
        <div
          className="pointer-events-none absolute z-20 w-60 rounded-xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur animate-fade-in-up"
          style={{
            left: Math.min(mousePos.x + 14, (wrapRef.current?.clientWidth || 999) - 250),
            top: Math.max(mousePos.y - 80, 8),
          }}
        >
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_HEX[hovered.color] }} />
            <p className="text-sm font-semibold text-foreground">{hovered.label}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{hovered.detail}</p>
          <p className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: COLOR_HEX[hovered.color] }}>
            {hovered.role.replace(/_/g, " ")}
          </p>
        </div>
      )}
      {/* Core label badge */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 translate-y-7">
        <span className="badge border-primary/30 bg-primary/10 text-primary text-[10px]">{maturityLabel}</span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Page
 * ─────────────────────────────────────────────────────────────────────────── */
function FoundryPageInner() {
  const searchParams = useSearchParams();
  const employeeId = searchParams?.get("employeeId") || "gilead-rep-001";
  const [organism, setOrganism] = useState<SpinorOrganism | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<SpinorSignatureAction | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SpinorOrganismNode | null>(null);
  const [priorArt, setPriorArt] = useState<any>(null);
  const [derivatives, setDerivatives] = useState<any[]>([]);
  const [llmAssess, setLlmAssess] = useState<any>(null);
  const [assessing, setAssessing] = useState(false);
  const [llmDerivatives, setLlmDerivatives] = useState<any[] | null>(null);
  const [deriving, setDeriving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, paRes, derRes] = await Promise.all([
        fetch(`/api/spinor/organism?employeeId=${employeeId}`, { cache: "no-store" }),
        fetch("/api/golden/prior-art", { cache: "no-store" }),
        fetch("/api/golden/derivatives", { cache: "no-store" }),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOrganism(data.organism);
      if (data.organism) {
        const paData = await paRes.json();
        const all = paData.priorArt || [];
        const match = all.find((p: any) => p.hypothesisClaim?.includes(data.organism.claim?.slice(0, 30) || "___"));
        setPriorArt(match || null);
      }
      const derData = await derRes.json();
      setDerivatives(derData.derivatives || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load organism");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action: SpinorSignatureAction) {
    if (!organism) return;
    setActing(action);
    setFlash(null);
    try {
      const res = await fetch("/api/golden/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "modify", assignmentId: organism.assignmentId, signatureAction: action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlash(`${ACTION_LABEL[action]} recorded. The organism will update as evidence arrives.`);
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  async function runLLMAssess() {
    if (!organism) return;
    setAssessing(true);
    setLlmAssess(null);
    try {
      const res = await fetch("/api/golden/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assess", hypothesisId: organism.hypothesisId, replicationCount: 0 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmAssess(data);
    } catch (e) {
      setLlmAssess({ llmUsed: false, llmError: e instanceof Error ? e.message : "Assessment failed" });
    } finally {
      setAssessing(false);
    }
  }

  async function runLLMDerivatives() {
    if (!organism) return;
    setDeriving(true);
    setLlmDerivatives(null);
    try {
      const res = await fetch("/api/golden/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "derivatives", hypothesisId: organism.hypothesisId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmDerivatives(data.derivatives || []);
    } catch (e) {
      setLlmDerivatives([]);
    } finally {
      setDeriving(false);
    }
  }

  useVoiceCommand({
    run_assess: () => runLLMAssess(),
    run_derivatives: () => runLLMDerivatives(),
  });

  useVoicePage({
    pageId: "foundry",
    title: "Hypothesis Foundry",
    summary: organism
      ? `Foundry organism loaded with ${organism.nodes?.length || 0} nodes. DCS signature: ${organism.dcs?.components?.map((c: any) => `${c.symbol}=${c.value?.toFixed(2)}`).join(", ") || "computing"}.`
      : "Foundry is loading the organism.",
    actions: [
      {
        name: "run_assess",
        label: "assess for golden node",
        available: !!organism && !assessing,
        handler: async () => {
          await runLLMAssess();
          const score = llmAssess?.goldenNodeScore || llmAssess?.score;
          return { success: true, speech: score ? `Assessment complete. Golden Node score: ${score}.` : "Assessment complete. Review the reasoning below." };
        },
      },
      {
        name: "run_derivatives",
        label: "generate derivatives",
        available: !!organism && !deriving,
        handler: async () => {
          await runLLMDerivatives();
          const count = llmDerivatives?.length || 0;
          return { success: true, speech: `Generated ${count} derivative hypothes${count !== 1 ? "es" : "is"}.` };
        },
      },
    ],
  });

  const nodes = organism?.nodes || [];

  // Streaming text for the LLM assessment reasoning.
  const llmReasoningText = useMemo(() => {
    if (!llmAssess?.llmUsed) return "";
    return llmAssess.llmReasoning || "";
  }, [llmAssess]);
  const { displayed: streamedReasoning, done: streamingDone } = useStreamingText(llmReasoningText, 12);

  const radarData = useMemo(() => {
    if (!organism) return [];
    // DCS component values are normalized 0..1; scale to a 0..20 axis so the
    // radar polygon is legible (per spec: max: 20).
    return organism.dcs.components.map((c) => ({
      label: c.symbol,
      value: c.value > 0 ? c.value * 20 : 0,
      max: 20,
    }));
  }, [organism]);

  if (loading) return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in-up">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="skeleton h-10 w-72 rounded-lg" />
          <div className="mt-3 flex gap-2">
            <div className="skeleton h-6 w-28 rounded-full" />
            <div className="skeleton h-6 w-32 rounded-full" />
          </div>
        </div>
        <div className="skeleton h-10 w-32 rounded-lg" />
      </div>
      <div className="bento-grid mt-6">
        <div className="bento-item bento-span-2">
          <div className="skeleton h-5 w-32 mb-4 rounded" />
          <div className="skeleton h-80 w-full rounded-xl" />
        </div>
        <div className="bento-item bento-span-2">
          <div className="skeleton h-5 w-32 mb-4 rounded" />
          <div className="skeleton h-80 w-full rounded-xl" />
        </div>
      </div>
      <div className="bento-grid mt-4">
        <div className="bento-item bento-span-4">
          <div className="skeleton h-5 w-40 mb-4 rounded" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        </div>
      </div>
    </div>
  );
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10 page-enter"><div className="glass-card p-6 border-destructive/20"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div><p className="text-sm text-destructive">{error}</p></div><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  if (!organism) return (
    <div className="mx-auto max-w-4xl px-8 py-20 page-enter">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Hypothesis Foundry</h1>
      <div className="glass-card mt-8 p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center organic-border bg-gradient-to-br from-primary/20 to-accent/20 animate-glow-pulse" />
        <p className="text-lg font-medium text-muted-foreground">No active hypothesis organism.</p>
        <p className="mt-2 text-sm text-muted-foreground">Plant a Daily Seed to grow one.</p>
        <button className="btn btn-primary mt-6" onClick={async () => { await fetch("/api/golden/allocate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) }); load(); }}>Plant Daily Seed</button>
      </div>
    </div>
  );

  const stageColor = STAGE_COLOR[organism.maturity];
  const maturityLabel = `${STAGE_GLYPH[organism.maturity]} ${STAGE_LABEL[organism.maturity]}`;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Hypothesis Foundry</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="badge border-primary/30 bg-primary/10 text-primary mr-2">{STAGE_GLYPH[organism.maturity]} {STAGE_LABEL[organism.maturity]}</span>
            <span className="badge border-spinor-blue/30 bg-spinor-blue/10 mr-2" style={{ color: "hsl(var(--spinor-blue))" }}>{EVIDENCE_LABEL[organism.evidence]} evidence</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="stat-card flex items-center gap-3 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">DCS</span>
            <span className="text-2xl font-bold text-foreground">{organism.dcs.score}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Organism Canvas — interactive particle network */}
        <div className="lg:col-span-2 glass-card glow-border p-4 relative overflow-hidden">
          <div className="spinor-aurora" />
          <div className="relative z-10">
            <OrganismCanvas
              nodes={nodes}
              maturityColor={stageColor}
              maturityLabel={maturityLabel}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
            />
          </div>

          {/* Selected node detail */}
          {selectedNode && (
            <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 animate-fade-in-up relative z-10">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ background: COLOR_HEX[selectedNode.color] }} />
                <p className="font-medium text-foreground">{selectedNode.label}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{selectedNode.detail}</p>
              <p className="mt-2 text-xs" style={{ color: COLOR_HEX[selectedNode.color] }}>{selectedNode.role.replace(/_/g, " ")}</p>
            </div>
          )}
        </div>

        {/* Side panels — bento grid */}
        <div className="bento-grid">
          {/* Claim — spans full width of the 4-col bento on this side column */}
          <div className="bento-item bento-span-4">
            <p className="done-section-label">Hypothesis claim</p>
            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{organism.claim}</p>
            <p className="mt-2 text-xs text-muted-foreground">{organism.allocationReason}</p>
          </div>

          {/* DCS progress ring */}
          <div className="bento-item bento-span-2 flex flex-col items-center justify-center">
            <p className="done-section-label self-start">DCS score</p>
            <div className="mt-1">
              <DcsProgressRing score={organism.dcs.score} color={stageColor} />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {organism.dcs.provisional ? "Provisional · awaiting replication" : "Settled"}
            </p>
          </div>

          {/* DCS radar chart */}
          <div className="bento-item bento-span-2 flex flex-col items-center">
            <p className="done-section-label self-start">DCS breakdown</p>
            <div className="mt-1 flex justify-center">
              <RadarChart data={radarData} size={200} color={stageColor} />
            </div>
          </div>

          {/* Signature actions */}
          <div className="bento-item bento-span-4">
            <p className="done-section-label">Signature actions</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {organism.actions.map((action: any) => (
                <button
                  key={action}
                  onClick={() => handleAction(action)}
                  disabled={acting !== null}
                  className="rounded-xl border border-border px-3 py-2.5 text-xs font-medium text-foreground/80 transition-all hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                >
                  {ACTION_LABEL[action as keyof typeof ACTION_LABEL]}
                </button>
              ))}
            </div>
            {flash && <p className="mt-3 text-xs text-muted-foreground animate-fade-in">{flash}</p>}
          </div>

          {/* LLM Golden Node assessment */}
          <div className="bento-item bento-span-4">
            <div className="flex items-center justify-between">
              <p className="done-section-label flex items-center gap-2">LLM Golden Node Assessment</p>
              <button onClick={runLLMAssess} disabled={assessing} className="btn btn-ghost text-xs">
                {assessing ? <><div className="llm-thinking-dots"><span /><span /><span /></div></> : "Assess"}
              </button>
            </div>
            {llmAssess && (
              <div className="mt-3 text-sm space-y-2">
                {llmAssess.llmUsed ? (
                  <>
                    {llmAssess.recommendedStage && (
                      <p className="text-foreground/90">Recommended stage: <span className="font-bold text-foreground">{llmAssess.recommendedStage}</span></p>
                    )}
                    {llmAssess.llmReasoning && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {streamedReasoning}
                        {!streamingDone && <span className="inline-block w-2 h-3 ml-0.5 align-middle animate-pulse bg-primary/60" />}
                      </p>
                    )}
                    {llmAssess.criteria && (
                      <div className="grid grid-cols-2 gap-1.5 mt-2">
                        {Object.entries(llmAssess.criteria).slice(0, 6).map(([k, v]: any) => (
                          <div key={k} className="rounded-lg bg-muted/20 p-2">
                            <p className="text-[10px] text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                            <p className="text-xs font-bold">{typeof v === "boolean" ? (v ? "✓" : "✗") : String(v).slice(0, 20)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">LLM unavailable{llmAssess.llmError ? `: ${llmAssess.llmError}` : ""}.</p>
                )}
              </div>
            )}
            {assessing && (
              <div className="mt-3">
                <span className="llm-badge">Synthesizing assessment…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Prior art + derivatives */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-card p-5">
          <p className="done-section-label">Prior art</p>
          {priorArt ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="badge border-spinor-blue/30 bg-spinor-blue/10" style={{ color: "hsl(var(--spinor-blue))" }}>{priorArt.status.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">{priorArt.evidenceState} · {(priorArt.researchConfidence * 100).toFixed(0)}% confidence</span>
              </div>
              <p className="mt-2 text-sm text-foreground/80">{priorArt.adjacentSupportSummary}</p>
              <p className="mt-2 text-xs text-muted-foreground">Domains: {priorArt.sourceDomains.join(", ")}</p>
            </div>
          ) : <p className="mt-3 text-sm text-muted-foreground">No prior-art record linked.</p>}
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <p className="done-section-label">Derivatives</p>
            <button onClick={runLLMDerivatives} disabled={deriving} className="btn btn-ghost text-xs">
              {deriving ? <><div className="llm-thinking-dots"><span /><span /><span /></div></> : "Generate with LLM"}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {derivatives.length > 0 && derivatives.slice(0, 3).map((d) => (
              <div key={d.id} className="rounded-lg border border-border bg-muted/10 p-3">
                <p className="text-sm text-foreground/90">{d.claim}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.modifiedDimension?.replace(/_/g, " ")} · {d.status} · {d.origin}</p>
              </div>
            ))}
            {llmDerivatives && llmDerivatives.map((d, i) => (
              <div key={`llm-${i}`} className="rounded-lg border border-spinor-green/20 bg-spinor-green/5 p-3">
                <p className="text-sm text-foreground/90">{d.claim}</p>
                <p className="mt-1 text-xs text-muted-foreground">LLM · {d.modifiedDimension?.replace(/_/g, " ")} · {d.rationale?.slice(0, 80)}</p>
              </div>
            ))}
            {derivatives.length === 0 && (!llmDerivatives || llmDerivatives.length === 0) && (
              <p className="text-sm text-muted-foreground">No derivatives yet. Run an experiment or generate with LLM.</p>
            )}
          </div>
        </div>
      </div>

      <div className="section-divider mt-8" />
    </div>
  );
}
