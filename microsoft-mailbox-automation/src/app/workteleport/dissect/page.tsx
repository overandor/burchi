"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, ArrowLeft, FlaskConical, Sparkles, Microscope, Lightbulb, ArrowRight } from "lucide-react";

interface DissectedHypothesis {
  id: string;
  originalClaim: string;
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  timing: string;
  mechanism: string;
  risk: string;
  demoronifiedClaim: string;
  researchStatus: string;
  researchSummary: string;
  novelComponent: string;
  noveltyType: string;
  experimentDesign: string;
  replicationPlan: string;
  capitalizationPlan: string;
}

const RESEARCH_STATUS_COLORS: Record<string, string> = {
  established: "bg-green-500/10 text-green-500",
  supported: "bg-blue-500/10 text-blue-500",
  transferred: "bg-purple-500/10 text-purple-500",
  plausible: "bg-amber-500/10 text-amber-500",
  untested: "bg-gray-500/10 text-gray-500",
  contradicted: "bg-red-500/10 text-red-500",
};

export default function DissectPage() {
  const [claim, setClaim] = useState("");
  const [result, setResult] = useState<DissectedHypothesis | null>(null);
  const [history, setHistory] = useState<DissectedHypothesis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDissect() {
    if (!claim.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workteleport/dissect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Dissect failed");
      }
      const data = await res.json();
      setResult(data.hypothesis);
      setHistory((prev) => [data.hypothesis, ...prev].slice(0, 10));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link href="/workteleport" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Dissect-Demoronify-Research-NoveltyMagnify</h1>
            <p className="text-xs text-muted-foreground">Hypothesis reasoning pipeline</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Pipeline Visualization */}
        <div className="mb-8 flex flex-wrap items-center gap-2 text-xs">
          {["Dissect", "Demoronify", "Research", "Novelty Magnify", "Experiment", "Replicate", "Capitalize"].map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              <span className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium">{stage}</span>
              {i < 6 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Input */}
        <section className="mb-8 rounded-xl border border-border bg-card p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Input Hypothesis
          </div>
          <textarea
            className="mb-3 w-full rounded-lg border border-border bg-background p-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            rows={3}
            placeholder="e.g., AI-driven physician-intent optimization will transform engagement through cutting-edge personalization."
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
          />
          <button
            onClick={handleDissect}
            disabled={loading || !claim.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Processing..." : "Run Pipeline"}
          </button>

          {error && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}
        </section>

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Stage 1: Dissect */}
            <PipelineStage
              stage={1}
              icon={<Microscope className="h-4 w-4" />}
              title="Dissect: PICO-TMR Components"
            >
              <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                <Field label="Population" value={result.population} />
                <Field label="Intervention" value={result.intervention} />
                <Field label="Comparison" value={result.comparison} />
                <Field label="Outcome" value={result.outcome} />
                <Field label="Timing" value={result.timing} />
                <Field label="Mechanism" value={result.mechanism} />
                <Field label="Risk" value={result.risk} />
              </div>
            </PipelineStage>

            {/* Stage 2: Demoronify */}
            <PipelineStage
              stage={2}
              icon={<Sparkles className="h-4 w-4" />}
              title="Demoronify: Testable Claim"
            >
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <p className="text-sm">{result.demoronifiedClaim}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Marketing language replaced with concrete, measurable terms.
              </p>
            </PipelineStage>

            {/* Stage 3: Research */}
            <PipelineStage
              stage={3}
              icon={<Brain className="h-4 w-4" />}
              title="Research: Evidence Status"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs ${RESEARCH_STATUS_COLORS[result.researchStatus] || ""}`}>
                  {result.researchStatus}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{result.researchSummary}</p>
            </PipelineStage>

            {/* Stage 4: Novelty Magnify */}
            <PipelineStage
              stage={4}
              icon={<Lightbulb className="h-4 w-4" />}
              title="Novelty Magnify: What is Actually New"
            >
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                <div className="text-xs text-muted-foreground">Novel component:</div>
                <p className="text-sm">{result.novelComponent}</p>
                <div className="mt-2 text-xs text-muted-foreground">Type: {result.noveltyType}</div>
              </div>
            </PipelineStage>

            {/* Stage 5: Experiment Design */}
            <PipelineStage
              stage={5}
              icon={<FlaskConical className="h-4 w-4" />}
              title="Experiment Design"
            >
              <p className="text-xs">{result.experimentDesign}</p>
            </PipelineStage>

            {/* Stage 6: Replication Plan */}
            <PipelineStage
              stage={6}
              icon={<ArrowRight className="h-4 w-4" />}
              title="Replication Plan"
            >
              <p className="text-xs">{result.replicationPlan}</p>
            </PipelineStage>

            {/* Stage 7: Capitalization Plan */}
            <PipelineStage
              stage={7}
              icon={<Sparkles className="h-4 w-4" />}
              title="Capitalization Plan"
            >
              <p className="text-xs">{result.capitalizationPlan}</p>
            </PipelineStage>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold">Recent Hypotheses</h2>
            <div className="space-y-2">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setResult(h)}
                  className="block w-full rounded-lg border border-border/50 bg-card p-3 text-left hover:border-primary/50"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-mono text-muted-foreground">{h.id.substring(0, 20)}...</span>
                    <span className={`rounded-full px-2 py-0.5 ${RESEARCH_STATUS_COLORS[h.researchStatus] || ""}`}>
                      {h.researchStatus}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm">{h.demoronifiedClaim}</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function PipelineStage({ stage, icon, title, children }: { stage: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Stage {stage}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
