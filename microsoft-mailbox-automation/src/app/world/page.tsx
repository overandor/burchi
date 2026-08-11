"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  TrendingUp,
  AlertTriangle,
  GitBranch,
  Award,
  Eye,
  RefreshCw,
  Activity,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { useVoicePage } from "@/components/VoiceContext";

interface WorldSignal {
  id: string;
  type: "new_signal" | "contradiction" | "experiment_attention" | "replication_gap" | "emerging_golden" | "neglected_area";
  title: string;
  detail: string;
  territory?: string;
  channel?: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  info: "border-electric-blue/30 bg-electric-blue/5 text-electric-blue",
  warning: "border-amber-400/30 bg-amber-400/5 text-amber-400",
  critical: "border-crimson/30 bg-crimson/5 text-crimson",
};

const TYPE_ICON: Record<string, typeof Globe> = {
  new_signal: TrendingUp,
  contradiction: AlertTriangle,
  experiment_attention: Activity,
  replication_gap: GitBranch,
  emerging_golden: Award,
  neglected_area: Eye,
};

const TYPE_LABEL: Record<string, string> = {
  new_signal: "New Signal",
  contradiction: "Contradiction",
  experiment_attention: "Experiment Needs Attention",
  replication_gap: "Replication Gap",
  emerging_golden: "Emerging Golden Node",
  neglected_area: "Neglected Opportunity",
};

