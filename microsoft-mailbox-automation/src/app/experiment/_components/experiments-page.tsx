"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { HypothesisAnatomy, HypothesisAssignment, SuccessKind } from "@/types";
import { useVoiceCommand } from "@/components/useVoiceCommand";
import { useVoicePage } from "@/components/VoiceContext";

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-8 py-20 text-center"><p className="text-muted-foreground animate-pulse">Loading experiments…</p></div>}>
      <ExperimentsPageInner />
    </Suspense>
  );
}

function ExperimentsPageInner() {
  const searchParams = useSearchParams();
  const employeeId = searchParams?.get("employeeId") || "gilead-rep-001";
  const [assignments, setAssignments] = useState<HypothesisAssignment[]>([]);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisAnatomy>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    successKind: "performance" as SuccessKind,
    outcomeDescription: "",
    falsified: false,
    falsificationEvidence: "",
    metricName: "",
    metricValue: 0,
    metricBaseline: 0,
    metricUnit: "",
    higherIsBetter: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [useLLM, setUseLLM] = useState(true);
  const [llmProtocol, setLlmProtocol] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      let aRes = await fetch(`/api/golden/assignments?employeeId=${employeeId}`);
      let aData = await aRes.json();
      // Fallback: if no assignments for this employee, load all
      if (!aData.assignments || aData.assignments.length === 0) {
        aRes = await fetch("/api/golden/assignments");
        aData = await aRes.json();
      }
      const hRes = await fetch("/api/golden/hypotheses");
      const hData = await hRes.json();
      setAssignments(aData.assignments || []);
      setHypotheses(new Map((hData.hypotheses || []).map((h: HypothesisAnatomy) => [h.id, h])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function submitOutcome(assignmentId: string) {
    if (!form.outcomeDescription.trim()) {
      setError("Please describe the outcome before recording.");
      return;
    }
    setSubmitting(true);
    setLastResult(null);
    setError(null);
    try {
      const metrics = form.metricName
        ? [{ metric: form.metricName, value: Number(form.metricValue), unit: form.metricUnit, baseline: Number(form.metricBaseline), higherIsBetter: form.higherIsBetter }]
        : [];
      const res = await fetch("/api/golden/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId, successKind: form.successKind, outcomeDescription: form.outcomeDescription.trim(),
          metrics, falsified: form.falsified, falsificationEvidence: form.falsificationEvidence || undefined, useLLM,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.formErrors?.join("; ") || errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLastResult(data);
      setRecordingFor(null);
      setForm({ successKind: "performance", outcomeDescription: "", falsified: false, falsificationEvidence: "", metricName: "", metricValue: 0, metricBaseline: 0, metricUnit: "", higherIsBetter: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function generateProtocol(assignmentId: string) {
    const a = assignments.find(x => x.id === assignmentId);
    const h = a ? hypotheses.get(a.hypothesisId) : null;
    if (!h) return;
    setGenerating(true);
    setLlmProtocol(null);
    try {
      const res = await fetch("/api/llm/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are an experimental design engine for pharma field execution. Given a hypothesis, generate a concise experiment protocol including: eligible population, comparison group, primary outcome, secondary outcomes, stopping conditions, observation window, and compliance limits. Format as clear sections." },
            { role: "user", content: `Hypothesis: "${h.claim}"\nIntervention: ${h.intervention}\nControl: ${h.control}\nPrimary outcome: ${h.primaryOutcome}\nCompliance boundary: ${h.complianceBoundary}\nEligible accounts: ${a?.eligibleAccountIds.length || 0}\nEvaluation window: ${a?.evaluationPeriodDays || 14} days` },
          ],
          temperature: 0.3,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLlmProtocol(data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || "No protocol generated.");
    } catch (e) {
      setLlmProtocol("Protocol generation unavailable.");
    } finally {
      setGenerating(false);
    }
  }

  useVoiceCommand({
    record_outcome: () => { const act = assignments.filter((a) => !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state)); if (act.length > 0) setRecordingFor(act[0].id); },
    generate_protocol: () => { const act = assignments.filter((a) => !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state)); if (act.length > 0) generateProtocol(act[0].id); },
  });

  const activeAssignments = assignments.filter((a) => !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state));

  useVoicePage({
    pageId: "experiment",
    title: "Experiment",
    summary: `You have ${activeAssignments.length} active experiment${activeAssignments.length !== 1 ? "s" : ""}${activeAssignments.length > 0 ? `. First: ${activeAssignments[0]?.kind || "unknown"} in state ${activeAssignments[0]?.state}` : "."}`,
    actions: [
      {
        name: "record_outcome",
        label: "record outcome",
        available: activeAssignments.length > 0,
        handler: async () => {
          if (activeAssignments.length > 0) {
            setRecordingFor(activeAssignments[0].id);
            return { success: true, speech: "Outcome recording form opened." };
          }
          return { success: false, speech: "No active experiments to record outcomes for." };
        },
      },
      {
        name: "generate_protocol",
        label: "generate protocol",
        available: activeAssignments.length > 0 && !generating,
        handler: async () => {
          if (activeAssignments.length > 0) {
            await generateProtocol(activeAssignments[0].id);
            return { success: true, speech: "Protocol generated. Review it below." };
          }
          return { success: false, speech: "No active experiments to generate a protocol for." };
        },
      },
    ],
  });

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-20 text-center page-enter"><div className="inline-flex flex-col items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10"><div className="llm-thinking-dots"><span /><span /><span /></div></div><p className="text-sm text-muted-foreground">Loading experiments…</p></div></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10 page-enter"><div className="glass-card p-6 border-destructive/20"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div><p className="text-sm text-destructive">{error}</p></div><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  const active = assignments.filter((a) => !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state));

  return (
    <div className="mx-auto max-w-5xl px-8 py-10 page-enter">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Experiment</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Design protocols, record outcomes, and let the Attribution Oracle determine what made the difference.</p>
        </div>
        <div className={`llm-badge ${useLLM ? "llm-badge-live" : "llm-badge-offline"}`}>
          <div className={`h-1.5 w-1.5 rounded-full ${useLLM ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
          {useLLM ? "LLM attribution on" : "Deterministic only"}
        </div>
      </div>

      {/* Last result */}
      {lastResult && (
        <div className="glass-card mt-6 p-5 animate-fade-in-up border-emerald-500/20">
          <p className="done-section-label text-emerald-400">✓ Outcome recorded</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Attribution</p>
              <p className="mt-1 text-sm font-bold text-foreground">{lastResult.attribution?.responsibleFactor?.replace(/_/g, " ") || "Pending"}</p>
              <p className="text-xs text-muted-foreground">Confidence: {lastResult.attribution ? ((lastResult.attribution.attributionConfidence || 0) * 100).toFixed(0) + "%" : "N/A"}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">Derivatives generated</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{lastResult.derivatives?.length || 0}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">LLM used</p>
              <p className="mt-1 text-sm font-bold">{lastResult.llmUsed ? "✓ Yes" : "✗ No (deterministic)"}</p>
            </div>
          </div>
          {lastResult.attribution?.reasoning && (
            <p className="mt-3 text-sm text-muted-foreground">{lastResult.attribution.reasoning}</p>
          )}
        </div>
      )}

      {active.length === 0 ? (
        <div className="glass-card mt-8 p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center organic-border bg-gradient-to-br from-primary/20 to-accent/20 animate-glow-pulse" />
          <p className="text-lg font-medium text-muted-foreground">No active experiments.</p>
          <p className="mt-2 text-sm text-muted-foreground">Accept a hypothesis from Today to begin.</p>
          <a href="/today" className="btn btn-primary mt-6 inline-block">Go to Today →</a>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {active.map((a) => {
            const h = hypotheses.get(a.hypothesisId);
            return (
              <div key={a.id} className="glass-card glass-card-hover p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-lg">{h?.claim || a.hypothesisId}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="badge border-primary/30 bg-primary/10 text-primary">{a.kind}</span>
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{a.state}</span>
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">Trial {a.trialNumber}</span>
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{a.evaluationPeriodDays}d window</span>
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{a.eligibleAccountIds.length} accounts</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => generateProtocol(a.id)} disabled={generating} className="btn btn-ghost text-xs">
                      {generating ? <><div className="llm-thinking-dots"><span /><span /><span /></div></> : "◈ LLM protocol"}
                    </button>
                    <button onClick={() => { setRecordingFor(recordingFor === a.id ? null : a.id); setLastResult(null); }} className="btn btn-primary">
                      {recordingFor === a.id ? "Cancel" : "Record outcome"}
                    </button>
                  </div>
                </div>

                {/* LLM Protocol */}
                {llmProtocol && recordingFor === a.id && (
                  <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-4 animate-fade-in-up">
                    <p className="done-section-label flex items-center gap-2"><span className="text-accent">◈</span> LLM-Generated Protocol</p>
                    <pre className="mt-2 text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{llmProtocol}</pre>
                  </div>
                )}

                {/* Recording form */}
                {recordingFor === a.id && (
                  <div className="mt-4 space-y-4 border-t border-border pt-4 animate-fade-in-up">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="done-section-label">Success kind</span>
                        <select className="input mt-1" value={form.successKind} onChange={(e) => setForm({ ...form, successKind: e.target.value as SuccessKind })}>
                          {["performance", "efficiency", "discovery", "boundary", "system", "channel", "falsification"].map((k) => (<option key={k} value={k}>{k}</option>))}
                        </select>
                      </label>
                      <label className="flex items-end gap-2 pb-2">
                        <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} className="h-4 w-4 rounded" />
                        <span className="text-sm text-muted-foreground">Use LLM for attribution & derivatives</span>
                      </label>
                    </div>
                    <label className="block">
                      <span className="done-section-label">Outcome description</span>
                      <textarea className="input mt-1" rows={3} placeholder="What happened? What did you observe?" value={form.outcomeDescription} onChange={(e) => setForm({ ...form, outcomeDescription: e.target.value })} />
                    </label>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <label className="block"><span className="done-section-label">Metric name</span><input className="input mt-1" placeholder="completion_rate" value={form.metricName} onChange={(e) => setForm({ ...form, metricName: e.target.value })} /></label>
                      <label className="block"><span className="done-section-label">Unit</span><input className="input mt-1" placeholder="pct" value={form.metricUnit} onChange={(e) => setForm({ ...form, metricUnit: e.target.value })} /></label>
                      <label className="block"><span className="done-section-label">Value</span><input type="number" className="input mt-1" value={form.metricValue} onChange={(e) => setForm({ ...form, metricValue: Number(e.target.value) })} /></label>
                      <label className="block"><span className="done-section-label">Baseline</span><input type="number" className="input mt-1" value={form.metricBaseline} onChange={(e) => setForm({ ...form, metricBaseline: Number(e.target.value) })} /></label>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.higherIsBetter} onChange={(e) => setForm({ ...form, higherIsBetter: e.target.checked })} className="h-4 w-4 rounded" />Higher is better</label>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.falsified} onChange={(e) => setForm({ ...form, falsified: e.target.checked })} className="h-4 w-4 rounded" />This falsifies the hypothesis (useful failure)</label>
                    </div>
                    {form.falsified && (<input className="input" placeholder="Falsification evidence" value={form.falsificationEvidence} onChange={(e) => setForm({ ...form, falsificationEvidence: e.target.value })} />)}
                    <button onClick={() => submitOutcome(a.id)} disabled={submitting || !form.outcomeDescription.trim()} className="btn btn-primary w-full disabled:opacity-40">
                      {submitting ? <><div className="llm-thinking-dots"><span /><span /><span /></div> Recording…</> : "Submit outcome → Attribution Oracle"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
