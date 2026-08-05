"use client";

import { useCallback, useEffect, useState } from "react";
import { SPIN, SPINState, EvidenceTier, AttributionClaim } from "@/lib/spinor/spin";
import { spinSummary } from "@/lib/spinor/spin-engine";

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  prior_art_checked: "Prior Art Checked",
  novelty_qualified: "Novelty Qualified",
  eligible: "Employee Eligible",
  assigned: "Mission Assigned",
  human_modified: "Human Modified",
  preregistered: "Pre-Registered",
  executing: "Executing",
  observed: "Outcome Observed",
  attributed: "Attributed",
  replication_pending: "Replication Required",
  replicated: "Replicated",
  golden_node_candidate: "Golden Node Candidate",
  systemization_pending: "Systemization Pending",
  automated: "Automated",
  channel_candidate: "Channel Candidate",
  reverse_test_required: "Reverse Test Required",
  adversarial_execution: "Adversarial Execution",
  revalidated: "Revalidated",
  narrowed: "Narrowed",
  rolled_back: "Rolled Back",
  retired: "Retired",
  research: "Research Renewal",
};

const STATE_COLORS: Record<string, string> = {
  draft: "#64748b",
  prior_art_checked: "#64748b",
  novelty_qualified: "#0ea5e9",
  eligible: "#0ea5e9",
  assigned: "#0ea5e9",
  human_modified: "#8b5cf6",
  preregistered: "#8b5cf6",
  executing: "#f59e0b",
  observed: "#f59e0b",
  attributed: "#f59e0b",
  replication_pending: "#f59e0b",
  replicated: "#10b981",
  golden_node_candidate: "#10b981",
  systemization_pending: "#10b981",
  automated: "#10b981",
  channel_candidate: "#10b981",
  reverse_test_required: "#ef4444",
  adversarial_execution: "#ef4444",
  revalidated: "#22c55e",
  narrowed: "#f97316",
  rolled_back: "#dc2626",
  retired: "#475569",
  research: "#6366f1",
};

const EVIDENCE_LABELS: Record<string, string> = {
  observed: "Observed",
  associated: "Associated",
  supported: "Supported",
  experimentally_demonstrated: "Experimentally Demonstrated",
  replicated: "Replicated",
};

const FORWARD_STATES = [
  "draft", "prior_art_checked", "novelty_qualified", "eligible",
  "assigned", "human_modified", "preregistered", "executing",
  "observed", "attributed", "replication_pending", "replicated",
];

const REVERSE_STATES = [
  "golden_node_candidate", "systemization_pending", "automated",
  "channel_candidate", "reverse_test_required", "adversarial_execution",
];

const TERMINAL_STATES = ["revalidated", "narrowed", "rolled_back", "retired", "research"];

interface SpinWithClaims {
  spin: SPIN;
  claims: AttributionClaim[];
}

