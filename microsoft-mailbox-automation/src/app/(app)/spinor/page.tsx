"use client";

import { useState, useEffect, useCallback } from "react";
import type { SpinorOrganism, SpinorOrganismNode, SpinorSignatureAction, SpinorMaturityStage, SpinorEvidenceBadge } from "@/types";

const EMPLOYEE_ID = "emp-001";

const STAGE_COLOR: Record<SpinorMaturityStage, string> = {
  seed: "#6b7280", sprout: "#8b5cf6", branch: "#a78bfa", grove: "#22c55e",
  golden_node: "#fbbf24", infrastructure: "#f59e0b", spinout: "#ef4444",
};

const EVIDENCE_COLOR: Record<SpinorEvidenceBadge, string> = {
  established: "#22c55e", supported: "#3b82f6", transferred: "#06b6d4",
  plausible: "#a78bfa", untested: "#6b7280", contradicted: "#ef4444", internal_signal: "#fbbf24",
};

const NODE_COLOR_HEX: Record<string, string> = {
  blue: "#3b82f6", violet: "#8b5cf6", green: "#22c55e", gold: "#fbbf24", red: "#ef4444", gray: "#6b7280",
};

const ACTION_LABEL: Record<SpinorSignatureAction, string> = {
  plant: "Plant — begin the experiment",
  observe: "Observe — record an interim measurement",
  record: "Record — log a final outcome",
  challenge: "Challenge — dispute the hypothesis or its evidence",
  replicate: "Replicate — verify or falsify another's finding",
  derive: "Derive — propose a derivative",
  integrate: "Integrate — promote into infrastructure",
  spin_out: "Spin out — propose as a separate channel/business",
};

const ROLE_LABEL: Record<string, string> = {
  core: "Today's Hypothesis", supporting_research: "Supporting Research", contradicting: "Contradicting Evidence",
  previous_attempt: "Previous Attempt", derivative: "Derivative", replication: "Replication",
  risk_signal: "Risk Signal", expected_value: "Expected Value", golden_node: "Golden Node", compost: "Compost (Falsified)",
};

