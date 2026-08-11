"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FlaskConical, ArrowLeft, CheckCircle2, XCircle, Clock, Lightbulb } from "lucide-react";

interface ExperimentTwin {
  id: string;
  researchQuestion: string;
  hypothesis: string;
  permutationType: string;
  permutationDescription: string;
  status: string;
  result?: {
    controlMetric: number;
    experimentalMetric: number;
    improvement: number;
    significance: string;
    recommendation: string;
    notes: string;
  };
  createdAt: string;
  completedAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-500/10 text-blue-500",
  running: "bg-purple-500/10 text-purple-500",
  completed: "bg-gray-500/10 text-gray-500",
  validated: "bg-green-500/10 text-green-500",
  falsified: "bg-red-500/10 text-red-500",
};

const PERMUTATION_LABELS: Record<string, string> = {
  fewer_steps: "Fewer Steps",
  different_tool: "Different Tool",
  removed_step: "Removed Step",
  new_combination: "New Combination",
  new_timing: "New Timing",
};

export default function ExperimentTwinsPage() {
  const [twins, setTwins] = useState<ExperimentTwin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTwins = useCallback(async () => {
    try {
      const res = await fetch("/api/workteleport/twins");
      if (res.ok) {
        const data = await res.json();
        setTwins(data.twins || []);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTwins();
  }, [fetchTwins]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link href="/workteleport" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FlaskConical className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Experiment Twins</h1>
            <p className="text-xs text-muted-foreground">Every workflow gets an experimental counterpart</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4 text-primary" /> The Experiment Twin attacks stagnation
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The operational workflow protects continuity. The Experiment Twin asks: Could this be done with fewer steps?
            A different tool? Another employee? Which part produces the measurable outcome? Which steps are unnecessary
            historical residue?
          </p>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading experiment twins...</div>
        ) : twins.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No experiment twins yet. Twins are created automatically when workflows complete.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {twins.map((twin) => (
              <div key={twin.id} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-2 flex items-start justify-between">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[twin.status] || ""}`}>
                    {twin.status}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {PERMUTATION_LABELS[twin.permutationType] || twin.permutationType}
                  </span>
                </div>

                <h3 className="text-sm font-semibold">{twin.researchQuestion}</h3>
                <p className="mt-1 text-xs text-muted-foreground italic">"{twin.hypothesis}"</p>

                {twin.permutationDescription && (
                  <p className="mt-2 text-xs">{twin.permutationDescription}</p>
                )}

                {twin.result && (
                  <div className="mt-3 rounded-lg border border-border/50 bg-background p-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Control:</span> {twin.result.controlMetric}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Experimental:</span> {twin.result.experimentalMetric}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Improvement:</span>{" "}
                        <span className={twin.result.improvement > 0 ? "text-green-500" : "text-red-500"}>
                          {twin.result.improvement > 0 ? "+" : ""}{(twin.result.improvement * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Significance:</span> {twin.result.significance}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {twin.result.recommendation === "adopt" && (
                        <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Adopt</span>
                      )}
                      {twin.result.recommendation === "reject" && (
                        <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3 w-3" /> Reject</span>
                      )}
                      {twin.result.recommendation === "replicate" && (
                        <span className="flex items-center gap-1 text-amber-500"><Clock className="h-3 w-3" /> Replicate</span>
                      )}
                      {twin.result.notes && (
                        <span className="text-muted-foreground">{twin.result.notes}</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Created {new Date(twin.createdAt).toLocaleDateString()}</span>
                  {twin.completedAt && <span>Completed {new Date(twin.completedAt).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
