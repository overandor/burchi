/**
 * Public SPINOR experiment audit builder.
 *
 * Joins HypothesisAssignment, HypothesisAnatomy, HypothesisOutcome,
 * HypothesisAttribution, and SPIN records into a single auditable view.
 */

import {
  loadHypotheses,
  loadHypothesisAssignments,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
} from "@/lib/config";
import { loadAllSpins, loadClaims } from "@/lib/spinor/spin-db";
import type {
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisAttribution,
  HypothesisOutcome,
} from "@/types";
import type { SPIN, AttributionClaim, ReverseTestSpec, PriorArtState, ContributionEntry, HumanModification } from "@/lib/spinor/spin";

export interface ExecutionReceipt {
  snapshotId: string;
  state: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  reason: string;
  contentDigest: string;
  previousDigest: string;
}

export interface AuditExperiment {
  /** Canonical experiment id (the assignment id, or the spin id for SPIN-only experiments). */
  id: string;
  /** Associated hypothesis. */
  hypothesisId: string;
  claim: string;
  intervention: string;
  control: string;
  population: string;
  primaryOutcome: string;
  secondaryOutcomes: string[];
  knownConfounders: string[];
  complianceBoundary: string;
  expectedValue: string;
  primaryUncertainty: string;
  novelComponent: string | null;
  researchRisk: "low" | "moderate" | "high" | undefined;
  fixedConstraints: string[];
  modifiableDimensions: string[];
  origin: string;
  parentHypothesisId: string | undefined;
  /** Assignment / execution policy. */
  assignment: HypothesisAssignment | null;
  /** Eligible agents and owner. */
  ownerEmployeeId: string;
  participants: string[];
  /** Outcome and attribution. */
  outcome: HypothesisOutcome | null;
  attribution: HypothesisAttribution | null;
  /** Causal unit. */
  spin: SPIN | null;
  /** Per-SPIN claims. */
  claims: AttributionClaim[];
  /** Evidence ancestry. */
  priorArt: PriorArtState | null;
  /** Reverse falsification test. */
  reverseTest: ReverseTestSpec | null;
  /** Snapshot chain as execution receipts. */
  executionReceipts: ExecutionReceipt[];
  /** Human-LLM contribution entries from the SPIN. */
  contributions: ContributionEntry[];
  /** Human modification records from the SPIN. */
  modifications: HumanModification[];
  /** Prior-art status label from the hypothesis. */
  priorArtStatus: string;
  /** Source domains from the hypothesis. */
  sourceDomains: string[];
  /** Whether the evidence provider is durable or ephemeral. */
  evidenceProviderDurable: boolean;
}

function toReceipts(spin: SPIN): ExecutionReceipt[] {
  return (spin.snapshots || []).map((s) => ({
    snapshotId: s.snapshotId,
    state: s.state,
    timestamp: s.timestamp,
    actorId: s.actorId,
    actorRole: s.actorRole,
    reason: s.reason,
    contentDigest: s.contentDigest,
    previousDigest: s.previousDigest,
  }));
}

