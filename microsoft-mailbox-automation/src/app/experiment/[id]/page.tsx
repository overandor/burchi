export const dynamic = "force-dynamic";

import { getAuditExperimentById } from "@/lib/experiment/audit";
import { getTruthState, classifyCausalReveal, computeEffectReport, classifyConfounders } from "@/lib/experiment/truth-state";
import type { CausalReveal, ConfounderState } from "@/lib/experiment/truth-state";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  params: { id: string };
}

function formatPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function formatSignedPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

const REVEAL_LABELS: Record<CausalReveal, { label: string; color: string; description: string }> = {
  rejected: { label: "Rejected", color: "text-destructive border-destructive/30 bg-destructive/10", description: "Hypothesis falsified. The intervention did not produce the expected effect." },
  inconclusive: { label: "Inconclusive", color: "text-muted-foreground border-muted-foreground/30 bg-muted/10", description: "Evidence is insufficient to support or reject the hypothesis." },
  promising: { label: "Promising (Internal Signal)", color: "text-amber-500 border-amber-500/30 bg-amber-500/10", description: "Positive effect observed but not yet independently replicated. Remains an Internal Signal." },
  replicated: { label: "Replicated", color: "text-blue-500 border-blue-500/30 bg-blue-500/10", description: "Effect reproduced in at least one independent replication." },
  golden_node_candidate: { label: "Golden Node Candidate", color: "text-primary border-primary/30 bg-primary/10", description: "Meets replication and confidence thresholds. Eligible for Golden Node promotion." },
  golden_node: { label: "Golden Node", color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10", description: "Validated strategy. Promoted to Golden Node." },
  compliance_blocked: { label: "Compliance Blocked", color: "text-destructive border-destructive/30 bg-destructive/10", description: "Experiment blocked by compliance. No further execution permitted." },
};

const CONFOUNDER_STATE_LABELS: Record<ConfounderState, { label: string; color: string }> = {
  unresolved: { label: "Unresolved", color: "text-destructive border-destructive/30 bg-destructive/10" },
  measured: { label: "Measured", color: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  controlled: { label: "Controlled", color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  unlikely: { label: "Unlikely", color: "text-muted-foreground border-muted-foreground/20 bg-muted/10" },
  confirmed: { label: "Confirmed", color: "text-destructive border-destructive/30 bg-destructive/10" },
};

export function generateMetadata({ params }: Props): Metadata {
  return {
    title: `Experiment ${params.id} — SPINOR Audit`,
  };
}

export default function ExperimentDetailPage({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const exp = getAuditExperimentById(id);
  if (!exp) notFound();

  const truth = getTruthState();
  const reveal = classifyCausalReveal(exp.outcome, exp.attribution, exp.spin);
  const revealInfo = REVEAL_LABELS[reveal];
  const effectReports = exp.outcome?.metrics.map(computeEffectReport) ?? [];
  const confounders = classifyConfounders(
    exp.knownConfounders,
    exp.outcome?.contextAtObservation?.externalFactors,
    exp.attribution,
  );
  const modelContributions = exp.spin?.contributions?.filter((c) => c.modelAssisted) ?? [];
  const humanContributions = exp.spin?.contributions?.filter((c) => !c.modelAssisted) ?? [];
  const humanModifications = exp.spin?.modifications ?? [];

  const status = exp.outcome
    ? exp.outcome.falsified
      ? "falsified"
      : "observed"
    : exp.assignment?.state || exp.spin?.state || "draft";

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
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
            <span className={truth.experimentWritesTested ? "text-emerald-500" : "text-destructive"}>
              {truth.experimentWritesTested ? "✓" : "✗"} Writes tested
            </span>
            <span className={truth.complianceTransitionsTested ? "text-emerald-500" : "text-destructive"}>
              {truth.complianceTransitionsTested ? "✓" : "✗"} Compliance tested
            </span>
            <span className={truth.replicationGateTested ? "text-emerald-500" : "text-destructive"}>
              {truth.replicationGateTested ? "✓" : "✗"} Replication gate
            </span>
            <span className={truth.productionDeploymentApproved ? "text-emerald-500" : "text-destructive"}>
              {truth.productionDeploymentApproved ? "✓" : "✗"} Production approved
            </span>
          </div>
        </div>
      )}

      <div className="mb-6">
        <Link href="/experiment" className="text-sm text-muted-foreground hover:text-foreground">
          ← All experiments
        </Link>
      </div>

      {/* Structured experiment header */}
      <header className="mb-8 glass-card p-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{exp.claim}</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <p className="text-muted-foreground">Experiment ID</p>
            <p className="font-mono text-foreground">{exp.id}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Hypothesis ID</p>
            <p className="font-mono text-foreground">{exp.hypothesisId}</p>
          </div>
          <div>
            <p className="text-muted-foreground">SPIN ID</p>
            <p className="font-mono text-foreground">{exp.spin?.spinId || "Not yet created"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Owner</p>
            <p className="text-foreground">{exp.ownerEmployeeId}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Current state</p>
            <p className="text-foreground">{status}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Evidence class</p>
            <p className="text-foreground">{exp.spin?.evidenceTier || "observation"}</p>
          </div>
          {exp.assignment && (
            <>
              <div>
                <p className="text-muted-foreground">Trial</p>
                <p className="text-foreground">{exp.assignment.trialNumber}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Observation window</p>
                <p className="text-foreground">{exp.assignment.evaluationPeriodDays}d</p>
              </div>
              <div>
                <p className="text-muted-foreground">Assigned at</p>
                <p className="text-foreground">{new Date(exp.assignment.assignedAt).toISOString().split("T")[0]}</p>
              </div>
            </>
          )}
          {exp.spin && (
            <div>
              <p className="text-muted-foreground">Created at</p>
              <p className="text-foreground">{new Date(exp.spin.createdAt).toISOString().split("T")[0]}</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="badge border-primary/30 bg-primary/10 text-primary">{exp.assignment?.kind || exp.spin?.state || "experiment"}</span>
          <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">{status}</span>
          <span className={`badge ${revealInfo.color}`}>{revealInfo.label}</span>
          {exp.spin && (
            <span className="badge border-muted-foreground/20 bg-muted/10 text-muted-foreground">
              replication {exp.spin.replicationCount}/{exp.spin.requiredReplications}
            </span>
          )}
        </div>
      </header>

      {/* Causal reveal classification */}
      <section className="mb-8 glass-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Causal Reveal</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className={`badge ${revealInfo.color} text-sm`}>{revealInfo.label}</span>
          <p className="text-sm text-muted-foreground">{revealInfo.description}</p>
        </div>
        <p className="mt-4 text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
          An initial result remains an <strong>Internal Signal</strong> until a properly designed experiment
          and independent replication satisfy the configured evidence thresholds.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Structured claim (PICO) */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Structured Claim</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Population</dt>
              <dd className="text-foreground">{exp.population || "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Intervention</dt>
              <dd className="text-foreground">{exp.intervention || "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Comparison</dt>
              <dd className="text-foreground">{exp.control || "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Outcome</dt>
              <dd className="text-foreground">{exp.primaryOutcome || "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Compliance boundary</dt>
              <dd className="text-foreground">{exp.complianceBoundary || "Not specified"}</dd>
            </div>
          </dl>
        </section>

        {/* Assignment policy */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Assignment Policy &amp; Agents</h2>
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
              <dd className="text-foreground">{exp.participants.length > 0 ? exp.participants.join(", ") : "all accounts"}</dd>
            </div>
          </dl>
        </section>

        {/* Effect reporting */}
        <section className="glass-card p-6 space-y-4 md:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Effect Reporting</h2>
          {effectReports.length > 0 ? (
            <div className="space-y-4">
              {effectReports.map((er, i) => (
                <div key={i} className="border-l-2 border-primary/30 pl-4">
                  <p className="font-medium text-foreground">{er.metric}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground">Baseline</p>
                      <p className="text-foreground">{er.baseline} {er.unit}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Observed</p>
                      <p className="text-foreground">{er.observed} {er.unit}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Absolute change</p>
                      <p className={er.direction === "improvement" ? "text-emerald-500" : er.direction === "regression" ? "text-destructive" : "text-muted-foreground"}>
                        {er.absoluteChange > 0 ? "+" : ""}{er.absoluteChange} {er.unit}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Relative change</p>
                      <p className={er.direction === "improvement" ? "text-emerald-500" : er.direction === "regression" ? "text-destructive" : "text-muted-foreground"}>
                        {er.relativeChange != null ? formatSignedPercent(er.relativeChange) : "N/A (baseline=0)"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Direction: {er.direction} ({er.higherIsBetter ? "higher is better" : "lower is better"})
                  </p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground border-l-2 border-amber-500/30 pl-3">
                Confidence intervals, missing outcome counts, and sample sizes are not yet reported.
                Do not interpret these results as validated without independent replication.
              </p>
            </div>
          ) : exp.outcome ? (
            <p className="text-sm text-muted-foreground">No quantitative metrics recorded.</p>
          ) : (
            <p className="text-sm text-muted-foreground">No outcome recorded yet.</p>
          )}
          {exp.outcome && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">Outcome description</p>
              <p className="mt-1 text-sm text-foreground">{exp.outcome.outcomeDescription}</p>
              {exp.outcome.falsified && (
                <p className="mt-2 text-sm text-destructive">
                  Falsified: {exp.outcome.falsificationEvidence || "No evidence provided"}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Causal attribution */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Causal Attribution</h2>
          {exp.attribution ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Estimated effect</dt>
                <dd className="text-foreground">{formatPercent(exp.attribution.estimatedEffect)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Confidence</dt>
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

        {/* Confounder attack */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Confounder Attack</h2>
          <p className="text-xs text-muted-foreground">
            The system actively argues against its own positive result. Each confounder must be resolved before attribution confidence can increase.
          </p>
          {confounders.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {confounders.map((c, i) => {
                const stateInfo = CONFOUNDER_STATE_LABELS[c.state];
                return (
                  <li key={i} className="flex items-center justify-between">
                    <span className="text-foreground">{c.label}</span>
                    <span className={`badge ${stateInfo.color}`}>{stateInfo.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No confounders recorded.</p>
          )}
          {exp.outcome?.contextAtObservation?.externalFactors && exp.outcome.contextAtObservation.externalFactors.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">External factors at observation</p>
              <p className="mt-1 text-sm text-foreground">{exp.outcome.contextAtObservation.externalFactors.join("; ")}</p>
            </div>
          )}
        </section>

        {/* Prior-art classification */}
        {exp.priorArt && (
          <section className="glass-card p-6 space-y-4 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Prior-Art Classification</h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Tested in market</dt>
                <dd className="text-foreground">{exp.priorArt.testedInMarket ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tested in adjacent industries</dt>
                <dd className="text-foreground">{exp.priorArt.testedInAdjacentIndustries ? "Yes" : "No"}</dd>
              </div>
              {exp.priorArt.adjacentSupportSummary && (
                <div>
                  <dt className="text-muted-foreground">Adjacent support summary</dt>
                  <dd className="text-foreground">{exp.priorArt.adjacentSupportSummary}</dd>
                </div>
              )}
              {exp.priorArt.sourceDomains.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Source domains</dt>
                  <dd className="text-foreground">{exp.priorArt.sourceDomains.join(", ")}</dd>
                </div>
              )}
              {exp.priorArt.noveltyDelta && (
                <div>
                  <dt className="text-muted-foreground">Experimental novelty delta</dt>
                  <dd className="text-foreground whitespace-pre-wrap">{exp.priorArt.noveltyDelta}</dd>
                </div>
              )}
              {exp.priorArt.requiredConditions.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Required conditions</dt>
                  <dd className="text-foreground">{exp.priorArt.requiredConditions.join("; ")}</dd>
                </div>
              )}
              {exp.priorArt.risksAndConfounders.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Risks and confounders</dt>
                  <dd className="text-foreground">{exp.priorArt.risksAndConfounders.join("; ")}</dd>
                </div>
              )}
              {exp.priorArt.genuinelyUnknown.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Genuinely unknown</dt>
                  <dd className="text-foreground">{exp.priorArt.genuinelyUnknown.join("; ")}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Checked by</dt>
                <dd className="text-foreground">{exp.priorArt.checkedBy}</dd>
              </div>
            </dl>
          </section>
        )}

        {/* SPIN record */}
        {exp.spin && (
          <section className="glass-card p-6 space-y-4 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">SPIN Record</h2>
            <p className="text-xs text-muted-foreground">
              The SPIN represents the full causal combination: human judgment, hypothesis version, customer context,
              territory, model assistance, execution method, timing, external conditions, assignment method, and chance.
            </p>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">SPIN ID</dt>
                <dd className="font-mono text-foreground">{exp.spin.spinId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">State</dt>
                <dd className="text-foreground">{exp.spin.state}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Evidence tier</dt>
                <dd className="text-foreground">{exp.spin.evidenceTier}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Replication</dt>
                <dd className="text-foreground">{exp.spin.replicationCount} of {exp.spin.requiredReplications} required</dd>
              </div>
              {exp.spin.strategyId && (
                <div>
                  <dt className="text-muted-foreground">Strategy ID</dt>
                  <dd className="font-mono text-foreground">{exp.spin.strategyId}</dd>
                </div>
              )}
              {exp.spin.goldenNodeId && (
                <div>
                  <dt className="text-muted-foreground">Golden Node ID</dt>
                  <dd className="font-mono text-foreground">{exp.spin.goldenNodeId}</dd>
                </div>
              )}
              {exp.spin.tags.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="text-foreground">{exp.spin.tags.join(", ")}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Human-LLM contribution separation */}
        {(modelContributions.length > 0 || humanContributions.length > 0 || humanModifications.length > 0) && (
          <section className="glass-card p-6 space-y-4 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Human–LLM Contribution Separation</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">Model Contribution</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {modelContributions.map((c) => (
                    <li key={c.entryId} className="border-l-2 border-accent/30 pl-3">
                      <p className="text-foreground">{c.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.contributorRole.replace(/_/g, " ")} · {c.contributorId}
                        {c.modelId ? ` · ${c.modelId}` : ""}
                      </p>
                    </li>
                  ))}
                  {modelContributions.length === 0 && (
                    <li className="text-sm text-muted-foreground">No model contributions recorded.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Human Contribution</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {humanContributions.map((c) => (
                    <li key={c.entryId} className="border-l-2 border-primary/30 pl-3">
                      <p className="text-foreground">{c.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.contributorRole.replace(/_/g, " ")} · {c.contributorId}
                      </p>
                    </li>
                  ))}
                  {humanModifications.map((m) => (
                    <li key={m.modificationId} className="border-l-2 border-primary/30 pl-3">
                      <p className="text-foreground">{m.rationale}</p>
                      <p className="text-xs text-muted-foreground">
                        Modified by {m.modifierId} · {Object.keys(m.changedVariables).join(", ")}
                        {m.modelContribution ? ` · model: ${m.modelContribution}` : ""}
                      </p>
                    </li>
                  ))}
                  {humanContributions.length === 0 && humanModifications.length === 0 && (
                    <li className="text-sm text-muted-foreground">No human contributions recorded.</li>
                  )}
                </ul>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground border-l-2 border-amber-500/30 pl-3">
              The LLM must never silently alter an active protocol. Any material change must create a new hypothesis
              revision, a protocol revision, a derivative experiment, or a documented deviation.
            </p>
          </section>
        )}

        {/* Replication and reverse test */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Replication &amp; Reverse-Falsification</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Replication status</dt>
              <dd className="text-foreground">
                {exp.spin
                  ? `${exp.spin.replicationCount} of ${exp.spin.requiredReplications} replications · state: ${exp.spin.state}`
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
                {exp.reverseTest.result != null && (
                  <div>
                    <dt className="text-muted-foreground">Result</dt>
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
              </>
            ) : (
              <div>
                <dt className="text-muted-foreground">Reverse test</dt>
                <dd className="text-foreground">None scheduled</dd>
              </div>
            )}
          </dl>
        </section>

        {/* Attribution claims */}
        {exp.claims.length > 0 && (
          <section className="glass-card p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Attribution Claims</h2>
            <ul className="space-y-3 text-sm">
              {exp.claims.map((c) => (
                <li key={c.claimId} className="border-l-2 border-primary/30 pl-3">
                  <p className="font-mono text-xs text-muted-foreground">{c.claimId}</p>
                  <p className="text-foreground">
                    {c.outcomeMetric}: {c.outcomeValue} vs baseline {c.counterfactualEstimate}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Causal effect: {c.causalEffect != null ? c.causalEffect.toFixed(2) : "N/A"} · confidence: {(c.confidence * 100).toFixed(0)}% · method: {c.method}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Execution timeline */}
        <section className="glass-card p-6 space-y-4 md:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Execution Timeline</h2>
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
        <div className="mt-8 text-right">
          <a href={`/experiment/record?employeeId=${encodeURIComponent(exp.assignment.employeeId)}`} className="btn btn-primary">
            Record outcome for this assignment
          </a>
        </div>
      )}
    </main>
  );
}
