"use client";

import { GenericDataPage } from "@/components/data-view";
import { GitBranch, Users, Activity, Clock, Mail, Brain, TrendingUp } from "lucide-react";
import { PageSection, EmptyState, Stat } from "@/components/page-shell";

interface Physician {
  physicianId: string;
  name: string;
  currentState: string;
  stateHistory: { state: string; observedAt: string; evidence: string }[];
  interactionSignals: {
    digitalResponsiveness: number;
    preferredChannel: string;
    selfServiceCompletion: number;
    staffDelegationPattern: string;
    meetingPreference: string;
    responseLatencyHours: number;
    contentDepthPreference: string;
    workflowComplexityTolerance: string;
    priorAutomationAdoption: number;
  };
  recommendedApproach: string;
  nextTestHypothesis: string;
  updatedAt: string;
}

function StateBadge({ state }: { state: string }) {
  const tone: Record<string, string> = {
    automation_proficient: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    automation_tolerant: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    automation_curious: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    human_relationship_dominant: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    llm_aware: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    automation_resistant: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  const cls = tone[state] || "bg-muted/20 text-muted-foreground border-border/50";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PhysicianCard({ p }: { p: Physician }) {
  const signals = p.interactionSignals || {};
  return (
    <div className="card card-hover flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
          <p className="mt-0.5 text-[10px] font-mono text-muted-foreground">{p.physicianId}</p>
        </div>
        <StateBadge state={p.currentState} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3 w-3" />
          <span className="capitalize">{signals.preferredChannel?.replace(/_/g, " ")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span>{signals.responseLatencyHours}h latency</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Brain className="h-3 w-3" />
          <span className="capitalize">{signals.meetingPreference} preference</span>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3" />
          <span className="capitalize">{signals.workflowComplexityTolerance} complexity</span>
        </div>
      </div>

      <div className="space-y-2">
        <MetricBar label="Digital responsiveness" value={signals.digitalResponsiveness ?? 0} />
        <MetricBar label="Self-service completion" value={signals.selfServiceCompletion ?? 0} />
        <MetricBar label="Prior automation adoption" value={signals.priorAutomationAdoption ?? 0} />
      </div>

      <div className="space-y-2 text-xs leading-relaxed">
        <p className="text-foreground/80">
          <span className="font-medium text-muted-foreground">Recommended:</span>{" "}
          {p.recommendedApproach}
        </p>
        {p.nextTestHypothesis && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground/70">Next test:</span>{" "}
            {p.nextTestHypothesis}
          </p>
        )}
      </div>
    </div>
  );
}

function SpinorRLOverview({ data }: { data: any }) {
  const physicians: Physician[] = data?.physicians || [];
  const hasState = physicians.length > 0;

  return (
    <div className="space-y-6">
      <PageSection title="Physician adaptation" icon={Users}>
        {physicians.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No physician signals"
            message="The RL engine has not received any physician interaction data yet."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {physicians.map((p) => (
              <PhysicianCard key={p.physicianId} p={p} />
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Engine status" icon={Activity}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Missions" value={data?.counts?.missions ?? 0} />
          <Stat label="Palindromes" value={data?.counts?.palindromeUpdates ?? 0} />
          <Stat label="Stagnation flags" value={data?.counts?.stagnationFlags ?? 0} />
          <Stat label="RL rewards" value={data?.counts?.rlRewards ?? 0} />
        </div>
        {!hasState && (
          <p className="mt-3 text-xs text-muted-foreground">
            Engine is online but the mission queue is empty. Use the allocation endpoints to generate missions.
          </p>
        )}
      </PageSection>
    </div>
  );
}

export default function SpinorRLPage() {
  return (
    <GenericDataPage
      icon={GitBranch}
      title="SPINOR-RL"
      subtitle="Reinforcement learning engine state and mission telemetry."
      endpoint="/api/spinor-rl/state"
      stats={[
        { label: "Missions", path: "counts.missions" },
        { label: "Physicians", path: "counts.physicians" },
        { label: "Palindromes", path: "counts.palindromeUpdates" },
        { label: "Rewards", path: "counts.rlRewards" },
        { label: "Stagnation", path: "counts.stagnationFlags" },
      ]}
      renderOverview={(data) => <SpinorRLOverview data={data} />}
    />
  );
}
