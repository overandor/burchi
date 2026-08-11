"use client";

import { useState, useEffect, useCallback } from "react";
import { Cog, Plus, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader, PageSection, Stat, EmptyState } from "@/components/page-shell";
import { useCurrentUser } from "@/lib/auth/use-current-user";

const STEP_TYPES = ["trigger", "condition", "action", "wait", "measurement", "stop"] as const;
interface StepForm { type: typeof STEP_TYPES[number]; label: string; waitHours?: number; }

export default function ProcessLabPage() {
  const { user } = useCurrentUser();
  const employeeId = user?.id;
  const [processes, setProcesses] = useState<any[]>([]);
  const [hypotheses, setHypotheses] = useState<{ id: string; claim: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    hypothesisId: "",
    objective: "",
    eligibilityRules: "",
    complianceBoundary: "",
  });
  const [steps, setSteps] = useState<StepForm[]>([{ type: "trigger", label: "" }]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const processUrl = employeeId
        ? `/api/golden/process-lab?employeeId=${employeeId}`
        : "/api/golden/process-lab";
      const [pRes, hRes] = await Promise.all([
        fetch(processUrl),
        fetch("/api/spinor/email-engine?action=hypotheses"),
      ]);
      const pData = await pRes.json();
      const hData = await hRes.json();
      setProcesses(pData.processes || []);
      setHypotheses((hData.hypotheses || []).map((h: any) => ({ id: h.id, claim: h.claim })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  function addStep() { setSteps([...steps, { type: "action", label: "" }]); }
  function removeStep(i: number) { setSteps(steps.filter((_, idx) => idx !== i)); }
  function updateStep(i: number, patch: Partial<StepForm>) {
    setSteps(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/golden/process-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          objective: form.objective,
          ownerEmployeeId: employeeId,
          hypothesisId: form.hypothesisId || undefined,
          eligibilityRules: form.eligibilityRules.split("\n").filter(Boolean),
          complianceBoundary: form.complianceBoundary,
          steps: steps.filter((s) => s.label.trim()).map((s, i) => ({
            id: `step_${i + 1}`,
            type: s.type,
            label: s.label,
            ...(s.type === "wait" ? { waitHours: s.waitHours || 24 } : {}),
          })),
          humanInterventionPoints: [],
          measurementDesign: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage("Process created and validated.");
      setForm({ name: "", hypothesisId: "", objective: "", eligibilityRules: "", complianceBoundary: "" });
      setSteps([{ type: "trigger", label: "" }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      <PageHeader
        icon={Cog}
        title="Process Lab"
        subtitle="Systematize validated hypotheses into reusable, compliant processes."
      />

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-4">
          <div className="flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        </div>
      )}
      {message && (
        <div className="mt-6 rounded-2xl border border-spinor-green/20 bg-spinor-green/[0.03] p-4">
          <div className="flex items-center gap-2 text-foreground">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">{message}</span>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PageSection title="Processes" className="lg:col-span-1" actions={
          <span className="text-xs text-muted-foreground">{processes.length} defined</span>
        }>
          {processes.length === 0 ? (
            <EmptyState
              icon={Cog}
              title="No processes yet"
              description="Create the first reusable process from a validated hypothesis."
            />
          ) : (
            <div className="space-y-3">
              {processes.map((p) => (
                <div key={p.id} className="card p-4">
                  <p className="font-medium text-foreground/90">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.objective}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.steps?.length || 0} steps · Compliance: {p.complianceBoundary || "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </PageSection>

        <PageSection title="New process" className="lg:col-span-1">
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Office-manager-first outreach sequence"
                className="input mt-1 w-full"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Objective</span>
              <textarea
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                placeholder="What this process should achieve"
                rows={2}
                className="input mt-1 w-full resize-none"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked hypothesis</span>
              <select
                value={form.hypothesisId}
                onChange={(e) => setForm({ ...form, hypothesisId: e.target.value })}
                className="input mt-1 w-full"
              >
                <option value="">None / manual</option>
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>{h.claim.slice(0, 80)}…</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Eligibility rules (one per line)</span>
              <textarea
                value={form.eligibilityRules}
                onChange={(e) => setForm({ ...form, eligibilityRules: e.target.value })}
                rows={2}
                className="input mt-1 w-full resize-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compliance boundary</span>
              <textarea
                value={form.complianceBoundary}
                onChange={(e) => setForm({ ...form, complianceBoundary: e.target.value })}
                rows={2}
                className="input mt-1 w-full resize-none"
                required
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Steps</span>
                <button type="button" onClick={addStep} className="btn btn-ghost text-xs">
                  <Plus className="mr-1 h-3 w-3" /> Add step
                </button>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <select
                    value={s.type}
                    onChange={(e) => updateStep(i, { type: e.target.value as any })}
                    className="input w-28 text-xs"
                  >
                    {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    value={s.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step description"
                    className="input flex-1 text-sm"
                  />
                  {s.type === "wait" && (
                    <input
                      type="number"
                      value={s.waitHours || ""}
                      onChange={(e) => updateStep(i, { waitHours: Number(e.target.value) })}
                      placeholder="hrs"
                      className="input w-20 text-sm"
                    />
                  )}
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
                  )}
                </div>
              ))}
            </div>

            <button type="submit" disabled={submitting} className="btn btn-primary w-full disabled:opacity-50">
              {submitting ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Creating…</>
              ) : (
                "Create process"
              )}
            </button>
          </form>
        </PageSection>
      </div>
    </div>
  );
}
