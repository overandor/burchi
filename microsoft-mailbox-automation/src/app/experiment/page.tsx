export const dynamic = "force-dynamic";

import { buildAuditExperiments } from "@/lib/experiment/audit";
import { getTruthState, classifyCausalReveal } from "@/lib/experiment/truth-state";
import type { CausalReveal } from "@/lib/experiment/truth-state";
import { listExperiments, governedExperimentsHealth } from "@/lib/experiment/governed-store";
import { designFieldCompleteness, DEVELOPMENT_ENVIRONMENT_STATUS } from "@/lib/experiment/governed-types";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SPINOR Experiments — Public Audit",
  description: "Auditable view of active and completed SPINOR experiments, including hypothesis, treatment/control, assignment policy, observed outcomes, causal attribution, replication status, reverse-falsification tests, and execution receipts.",
};

function formatPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

const REVEAL_LABELS: Record<CausalReveal, { label: string; color: string }> = {
  rejected: { label: "Rejected", color: "text-destructive border-destructive/30 bg-destructive/10" },
  inconclusive: { label: "Inconclusive", color: "text-muted-foreground border-muted-foreground/30 bg-muted/10" },
  promising: { label: "Internal Signal", color: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  replicated: { label: "Replicated", color: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  golden_node_candidate: { label: "Golden Node Candidate", color: "text-primary border-primary/30 bg-primary/10" },
  golden_node: { label: "Golden Node", color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  compliance_blocked: { label: "Compliance Blocked", color: "text-destructive border-destructive/30 bg-destructive/10" },
};

export default function ExperimentAuditPage() {
  const experiments = buildAuditExperiments();
  const truth = getTruthState();
  const governed = listExperiments();
  const govHealth = governedExperimentsHealth();

  if (experiments.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">SPINOR Experiment Audit</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Public audit view of hypothesis assignments, outcomes, causal attribution, and execution provenance.
          </p>
        </header>
        <div className="glass-card p-10 text-center">
          <p className="text-lg font-medium text-muted-foreground">No experiments found.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Experiments appear when hypotheses are assigned and outcomes are recorded.
          </p>
          <div className="mt-6">
            <a href="/experiment/record" className="btn btn-primary inline-block">Record an outcome</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {/* Truth-state banner */}
      {truth.isDevelopmentEvidence && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-500">
            DEVELOPMENT EVIDENCE PROVIDER
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Records may not survive redeployment. Organization isolation is not yet storage-enforced.
            No production experiment may be activated. Displayed examples are labeled demonstration data.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span className={truth.durableStorageConnected ? "text-emerald-500" : "text-destructive"}>
              {truth.durableStorageConnected ? "✓" : "✗"} Durable storage
            </span>
            <span className={truth.authEnforced ? "text-emerald-500" : "text-destructive"}>
              {truth.authEnforced ? "✓" : "✗"} Auth enforced
            </span>
            <span className={truth.orgIsolationVerified ? "text-emerald-500" : "text-destructive"}>
              {truth.orgIsolationVerified ? "✓" : "✗"} Org isolation
            </span>
            <span className={truth.evidenceProvenanceVerified ? "text-emerald-500" : "text-destructive"}>
              {truth.evidenceProvenanceVerified ? "✓" : "✗"} Provenance verified
            </span>
          </div>
        </div>
      )}

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">SPINOR Experiment Audit</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {governed.length} governed experiment{governed.length !== 1 ? "s" : ""} · {experiments.length} legacy audit experiment{experiments.length !== 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/experiment/new" className="btn btn-primary self-start">+ New Governed Experiment</Link>
          <a href="/experiment/record" className="btn btn-ghost self-start">Record outcome</a>
        </div>
      </header>

      {/* Governed experiments section */}
      {governed.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Governed Experiment Objects</h2>
          <div className="space-y-3">
            {governed.map((exp) => {
              const designCheck = designFieldCompleteness(exp.design);
              return (
                <Link key={exp.id} href={`/experiment/${encodeURIComponent(exp.id)}`} className="glass-card glass-card-hover block p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-foreground text-sm">{exp.claimProse || exp.claim.population || exp.id}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`badge ${exp.experimentState === "active" ? "badge-green" : exp.experimentState === "blocked" ? "badge-red" : "border-muted-foreground/20 bg-muted/10 text-muted-foreground"}`}>{exp.experimentState.replace(/_/g, " ")}</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">compliance: {exp.complianceState.replace(/_/g, " ")}</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">v{exp.version}</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{exp.evidenceClass.replace(/_/g, " ")}</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{exp.events.length} events</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{exp.confounders.length} confounders</span>
                        {designCheck.incomplete > 0 && (
                          <span className="badge badge-amber">{designCheck.incomplete} incomplete fields</span>
                        )}
                        {exp.parentExperimentId && (
                          <span className="badge badge-violet">derivative</span>
                        )}
                        {exp.replicationOfId && (
                          <span className="badge badge-cyan">replication</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{exp.id}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {governed.length > 0 && (
        <div className="mb-8 border-t border-border/50 pt-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Legacy Audit Experiments</h2>
        </div>
      )}

      <div className="space-y-8">
        {experiments.map((exp) => {
          const h = exp.assignment ? exp.hypothesisId : exp.spin?.hypothesisId;
          const status = exp.outcome
            ? exp.outcome.falsified
              ? "falsified"
              : "observed"
            : exp.assignment?.state || exp.spin?.state || "draft";
          const reveal = classifyCausalReveal(exp.outcome, exp.attribution, exp.spin);
          const revealInfo = REVEAL_LABELS[reveal];

          return (
            <article key={exp.id} className="glass-card p-6" data-experiment-id={exp.id}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-foreground">
                    <Link href={`/experiment/${encodeURIComponent(exp.id)}`} className="hover:underline">
                      {exp.claim}
                    </Link>
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground font-mono">experiment_id: {exp.id}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="badge border-primary/30 bg-primary/10 text-primary">{exp.assignment?.kind || exp.spin?.state || "experiment"}</span>
                    <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{status}</span>
                    <span className={`badge ${revealInfo.color}`}>{revealInfo.label}</span>
                    {exp.assignment && (
                      <>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">Trial {exp.assignment.trialNumber}</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{exp.assignment.evaluationPeriodDays}d window</span>
                        <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{exp.participants.length} participants</span>
                      </>
                    )}
                    {exp.spin && (
                      <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">
                        replication {exp.spin.replicationCount}/{exp.spin.requiredReplications}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Hypothesis and design */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Hypothesis &amp; Design</h3>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Hypothesis</dt>
                      <dd className="text-foreground">{exp.claim}</dd>
                    </div>
                    {exp.intervention && (
                      <div>
                        <dt className="text-muted-foreground">Treatment / Intervention</dt>
                        <dd className="text-foreground">{exp.intervention}</dd>
                      </div>
                    )}
                    {exp.control && (
                      <div>
                        <dt className="text-muted-foreground">Control</dt>
                        <dd className="text-foreground">{exp.control}</dd>
                      </div>
                    )}
                    {exp.population && (
                      <div>
                        <dt className="text-muted-foreground">Population</dt>
                        <dd className="text-foreground">{exp.population}</dd>
                      </div>
                    )}
                    {exp.primaryOutcome && (
                      <div>
                        <dt className="text-muted-foreground">Primary success metric</dt>
                        <dd className="text-foreground">{exp.primaryOutcome}</dd>
                      </div>
                    )}
                    {exp.complianceBoundary && (
                      <div>
                        <dt className="text-muted-foreground">Compliance boundary</dt>
                        <dd className="text-foreground">{exp.complianceBoundary}</dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* Assignment policy and participants */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Assignment Policy &amp; Agents</h3>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Owner / Agent</dt>
                      <dd className="text-foreground">{exp.ownerEmployeeId}</dd>
                    </div>
                    {exp.assignment && (
                      <>
                        <div>
                          <dt className="text-muted-foreground">Allocation reason</dt>
                          <dd className="text-foreground">{exp.assignment.allocationReason}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Innovation window</dt>
                          <dd className="text-foreground">{(exp.assignment.innovationWindow || []).join(", ") || "fixed"}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt className="text-muted-foreground">Eligible participants</dt>
                      <dd className="text-foreground">
                        {exp.participants.length > 0 ? exp.participants.join(", ") : "all accounts"}
                      </dd>
                    </div>
                    {exp.knownConfounders.length > 0 && (
                      <div>
                        <dt className="text-muted-foreground">Known confounders</dt>
                        <dd className="text-foreground">{exp.knownConfounders.join("; ")}</dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* Observed result */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Observed Result</h3>
                  {exp.outcome ? (
                    <dl className="space-y-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Outcome</dt>
                        <dd className="text-foreground">{exp.outcome.outcomeDescription}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Success kind</dt>
                        <dd className="text-foreground">{exp.outcome.successKind}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Falsified</dt>
                        <dd className="text-foreground">{exp.outcome.falsified ? "Yes — useful failure" : "No"}</dd>
                      </div>
                      {exp.outcome.metrics.length > 0 && (
                        <div>
                          <dt className="text-muted-foreground">Metrics</dt>
                          <dd className="text-foreground">
                            {exp.outcome.metrics.map((m, i) => (
                              <span key={i} className="mr-2 inline-block">
                                {m.metric}: {m.value} {m.unit} (baseline {m.baseline}, {m.higherIsBetter ? "higher" : "lower"} is better)
                              </span>
                            ))}
                          </dd>
                        </div>
                      )}
                      {exp.outcome.contextAtObservation?.externalFactors && (
                        <div>
                          <dt className="text-muted-foreground">External factors at observation</dt>
                          <dd className="text-foreground">{exp.outcome.contextAtObservation.externalFactors.join("; ")}</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">No outcome recorded yet.</p>
                  )}
                </section>

                {/* Causal attribution */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Causal Attribution</h3>
                  {exp.attribution ? (
                    <dl className="space-y-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Estimated causal effect</dt>
                        <dd className="text-foreground">{formatPercent(exp.attribution.estimatedEffect)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Attribution confidence</dt>
                        <dd className="text-foreground">{formatPercent(exp.attribution.attributionConfidence)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Responsible factor</dt>
                        <dd className="text-foreground">{exp.attribution.responsibleFactor.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Method</dt>
                        <dd className="text-foreground">{exp.attribution.method.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Counterfactual estimate</dt>
                        <dd className="text-foreground">{exp.attribution.counterfactualEstimate}</dd>
                      </div>
                      {exp.attribution.unexplainedVariance != null && (
                        <div>
                          <dt className="text-muted-foreground">Unexplained variance</dt>
                          <dd className="text-foreground">{formatPercent(exp.attribution.unexplainedVariance)}</dd>
                        </div>
                      )}
                      {exp.attribution.reasoning && (
                        <div>
                          <dt className="text-muted-foreground">Reasoning</dt>
                          <dd className="text-foreground whitespace-pre-wrap">{exp.attribution.reasoning}</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">No attribution computed yet.</p>
                  )}
                </section>

                {/* Replication and reverse test */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Replication &amp; Reverse-Falsification</h3>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Replication status</dt>
                      <dd className="text-foreground">
                        {exp.spin
                          ? `${exp.spin.replicationCount} of ${exp.spin.requiredReplications} replications completed · state: ${exp.spin.state}`
                          : "Not yet tracked in SPINOR"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Evidence tier</dt>
                      <dd className="text-foreground">{exp.spin?.evidenceTier || "observation"}</dd>
                    </div>
                    {exp.reverseTest ? (
                      <>
                        <div>
                          <dt className="text-muted-foreground">Reverse test status</dt>
                          <dd className="text-foreground">{exp.reverseTest.status}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Mission class</dt>
                          <dd className="text-foreground">{exp.reverseTest.testMissionClass}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Tester</dt>
                          <dd className="text-foreground">{exp.reverseTest.testerId || "unassigned"}</dd>
                        </div>
                        {exp.reverseTest.result != null && (
                          <div>
                            <dt className="text-muted-foreground">Reverse test result</dt>
                            <dd className="text-foreground">{exp.reverseTest.result ? "Passed" : "Failed"}</dd>
                          </div>
                        )}
                        {exp.reverseTest.failureConditions.length > 0 && (
                          <div>
                            <dt className="text-muted-foreground">Failure conditions</dt>
                            <dd className="text-foreground">{exp.reverseTest.failureConditions.join("; ")}</dd>
                          </div>
                        )}
                        {exp.reverseTest.successConditions.length > 0 && (
                          <div>
                            <dt className="text-muted-foreground">Success conditions</dt>
                            <dd className="text-foreground">{exp.reverseTest.successConditions.join("; ")}</dd>
                          </div>
                        )}
                        {exp.reverseTest.deadline && (
                          <div>
                            <dt className="text-muted-foreground">Deadline</dt>
                            <dd className="text-foreground">{exp.reverseTest.deadline}</dd>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <dt className="text-muted-foreground">Reverse test</dt>
                        <dd className="text-foreground">None scheduled</dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* Execution receipts */}
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Execution Receipts</h3>
                  {exp.executionReceipts.length > 0 ? (
                    <ol className="space-y-3 text-sm">
                      {exp.executionReceipts.map((r) => (
                        <li key={r.snapshotId} className="border-l-2 border-primary/30 pl-3">
                          <p className="font-medium text-foreground">
                            {r.state} · {r.actorId} ({r.actorRole})
                          </p>
                          <p className="text-muted-foreground">{r.reason}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            digest: {r.contentDigest} · previous: {r.previousDigest || "genesis"} · {new Date(r.timestamp).toISOString()}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground">No provenance snapshots recorded yet.</p>
                  )}
                </section>
              </div>

              {exp.assignment && (
                <div className="mt-6 border-t border-border pt-4 text-right">
                  <a href={`/experiment/record?employeeId=${encodeURIComponent(exp.assignment.employeeId)}`} className="btn btn-ghost text-sm">
                    Record outcome for this assignment
                  </a>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
