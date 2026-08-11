"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewExperimentPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    owner: "",
    assignedParticipant: "",
    population: "",
    intervention: "",
    comparison: "",
    outcome: "",
    timePeriod: "14 days",
    mechanism: "",
    risk: "",
    falsificationCondition: "",
    observationWindowDays: "14",
    evidenceClass: "internal_signal",
    priorArtClassification: "untested",
    priorArtEstablished: "",
    priorArtTransferred: "",
    priorArtInternalSignal: "",
    priorArtNoveltyDelta: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const claim = {
        population: form.population,
        intervention: form.intervention,
        comparison: form.comparison,
        outcome: form.outcome,
        timePeriod: form.timePeriod,
        mechanism: form.mechanism,
        risk: form.risk,
        falsificationCondition: form.falsificationCondition,
      };

      const claimProse = `Among ${claim.population}, ${claim.intervention} compared with ${claim.comparison} will improve ${claim.outcome} within ${claim.timePeriod}. Mechanism: ${claim.mechanism}. Risk: ${claim.risk}. Falsification condition: ${claim.falsificationCondition}.`;

      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: form.owner,
          assignedParticipant: form.assignedParticipant,
          claim,
          claimProse,
          observationWindowDays: parseInt(form.observationWindowDays) || 14,
          evidenceClass: form.evidenceClass,
          priorArt: {
            classification: form.priorArtClassification,
            establishedSummary: form.priorArtEstablished,
            transferredSummary: form.priorArtTransferred,
            internalSignalSummary: form.priorArtInternalSignal,
            noveltyDelta: form.priorArtNoveltyDelta,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create experiment");
      }

      const data = await res.json();
      router.push(`/experiment/${encodeURIComponent(data.experiment.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6">
        <Link href="/experiment" className="text-sm text-muted-foreground hover:text-foreground">← All experiments</Link>
      </div>

      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New Governed Experiment</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a durable, versioned experiment object with state machine, compliance gates, and execution receipts.
        </p>
      </header>

      <div className="mb-6 rounded-xl border border-amber/30 bg-amber/5 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-400">Development Evidence Provider</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This experiment will be stored in SQLite but may not survive redeployment. Organization isolation is not yet storage-enforced.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="glass-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-primary">Experimenter</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Owner (required)</label>
              <input
                type="text"
                required
                value={form.owner}
                onChange={(e) => update("owner", e.target.value)}
                className="input w-full"
                placeholder="e.g. rep-001"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assigned Participant</label>
              <input
                type="text"
                value={form.assignedParticipant}
                onChange={(e) => update("assignedParticipant", e.target.value)}
                className="input w-full"
                placeholder="e.g. account-042"
              />
            </div>
          </div>
        </section>

        <section className="glass-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-primary">Structured Claim (PICO-T + Mechanism + Risk + Falsification)</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Population</label>
              <input type="text" value={form.population} onChange={(e) => update("population", e.target.value)} className="input w-full" placeholder="e.g. Cardiology accounts with prior PA approval delays" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Intervention</label>
              <input type="text" value={form.intervention} onChange={(e) => update("intervention", e.target.value)} className="input w-full" placeholder="e.g. Pre-call barrier checklist with staff routing" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Comparison</label>
              <input type="text" value={form.comparison} onChange={(e) => update("comparison", e.target.value)} className="input w-full" placeholder="e.g. Standard call sequence without checklist" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
              <input type="text" value={form.outcome} onChange={(e) => update("outcome", e.target.value)} className="input w-full" placeholder="e.g. PA approval cycle time in business days" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Time Period</label>
                <input type="text" value={form.timePeriod} onChange={(e) => update("timePeriod", e.target.value)} className="input w-full" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Observation Window (days)</label>
                <input type="number" value={form.observationWindowDays} onChange={(e) => update("observationWindowDays", e.target.value)} className="input w-full" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Mechanism</label>
              <input type="text" value={form.mechanism} onChange={(e) => update("mechanism", e.target.value)} className="input w-full" placeholder="e.g. Identifying missing documentation before submission reduces rejection cycles" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Risk</label>
              <input type="text" value={form.risk} onChange={(e) => update("risk", e.target.value)} className="input w-full" placeholder="e.g. Staff may not have time for additional checklist steps" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Falsification Condition</label>
              <input type="text" value={form.falsificationCondition} onChange={(e) => update("falsificationCondition", e.target.value)} className="input w-full" placeholder="e.g. PA cycle time does not decrease by more than 1 business day" />
            </div>
          </div>
        </section>

        <section className="glass-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-primary">Prior-Art Classification</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Classification</label>
              <select value={form.priorArtClassification} onChange={(e) => update("priorArtClassification", e.target.value)} className="input w-full">
                <option value="untested">Untested</option>
                <option value="established">Established</option>
                <option value="supported">Supported</option>
                <option value="transferred">Transferred</option>
                <option value="plausible">Plausible</option>
                <option value="previously_failed">Previously Failed</option>
                <option value="contradicted">Contradicted</option>
                <option value="unsupported">Unsupported</option>
                <option value="internal_signal">Internal Signal</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Established Summary</label>
              <textarea value={form.priorArtEstablished} onChange={(e) => update("priorArtEstablished", e.target.value)} className="input w-full" rows={2} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Transferred Summary</label>
              <textarea value={form.priorArtTransferred} onChange={(e) => update("priorArtTransferred", e.target.value)} className="input w-full" rows={2} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Internal Signal Summary</label>
              <textarea value={form.priorArtInternalSignal} onChange={(e) => update("priorArtInternalSignal", e.target.value)} className="input w-full" rows={2} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Novelty Delta</label>
              <textarea value={form.priorArtNoveltyDelta} onChange={(e) => update("priorArtNoveltyDelta", e.target.value)} className="input w-full" rows={2} />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red/30 bg-red/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Link href="/experiment" className="btn btn-ghost">Cancel</Link>
          <button type="submit" disabled={creating} className="btn btn-primary">
            {creating ? "Creating…" : "Create Experiment"}
          </button>
        </div>
      </form>
    </main>
  );
}
