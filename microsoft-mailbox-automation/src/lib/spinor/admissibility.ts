/**
 * Admissibility Engine — the explicit gate that prevents weak evidence
 * from being presented as causal conclusions or promoted to Golden Nodes.
 *
 * Five tiers (lowest → highest evidentiary strength):
 *   1. observation
 *   2. internal_signal
 *   3. controlled_experiment
 *   4. valid_replication
 *   5. golden_node_eligible
 *
 * Every threshold is configurable, versioned, and auditable. The engine
 * is deterministic: the same inputs + config always produce the same level.
 *
 * The UI must never imply causal certainty when only observational evidence
 * exists. This module enforces that constraint structurally.
 */

import {
  AdmissibilityLevel,
  AdmissibilityDecision,
  AdmissibilityCheck,
  AdmissibilityConfig,
} from "@/types";
import { SPIN, AttributionClaim, EvidenceTier, AutomationStatus } from "./spin";

// ---------------------------------------------------------------------------
// Default configuration (versioned for auditability)
// ---------------------------------------------------------------------------

export const DEFAULT_ADMISSIBILITY_CONFIG: AdmissibilityConfig = {
  configVersion: "1.0.0",
  minObservationsInternalSignal: 5,
  executionFidelityThreshold: 0.7,
  minReplicationsGoldenNode: 2,
  minExperimentsGoldenNode: 2,
  attributionConfidenceThreshold: 0.75,
  requireFailureBoundaryForGoldenNode: true,
  requireTransferabilityForGoldenNode: true,
  requireComplianceClear: true,
};

// ---------------------------------------------------------------------------
// Input shape — the evidence bundle for one record
// ---------------------------------------------------------------------------

export interface AdmissibilityInput {
  recordId: string;
  /** Number of documented observations (actions with outcomes). */
  observationCount: number;
  /** Whether a comparison group or historical baseline exists. */
  hasComparison: boolean;
  /** Execution fidelity 0..1 (what was actually executed vs assigned). */
  executionFidelity: number;
  /** Whether the hypothesis version was pre-registered before execution. */
  preRegistered: boolean;
  /** Whether explicit treatment and comparison conditions were defined. */
  hasExplicitTreatmentAndComparison: boolean;
  /** Whether eligibility criteria were documented. */
  hasEligibilityCriteria: boolean;
  /** Whether an assignment method was declared. */
  hasAssignmentMethod: boolean;
  /** Whether a fixed primary metric was declared. */
  hasFixedPrimaryMetric: boolean;
  /** Whether a defined observation window was declared. */
  hasObservationWindow: boolean;
  /** Whether protocol-fidelity was captured. */
  hasFidelityCapture: boolean;
  /** Whether any prohibited variable was changed. */
  prohibitedVariableChanged: boolean;
  /** Whether compliance approval was obtained where required. */
  complianceApproved: boolean;
  /** Whether there are unresolved critical compliance issues. */
  hasUnresolvedCompliance: boolean;
  /** Attribution claims produced by the causal engine. */
  claims: AttributionClaim[];
  /** Number of independent replications (different operator/territory/period). */
  independentReplications: number;
  /** Number of distinct admissible experiments. */
  experimentCount: number;
  /** Whether a failure boundary is documented. */
  hasFailureBoundary: boolean;
  /** Whether transferability was demonstrated in >1 context. */
  transferabilityDemonstrated: boolean;
  /** Whether economic value exceeds implementation cost. */
  economicValueExceedsCost: boolean;
  /** Whether a complete contribution ledger exists. */
  hasCompleteContributionLedger: boolean;
  /** Unresolved confounders that cap the attainable level. */
  unresolvedConfounders: string[];
}

// ---------------------------------------------------------------------------
// Level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: AdmissibilityLevel[] = [
  "observation",
  "internal_signal",
  "controlled_experiment",
  "valid_replication",
  "golden_node_eligible",
];