export default function WorldPage() {
  const { user } = useCurrentUser();
  const employeeId = user?.id || "gilead-rep-001";
  const [signals, setSignals] = useState<WorldSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, critical: 0, warnings: 0, emerging: 0 });

  async function loadWorld() {
    setLoading(true);
    setError(null);
    try {
      // Aggregate from multiple sources to build the world view
      const [spinsRes, goldenRes, admissibilityRes, outcomesRes, hypothesesRes] = await Promise.all([
        fetch("/api/spin/dashboard", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(`/api/golden/golden-nodes?employeeId=${employeeId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/spinor/admissibility", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/golden/outcomes", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/golden/hypotheses", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);

      const newSignals: WorldSignal[] = [];

      // SPIN state distribution → experiments requiring attention
      if (spinsRes?.stateDistribution) {
        for (const [state, count] of Object.entries(spinsRes.stateDistribution)) {
          if (state === "executing" && (count as number) > 0) {
            newSignals.push({
              id: `spin-executing`,
              type: "experiment_attention",
              title: `${count} experiment(s) in execution`,
              detail: "Active field experiments awaiting observation capture.",
              severity: "info",
              createdAt: new Date().toISOString(),
            });
          }
          if (state === "replication_pending" && (count as number) > 0) {
            newSignals.push({
              id: `spin-replication-pending`,
              type: "replication_gap",
              title: `${count} replication(s) pending`,
              detail: "Independent replications needed to advance evidence tier.",
              severity: "warning",
              createdAt: new Date().toISOString(),
            });
          }
          if (state === "reverse_test_required" && (count as number) > 0) {
            newSignals.push({
              id: `spin-reverse-test`,
              type: "contradiction",
              title: `${count} reverse test(s) required`,
              detail: "Promotion triggered adversarial reverse falsification.",
              severity: "critical",
              createdAt: new Date().toISOString(),
            });
          }
          if (state === "replicated" && (count as number) > 0) {
            newSignals.push({
              id: `spin-replicated`,
              type: "emerging_golden",
              title: `${count} SPIN(s) replicated`,
              detail: "Replicated experiments ready for golden node evaluation.",
              severity: "info",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      // Golden nodes → emerging golden nodes
      if (goldenRes?.goldenNodes) {
        const emerging = goldenRes.goldenNodes.filter(
          (n: any) => n.stage === "local_success" || n.stage === "rep_owned_process" || n.stage === "hypothesis",
        );
        for (const node of emerging.slice(0, 5)) {
          newSignals.push({
            id: `golden-${node.id}`,
            type: "emerging_golden",
            title: node.title || `Golden Node ${node.id}`,
            detail: `Stage: ${node.stage}. Replications: ${node.replications}. Portability: ${node.portability}.`,
            severity: "info",
            createdAt: node.createdAt ?? new Date().toISOString(),
          });
        }
      }

      // Outcomes → new signals and contradictions
      if (outcomesRes?.outcomes) {
        for (const outcome of outcomesRes.outcomes.slice(0, 5)) {
          if (outcome.falsified) {
            newSignals.push({
              id: `outcome-falsified-${outcome.id}`,
              type: "contradiction",
              title: `Hypothesis falsified: ${outcome.hypothesisId}`,
              detail: outcome.outcomeDescription?.slice(0, 120) ?? "Falsified result",
              severity: "warning",
              createdAt: outcome.observedAt ?? new Date().toISOString(),
            });
          } else {
            newSignals.push({
              id: `outcome-success-${outcome.id}`,
              type: "new_signal",
              title: `${outcome.successKind}: ${outcome.hypothesisId}`,
              detail: outcome.outcomeDescription?.slice(0, 120) ?? "New outcome recorded",
              severity: "info",
              createdAt: outcome.observedAt ?? new Date().toISOString(),
            });
          }
        }
      }

      // Admissibility decisions → signals
      if (admissibilityRes?.decisions) {
        const capped = admissibilityRes.decisions.filter(
          (d: any) => d.blockingConfounders?.length > 0,
        );
        for (const dec of capped.slice(0, 3)) {
          newSignals.push({
            id: `admissibility-${dec.recordId}`,
            type: "contradiction",
            title: `Evidence capped by confounders`,
            detail: `Record ${dec.recordId} capped at ${dec.level} due to: ${dec.blockingConfounders.join(", ")}`,
            severity: "warning",
            createdAt: dec.decidedAt,
          });
        }
      }

      // Hypotheses → neglected areas
      if (hypothesesRes?.hypotheses) {
        const untested = hypothesesRes.hypotheses.filter(
          (h: any) => h.priorArtStatus === "novel_permutation" || h.priorArtStatus === "new_mechanism",
        );
        for (const hyp of untested.slice(0, 2)) {
          newSignals.push({
            id: `neglected-${hyp.id}`,
            type: "neglected_area",
            title: `Untested novel hypothesis: ${hyp.claim?.slice(0, 60) ?? hyp.id}`,
            detail: `Prior-art status: ${hyp.priorArtStatus}. Research risk: ${hyp.researchRisk}. This hypothesis has not been tested.`,
            severity: "info",
            createdAt: hyp.createdAt ?? new Date().toISOString(),
          });
        }
      }

      // If no data at all, show a useful empty state signal
      if (newSignals.length === 0) {
        newSignals.push({
          id: "empty-state",
          type: "neglected_area",
          title: "No active world signals",
          detail: "Connect a mailbox or run the demo seed to populate the world view with real signals.",
          severity: "info",
          createdAt: new Date().toISOString(),
        });
      }

      setSignals(newSignals);
      setStats({
        total: newSignals.length,
        critical: newSignals.filter((s) => s.severity === "critical").length,
        warnings: newSignals.filter((s) => s.severity === "warning").length,
        emerging: newSignals.filter((s) => s.type === "emerging_golden").length,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorld();
  }, []);

  useVoicePage({
    pageId: "world",
    title: "World View",
    summary: `${stats.total} signals. ${stats.critical} critical, ${stats.warnings} warnings, ${stats.emerging} emerging.`,
    actions: [],
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[0_0_20px_-4px_hsl(var(--primary)/0.35)]">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">World</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              What changed across customers, territories, channels, campaigns, and experiments.
            </p>
          </div>
        </div>
        <button
          onClick={loadWorld}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Signals", value: stats.total, icon: Activity, color: "text-primary" },
          { label: "Critical", value: stats.critical, icon: AlertTriangle, color: "text-red-400" },
          { label: "Warnings", value: stats.warnings, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Emerging Golden", value: stats.emerging, icon: Award, color: "text-amber-300" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card card-hover p-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${stat.color}`} />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{stat.label}</span>
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Error loading world: {error}
        </div>
      )}

      {/* Signals */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          signals.map((signal) => {
            const Icon = TYPE_ICON[signal.type] ?? Globe;
            return (
              <div
                key={signal.id}
                className={`card card-hover border p-4 ${SEVERITY_STYLE[signal.severity]}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">{signal.title}</h3>
                      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                        {TYPE_LABEL[signal.type]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{signal.detail}</p>
                    {signal.territory && (
                      <span className="mt-2 inline-block rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] text-muted-foreground">
                        Territory: {signal.territory}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
