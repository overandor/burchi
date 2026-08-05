"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  MissionCard,
  MissionClass,
  PhysicianModel,
  PalindromeUpdate,
  RLAgentState,
  RLReward,
  EmailSignal,
  StagnationFlag,
  SproutNode,
  DiffusionState,
  AntiGamingCheck,
} from "@/types";

const EMPLOYEE_ID = "emp-001";

const MISSION_ICONS: Record<MissionClass, string> = {
  scout: "🔍", field: "🧪", builder: "🔧", replication: "🔄",
  saboteur: "💣", mutation: "🧬", translator: "🌐",
  recovery: "🚑", channel: "📡", palindrome: "↔️",
};

const MISSION_COLORS: Record<MissionClass, string> = {
  scout: "#3b82f6", field: "#22c55e", builder: "#f59e0b", replication: "#8b5cf6",
  saboteur: "#ef4444", mutation: "#ec4899", translator: "#06b6d4",
  recovery: "#f97316", channel: "#fbbf24", palindrome: "#a78bfa",
};

const DIFFUSION_STAGES = [
  "discovery", "internal_replication", "mechanism_isolation",
  "segment_testing", "adversarial_challenge", "controlled_diffusion",
  "operational_standard", "continuous_retesting",
];

type Tab = "missions" | "physicians" | "palindrome" | "rl" | "email" | "stagnation" | "sprout" | "diffusion" | "antigaming";

