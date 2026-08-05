"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProcessDefinition } from "@/types";

const EMPLOYEE_ID = "emp-001";
const STEP_TYPES = ["trigger", "condition", "action", "wait", "measurement", "stop"] as const;
interface StepForm { type: typeof STEP_TYPES[number]; label: string; waitHours?: number; }

export default function ProcessLabPage() {
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [hypotheses, setHypotheses] = useState<{ id: string; claim: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: "", hypothesisId: "", objective: "", eligibilityRules: "", complianceBoundary: "" });
  const [steps, setSteps] = useState<StepForm[]>([{ type: "trigger", label: "" }]);

  const load = useCallback(async () => {
    try {
      const [pRes, hRes] = await Promise.all([fetch(`/api/golden/process-lab?employeeId=${EMPLOYEE_ID}`), fetch("/api/golden/hypotheses")]);
      const pData = await pRes.json();
      const hData = await hRes.json();
      setProcesses(pData.processes || []);
      setHypotheses((hData.hypotheses || []).map((h: any) => ({ id: h.id, claim: h.claim })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function addStep() { setSteps([...steps, { type: "action", label: "" }]); }
  function removeStep(i: number) { setSteps(steps.filter((_, idx) => idx !== i)); }
  function updateStep(i: number, patch: Partial<StepForm>) { setSteps(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s)); }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/golden/process-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, hypothesisId: form.hypothesisId || undefined, objective: form.objective,
          eligibilityRules: form.eligibilityRules.split("\n").filter(Boolean), complianceBoundary: form.complianceBoundary,
          steps: steps.filter((s) => s.label.trim()).map((s, i) => ({ id: `step_${i + 1}`, type: s.type, label: s.label, ...(s.type === "wait" ? { waitHours: s.waitHours || 24 } : {}) })),
          authorEmployeeId: EMPLOYEE_ID,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm({ name: "", hypothesisId: "", objective: "", eligibilityRules: "", complianceBoundary: "" });
      setSteps([{ type: "trigger", label: "" }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create process");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading process lab…</p></div>;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Process Lab</h1>
      <p className="mt-2 text-muted-foreground">Turn validated hypotheses into reusable, executable processes.</p>
      {error && <div className="mt-4 rounded-lg border border-status-blocked/30 bg-status-blocked/10 p-3 text-sm text-status-blocked">{error}</div>}
      <div className="card mt-6 p-5">
        <p className="done-section-label">Process builder</p>
        <div className="mt-3 space-y-3">
          <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Process name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.hypothesisId} onChange={(e) => setForm({ ...form, hypothesisId: e.target.value })}>
            <option value="">Link to hypothesis (optional)</option>
            {hypotheses.map((h) => (<option key={h.id} value={h.id}>{h.claim.slice(0, 80)}</option>))}
          </select>
          <textarea className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={2} placeholder="Objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
          <textarea className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="Eligibility rules (one per line)" value={form.eligibilityRules} onChange={(e) => setForm({ ...form, eligibilityRules: e.target.value })} />
          <textarea className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={2} placeholder="Compliance boundary" value={form.complianceBoundary} onChange={(e) => setForm({ ...form, complianceBoundary: e.target.value })} />
          <div>
            <p className="done-section-label">Steps</p>
            <div className="mt-2 space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                  <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={s.type} onChange={(e) => updateStep(i, { type: e.target.value as StepForm["type"] })}>
                    {STEP_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <input className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" placeholder="Step description" value={s.label} onChange={(e) => updateStep(i, { label: e.target.value })} />
                  {s.type === "wait" && <input type="number" className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="hrs" value={s.waitHours || ""} onChange={(e) => updateStep(i, { waitHours: Number(e.target.value) })} />}
                  {steps.length > 1 && <button onClick={() => removeStep(i)} className="text-xs text-muted-foreground hover:text-status-blocked">✕</button>}
                </div>
              ))}
            </div>
            <button onClick={addStep} className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground">+ Add step</button>
          </div>
          <button onClick={submit} disabled={submitting || !form.name || !form.objective} className="btn btn-primary disabled:opacity-50">{submitting ? "Creating…" : "Create process"}</button>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <p className="done-section-label">Existing processes</p>
        {processes.length === 0 ? (<p className="text-sm text-muted-foreground">No processes defined yet.</p>) : (
          processes.map((p) => (
            <div key={p.id} className="card p-5">
              <p className="font-medium text-foreground">{p.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.id} · {p.hypothesisId || "unlinked"}</p>
              <p className="mt-2 text-sm text-foreground/90">{p.objective}</p>
              {p.eligibilityRules.length > 0 && (<div className="mt-2"><p className="text-xs text-muted-foreground">Eligibility:</p><ul className="ml-4 text-xs text-muted-foreground">{p.eligibilityRules.map((r, i) => (<li key={i}>· {r}</li>))}</ul></div>)}
              <div className="mt-3"><p className="text-xs text-muted-foreground">Steps:</p><ol className="ml-4 mt-1 space-y-1 text-sm text-foreground/90">{p.steps.map((s, i) => (<li key={s.id}><span className="text-muted-foreground">{i + 1}.</span> [{s.type}] {s.label}{s.type === "wait" && s.waitHours ? ` (${s.waitHours}h)` : ""}</li>))}</ol></div>
              {p.complianceBoundary && <p className="mt-2 text-xs text-status-needs">Compliance: {p.complianceBoundary}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