export default function SpinLifecyclePage() {
  const [spins, setSpins] = useState<SPIN[]>([]);
  const [selected, setSelected] = useState<SpinWithClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    try {
      const [spinsRes, statsRes] = await Promise.all([
        fetch("/api/spin/spins?summary=false"),
        fetch("/api/spin/dashboard"),
      ]);
      if (!spinsRes.ok) throw new Error(`HTTP ${spinsRes.status}`);
      const spinsData = await spinsRes.json();
      const statsData = await statsRes.json();
      setSpins(spinsData.spins || []);
      setStats(statsData);

      // Auto-select first spin and load its claims
      if (spinsData.spins?.length > 0 && !selected) {
        const first = spinsData.spins[0];
        const claimsRes = await fetch(`/api/spin/spins/${first.spinId}?claims=true`);
        if (claimsRes.ok) {
          const claimsData = await claimsRes.json();
          setSelected(claimsData);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  async function selectSpin(spin: SPIN) {
    try {
      const res = await fetch(`/api/spin/spins/${spin.spinId}?claims=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelected(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SPIN");
    }
  }

  async function seedDemo() {
    try {
      const res = await fetch("/api/spin/seed?force=true", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed failed");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <p className="text-muted-foreground animate-pulse">Loading SPIN lifecycle…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="glass-card p-6">
          <p className="text-destructive">{error}</p>
          <button className="btn btn-primary mt-4" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (spins.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h1 className="text-4xl font-bold tracking-tight gradient-text">SPIN Lifecycle</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The palindromic perpetual research game — every hypothesis travels from research through deployment, adversarial reverse testing, and renewal.
        </p>
        <div className="glass-card mt-8 p-12 text-center">
          <p className="text-lg text-muted-foreground">No SPINs in the database.</p>
          <p className="mt-2 text-sm text-muted-foreground">Seed demo data to see the full lifecycle.</p>
          <button className="btn btn-primary mt-6" onClick={seedDemo}>Seed Demo SPINs</button>
        </div>
      </div>
    );
  }

  const currentSpin = selected?.spin || spins[0];
  const currentClaims = selected?.claims || [];
  const currentStateIdx = [...FORWARD_STATES, ...REVERSE_STATES, ...TERMINAL_STATES].indexOf(currentSpin.state);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight gradient-text">SPIN Lifecycle</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Palindromic Perpetual Research Game · {String(stats?.totalSpins ?? spins.length)} SPINs · {String(stats?.reverseTestsPending ?? 0)} reverse tests pending
          </p>
        </div>
        <button className="btn btn-secondary text-sm" onClick={seedDemo}>Re-seed</button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total SPINs" value={String(stats.totalSpins || 0)} />
          <StatCard label="Reverse Tests" value={String(stats.reverseTestsPending || 0)} accent="text-orange-400" />
          <StatCard label="Chain Integrity" value={stats.chainIntegrityOk ? "Intact" : "BROKEN"} accent={stats.chainIntegrityOk ? "text-green-400" : "text-red-400"} />
          <StatCard label="DB Path" value={String((stats.db as any)?.path || "—").split("/").pop() || "—"} small />
          <StatCard label="DB Spins" value={String((stats.db as any)?.spinCount || 0)} />
          <StatCard label="DB Claims" value={String((stats.db as any)?.claimCount || 0)} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* SPIN list */}
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">SPINs</h2>
          {spins.map((spin) => {
            const isActive = currentSpin.spinId === spin.spinId;
            const color = STATE_COLORS[spin.state] || "#64748b";
            return (
              <button
                key={spin.spinId}
                onClick={() => selectSpin(spin)}
                className={`w-full text-left rounded-xl border p-3 transition-all ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  <span className="text-xs font-mono text-muted-foreground">{spin.spinId.slice(0, 16)}</span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-foreground line-clamp-2">{spin.claim}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="badge border-border text-xs" style={{ color }}>{STATE_LABELS[spin.state] || spin.state}</span>
                  <span className="text-xs text-muted-foreground">{EVIDENCE_LABELS[spin.evidenceTier] || spin.evidenceTier}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main detail */}
        <div className="lg:col-span-3 space-y-6">
          {/* Lifecycle track */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Lifecycle Track</h2>
            <div className="space-y-1">
              {/* Forward journey */}
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                <span className="text-xs text-muted-foreground mr-2 whitespace-nowrap">Forward →</span>
                {FORWARD_STATES.map((state, i) => {
                  const idx = FORWARD_STATES.indexOf(state);
                  const isCurrent = currentSpin.state === state;
                  const isPast = currentStateIdx > idx;
                  const color = STATE_COLORS[state];
                  return (
                    <div key={state} className="flex items-center">
                      <div
                        className={`flex h-7 items-center rounded-full px-2.5 text-[10px] font-medium whitespace-nowrap transition-all ${isCurrent ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                        style={{
                          background: isCurrent || isPast ? `${color}30` : "transparent",
                          color: isCurrent || isPast ? color : "#64748b",
                          border: `1px solid ${isCurrent || isPast ? color : "#334155"}`,
                          ...(isCurrent ? { boxShadow: `0 0 12px ${color}40` } : {}),
                        }}
                      >
                        {STATE_LABELS[state]}
                      </div>
                      {i < FORWARD_STATES.length - 1 && <div className="h-px w-3" style={{ background: isPast ? color : "#334155" }} />}
                    </div>
                  );
                })}
              </div>

              {/* Reverse journey */}
              <div className="flex items-center gap-1 overflow-x-auto pb-2 pt-3 border-t border-border/30">
                <span className="text-xs text-muted-foreground mr-2 whitespace-nowrap">Reverse ←</span>
                {REVERSE_STATES.map((state, i) => {
                  const idx = FORWARD_STATES.length + REVERSE_STATES.indexOf(state);
                  const isCurrent = currentSpin.state === state;
                  const isPast = currentStateIdx > idx;
                  const color = STATE_COLORS[state];
                  return (
                    <div key={state} className="flex items-center">
                      <div
                        className={`flex h-7 items-center rounded-full px-2.5 text-[10px] font-medium whitespace-nowrap transition-all ${isCurrent ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                        style={{
                          background: isCurrent || isPast ? `${color}30` : "transparent",
                          color: isCurrent || isPast ? color : "#64748b",
                          border: `1px solid ${isCurrent || isPast ? color : "#334155"}`,
                          ...(isCurrent ? { boxShadow: `0 0 12px ${color}40` } : {}),
                        }}
                      >
                        {STATE_LABELS[state]}
                      </div>
                      {i < REVERSE_STATES.length - 1 && <div className="h-px w-3" style={{ background: isPast ? color : "#334155" }} />}
                    </div>
                  );
                })}
              </div>

              {/* Terminal */}
              <div className="flex items-center gap-1 overflow-x-auto pt-3 border-t border-border/30">
                <span className="text-xs text-muted-foreground mr-2 whitespace-nowrap">Outcome</span>
                {TERMINAL_STATES.map((state) => {
                  const isCurrent = currentSpin.state === state;
                  const color = STATE_COLORS[state];
                  return (
                    <div
                      key={state}
                      className={`flex h-7 items-center rounded-full px-2.5 text-[10px] font-medium whitespace-nowrap transition-all ${isCurrent ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                      style={{
                        background: isCurrent ? `${color}30` : "transparent",
                        color: isCurrent ? color : "#475569",
                        border: `1px solid ${isCurrent ? color : "#334155"}`,
                        ...(isCurrent ? { boxShadow: `0 0 12px ${color}40` } : {}),
                      }}
                    >
                      {STATE_LABELS[state]}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Hypothesis detail */}
          <div className="glass-card p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground">Hypothesis</h2>
                <p className="mt-2 text-base text-foreground">{currentSpin.claim}</p>
              </div>
              <div className="ml-4 flex flex-col items-end gap-1">
                <span className="badge border-primary/30 bg-primary/10 text-primary">{STATE_LABELS[currentSpin.state]}</span>
                <span className="badge border-spinor-blue/30 bg-spinor-blue/10 text-xs" style={{ color: "hsl(var(--spinor-blue))" }}>
                  {EVIDENCE_LABELS[currentSpin.evidenceTier]} evidence
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailRow label="Intervention" value={currentSpin.intervention} />
              <DetailRow label="Control" value={currentSpin.control} />
              <DetailRow label="Population" value={currentSpin.population} />
              <DetailRow label="Primary Uncertainty" value={currentSpin.primaryUncertainty} />
              <DetailRow label="Compliance Boundary" value={currentSpin.complianceBoundary} />
              <DetailRow label="Employee Owner" value={currentSpin.employeeOwner} />
            </div>
          </div>

          {/* Prior art */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Prior Art & Novelty</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailRow label="Tested In Market" value={currentSpin.priorArt.testedInMarket ? "Yes" : "No"} />
              <DetailRow label="Tested In Adjacent Industries" value={currentSpin.priorArt.testedInAdjacentIndustries ? "Yes" : "No"} />
              <DetailRow label="Adjacent Support" value={currentSpin.priorArt.adjacentSupportSummary || "—"} />
              <DetailRow label="Source Domains" value={currentSpin.priorArt.sourceDomains.join(", ") || "—"} />
              <DetailRow label="Responsible Component" value={currentSpin.priorArt.responsibleComponent || "—"} />
              <DetailRow label="Novelty Delta" value={currentSpin.priorArt.noveltyDelta || "—"} accent />
            </div>
            {currentSpin.priorArt.genuinelyUnknown.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Genuinely Unknown</p>
                <ul className="mt-1 space-y-1">
                  {currentSpin.priorArt.genuinelyUnknown.map((g, i) => (
                    <li key={i} className="text-sm text-foreground">• {g}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Attribution claims */}
          {currentClaims.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-foreground">Attribution Claims ({currentClaims.length})</h2>
              <div className="mt-4 space-y-3">
                {currentClaims.map((claim) => (
                  <div key={claim.claimId} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">{claim.claimId.slice(0, 18)}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge border-border text-xs">{claim.method.toUpperCase()}</span>
                        {claim.falsificationSurvived ? (
                          <span className="badge border-green-500/30 bg-green-500/10 text-green-400 text-xs">Falsification Survived</span>
                        ) : (
                          <span className="badge border-red-500/30 bg-red-500/10 text-red-400 text-xs">Falsified</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <StatMini label="Outcome" value={claim.outcomeValue?.toFixed(3) || "—"} />
                      <StatMini label="Counterfactual" value={claim.counterfactualEstimate?.toFixed(3) || "—"} />
                      <StatMini label="Causal Effect" value={claim.causalEffect?.toFixed(3) || "—"} accent="text-green-400" />
                      <StatMini label="Confidence" value={`${(claim.confidence * 100).toFixed(0)}%`} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {claim.testedBy.map((t) => (
                        <span key={t} className="badge border-border text-xs">{t}</span>
                      ))}
                      {claim.segments.map((s) => (
                        <span key={s} className="badge border-border text-xs">{s}</span>
                      ))}
                      {claim.territories.map((t) => (
                        <span key={t} className="badge border-border text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reverse test */}
          {currentSpin.reverseTest && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-foreground">Compulsory Reverse Test</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Promotion-triggered reverse falsification — the most distinctive operational mechanism in SPINOR.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <DetailRow label="Status" value={currentSpin.reverseTest.status} />
                <DetailRow label="Deadline" value={new Date(currentSpin.reverseTest.deadline).toLocaleDateString()} />
                <DetailRow label="Result" value={currentSpin.reverseTest.result === null ? "Pending" : currentSpin.reverseTest.result ? "Passed" : "Failed"} />
              </div>
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Failure Conditions</p>
                <ul className="mt-1 space-y-1">
                  {currentSpin.reverseTest.failureConditions.map((c, i) => (
                    <li key={i} className="text-sm text-red-400">✗ {c}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Success Conditions</p>
                <ul className="mt-1 space-y-1">
                  {currentSpin.reverseTest.successConditions.map((c, i) => (
                    <li key={i} className="text-sm text-green-400">✓ {c}</li>
                  ))}
                </ul>
              </div>
              {Object.keys(currentSpin.reverseTest.evidence).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Evidence</p>
                  <pre className="mt-1 rounded-lg bg-muted/20 p-3 text-xs overflow-x-auto">{JSON.stringify(currentSpin.reverseTest.evidence, null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          {/* Contribution ledger */}
          {currentSpin.contributions.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-foreground">Contribution Ledger ({currentSpin.contributions.length})</h2>
              <p className="mt-1 text-xs text-muted-foreground">Append-only provenance — preserves human inventorship evidence.</p>
              <div className="mt-4 space-y-2">
                {currentSpin.contributions.map((c) => (
                  <div key={c.entryId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{c.contributorId}</span>
                        <span className="badge border-border text-xs">{c.contributorRole.replace(/_/g, " ")}</span>
                        {c.modelAssisted && (
                          <span className="badge border-purple-500/30 bg-purple-500/10 text-purple-400 text-xs">Model Assist</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-foreground">{c.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{new Date(c.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Snapshot chain */}
          {currentSpin.snapshots.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-foreground">Snapshot Chain ({currentSpin.snapshots.length})</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Content-addressed SHA-256 chain — tamper-evident provenance without blockchain.
              </p>
              <div className="mt-4 space-y-1">
                {currentSpin.snapshots.map((snap, i) => {
                  const color = STATE_COLORS[snap.state] || "#64748b";
                  return (
                    <div key={snap.snapshotId} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                      <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                      <div className="h-2 w-2 rounded-full" style={{ background: color }} />
                      <span className="text-sm font-medium" style={{ color }}>{STATE_LABELS[snap.state] || snap.state}</span>
                      <span className="text-xs text-muted-foreground flex-1 truncate">{snap.reason}</span>
                      <span className="text-xs font-mono text-muted-foreground">{snap.contentDigest.slice(0, 12)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Human modifications */}
          {currentSpin.modifications.length > 0 && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-semibold text-foreground">Human Modifications ({currentSpin.modifications.length})</h2>
              <p className="mt-1 text-xs text-muted-foreground">Structured deltas — preserves inventorship for patent analysis.</p>
              <div className="mt-4 space-y-3">
                {currentSpin.modifications.map((mod) => (
                  <div key={mod.modificationId} className="rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{mod.modifierId}</span>
                      {mod.modelAssisted && (
                        <span className="badge border-purple-500/30 bg-purple-500/10 text-purple-400 text-xs">Model Assist</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-foreground">{mod.rationale}</p>
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Changed Variables</p>
                      <div className="mt-1 space-y-1">
                        {Object.entries(mod.changedVariables).map(([key, val]) => (
                          <div key={key} className="text-xs">
                            <span className="text-muted-foreground">{key}:</span>{" "}
                            <span className="text-red-400 line-through">{String(val.from)}</span>{" "}
                            <span className="text-muted-foreground">→</span>{" "}
                            <span className="text-green-400">{String(val.to)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, small }: { label: string; value: string; accent?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold ${accent || "text-foreground"} ${small ? "text-sm truncate" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase">{label}</p>
      <p className={`mt-0.5 text-sm ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function StatMini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${accent || "text-foreground"}`}>{value}</p>
    </div>
  );
}