export default function SpinorPage() {
  const [organism, setOrganism] = useState<SpinorOrganism | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SpinorOrganismNode | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ employeeId: string; score: number; roles: string[]; breakdown: Record<string, number> }[]>([]);
  const [profile, setProfile] = useState<{ dimensions: Record<string, number>; researchStreak: number } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [tab, setTab] = useState<"organism" | "leaderboard" | "profile">("organism");

  const load = useCallback(async () => {
    try {
      await fetch("/api/golden", { method: "POST" });
      const [orgRes, lbRes, profRes] = await Promise.all([
        fetch(`/api/golden/spinor?action=organism&employeeId=${EMPLOYEE_ID}`),
        fetch("/api/golden/spinor?action=leaderboard"),
        fetch(`/api/golden/spinor?action=profile&employeeId=${EMPLOYEE_ID}`),
      ]);
      if (orgRes.ok) { const d = await orgRes.json(); setOrganism(d.organism || null); }
      if (lbRes.ok) { const d = await lbRes.json(); setLeaderboard(d.rankings || []); }
      if (profRes.ok) { const d = await profRes.json(); setProfile(d.profile || null); setRoles(d.roles || []); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="mx-auto max-w-5xl px-8 py-10"><p className="text-muted-foreground">Building your Hypothesis Organism…</p></div>;
  if (error) return <div className="mx-auto max-w-5xl px-8 py-10"><div className="card border-status-blocked/30 p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Hypothesis Organism</h1>
        <p className="mt-2 text-muted-foreground">Your daily mission is a living experimental ecosystem.</p>
      </div>

      <div className="mb-6 flex gap-2">
        {(["organism", "leaderboard", "profile"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${tab === t ? "border-foreground bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {t === "organism" ? "Today's Organism" : t === "leaderboard" ? "Leaderboard" : "My Profile"}
          </button>
        ))}
      </div>

      {tab === "organism" && organism && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="card p-5">
              <p className="done-section-label">Today's Hypothesis</p>
              <p className="mt-2 text-sm font-medium text-foreground">{organism.claim}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: STAGE_COLOR[organism.maturity] }}>{organism.maturity.replace(/_/g, " ")}</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: EVIDENCE_COLOR[organism.evidence] + "30", color: EVIDENCE_COLOR[organism.evidence] }}>{organism.evidence.replace(/_/g, " ")}</span>
              </div>
            </div>
            <div className="card p-5">
              <p className="done-section-label">Evidence Required</p>
              <p className="mt-2 text-sm text-foreground/90">{organism.trialsCompleted} / {organism.requiredTrials} trials completed</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.min(100, (organism.trialsCompleted / organism.requiredTrials) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Falsification: {organism.falsificationCondition}</p>
            </div>
            <div className="card p-5">
              <p className="done-section-label">Evolutionary Paths</p>
              <div className="mt-2 space-y-1.5">
                {organism.actions.map((a) => (<div key={a} className="flex items-center gap-2 text-sm text-foreground/90"><span className="h-1.5 w-1.5 rounded-full bg-foreground" />{ACTION_LABEL[a]}</div>))}
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="done-section-label">Discovery Contribution Score</p>
              <span className="text-2xl font-bold text-foreground">{organism.dcs.score}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">DCS = (I × C × R × V × T) / H · {organism.dcs.provisional ? "Provisional" : "Settled"}</p>
            <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
              {organism.dcs.components.map((c) => (
                <div key={c.symbol} className="rounded-lg border border-border p-2 text-center">
                  <p className="text-xs font-bold text-foreground">{c.symbol}</p>
                  <p className="text-xs text-muted-foreground">{c.name}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{(c.value * 100).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <p className="done-section-label mb-4">Organism Canvas</p>
            <div className="relative mx-auto" style={{ width: "500px", height: "500px", maxWidth: "100%" }}>
              <svg viewBox="-250 -250 500 500" className="w-full h-full">
                {[60, 120, 180, 220].map((r) => (<circle key={r} cx="0" cy="0" r={r} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-border" opacity="0.3" />))}
                {organism.nodes.filter((n) => n.role !== "core").map((n) => {
                  const x = Math.cos(n.angle) * n.radius * 100;
                  const y = Math.sin(n.angle) * n.radius * 100;
                  return <line key={`line-${n.id}`} x1="0" y1="0" x2={x} y2={y} stroke={NODE_COLOR_HEX[n.color] || "#6b7280"} strokeWidth="1" opacity="0.2" />;
                })}
                <circle cx="0" cy="0" r="45" fill={STAGE_COLOR[organism.maturity]} opacity="0.15" />
                <circle cx="0" cy="0" r="30" fill={STAGE_COLOR[organism.maturity]} opacity="0.3" />
                <circle cx="0" cy="0" r="18" fill={STAGE_COLOR[organism.maturity]} className="cursor-pointer" onClick={() => setSelectedNode(organism.nodes.find(n => n.role === "core") || null)}>
                  <animate attributeName="r" values="18;22;18" dur="3s" repeatCount="indefinite" />
                </circle>
                <text x="0" y="4" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">CORE</text>
                {organism.nodes.filter((n) => n.role !== "core").map((n) => {
                  const x = Math.cos(n.angle) * n.radius * 100;
                  const y = Math.sin(n.angle) * n.radius * 100;
                  const color = NODE_COLOR_HEX[n.color] || "#6b7280";
                  const r = n.role === "golden_node" ? 16 : n.role === "compost" ? 10 : 12;
                  return (
                    <g key={n.id} className="cursor-pointer" onClick={() => setSelectedNode(n)}>
                      {n.pulse && (
                        <circle cx={x} cy={y} r={r + 4} fill={color} opacity="0.2">
                          <animate attributeName="r" values={`${r + 2};${r + 8};${r + 2}`} dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.2;0.05;0.2" dur="2s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle cx={x} cy={y} r={r} fill={color} opacity="0.8" stroke={color} strokeWidth="1.5" />
                      <text x={x} y={y + 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
                        {n.role === "golden_node" ? "GN" : n.role === "derivative" ? "D" : n.role === "replication" ? "R" : n.role === "previous_attempt" ? "T" : n.role === "supporting_research" ? "S" : n.role === "contradicting" ? "X" : n.role === "risk_signal" ? "!" : n.role === "expected_value" ? "$" : n.role === "compost" ? "C" : "•"}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {Object.entries(ROLE_LABEL).filter(([k]) => k !== "core").map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NODE_COLOR_HEX[
                    k === "supporting_research" ? "blue" : k === "contradicting" ? "red" : k === "previous_attempt" ? "violet" :
                    k === "derivative" ? "violet" : k === "replication" ? "green" : k === "risk_signal" ? "red" :
                    k === "expected_value" ? "gold" : k === "golden_node" ? "gold" : k === "compost" ? "gray" : "gray"
                  ] }} />
                  {v}
                </div>
              ))}
            </div>
          </div>

          {selectedNode && (
            <div className="card p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: NODE_COLOR_HEX[selectedNode.color] }}>{ROLE_LABEL[selectedNode.role]}</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ backgroundColor: EVIDENCE_COLOR[selectedNode.evidence] + "20", color: EVIDENCE_COLOR[selectedNode.evidence] }}>{selectedNode.evidence.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">{selectedNode.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{selectedNode.detail}</p>
            </div>
          )}

          <div className="card border-status-needs/30 p-4">
            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Compliance boundary: </span>{organism.complianceBoundary}</p>
          </div>
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="card p-5">
          <p className="done-section-label mb-2">Node Score Leaderboard</p>
          <p className="text-sm text-muted-foreground mb-4">Ranks the human–LLM–hypothesis combination, not raw sales.</p>
          <div className="space-y-2">
            {leaderboard.map((r, i) => (
              <div key={r.employeeId} className={`flex items-center justify-between rounded-lg border p-4 ${r.employeeId === EMPLOYEE_ID ? "border-foreground/40 bg-foreground/5" : "border-border"}`}>
                <div className="flex items-center gap-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10 text-sm font-bold text-foreground">{i + 1}</span>
                  <div>
                    <p className="font-medium text-foreground">{r.employeeId}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {r.roles.map((role) => (<span key={role} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{role}</span>))}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-foreground">{r.score.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">lift {r.breakdown.causalLift} + info {r.breakdown.informationGained} + mut {r.breakdown.mutationValue}</p>
                </div>
              </div>
            ))}
            {leaderboard.length === 0 && <p className="text-center text-muted-foreground py-8">No scores yet.</p>}
          </div>
        </div>
      )}

      {tab === "profile" && profile && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div><p className="done-section-label">Participant Profile</p><p className="mt-1 text-sm text-foreground">{EMPLOYEE_ID}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((role) => (<span key={role} className="rounded-full bg-foreground/10 px-3 py-1 text-xs font-semibold text-foreground">{role}</span>))}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Research streak: {profile.researchStreak}</p>
          </div>
          <div className="card p-5">
            <p className="done-section-label mb-3">Contribution Dimensions</p>
            <div className="space-y-3">
              {Object.entries(profile.dimensions).map(([key, value]) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="font-medium text-foreground">{(value * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${value * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "organism" && !organism && (
        <div className="card p-8 text-center"><p className="text-muted-foreground">No active hypothesis. Allocate one from Today's Research.</p></div>
      )}
    </div>
  );
}