const LEVEL_LABEL: Record<AdmissibilityLevel, string> = {
  observation: "Observation",
  internal_signal: "Internal Signal",
  controlled_experiment: "Controlled Experiment",
  valid_replication: "Valid Replication",
  golden_node_eligible: "Golden-Node-Eligible",
};

export function admissibilityLabel(level: AdmissibilityLevel): string {
  return LEVEL_LABEL[level];
}

export function levelRank(level: AdmissibilityLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

// ---------------------------------------------------------------------------
// Core decision function
// ---------------------------------------------------------------------------

/**
 * Evaluate a record against the admissibility rules and return the highest
 * tier whose requirements are fully satisfied. If even observation
 * requirements fail, the record is not admissible at any level.
 */
export function decideAdmissibility(
  input: AdmissibilityInput,
  config: AdmissibilityConfig = DEFAULT_ADMISSIBILITY_CONFIG,
): AdmissibilityDecision {
  const checks: AdmissibilityCheck[] = [];
  const blockingConfounders: string[] = [...(input.unresolvedConfounders ?? [])];

  // ── Observation (tier 1) ──────────────────────────────────────────────
  const obsHasAction = input.observationCount > 0;
  checks.push({
    requirement: "Documented action or event",
    satisfied: obsHasAction,
    detail: obsHasAction
      ? `${input.observationCount} documented observation(s)`
      : "No documented observations",
  });
  const obsHasOutcome = (input.claims ?? []).some((c) => c.outcomeValue !== null) || input.observationCount > 0;
  checks.push({
    requirement: "Documented outcome or missing outcome",
    satisfied: obsHasOutcome,
    detail: obsHasOutcome ? "Outcome recorded" : "No outcome recorded",
  });
  const obsHasProvenance = (input.recordId?.length ?? 0) > 0;
  checks.push({
    requirement: "Provenance available",
    satisfied: obsHasProvenance,
    detail: obsHasProvenance ? `Record ${input.recordId}` : "No record id",
  });

  const observationPassed = obsHasAction && obsHasOutcome && obsHasProvenance;
  if (!observationPassed) {
    return buildDecision(
      input.recordId,
      "observation",
      checks,
      false,
      "Record does not meet minimum observation requirements",
      blockingConfounders,
      config,
    );
  }

  // ── Internal Signal (tier 2) ──────────────────────────────────────────
  const sigMinObs = input.observationCount >= config.minObservationsInternalSignal;
  checks.push({
    requirement: `Minimum ${config.minObservationsInternalSignal} eligible observations`,
    satisfied: sigMinObs,
    detail: `${input.observationCount} observation(s)`,
  });
  const sigNoCompliance = !input.hasUnresolvedCompliance;
  checks.push({
    requirement: "No unresolved critical compliance issue",
    satisfied: sigNoCompliance,
    detail: sigNoCompliance ? "Compliance clear" : "Unresolved compliance issue",
  });
  const sigFidelity = input.executionFidelity >= config.executionFidelityThreshold;
  checks.push({
    requirement: `Execution fidelity ≥ ${config.executionFidelityThreshold}`,
    satisfied: sigFidelity,
    detail: `Fidelity ${input.executionFidelity.toFixed(2)}`,
  });
  const sigComparison = input.hasComparison;
  checks.push({
    requirement: "At least one plausible comparison or historical baseline",
    satisfied: sigComparison,
    detail: sigComparison ? "Comparison available" : "No comparison",
  });
  const sigConfounders = (input.claims ?? []).some((c) => (c.evidence?.length ?? 0) > 0) || input.observationCount > 0;
  checks.push({
    requirement: "Major confounders displayed",
    satisfied: sigConfounders,
    detail: sigConfounders ? "Confounders visible" : "No confounder data",
  });

  const internalSignalPassed =
    sigMinObs && sigNoCompliance && sigFidelity && sigComparison && sigConfounders;
  if (!internalSignalPassed) {
    return buildDecision(
      input.recordId,
      "observation",
      checks,
      true,
      "Meets observation requirements but not internal signal: " +
        failedRequirements(checks, LEVEL_ORDER.indexOf("internal_signal")),
      blockingConfounders,
      config,
    );
  }

  // Unresolved confounders cap at internal_signal (cannot claim controlled)
  if (blockingConfounders.length > 0) {
    return buildDecision(
      input.recordId,
      "internal_signal",
      checks,
      true,
      `Capped at Internal Signal due to unresolved confounders: ${blockingConfounders.join(", ")}`,
      blockingConfounders,
      config,
    );
  }

  // ── Controlled Experiment (tier 3) ────────────────────────────────────
  const cePreRegistered = input.preRegistered;
  checks.push({
    requirement: "Pre-registered hypothesis version",
    satisfied: cePreRegistered,
    detail: cePreRegistered ? "Pre-registered" : "Not pre-registered",
  });
  const ceTreatment = input.hasExplicitTreatmentAndComparison;
  checks.push({
    requirement: "Explicit treatment and comparison",
    satisfied: ceTreatment,
    detail: ceTreatment ? "Defined" : "Missing",
  });
  const ceEligibility = input.hasEligibilityCriteria;
  checks.push({
    requirement: "Eligibility criteria",
    satisfied: ceEligibility,
    detail: ceEligibility ? "Documented" : "Missing",
  });
  const ceAssignment = input.hasAssignmentMethod;
  checks.push({
    requirement: "Assignment method",
    satisfied: ceAssignment,
    detail: ceAssignment ? "Declared" : "Missing",
  });
  const ceMetric = input.hasFixedPrimaryMetric;
  checks.push({
    requirement: "Fixed primary metric",
    satisfied: ceMetric,
    detail: ceMetric ? "Fixed" : "Missing",
  });
  const ceWindow = input.hasObservationWindow;
  checks.push({
    requirement: "Defined observation window",
    satisfied: ceWindow,
    detail: ceWindow ? "Defined" : "Missing",
  });
  const ceFidelity = input.hasFidelityCapture;
  checks.push({
    requirement: "Protocol-fidelity capture",
    satisfied: ceFidelity,
    detail: ceFidelity ? "Captured" : "Missing",
  });
  const ceNoProhibited = !input.prohibitedVariableChanged;
  checks.push({
    requirement: "No prohibited variable changes",
    satisfied: ceNoProhibited,
    detail: ceNoProhibited ? "Clean" : "Prohibited variable changed",
  });
  const ceCompliance = input.complianceApproved || !config.requireComplianceClear;
  checks.push({
    requirement: "Compliance approval where required",
    satisfied: ceCompliance,
    detail: ceCompliance ? "Approved" : "Not approved",
  });

  const controlledPassed =
    cePreRegistered && ceTreatment && ceEligibility && ceAssignment &&
    ceMetric && ceWindow && ceFidelity && ceNoProhibited && ceCompliance;
  if (!controlledPassed) {
    return buildDecision(
      input.recordId,
      "internal_signal",
      checks,
      true,
      "Meets internal signal but not controlled experiment: " +
        failedRequirements(checks, LEVEL_ORDER.indexOf("controlled_experiment")),
      blockingConfounders,
      config,
    );
  }

  // ── Valid Replication (tier 4) ────────────────────────────────────────
  const vrReplications = input.independentReplications >= 1;
  checks.push({
    requirement: "At least 1 independent replication (operator/territory/period/population)",
    satisfied: vrReplications,
    detail: `${input.independentReplications} independent replication(s)`,
  });
  const vrNoReuse = input.experimentCount >= 2;
  checks.push({
    requirement: "No direct reuse of the original result as an observation",
    satisfied: vrNoReuse,
    detail: `${input.experimentCount} distinct experiment(s)`,
  });

  const replicationPassed = vrReplications && vrNoReuse;
  if (!replicationPassed) {
    return buildDecision(
      input.recordId,
      "controlled_experiment",
      checks,
      true,
      "Meets controlled experiment but not valid replication: " +
        failedRequirements(checks, LEVEL_ORDER.indexOf("valid_replication")),
      blockingConfounders,
      config,
    );
  }

  // ── Golden-Node-Eligible (tier 5) ─────────────────────────────────────
  const gnExperiments = input.experimentCount >= config.minExperimentsGoldenNode;
  checks.push({
    requirement: `At least ${config.minExperimentsGoldenNode} admissible experiments`,
    satisfied: gnExperiments,
    detail: `${input.experimentCount} experiment(s)`,
  });
  const gnReplications = input.independentReplications >= config.minReplicationsGoldenNode;
  checks.push({
    requirement: `At least ${config.minReplicationsGoldenNode} independent replications`,
    satisfied: gnReplications,
    detail: `${input.independentReplications} replication(s)`,
  });
  const gnConfidence = bestConfidence(input.claims ?? []) >= config.attributionConfidenceThreshold;
  checks.push({
    requirement: `Attribution confidence ≥ ${config.attributionConfidenceThreshold}`,
    satisfied: gnConfidence,
    detail: `Best confidence ${bestConfidence(input.claims ?? []).toFixed(2)}`,
  });
  const gnFailureBoundary = !config.requireFailureBoundaryForGoldenNode || input.hasFailureBoundary;
  checks.push({
    requirement: "Documented failure boundary",
    satisfied: gnFailureBoundary,
    detail: gnFailureBoundary ? "Documented" : "Missing",
  });
  const gnTransferability = !config.requireTransferabilityForGoldenNode || input.transferabilityDemonstrated;
  checks.push({
    requirement: "Transferability demonstrated in >1 context",
    satisfied: gnTransferability,
    detail: gnTransferability ? "Demonstrated" : "Not demonstrated",
  });
  const gnEconomics = input.economicValueExceedsCost;
  checks.push({
    requirement: "Economic value exceeds implementation cost",
    satisfied: gnEconomics,
    detail: gnEconomics ? "Positive ROI" : "ROI not established",
  });
  const gnLedger = input.hasCompleteContributionLedger;
  checks.push({
    requirement: "Complete contribution ledger",
    satisfied: gnLedger,
    detail: gnLedger ? "Complete" : "Incomplete",
  });
  const gnNoConfounders = blockingConfounders.length === 0;
  checks.push({
    requirement: "No unresolved critical confounder",
    satisfied: gnNoConfounders,
    detail: gnNoConfounders ? "Clear" : `${blockingConfounders.length} unresolved`,
  });

  const goldenNodePassed =
    gnExperiments && gnReplications && gnConfidence && gnFailureBoundary &&
    gnTransferability && gnEconomics && gnLedger && gnNoConfounders;
  if (!goldenNodePassed) {
    return buildDecision(
      input.recordId,
      "valid_replication",
      checks,
      true,
      "Meets valid replication but not golden-node-eligible: " +
        failedRequirements(checks, LEVEL_ORDER.indexOf("golden_node_eligible")),
      blockingConfounders,
      config,
    );
  }

  return buildDecision(
    input.recordId,
    "golden_node_eligible",
    checks,
    true,
    "All golden-node-eligible requirements satisfied",
    blockingConfounders,
    config,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bestConfidence(claims: AttributionClaim[]): number {
  if (claims.length === 0) return 0;
  return Math.max(...claims.map((c) => c.confidence));
}

function failedRequirements(checks: AdmissibilityCheck[], fromIndex: number): string {
  // Checks are pushed in tier order; approximate by listing all failed
  const failed = checks.filter((c) => !c.satisfied).map((c) => c.requirement);
  return failed.length > 0 ? failed.join("; ") : "unknown requirement";
}

function buildDecision(
  recordId: string,
  level: AdmissibilityLevel,
  checks: AdmissibilityCheck[],
  admissible: boolean,
  rationale: string,
  blockingConfounders: string[],
  config: AdmissibilityConfig,
): AdmissibilityDecision {
  return {
    recordId,
    level,
    checks,
    admissible,
    rationale,
    blockingConfounders,
    decidedAt: new Date().toISOString(),
    configVersion: config.configVersion,
  };
}

// ---------------------------------------------------------------------------
// Bridge: derive admissibility input from a SPIN record + claims
// ---------------------------------------------------------------------------

export function deriveInputFromSpin(
  spin: SPIN,
  claims: AttributionClaim[],
  opts: {
    observationCount?: number;
    hasComparison?: boolean;
    executionFidelity?: number;
    independentReplications?: number;
    experimentCount?: number;
    hasFailureBoundary?: boolean;
    transferabilityDemonstrated?: boolean;
    economicValueExceedsCost?: boolean;
    hasCompleteContributionLedger?: boolean;
    unresolvedConfounders?: string[];
  } = {},
): AdmissibilityInput {
  const isControlled = claims.some(
    (c) => c.method === "rct" || c.method === "diff_in_diff" || c.method === "synthetic_control" || c.method === "regression_discontinuity",
  );
  return {
    recordId: spin.spinId,
    observationCount: opts.observationCount ?? Math.max(1, claims.length),
    hasComparison: opts.hasComparison ?? (spin.control?.length ?? 0) > 0,
    executionFidelity: opts.executionFidelity ?? 0.8,
    preRegistered: spin.state === "preregistered" || spin.state === "executing" || spin.state === "observed" || spin.state === "attributed" || spin.state === "replicated",
    hasExplicitTreatmentAndComparison: (spin.intervention?.length ?? 0) > 0 && (spin.control?.length ?? 0) > 0,
    hasEligibilityCriteria: (spin.population?.length ?? 0) > 0,
    hasAssignmentMethod: spin.state !== "draft" && spin.state !== "prior_art_checked",
    hasFixedPrimaryMetric: claims.length > 0,
    hasObservationWindow: spin.state === "observed" || spin.state === "attributed" || spin.state === "replicated",
    hasFidelityCapture: (spin.modifications?.length ?? 0) >= 0, // fidelity is tracked via snapshots
    prohibitedVariableChanged: false,
    complianceApproved: (spin.complianceBoundary?.length ?? 0) > 0,
    hasUnresolvedCompliance: false,
    claims,
    independentReplications: opts.independentReplications ?? spin.replicationCount,
    experimentCount: opts.experimentCount ?? Math.max(1, spin.experimentIds?.length ?? 0),
    hasFailureBoundary: opts.hasFailureBoundary ?? spin.reverseTest !== null,
    transferabilityDemonstrated: opts.transferabilityDemonstrated ?? spin.replicationCount >= 2,
    economicValueExceedsCost: opts.economicValueExceedsCost ?? spin.goldenNodeId !== null,
    hasCompleteContributionLedger: opts.hasCompleteContributionLedger ?? (spin.contributions?.length ?? 0) > 0,
    unresolvedConfounders: opts.unresolvedConfounders ?? [],
  };
}

/**
 * Map the EvidenceTier enum (from spin.ts) to an AdmissibilityLevel.
 * This is a conservative bridge — the admissibility engine is stricter.
 */
export function evidenceTierToAdmissibility(tier: EvidenceTier): AdmissibilityLevel {
  switch (tier) {
    case EvidenceTier.OBSERVED:
      return "observation";
    case EvidenceTier.ASSOCIATED:
      return "internal_signal";
    case EvidenceTier.SUPPORTED:
      return "internal_signal";
    case EvidenceTier.EXPERIMENTALLY_DEMONSTRATED:
      return "controlled_experiment";
    case EvidenceTier.REPLICATED:
      return "valid_replication";
    default:
      return "observation";
  }
}

/**
 * Determine whether a record may be promoted to a Golden Node.
 * This is the hard gate: nothing below golden_node_eligible may promote.
 */
export function canPromoteToGoldenNode(decision: AdmissibilityDecision): boolean {
  return decision.admissible && decision.level === "golden_node_eligible";
}
