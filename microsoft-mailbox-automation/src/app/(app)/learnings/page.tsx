"use client";

import { useState, useEffect, useCallback } from "react";
import type { HypothesisDerivative } from "@/types";

const FILTERS = ["all", "proposed", "testing", "supported", "falsified"] as const;
type Filter = typeof FILTERS[number];

export default function LearningsPage() {
  const [derivatives, setDerivatives] = useState<HypothesisDerivative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/golden/derivatives");
      const data = await res.json();
      setDerivatives(data.derivatives || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateLlm(hypothesisId: string, useLLM = false) {
    setGenerating(true);
    try {
      await fetch("/api/golden/derivatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "llm_permutations", hypothesisId, useLLM }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  async function promote(id: string) {
    try {
      await fetch("/api/golden/derivatives", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "promote" }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    }
  }

  const parentIds = [...new Set(derivatives.map((d) => d.parentHypothesisId))];

  const filtered = filter === "all" ? derivatives : derivatives.filter((d) => d.status === filter);

  if (loading) return <div className="mx-auto max-w-4xl px-8 py-10"><p className="text-muted-foreground">Loading derivatives…</p></div>;
  if (error) return <div className="mx-auto max-w-4xl px-8 py-10"><div className="card p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Derivatives</h1>
      <p className="mt-2 text-muted-foreground">Hypothesis mutations — branched experiments adapted to new contexts.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "border-foreground bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {f}
          </button>
        ))}
        {parentIds.length > 0 && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => generateLlm(parentIds[0], false)} disabled={generating}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
              {generating ? "Generating…" : "Generate permutations"}
            </button>
            <button onClick={() => generateLlm(parentIds[0], true)} disabled={generating}
              className="rounded-lg border border-foreground/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/10 disabled:opacity-50">
              Generate with LLM
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card mt-6 p-8 text-center"><p className="text-muted-foreground">No derivatives yet. Use Generate to create permutations from your hypotheses.</p></div>
      ) : (
        <div className="mt-6 space-y-4">
          {filtered.map((d) => (
            <div key={d.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{d.claim}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    dimension: {d.modifiedDimension.replace(/_/g, " ")} · origin: {d.origin.replace(/_/g, " ")} · status: {d.status}
                  </p>
                  {d.rationale && <p className="mt-2 text-sm text-muted-foreground">{d.rationale}</p>}
                </div>
                {d.status === "proposed" && (
                  <button onClick={() => promote(d.id)} className="btn btn-outline text-xs">Promote to hypothesis</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
