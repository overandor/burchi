"use client";
import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { HypothesisAnatomy, PriorArtRecord, HypothesisAssignment } from "@/types";

export default function TodayPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading…</p></div>}>
      <TodayPageInner />
    </Suspense>
  );
}

function TodayPageInner() {
  const searchParams = useSearchParams();
  const employeeId = searchParams.get("employeeId") || "emp-001";
  const [assignments, setAssignments] = useState<HypothesisAssignment[]>([]);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisAnatomy>>(new Map());
  const [priorArt, setPriorArt] = useState<Map<string, PriorArtRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [llmResearch, setLlmResearch] = useState<{ summary: string; used: boolean; error?: string } | null>(null);
  const [researching, setResearching] = useState(false);
  const load = useCallback(async () => {
    try {
      const [aRes, hRes, paRes] = await Promise.all([fetch(`/api/golden/assignments?employeeId=${employeeId}&active=true`), fetch("/api/golden/hypotheses"), fetch("/api/golden/prior-art")]);
      const aData = await aRes.json(); const hData = await hRes.json(); const paData = await paRes.json();
      setAssignments(aData.assignments || []);
      setHypotheses(new Map((hData.hypotheses || []).map((h: HypothesisAnatomy) => [h.id, h])));
      setPriorArt(new Map((paData.priorArt || []).map((p: PriorArtRecord) => [p.id, p])));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  const current = assignments[0];
  const hypothesis = current ? hypotheses.get(current.hypothesisId) : undefined;
  const pa = hypothesis ? priorArt.get(hypothesis.priorArtId) : undefined;
  async function patchAssignment(action: "accept" | "reject" | "modify", extra?: Record<string, unknown>) {
    if (!current) return; setActing(true);
    try { const res = await fetch("/api/golden/assignments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, assignmentId: current.id, ...extra }) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } finally { setActing(false); }
  }
  async function runLLMResearch() {
    if (!hypothesis) return; setResearching(true); setLlmResearch(null);
    try { const res = await fetch("/api/golden/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "research", claim: hypothesis.claim }) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const data = await res.json(); setLlmResearch({ summary: data.record?.adjacentSupportSummary || "No summary returned.", used: data.llmUsed, error: data.llmError }); } catch (e) { setLlmResearch({ summary: "", used: false, error: e instanceof Error ? e.message : "Research failed" }); } finally { setResearching(false); }
  }
  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading today's hypothesis…</p></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10"><div className="card p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;
  if (!current || !hypothesis) return (<div className="mx-auto max-w-4xl px-8 py-10"><h1 className="text-3xl font-bold tracking-tight text-foreground">Today's Hypothesis</h1><div className="card mt-6 p-8 text-center"><p className="text-muted-foreground">No active hypothesis mission. Allocate one to begin.</p><button className="btn btn-primary mt-4" onClick={async () => { await fetch("/api/golden/allocate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) }); load(); }}>Allocate hypothesis</button></div></div>);
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Today's Hypothesis</h1>
      <p className="mt-2 text-muted-foreground">Trial {current.trialNumber} · {current.kind} · {current.state}</p>
      <div className="card mt-6 p-6">
        <p className="text-lg font-medium text-foreground">{hypothesis.claim}</p>
        <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground/80">Why this reached you: </span>{current.allocationReason}</p>
        {pa && (<div className="mt-4 rounded-lg border border-border bg-muted/20 p-4"><p className="done-section-label">Prior art</p><p className="mt-1 text-sm text-muted-foreground">Status: {pa.status.replace(/_/g, " ")} · Evidence: {pa.evidenceState} · Confidence: {(pa.researchConfidence * 100).toFixed(0)}%</p><p className="mt-1 text-muted-foreground">{pa.adjacentSupportSummary}</p><p className="mt-2 text-xs text-muted-foreground">Source domains: {pa.sourceDomains.join(", ")}</p></div>)}
        <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4"><div className="flex items-center justify-between"><p className="done-section-label">LLM prior-art research</p><button onClick={runLLMResearch} disabled={researching} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-all hover:border-foreground hover:text-foreground disabled:opacity-50">{researching ? "Researching…" : "Run LLM research"}</button></div>{llmResearch && (<div className="mt-2 text-sm">{llmResearch.used ? <p className="text-foreground/90">{llmResearch.summary}</p> : <p className="text-muted-foreground">LLM unavailable{llmResearch.error ? `: ${llmResearch.error}` : ""}. Deterministic prior-art used instead.</p>}</div>)}</div>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"><div><p className="done-section-label">Intervention</p><p className="mt-1 text-sm text-foreground/90">{hypothesis.intervention}</p></div><div><p className="done-section-label">Control</p><p className="mt-1 text-sm text-foreground/90">{hypothesis.control}</p></div><div><p className="done-section-label">Primary outcome</p><p className="mt-1 text-sm text-foreground/90">{hypothesis.primaryOutcome}</p></div><div><p className="done-section-label">Primary uncertainty</p><p className="mt-1 text-sm text-foreground/90">{hypothesis.primaryUncertainty}</p></div></div>
        <div className="mt-5"><p className="done-section-label">Fixed constraints</p><ul className="mt-1 space-y-1 text-sm text-muted-foreground">{hypothesis.fixedConstraints.map((c, i) => (<li key={i}>· {c}</li>))}</ul></div>
        <div className="mt-5"><p className="done-section-label">Innovation window (modifiable dimensions)</p><div className="mt-2 flex flex-wrap gap-2">{(hypothesis.modifiableDimensions || []).map((d) => (<span key={d} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">{d.replace(/_/g, " ")}</span>))}</div></div>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"><div><p className="done-section-label">Expected value</p><p className="mt-1 text-sm text-foreground/90">{hypothesis.expectedValue}</p></div><div><p className="done-section-label">Eligible accounts</p><p className="mt-1 text-sm text-foreground/90">{current.eligibleAccountIds.length} accounts · {current.evaluationPeriodDays} day window</p></div></div>
        <div className="mt-5 rounded-lg border border-status-needs/30 bg-status-needs/5 p-4"><p className="done-section-label text-status-needs">Compliance boundary</p><p className="mt-1 text-sm text-foreground/80">{hypothesis.complianceBoundary}</p></div>
        <div className="mt-6 flex gap-3"><button onClick={() => patchAssignment("accept")} disabled={acting} className="btn btn-primary disabled:opacity-50">{acting ? "…" : "Accept mission"}</button><button onClick={() => patchAssignment("reject")} disabled={acting} className="btn btn-outline disabled:opacity-50">Reject</button></div>
      </div>
    </div>
  );
}
