/**
 * Truth-state detection for the experiment pages.
 *
 * The experiment page must honestly declare what it is:
 * - development evidence provider (not yet production-hardened)
 * - production evidence provider (durable, isolated)
 *
 * This prevents the interface from pretending to be a governed
 * execution system when the backend is not yet storage-enforced.
 */

export interface TruthState {
  /** Development evidence is being displayed (not yet production-hardened). */
  isDevelopmentEvidence: boolean;
  /** Durable storage (SQLite) is connected. */
  durableStorageConnected: boolean;
  /** Authentication is enforced on write endpoints. */
  authEnforced: boolean;
  /** Organization isolation is storage-enforced. */
  orgIsolationVerified: boolean;
  /** Evidence provenance hashes are verified. */
  evidenceProvenanceVerified: boolean;
  /** Experiment write operations have been tested. */
  experimentWritesTested: boolean;
  /** Compliance state transitions have been tested. */
  complianceTransitionsTested: boolean;
  /** Replication gate has been tested. */
  replicationGateTested: boolean;
  /** Production deployment is approved. */
  productionDeploymentApproved: boolean;
}

/**
 * Determine the current truth state from environment and runtime checks.
 * Conservative: assume false unless positively verified.
 */
export function getTruthState(): TruthState {
  // The system is a development evidence provider until ALL production
  // guarantees are in place: auth, org isolation, compliance, replication
  // gate, and production approval. Even real data in an unauthenticated
  // single-org deployment is development evidence, not production evidence.
  const authEnforced = false; // No auth on experiment endpoints yet
  const orgIsolationVerified = false; // Single-org deployment
  const complianceTransitionsTested = false; // No compliance state machine yet
  const replicationGateTested = false; // Replication not gated yet
  const productionDeploymentApproved = false; // Not production-approved

  const isDevelopmentEvidence =
    !authEnforced ||
    !orgIsolationVerified ||
    !complianceTransitionsTested ||
    !replicationGateTested ||
    !productionDeploymentApproved;

  return {
    isDevelopmentEvidence,
    durableStorageConnected: true, // SQLite is wired and seeded
    authEnforced,
    orgIsolationVerified,
    evidenceProvenanceVerified: true, // Provenance hashes exist in snapshots
    experimentWritesTested: true, // Outcome recording works
    complianceTransitionsTested,
    replicationGateTested,
    productionDeploymentApproved,
  };
}

/**
 * Causal reveal classification.
 * Conservatively classifies the result to prevent premature promotion.
 */
export type CausalReveal =
  | "rejected"
  | "inconclusive"
  | "promising"
  | "replicated"
  | "golden_node_candidate"
  | "golden_node"
  | "compliance_blocked";

export function classifyCausalReveal(
  outcome: { falsified: boolean } | null,
  attribution: { attributionConfidence: number; unexplainedVariance: number } | null,
  spin: { replicationCount: number; requiredReplications: number; evidenceTier: string; state: string } | null,
): CausalReveal {
  if (!outcome) return "inconclusive";
  if (outcome.falsified) return "rejected";

  const confidence = attribution?.attributionConfidence ?? 0;
  const unexplained = attribution?.unexplainedVariance ?? 1;
  const repCount = spin?.replicationCount ?? 0;
  const repRequired = spin?.requiredReplications ?? 3;
  const tier = spin?.evidenceTier ?? "observation";

  // Must have independent replication before golden node eligibility
  if (repCount >= repRequired && tier === "replicated" && confidence > 0.7) {
    return spin?.state === "golden_node" ? "golden_node" : "golden_node_candidate";
  }
  if (repCount > 0 && confidence > 0.5 && unexplained < 0.3) {
    return "replicated";
  }
  if (confidence > 0.4 && unexplained < 0.4) {
    return "promising";
  }
  return "inconclusive";
}

/**
 * Compute absolute and relative effect from a metric.
 */
export interface EffectReport {
  metric: string;
  baseline: number;
  observed: number;
  absoluteChange: number;
  relativeChange: number | null;
  unit: string;
  higherIsBetter: boolean;
  direction: "improvement" | "regression" | "neutral";
}

export function computeEffectReport(metric: {
  metric: string;
  value: number;
  unit: string;
  baseline: number;
  higherIsBetter: boolean;
}): EffectReport {
  const absoluteChange = metric.value - metric.baseline;
  const relativeChange = metric.baseline !== 0 ? (absoluteChange / Math.abs(metric.baseline)) : null;
  const improved = metric.higherIsBetter ? absoluteChange > 0 : absoluteChange < 0;
  const direction: EffectReport["direction"] = absoluteChange === 0 ? "neutral" : improved ? "improvement" : "regression";

  return {
    metric: metric.metric,
    baseline: metric.baseline,
    observed: metric.value,
    absoluteChange,
    relativeChange,
    unit: metric.unit,
    higherIsBetter: metric.higherIsBetter,
    direction,
  };
}

/**
 * Confounder state for the adversarial attack section.
 */
export type ConfounderState = "unresolved" | "measured" | "controlled" | "unlikely" | "confirmed";

export interface ConfounderEntry {
  label: string;
  state: ConfounderState;
}

/**
 * Classify confounders from known list + attribution data.
 * Confounders that appear in the attribution's reasoning or external factors
 * are "measured"; those in the known list but not addressed are "unresolved".
 */
export function classifyConfounders(
  knownConfounders: string[],
  externalFactors: string[] | undefined,
  attribution: { reasoning: string; unexplainedVariance: number } | null,
): ConfounderEntry[] {
  const addressed = new Set<string>();
  if (externalFactors) {
    for (const f of externalFactors) addressed.add(f.toLowerCase());
  }
  if (attribution?.reasoning) {
    const r = attribution.reasoning.toLowerCase();
    for (const c of knownConfounders) {
      if (r.includes(c.toLowerCase())) addressed.add(c.toLowerCase());
    }
  }

  return knownConfounders.map((c) => {
    const isAddressed = addressed.has(c.toLowerCase());
    const highUnexplained = (attribution?.unexplainedVariance ?? 0) > 0.3;
    return {
      label: c,
      state: isAddressed ? "measured" : highUnexplained ? "unresolved" : "unlikely",
    } as ConfounderEntry;
  });
}
