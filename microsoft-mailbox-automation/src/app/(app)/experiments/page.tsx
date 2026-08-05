"use client";

import { useState, useEffect, useCallback } from "react";
import type { HypothesisAnatomy, HypothesisAssignment, SuccessKind } from "@/types";

const EMPLOYEE_ID = "emp-001";

export default function ExperimentsPage() {
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
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [useLLM, setUseLLM] = useState(true);

  const load = useCallback(async () => {
    try {
      const [aRes, hRes] = await Promise.all([
        fetch(`/api/golden/assignments?employeeId=${EMPLOYEE_ID}`),
        fetch("/api/golden/hypotheses"),
      ]);
      const aData = await aRes.json();
      const hData = await hRes.json();
      setAssignments(aData.assignments || []);
      setHypotheses(new Map((hData.hypotheses || []).map((h: HypothesisAnatomy) => [h.id, h])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitOutcome(assignmentId: string) {
    setSubmitting(true);
    setLastResult(null);
    try {
      const metrics = form.metricName
        ? [{ metric: form.metricName, value: Number(form.metricValue), unit: form.metricUnit, baseline: Number(form.metricBaseline), higherIsBetter: form.higherIsBetter }]
        : [];
      const res = await fetch("/api/golden/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId, successKind: form.successKind, outcomeDescription: form.outcomeDescription,
          metrics, falsified: form.falsified, falsificationEvidence: form.falsificationEvidence || undefined, useLLM,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const llmTag = data.llmUsed ? " [LLM]" : " [deterministic]";
      setLastResult(
        `Recorded${llmTag}. Attribution: ${data.attribution ? data.attribution.responsibleFactor.replace(/_/g, " ") + ` (confidence ${(data.attribution.attributionConfidence * 100).toFixed(0)}%)` : "pending"}. Derivatives generated: ${data.derivatives?.length || 0}.`
      );
      setRecordingFor(null);
      setForm({ successKind: "performance", outcomeDescription: "", falsified: false, falsificationEvidence: "", metricName: "", metricValue: 0, metricBaseline: 0, metricUnit: "", higherIsBetter: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading experiments…</p></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10"><div className="card p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  const active = assignments.filter((a) => !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state));

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Experiments</h1>
      <p className="mt-2 text-muted-foreground">Record outcomes from your active hypothesis missions.</p>

      {lastResult && (
        <div className="mt-4 rounded-lg border border-status-completed/30 bg-status-completed/10 p-4 text-sm text-foreground/90">{lastResult}</div>
      )}

      {active.length === 0 ? (
        <div className="card mt-6 p-8 text-center"><p className="text-muted-foreground">No active experiments. Accept a hypothesis from Today's Research.</p></div>
      ) : (
        <div className="mt-6 space-y-4">
          {active.map((a) => {
            const h = hypotheses.get(a.hypothesisId);
            return (
              <div key={a.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">{h?.claim || a.hypothesisId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{a.kind} · {a.state} · Trial {a.trialNumber} · {a.evaluationPeriodDays}d window · {a.eligibleAccountIds.length} accounts</p>
                  </div>
                  <button onClick={() => { setRecordingFor(recordingFor === a.id ? null : a.id); setLastResult(null); }} className="btn btn-primary">{recordingFor === a.id ? "Cancel" : "Record outcome"}</button>
                </div>
                {recordingFor === a.id && (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <label className="block">
                      <span className="done-section-label">Success kind</span>
                      <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.successKind} onChange={(e) => setForm({ ...form, successKind: e.target.value as SuccessKind })}>
                        {["performance", "efficiency", "discovery", "boundary", "system", "channel", "falsification"].map((k) => (<option key={k} value={k}>{k}</option>))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="done-section-label">Outcome description</span>
                      <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="What happened? What did you observe?" value={form.outcomeDescription} onChange={(e) => setForm({ ...form, outcomeDescription: e.target.value })} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block"><span className="done-section-label">Metric name</span><input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="e.g. completion_rate" value={form.metricName} onChange={(e) => setForm({ ...form, metricName: e.target.value })} /></label>
                      <label className="block"><span className="done-section-label">Unit</span><input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="e.g. pct" value={form.metricUnit} onChange={(e) => setForm({ ...form, metricUnit: e.target.value })} /></label>
                      <label className="block"><span className="done-section-label">Value</span><input type="number" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.metricValue} onChange={(e) => setForm({ ...form, metricValue: Number(e.target.value) })} /></label>
                      <label className="block"><span className="done-section-label">Baseline</span><input type="number" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.metricBaseline} onChange={(e) => setForm({ ...form, metricBaseline: Number(e.target.value) })} /></label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.higherIsBetter} onChange={(e) => setForm({ ...form, higherIsBetter: e.target.checked })} />Higher is better</label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.falsified} onChange={(e) => setForm({ ...form, falsified: e.target.checked })} />This falsifies the hypothesis (useful failure)</label>
                    {form.falsified && (<input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Falsification evidence" value={form.falsificationEvidence} onChange={(e) => setForm({ ...form, falsificationEvidence: e.target.value })} />)}
                    <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} />Use LLM for attribution & derivatives (falls back to deterministic if unavailable)</label>
                    <button onClick={() => submitOutcome(a.id)} disabled={submitting || !form.outcomeDescription} className="btn btn-primary disabled:opacity-50">{submitting ? "Recording…" : "Submit & attribute"}</button>
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