export default function SpinorRLPage() {
  const [tab, setTab] = useState<Tab>("missions");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<{ used: boolean; error?: string } | null>(null);

  // State
  const [missions, setMissions] = useState<MissionCard[]>([]);
  const [missionClasses, setMissionClasses] = useState<Record<string, { label: string; icon: string; description: string; color: string }>>({});
  const [physicians, setPhysicians] = useState<PhysicianModel[]>([]);
  const [palindromeUpdates, setPalindromeUpdates] = useState<PalindromeUpdate[]>([]);
  const [rlState, setRlState] = useState<RLAgentState | null>(null);
  const [rlAction, setRlAction] = useState<{ action: string; rationale: string } | null>(null);
  const [rlRewards, setRlRewards] = useState<RLReward[]>([]);
  const [emailSignals, setEmailSignals] = useState<EmailSignal[]>([]);
  const [stagnationFlags, setStagnationFlags] = useState<StagnationFlag[]>([]);
  const [sprouts, setSprouts] = useState<SproutNode[]>([]);
  const [diffusionStates, setDiffusionStates] = useState<DiffusionState[]>([]);
  const [antiGamingChecks, setAntiGamingChecks] = useState<AntiGamingCheck[]>([]);

  const load = useCallback(async () => {
    try {
      const [mRes, stateRes] = await Promise.all([
        fetch(`/api/spinor-rl/mission?employeeId=${EMPLOYEE_ID}`),
        fetch("/api/spinor-rl/state"),
      ]);
      if (mRes.ok) {
        const d = await mRes.json();
        setMissions(d.missions || []);
        setMissionClasses(d.missionClasses || {});
      }
      if (stateRes.ok) {
        const d = await stateRes.json();
        setPhysicians(d.physicians || []);
        setPalindromeUpdates(d.palindromeUpdates || []);
        setRlRewards(d.rlRewards || []);
        setEmailSignals(d.emailSignals || []);
        setStagnationFlags(d.stagnationFlags || []);
        setSprouts(d.sproutTree || []);
        setDiffusionStates(d.diffusionStates || []);
        setAntiGamingChecks(d.antiGamingChecks || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateNewMission(missionClass?: MissionClass) {
    setActing(true); setLlmStatus(null);
    try {
      const res = await fetch("/api/spinor-rl/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: EMPLOYEE_ID, missionClass }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setLlmStatus({ used: d.llmUsed, error: d.llmError });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate mission");
    } finally { setActing(false); }
  }

  async function updateMission(missionId: string, state: MissionCard["state"]) {
    setActing(true);
    try {
      await fetch("/api/spinor-rl/mission", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, state }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update mission");
    } finally { setActing(false); }
  }

  async function loadRLState() {
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/spinor-rl/rl?employeeId=${EMPLOYEE_ID}&action=state`),
        fetch(`/api/spinor-rl/rl?employeeId=${EMPLOYEE_ID}&action=select`),
      ]);
      if (sRes.ok) { const d = await sRes.json(); setRlState(d.state); }
      if (aRes.ok) { const d = await aRes.json(); setRlAction(d); }
    } catch (e) { /* ignore */ }
  }

  useEffect(() => { if (tab === "rl") loadRLState(); }, [tab]);

  if (loading) return <div className="mx-auto max-w-5xl px-8 py-10"><p className="text-muted-foreground">Loading SPINOR-RL engine…</p></div>;
  if (error) return <div className="mx-auto max-w-5xl px-8 py-10"><div className="card border-status-blocked/30 p-6"><p className="text-status-blocked">{error}</p><button className="btn btn-primary mt-4" onClick={load}>Retry</button></div></div>;

  const tabs: { id: Tab; label: string; icon: string; count?: number }[] = [
    { id: "missions", label: "Missions", icon: "🎯", count: missions.length },
    { id: "physicians", label: "Physicians", icon: "👨‍⚕️", count: physicians.length },
    { id: "palindrome", label: "Palindrome", icon: "↔️", count: palindromeUpdates.length },
    { id: "rl", label: "RL Engine", icon: "🤖" },
    { id: "email", label: "Email Sensor", icon: "📡", count: emailSignals.length },
    { id: "stagnation", label: "Stagnation", icon: "⚠️", count: stagnationFlags.length },
    { id: "sprout", label: "Sprouts", icon: "🌱", count: sprouts.length },
    { id: "diffusion", label: "Diffusion", icon: "🌊", count: diffusionStates.length },
    { id: "antigaming", label: "Anti-Gaming", icon: "🛡️", count: antiGamingChecks.length },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">SPINOR-RL</h1>
        <p className="mt-2 text-muted-foreground">The Palindromic Perpetual Research Game — every day is a mission in a living experimental ecosystem.</p>
      </div>

      {llmStatus && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${llmStatus.used ? "border-status-validated/30 bg-status-validated/5 text-status-validated" : "border-border bg-muted/20 text-muted-foreground"}`}>
          {llmStatus.used ? "LLM enhancement active" : `LLM unavailable${llmStatus.error ? `: ${llmStatus.error}` : ""}. Deterministic fallback used.`}
        </div>
      )}

      {/* Tab navigation */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${tab === t.id ? "border-foreground bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            <span>{t.icon}</span>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="ml-1 rounded-full bg-foreground/10 px-1.5 text-[10px]">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Missions Tab */}
      {tab === "missions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">Active Missions</h2>
            <div className="flex gap-2">
              <button onClick={() => generateNewMission()} disabled={acting} className="btn btn-primary disabled:opacity-50">
                {acting ? "Generating…" : "Generate Mission"}
              </button>
            </div>
          </div>

          {/* Mission class selector */}
          <div className="card p-4">
            <p className="done-section-label mb-3">Generate Specific Mission Class</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {Object.entries(missionClasses).map(([key, config]) => (
                <button key={key} onClick={() => generateNewMission(key as MissionClass)} disabled={acting}
                  className="rounded-lg border border-border p-2 text-center text-xs transition-all hover:border-foreground disabled:opacity-50">
                  <div className="text-lg">{config.icon}</div>
                  <div className="mt-1 font-medium text-foreground">{config.label}</div>
                </button>
              ))}
            </div>
          </div>

          {missions.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-muted-foreground">No active missions. Generate one to begin.</p>
            </div>
          ) : (
            missions.map((m) => (
              <div key={m.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{MISSION_ICONS[m.missionClass]}</span>
                      <h3 className="font-semibold text-foreground">{m.title}</h3>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: MISSION_COLORS[m.missionClass] }}>
                        {m.missionClass.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-foreground/90">{m.claim}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${m.state === "completed" ? "bg-status-validated/10 text-status-validated" : m.state === "abandoned" ? "bg-status-blocked/10 text-status-blocked" : "bg-primary/10 text-primary"}`}>
                    {m.state}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div><p className="done-section-label">Prior Evidence</p><p className="mt-1 text-xs text-muted-foreground">{m.priorEvidence}</p></div>
                  <div><p className="done-section-label">Tested Already</p><p className="mt-1 text-xs text-muted-foreground">{m.testedAlready}</p></div>
                  <div><p className="done-section-label">Experimental Action</p><p className="mt-1 text-xs text-foreground/80">{m.experimentalAction}</p></div>
                  <div><p className="done-section-label">Control Comparison</p><p className="mt-1 text-xs text-foreground/80">{m.controlComparison}</p></div>
                  <div><p className="done-section-label">Success Metric</p><p className="mt-1 text-xs text-foreground/80">{m.successMetric}</p></div>
                  <div><p className="done-section-label">Failure Condition</p><p className="mt-1 text-xs text-status-blocked/80">{m.failureCondition}</p></div>
                </div>

                <div className="mt-3 rounded-lg border border-status-needs/20 bg-status-needs/5 p-3">
                  <p className="done-section-label text-status-needs">Risk Boundary</p>
                  <p className="mt-1 text-xs text-foreground/70">{m.riskBoundary}</p>
                </div>

                <div className="mt-3">
                  <p className="done-section-label">Unknowns</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {m.unknowns.map((u, i) => <li key={i}>· {u}</li>)}
                  </ul>
                </div>

                {m.state === "assigned" && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateMission(m.id, "accepted")} disabled={acting} className="btn btn-primary text-xs disabled:opacity-50">Accept</button>
                    <button onClick={() => updateMission(m.id, "abandoned")} disabled={acting} className="btn btn-outline text-xs disabled:opacity-50">Abandon</button>
                  </div>
                )}
                {m.state === "accepted" && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateMission(m.id, "executing")} disabled={acting} className="btn btn-primary text-xs disabled:opacity-50">Begin Execution</button>
                  </div>
                )}
                {m.state === "executing" && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateMission(m.id, "completed")} disabled={acting} className="btn btn-primary text-xs disabled:opacity-50">Mark Complete</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Physicians Tab */}
      {tab === "physicians" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Physician Adaptation Models</h2>
          <p className="text-sm text-muted-foreground">Continuously updated interaction models — hypotheses, not permanent labels.</p>
          {physicians.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No physician models yet. They are built from observed email behavior.</p></div>
          ) : (
            physicians.map((p) => (
              <div key={p.physicianId} className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">{p.name}</h3>
                  <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-400">
                    {p.currentState.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Metric label="Digital Responsiveness" value={p.interactionSignals.digitalResponsiveness} />
                  <Metric label="Self-Service" value={p.interactionSignals.selfServiceCompletion} />
                  <Metric label="Automation Adoption" value={p.interactionSignals.priorAutomationAdoption} />
                  <div>
                    <p className="done-section-label">Response Latency</p>
                    <p className="mt-1 text-sm text-foreground/90">{p.interactionSignals.responseLatencyHours}h</p>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="done-section-label">Recommended Approach</p>
                  <p className="mt-1 text-sm text-foreground/80">{p.recommendedApproach}</p>
                </div>
                <div className="mt-3">
                  <p className="done-section-label">Next Test Hypothesis</p>
                  <p className="mt-1 text-sm text-foreground/80">{p.nextTestHypothesis}</p>
                </div>
                <div className="mt-3">
                  <p className="done-section-label">State History</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.stateHistory.slice(-5).map((h, i) => (
                      <span key={i} className="rounded bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {h.state.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Palindrome Tab */}
      {tab === "palindrome" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Palindromic Learning Updates</h2>
          <p className="text-sm text-muted-foreground">Forward pass (did it work?) + Reverse pass (what assumption generated it?).</p>
          {palindromeUpdates.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No palindromic updates yet. They are generated when experiments complete.</p></div>
          ) : (
            palindromeUpdates.map((u) => (
              <div key={u.id} className="card p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-status-validated/20 bg-status-validated/5 p-4">
                    <p className="done-section-label text-status-validated">Forward Pass →</p>
                    <p className="mt-2 text-xs text-foreground/80">{u.forward.llmAnalysis}</p>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <p>Improved: {u.forward.improvedOutcome ? "Yes" : "No"}</p>
                      <p>For whom: {u.forward.forWhom}</p>
                      <p>Repeatable: {u.forward.repeatable ? "Yes" : "Not yet"}</p>
                      <p>Can become system: {u.forward.canBecomeSystem ? "Yes" : "No"}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                    <p className="done-section-label text-violet-400">← Reverse Pass</p>
                    <p className="mt-2 text-xs text-foreground/80">{u.reverse.llmAnalysis}</p>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <p>Assumption: {u.reverse.assumptionGenerated}</p>
                      <p>Alternative: {u.reverse.alternativeMechanism}</p>
                      <p>Where should fail: {u.reverse.whereShouldFail}</p>
                      <p>New question: {u.reverse.newResearchQuestion}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
                  <p className="done-section-label">Learning Record</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <p><span className="text-muted-foreground">Prior belief:</span> {u.learningRecord.priorBelief}</p>
                    <p><span className="text-muted-foreground">Observed:</span> {u.learningRecord.observedResult}</p>
                    <p><span className="text-muted-foreground">Inferred mechanism:</span> {u.learningRecord.inferredMechanism}</p>
                    <p><span className="text-muted-foreground">Next hypothesis:</span> {u.learningRecord.nextHypothesis}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* RL Engine Tab */}
      {tab === "rl" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">RL Allocation Engine</h2>
          <p className="text-sm text-muted-foreground">Contextual multi-agent bandit — assigns hypotheses based on capability, effort, and learning velocity.</p>

          {rlState && (
            <div className="card p-5">
              <p className="done-section-label">Agent State for {EMPLOYEE_ID}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Recent Effort" value={rlState.recentEffort} />
                <Stat label="Historical Performance" value={rlState.historicalPerformance} />
                <Stat label="Research Quality" value={`${(rlState.researchQuality * 100).toFixed(0)}%`} />
                <Stat label="Experiment Novelty" value={`${(rlState.experimentNovelty * 100).toFixed(0)}%`} />
                <Stat label="Operational Workload" value={rlState.operationalWorkload} />
                <Stat label="Confidence in Evidence" value={`${(rlState.confidenceInEvidence * 100).toFixed(0)}%`} />
              </div>
              <div className="mt-3">
                <p className="done-section-label">Capability Profile</p>
                <div className="mt-2 space-y-1.5">
                  {Object.entries(rlState.capabilityProfile).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-32 text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${v * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs text-foreground/80">{(v * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {rlAction && (
            <div className="card border-primary/20 p-5">
              <p className="done-section-label text-primary">Recommended RL Action</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{rlAction.action.replace(/_/g, " ")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{rlAction.rationale}</p>
            </div>
          )}

          {rlRewards.length > 0 && (
            <div className="card p-5">
              <p className="done-section-label">Recent Rewards</p>
              <div className="mt-3 space-y-2">
                {rlRewards.slice(-5).map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border p-2">
                    <span className="text-sm font-semibold text-foreground">Reward: {r.total}</span>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Validated: {r.validatedOutcomeValue}</span>
                      <span>Novelty: {r.novelty}</span>
                      <span>Useful failure: {r.usefulFailure}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Email Sensor Tab */}
      {tab === "email" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Email Competitive Sensor</h2>
          <p className="text-sm text-muted-foreground">Email is not merely communication — it is a behavioral evidence stream.</p>
          {emailSignals.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No email signals extracted yet. Signals are generated when emails are processed.</p></div>
          ) : (
            emailSignals.slice(-10).map((s) => (
              <div key={s.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-foreground">Signal from {s.emailId.slice(0, 20)}…</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.llmUsed ? "bg-status-validated/10 text-status-validated" : "bg-muted/20 text-muted-foreground"}`}>
                    {s.llmUsed ? "LLM" : "Deterministic"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {s.commitments.length > 0 && <SignalList label="Commitments" items={s.commitments} />}
                  {s.objections.length > 0 && <SignalList label="Objections" items={s.objections} />}
                  {s.unansweredQuestions.length > 0 && <SignalList label="Unanswered Questions" items={s.unansweredQuestions} />}
                  {s.technologyAdoptionSignals.length > 0 && <SignalList label="Tech Adoption Signals" items={s.technologyAdoptionSignals} />}
                  {s.processBottlenecks.length > 0 && <SignalList label="Process Bottlenecks" items={s.processBottlenecks} />}
                  {s.emergingDemand.length > 0 && <SignalList label="Emerging Demand" items={s.emergingDemand} />}
                </div>
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="done-section-label text-primary">Recommended Next Action</p>
                    <p className="mt-1 text-xs text-foreground/80">{s.recommendedNextAction}</p>
                  </div>
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                    <p className="done-section-label text-violet-400">Recommended Next Test</p>
                    <p className="mt-1 text-xs text-foreground/80">{s.recommendedNextTest}</p>
                  </div>
                  <div className="rounded-lg border border-status-needs/20 bg-status-needs/5 p-3">
                    <p className="done-section-label text-status-needs">Belief to Challenge</p>
                    <p className="mt-1 text-xs text-foreground/80">{s.beliefToChallenge}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Stagnation Tab */}
      {tab === "stagnation" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Anti-Stagnation Protocol</h2>
          <p className="text-sm text-muted-foreground">Every repeated task is inspected: automate, eliminate, experiment, or promote to system.</p>
          {stagnationFlags.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No stagnation flags detected.</p></div>
          ) : (
            stagnationFlags.map((f) => (
              <div key={f.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-foreground">{f.taskDescription}</h3>
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: f.recommendedTransformation === "automate" ? "#3b82f6" : f.recommendedTransformation === "eliminate" ? "#ef4444" : f.recommendedTransformation === "experiment" ? "#a78bfa" : "#f59e0b" }}>
                    {f.recommendedTransformation.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat label="Repetition Count" value={f.repetitionCount} />
                  <Stat label="Predictability" value={`${(f.predictabilityScore * 100).toFixed(0)}%`} />
                </div>
                <p className="mt-3 text-sm text-foreground/80">{f.rationale}</p>
                <div className="mt-2 rounded-lg border border-border bg-muted/10 p-3">
                  <p className="done-section-label">Automation/Transformation Plan</p>
                  <p className="mt-1 text-xs text-foreground/80">{f.automationPlan}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Sprouts Tab */}
      {tab === "sprout" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Sprouting Derivative Trees</h2>
          <p className="text-sm text-muted-foreground">Derivatives branch from parent hypotheses. Employees earn research credit for useful descendants.</p>
          {sprouts.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No sprouts yet. Generate derivatives from hypotheses to build the tree.</p></div>
          ) : (
            <div className="card p-5">
              <div className="space-y-2">
                {sprouts.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-3" style={{ marginLeft: `${s.depth * 20}px` }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{"└".repeat(s.depth > 0 ? 1 : 0)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.status === "supported" ? "bg-status-validated/10 text-status-validated" : s.status === "falsified" ? "bg-status-blocked/10 text-status-blocked" : "bg-muted/20 text-muted-foreground"}`}>
                        {s.status}
                      </span>
                      <span className="text-xs text-muted-foreground">depth {s.depth}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground/90">{s.claim}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Modified: {s.modifiedDimension.replace(/_/g, " ")} · Credit: {s.creditEmployeeId}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Diffusion Tab */}
      {tab === "diffusion" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Staged Diffusion</h2>
          <p className="text-sm text-muted-foreground">Prevents premature standardization by controlling how discoveries spread.</p>
          {diffusionStates.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No diffusion states. Discoveries advance through stages as they are validated.</p></div>
          ) : (
            diffusionStates.map((d) => (
              <div key={d.hypothesisId} className="card p-5">
                <h3 className="font-medium text-foreground">Hypothesis: {d.hypothesisId}</h3>
                <div className="mt-3 flex items-center gap-1">
                  {DIFFUSION_STAGES.map((stage, i) => {
                    const currentIdx = DIFFUSION_STAGES.indexOf(d.stage);
                    const reached = i <= currentIdx;
                    return (
                      <div key={stage} className="flex items-center">
                        <div className={`h-2 w-2 rounded-full ${reached ? "bg-primary" : "bg-muted"}`} />
                        {i < DIFFUSION_STAGES.length - 1 && <div className={`h-0.5 w-8 ${i < currentIdx ? "bg-primary" : "bg-muted"}`} />}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Current stage: <span className="font-medium text-foreground">{d.stage.replace(/_/g, " ")}</span></p>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Replicating" value={d.replicatingEmployees.length} />
                  <Stat label="Mutating" value={d.mutatingEmployees.length} />
                  <Stat label="Falsifying" value={d.falsifyingEmployees.length} />
                  <Stat label="Failure Testing" value={d.failureTestEmployees.length} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Anti-Gaming Tab */}
      {tab === "antigaming" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Anti-Gaming Controls</h2>
          <p className="text-sm text-muted-foreground">Separates activity from effort, effort from evidence, evidence from causality.</p>
          {antiGamingChecks.length === 0 ? (
            <div className="card p-8 text-center"><p className="text-muted-foreground">No anti-gaming checks yet. Checks run when experiments complete.</p></div>
          ) : (
            antiGamingChecks.map((c) => (
              <div key={c.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-foreground">Check for {c.experimentId}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.passed ? "bg-status-validated/10 text-status-validated" : "bg-status-blocked/10 text-status-blocked"}`}>
                    {c.passed ? "PASSED" : "FAILED"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <CheckItem label="Pre-registered conditions" passed={c.preRegisteredConditions} />
                  <CheckItem label="Control population used" passed={c.controlPopulationUsed} />
                  <CheckItem label="Holdout testing" passed={c.holdoutTestingUsed} />
                  <CheckItem label="Randomized assignment" passed={c.randomizedAssignment} />
                  <CheckItem label="No anomaly detected" passed={!c.anomalyDetected} />
                  <CheckItem label="No duplicate experiment" passed={!c.duplicateExperiment} />
                  <CheckItem label="Negative finding reported" passed={c.negativeFindingReported} />
                  <Stat label="Selective reporting penalty" value={c.selectiveReportingPenalty} />
                  <Stat label="Outcome delay window" value={`${c.outcomeDelayWindow}d`} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="done-section-label">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${value * 100}%` }} />
        </div>
        <span className="text-xs text-foreground/80">{(value * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="done-section-label">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground/90">{value}</p>
    </div>
  );
}

function SignalList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="done-section-label">{label}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {items.map((item, i) => <li key={i}>· {item}</li>)}
      </ul>
    </div>
  );
}

function CheckItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${passed ? "bg-status-validated" : "bg-status-blocked"}`} />
      <span className="text-xs text-foreground/80">{label}</span>
    </div>
  );
}
