"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  SpinorOrganism,
  SpinorOrganismNode,
  SpinorSignatureAction,
  SpinorMaturityStage,
  SpinorEvidenceBadge,
} from "@/types";
import {
  STAGE_LABEL,
  STAGE_GLYPH,
  EVIDENCE_LABEL,
  ACTION_LABEL,
} from "@/lib/spinor/scoring";

const COLOR_HEX: Record<SpinorOrganismNode["color"], string> = {
  blue: "#38bdf8", violet: "#a78bfa", green: "#34d399", gold: "#fbbf24", red: "#f87171", gray: "#94a3b8",
};

const STAGE_COLOR: Record<SpinorMaturityStage, string> = {
  seed: "#94a3b8", sprout: "#34d399", branch: "#a78bfa", grove: "#38bdf8", golden_node: "#fbbf24", infrastructure: "#f59e0b", spinout: "#fb923c",
};

export default function FoundryPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading organism…</p></div>}>
      <FoundryPageInner />
    </Suspense>
  );
}

function FoundryPageInner() {
  const searchParams = useSearchParams();
  const employeeId = searchParams?.get("employeeId") || "emp-001";
  const [organism, setOrganism] = useState<SpinorOrganism | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<SpinorSignatureAction | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SpinorOrganismNode | null>(null);
  const [priorArt, setPriorArt] = useState<{ id: string; hypothesisClaim: string; status: string; evidenceState: string; adjacentSupportSummary: string; sourceDomains: string[]; researchConfidence: number } | null>(null);
  const [derivatives, setDerivatives] = useState<{ id: string; claim: string; modifiedDimension: string; rationale: string; status: string; origin: string }[]>([]);

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

  const nodes = organism?.nodes || [];
  const centerX = 300, centerY = 280, radius = 160;

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading organism…</p></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10"><div className="card p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;
  if (!organism) return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Hypothesis Foundry</h1>
      <div className="card mt-6 p-8 text-center">
        <p className="text-muted-foreground">No active hypothesis organism. Allocate a Daily Seed to grow one.</p>
        <button className="btn btn-primary mt-4" onClick={async () => { await fetch("/api/golden/allocate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) }); load(); }}>Plant Daily Seed</button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Hypothesis Foundry</h1>
          <p className="mt-1 text-sm text-muted-foreground">Living organism · {STAGE_LABEL[organism.maturity]} stage · {EVIDENCE_LABEL[organism.evidence]} evidence</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">DCS</span>
          <span className="text-lg font-bold" style={{ color: organism.dcs.score >= 50 ? "#34d399" : organism.dcs.score >= 20 ? "#fbbf24" : "#94a3b8" }}>{organism.dcs.score}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Organism Canvas */}
        <div className="lg:col-span-2 card p-4">
          <svg viewBox="0 0 600 560" className="w-full">
            {/* Core */}
            <circle cx={centerX} cy={centerY} r="28" fill={STAGE_COLOR[organism.maturity]} opacity="0.15" />
            <circle cx={centerX} cy={centerY} r="18" fill={STAGE_COLOR[organism.maturity]} opacity="0.4" />
            <circle cx={centerX} cy={centerY} r="10" fill={STAGE_COLOR[organism.maturity]} className="animate-glow-pulse" />
            <text x={centerX} y={centerY + 50} textAnchor="middle" className="fill-foreground text-[10px] font-bold">{STAGE_GLYPH[organism.maturity]} {STAGE_LABEL[organism.maturity]}</text>

            {/* Nodes */}
            {nodes.map((node, i) => {
              const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
              const x = centerX + Math.cos(angle) * radius;
              const y = centerY + Math.sin(angle) * radius;
              const color = COLOR_HEX[node.color] || "#94a3b8";
              return (
                <g key={node.id} className="cursor-pointer" onClick={() => setSelectedNode(node)}>
                  <line x1={centerX} y1={centerY} x2={x} y2={y} stroke={color} strokeWidth="1.5" opacity="0.3" />
                  <circle cx={x} cy={y} r="14" fill={color} opacity="0.15" />
                  <circle cx={x} cy={y} r="8" fill={color} opacity={selectedNode?.id === node.id ? 1 : 0.6} />
                  <text x={x} y={y - 20} textAnchor="middle" className="fill-foreground text-[9px] font-medium">{node.label}</text>
                </g>
              );
            })}
          </svg>

          {selectedNode && (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
              <p className="font-medium text-foreground">{selectedNode.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{selectedNode.detail}</p>
              <p className="mt-2 text-xs" style={{ color: COLOR_HEX[selectedNode.color] }}>{selectedNode.role.replace(/_/g, " ")}</p>
            </div>
          )}
        </div>

        {/* Side panels */}
        <div className="space-y-4">
          {/* Claim */}
          <div className="card p-4">
            <p className="done-section-label">Hypothesis claim</p>
            <p className="mt-1 text-sm text-foreground/90">{organism.claim}</p>
            <p className="mt-2 text-xs text-muted-foreground">{organism.allocationReason}</p>
          </div>

          {/* DCS breakdown */}
          <div className="card p-4">
            <p className="done-section-label">Discovery Contribution Score</p>
            <div className="mt-2 space-y-1">
              {organism.dcs.components.map((c) => (
                <div key={c.symbol} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground"><span className="font-mono font-bold text-foreground/80">{c.symbol}</span> {c.name}</span>
                  <span className={c.value > 0 ? "text-emerald-400" : c.value < 0 ? "text-red-400" : "text-muted-foreground"}>{c.value > 0 ? "+" : ""}{c.value}</span>
                </div>
              ))}
              <div className="mt-2 border-t border-border pt-2 flex items-center justify-between">
                <span className="text-sm font-bold">Total</span>
                <span className="text-lg font-bold" style={{ color: organism.dcs.score >= 50 ? "#34d399" : organism.dcs.score >= 20 ? "#fbbf24" : "#94a3b8" }}>{organism.dcs.score}</span>
              </div>
            </div>
          </div>

          {/* Signature actions */}
          <div className="card p-4">
            <p className="done-section-label">Signature actions</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {organism.actions.map((action) => (
                <button
                  key={action}
                  onClick={() => handleAction(action)}
                  disabled={acting !== null}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/80 transition-all hover:border-foreground hover:bg-foreground/5 disabled:opacity-50"
                >
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
            {flash && <p className="mt-2 text-xs text-muted-foreground">{flash}</p>}
          </div>
        </div>
      </div>

      {/* Prior art + derivatives */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-4">
          <p className="done-section-label">Prior art</p>
          {priorArt ? (
            <div className="mt-2">
              <p className="text-sm text-foreground/90">Status: {priorArt.status.replace(/_/g, " ")} · Evidence: {priorArt.evidenceState}</p>
              <p className="mt-1 text-sm text-muted-foreground">{priorArt.adjacentSupportSummary}</p>
              <p className="mt-2 text-xs text-muted-foreground">Domains: {priorArt.sourceDomains.join(", ")} · Confidence: {(priorArt.researchConfidence * 100).toFixed(0)}%</p>
            </div>
          ) : <p className="mt-2 text-sm text-muted-foreground">No prior-art record linked.</p>}
        </div>
        <div className="card p-4">
          <p className="done-section-label">Derivatives</p>
          {derivatives.length > 0 ? (
            <div className="mt-2 space-y-2">
              {derivatives.slice(0, 5).map((d) => (
                <div key={d.id} className="rounded-lg border border-border bg-muted/10 p-3">
                  <p className="text-sm text-foreground/90">{d.claim}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{d.modifiedDimension.replace(/_/g, " ")} · {d.status} · {d.origin}</p>
                </div>
              ))}
            </div>
          ) : <p className="mt-2 text-sm text-muted-foreground">No derivatives yet. Run an experiment to generate branches.</p>}
        </div>
      </div>
    </div>
  );
}