export function buildAuditExperiments(): AuditExperiment[] {
  const hypotheses = new Map<string, HypothesisAnatomy>(
    loadHypotheses().map((h) => [h.id, h]),
  );
  const assignments = loadHypothesisAssignments();
  const outcomes = loadHypothesisOutcomes();
  const attributions = loadHypothesisAttributions();
  const spins = loadAllSpins();

  const outcomeByAssignmentId = new Map<string, HypothesisOutcome>();
  for (const o of outcomes) {
    // Keep the latest observed outcome per assignment.
    const existing = outcomeByAssignmentId.get(o.assignmentId);
    if (!existing || o.observedAt > existing.observedAt) {
      outcomeByAssignmentId.set(o.assignmentId, o);
    }
  }

  const attributionByOutcomeId = new Map<string, HypothesisAttribution>();
  for (const a of attributions) {
    attributionByOutcomeId.set(a.outcomeId, a);
  }

  const spinByHypothesisId = new Map<string, SPIN>();
  const spinByExperimentId = new Map<string, SPIN>();
  for (const s of spins) {
    if (s.hypothesisId && !spinByHypothesisId.has(s.hypothesisId)) {
      spinByHypothesisId.set(s.hypothesisId, s);
    }
    for (const expId of s.experimentIds || []) {
      spinByExperimentId.set(expId, s);
    }
  }

  // Fallback: if no SPIN matches by hypothesis ID or experiment ID,
  // match by index (SPINs and assignments may have been seeded with
  // different hypothesis ID schemes across versions).
  const spinFallback = new Map<number, SPIN>();
  spins.forEach((s, i) => { spinFallback.set(i, s); });

  const experiments: AuditExperiment[] = [];

  // Primary view: an experiment is a HypothesisAssignment.
  for (let idx = 0; idx < assignments.length; idx++) {
    const a = assignments[idx];
    const h = hypotheses.get(a.hypothesisId);
    const outcome = outcomeByAssignmentId.get(a.id) || null;
    const attribution = outcome ? attributionByOutcomeId.get(outcome.id) || null : null;
    const spin = spinByExperimentId.get(a.id) || spinByHypothesisId.get(a.hypothesisId) || spinFallback.get(idx) || null;
    const claims = spin ? loadClaims(spin.spinId) : [];
    const priorArt = spin ? spin.priorArt : null;

    experiments.push({
      id: a.id,
      hypothesisId: a.hypothesisId,
      claim: h?.claim || spin?.claim || a.hypothesisId,
      intervention: h?.intervention || spin?.intervention || "",
      control: h?.control || spin?.control || "",
      population: h?.targetCondition || spin?.population || "",
      primaryOutcome: h?.primaryOutcome || spin?.primaryUncertainty || "",
      secondaryOutcomes: h?.secondaryOutcomes || [],
      knownConfounders: h?.knownConfounders || [],
      complianceBoundary: h?.complianceBoundary || spin?.complianceBoundary || "",
      expectedValue: h?.expectedValue || "",
      primaryUncertainty: h?.primaryUncertainty || spin?.primaryUncertainty || "",
      novelComponent: h?.novelComponent || null,
      researchRisk: h?.researchRisk,
      fixedConstraints: h?.fixedConstraints || [],
      modifiableDimensions: (h?.modifiableDimensions || []).map(String),
      origin: h?.origin || "research",
      parentHypothesisId: h?.parentHypothesisId,
      assignment: a,
      ownerEmployeeId: a.employeeId,
      participants: a.eligibleAccountIds || [],
      outcome,
      attribution,
      spin,
      claims,
      priorArt,
      reverseTest: spin?.reverseTest || null,
      executionReceipts: spin ? toReceipts(spin) : [],
      contributions: spin?.contributions || [],
      modifications: spin?.modifications || [],
      priorArtStatus: h?.priorArtStatus || "unsupported",
      sourceDomains: h?.sourceDomains || [],
      evidenceProviderDurable: false,
    });
  }

  // Include SPINs that do not map to an assignment, so they are still auditable.
  const usedSpinIds = new Set(experiments.filter((e) => e.spin).map((e) => e.spin!.spinId));
  for (const s of spins) {
    if (usedSpinIds.has(s.spinId)) continue;
    const h = hypotheses.get(s.hypothesisId);
    const claims = loadClaims(s.spinId);
    experiments.push({
      id: s.spinId,
      hypothesisId: s.hypothesisId,
      claim: h?.claim || s.claim || s.hypothesisId,
      intervention: h?.intervention || s.intervention || "",
      control: h?.control || s.control || "",
      population: h?.targetCondition || s.population || "",
      primaryOutcome: h?.primaryOutcome || s.primaryUncertainty || "",
      secondaryOutcomes: h?.secondaryOutcomes || [],
      knownConfounders: h?.knownConfounders || [],
      complianceBoundary: h?.complianceBoundary || s.complianceBoundary || "",
      expectedValue: h?.expectedValue || "",
      primaryUncertainty: h?.primaryUncertainty || s.primaryUncertainty || "",
      novelComponent: h?.novelComponent || null,
      researchRisk: h?.researchRisk,
      fixedConstraints: h?.fixedConstraints || [],
      modifiableDimensions: (h?.modifiableDimensions || []).map(String),
      origin: h?.origin || "research",
      parentHypothesisId: h?.parentHypothesisId,
      assignment: null,
      ownerEmployeeId: s.employeeOwner || "",
      participants: [],
      outcome: null,
      attribution: null,
      spin: s,
      claims,
      priorArt: s.priorArt,
      reverseTest: s.reverseTest,
      executionReceipts: toReceipts(s),
      contributions: s.contributions || [],
      modifications: s.modifications || [],
      priorArtStatus: h?.priorArtStatus || "unsupported",
      sourceDomains: h?.sourceDomains || [],
      evidenceProviderDurable: false,
    });
  }

  return experiments;
}

export function getAuditExperimentById(id: string): AuditExperiment | null {
  return buildAuditExperiments().find((e) => e.id === id) || null;
}
