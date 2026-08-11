/**
 * Research Gauntlet — the nine mandatory stages every LLM-generated
 * hypothesis must pass before it can enter live experimentation.
 *
 * No LLM brainstorm enters live experimentation directly.
 *
 * Stage 1: Claim Dissection
 * Stage 2: Prior-Art Sweep
 * Stage 3: Evidence Integrity
 * Stage 4: Novelty Extraction
 * Stage 5: Confounder Attack
 * Stage 6: Experimental Design
 * Stage 7: Field Execution
 * Stage 8: Causal Reveal
 * Stage 9: Derivative Generation
 *
 * Each stage has deterministic validators. A stage that fails its
 * validation returns "revision_required" or "rejected" and the gauntlet
 * halts until the issue is resolved. Every stage record is preserved
 * for auditability.
 */

import { nanoid } from "nanoid";
import {
  GauntletRun,
  GauntletStage,
  GauntletStageRecord,
  GauntletStageStatus,
  DissectedClaim,
  EvidenceIntegrityReport,
  GauntletConfounder,
  ExperimentalDesign,
  CausalReveal,
  CausalClassification,
} from "@/types";

// ---------------------------------------------------------------------------
// Stage ordering
// ---------------------------------------------------------------------------

export const STAGE_ORDER: GauntletStage[] = [
  "claim_dissection",
  "prior_art_sweep",
  "evidence_integrity",
  "novelty_extraction",
  "confounder_attack",
  "experimental_design",
  "field_execution",
  "causal_reveal",
  "derivative_generation",
];

export const STAGE_LABEL: Record<GauntletStage, string> = {
  claim_dissection: "Claim Dissection",
  prior_art_sweep: "Prior-Art Sweep",
  evidence_integrity: "Evidence Integrity",
  novelty_extraction: "Novelty Extraction",
  confounder_attack: "Confounder Attack",
  experimental_design: "Experimental Design",
  field_execution: "Field Execution",
  causal_reveal: "Causal Reveal",
  derivative_generation: "Derivative Generation",
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function emptyStageRecord(stage: GauntletStage): GauntletStageRecord {
  return {
    stage,
    status: "pending",
    startedAt: null,
    completedAt: null,
    reviewer: null,
    notes: "",
    rejectionReason: null,
  };
}

export function createGauntletRun(hypothesisId: string): GauntletRun {
  const runId = `GNT-${nanoid(12).toUpperCase()}`;
  return {
    runId,
    hypothesisId,
    spinId: null,
    stages: STAGE_ORDER.map(emptyStageRecord),
    dissectedClaim: null,
    evidenceIntegrity: null,
    confounders: [],
    design: null,
    causalReveal: null,
    currentStage: "claim_dissection",
    complete: false,
    createdAt: now(),
    updatedAt: now(),
  };
}

// ---------------------------------------------------------------------------
// Stage record helpers
// ---------------------------------------------------------------------------

function markStage(
  run: GauntletRun,
  stage: GauntletStage,
  status: GauntletStageStatus,
  notes: string,
  rejectionReason: string | null = null,
  reviewer: string | null = null,
): void {
  const rec = run.stages.find((s) => s.stage === stage);
  if (!rec) return;
  rec.status = status;
  rec.notes = notes;
  rec.rejectionReason = rejectionReason;
  rec.reviewer = reviewer;
  if (status === "in_progress" && !rec.startedAt) rec.startedAt = now();
  if (status === "passed" || status === "rejected" || status === "revision_required") {
    rec.completedAt = now();
  }
  run.updatedAt = now();
}

function advanceCurrentStage(run: GauntletRun): void {
  const idx = STAGE_ORDER.indexOf(run.currentStage);
  if (idx < STAGE_ORDER.length - 1) {
    run.currentStage = STAGE_ORDER[idx + 1];
  } else {
    run.complete = true;
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — Claim Dissection
// ---------------------------------------------------------------------------

const REQUIRED_CLAIM_FIELDS: (keyof DissectedClaim)[] = [
  "population",
  "intervention",
  "comparison",
  "outcome",
  "timePeriod",
  "mechanism",
  "risk",
  "falsificationCondition",
];

/**
 * Validate a dissected claim. Rejects if any critical field is missing.
 */
export function validateClaim(claim: DissectedClaim): { valid: boolean; missing: string[] } {
  const missing = REQUIRED_CLAIM_FIELDS.filter((f) => {
    const v = claim[f];
    return v === undefined || v === null || String(v).trim() === "";
  });
  return { valid: missing.length === 0, missing };
}

export function stage1ClaimDissection(
  run: GauntletRun,
  claim: DissectedClaim,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "claim_dissection", "in_progress", "Dissecting claim", null, reviewer);
  const { valid, missing } = validateClaim(claim);
  if (!valid) {
    markStage(
      run,
      "claim_dissection",
      "revision_required",
      "Claim missing critical fields",
      `Missing: ${missing.join(", ")}`,
      reviewer,
    );
    return run;
  }
  run.dissectedClaim = claim;
  markStage(run, "claim_dissection", "passed", "Claim dissected and validated", null, reviewer);
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 2 — Prior-Art Sweep
// ---------------------------------------------------------------------------

export interface PriorArtSweepInput {
  evidenceClass:
  | "established"
  | "supported"
  | "transferred"
  | "plausible"
  | "untested"
  | "previously_failed"
  | "contradicted"
  | "unsupported"
  | "internal_signal";
  sources: string[];
  negativeResults: string[];
  abandonedMethods: string[];
  regulatoryRestrictions: string[];
  summary: string;
}

export function stage2PriorArtSweep(
  run: GauntletRun,
  input: PriorArtSweepInput,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "prior_art_sweep", "in_progress", "Sweeping prior art", null, reviewer);
  if (input.sources.length === 0) {
    markStage(
      run,
      "prior_art_sweep",
      "revision_required",
      "No evidence sources found",
      "At least one source must be consulted",
      reviewer,
    );
    return run;
  }
  markStage(
    run,
    "prior_art_sweep",
    "passed",
    `Evidence class: ${input.evidenceClass}. ${input.sources.length} source(s).`,
    null,
    reviewer,
  );
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 3 — Evidence Integrity
// ---------------------------------------------------------------------------

export function validateEvidenceIntegrity(report: EvidenceIntegrityReport): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (report.baseline === null) issues.push("baseline missing");
  if (report.observed === null) issues.push("observed missing");
  if (report.sampleSize === null) issues.push("sample size missing");
  if (report.controlMethod === null) issues.push("control method missing");
  if (report.baseline !== null && report.observed !== null) {
    if (report.absoluteChange === null) {
      issues.push("absolute change not computed");
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Compute absolute and relative change from baseline and observed.
 * Relative change is the fraction (e.g. 0.3 for 30%).
 * Never display "30% improvement" without distinguishing relative from
 * absolute change — this function enforces both are computed.
 */
export function computeEffect(
  baseline: number,
  observed: number,
): { absolute: number; relative: number } {
  const absolute = observed - baseline;
  const relative = baseline !== 0 ? absolute / baseline : 0;
  return { absolute, relative };
}

export function stage3EvidenceIntegrity(
  run: GauntletRun,
  report: EvidenceIntegrityReport,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "evidence_integrity", "in_progress", "Checking evidence integrity", null, reviewer);
  const { valid, issues } = validateEvidenceIntegrity(report);
  if (!valid) {
    markStage(
      run,
      "evidence_integrity",
      "revision_required",
      "Evidence incomplete",
      `Missing: ${issues.join(", ")}`,
      reviewer,
    );
    return run;
  }
  run.evidenceIntegrity = report;
  markStage(run, "evidence_integrity", "passed", "Evidence integrity verified", null, reviewer);
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 4 — Novelty Extraction
// ---------------------------------------------------------------------------

export const NOVELTY_DIMENSIONS = [
  "customer_population",
  "stakeholder",
  "timing",
  "channel",
  "sequence",
  "personalization_variable",
  "human_llm_division",
  "automation_layer",
  "workflow_ownership",
  "measurement_method",
  "incentive_structure",
  "combination_of_processes",
  "transfer_to_industry_or_territory",
] as const;

export type NoveltyDimension = (typeof NOVELTY_DIMENSIONS)[number];

export interface NoveltyExtractionInput {
  noveltyDimensions: NoveltyDimension[];
  experimentalVariable: string;
  familiarityNote: string;
}

export function stage4NoveltyExtraction(
  run: GauntletRun,
  input: NoveltyExtractionInput,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "novelty_extraction", "in_progress", "Extracting novelty", null, reviewer);
  if (!input.experimentalVariable.trim()) {
    markStage(
      run,
      "novelty_extraction",
      "revision_required",
      "No explicit experimental variable",
      "The actual experimental variable must be made explicit",
      reviewer,
    );
    return run;
  }
  markStage(
    run,
    "novelty_extraction",
    "passed",
    `Novelty: ${input.noveltyDimensions.join(", ") || "none identified"}. Variable: ${input.experimentalVariable}`,
    null,
    reviewer,
  );
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 5 — Confounder Attack
// ---------------------------------------------------------------------------

export const CONFOUNDER_STATUSES = [
  "unresolved",
  "controlled",
  "measured",
  "unlikely",
  "confirmed",
] as const;

export function stage5ConfounderAttack(
  run: GauntletRun,
  confounders: GauntletConfounder[],
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "confounder_attack", "in_progress", "Attacking hypothesis with confounders", null, reviewer);
  if (confounders.length === 0) {
    markStage(
      run,
      "confounder_attack",
      "revision_required",
      "No confounders generated",
      "The LLM must argue against its own hypothesis",
      reviewer,
    );
    return run;
  }
  run.confounders = confounders;
  const unresolved = confounders.filter((c) => c.status === "unresolved").length;
  markStage(
    run,
    "confounder_attack",
    "passed",
    `${confounders.length} confounder(s) identified, ${unresolved} unresolved`,
    null,
    reviewer,
  );
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 6 — Experimental Design
// ---------------------------------------------------------------------------

const REQUIRED_DESIGN_FIELDS: (keyof ExperimentalDesign)[] = [
  "eligiblePopulation",
  "treatmentCondition",
  "comparisonCondition",
  "assignmentMethod",
  "primaryMetric",
  "observationWindow",
  "attributionPlan",
];

export function validateDesign(design: ExperimentalDesign): { valid: boolean; missing: string[] } {
  const missing = REQUIRED_DESIGN_FIELDS.filter((f) => {
    const v = design[f];
    return v === undefined || v === null || String(v).trim() === "";
  });
  if (design.sampleTarget <= 0) missing.push("sampleTarget" as keyof ExperimentalDesign);
  return { valid: missing.length === 0, missing };
}

export function stage6ExperimentalDesign(
  run: GauntletRun,
  design: ExperimentalDesign,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "experimental_design", "in_progress", "Designing experiment", null, reviewer);
  const { valid, missing } = validateDesign(design);
  if (!valid) {
    markStage(
      run,
      "experimental_design",
      "revision_required",
      "Design incomplete",
      `Missing: ${missing.join(", ")}`,
      reviewer,
    );
    return run;
  }
  run.design = design;
  markStage(run, "experimental_design", "passed", "Experimental design approved", null, reviewer);
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 7 — Field Execution
// ---------------------------------------------------------------------------

export interface FieldExecutionInput {
  assignedProtocol: string;
  approvedProtocol: string;
  actualExecuted: string;
  changedVariables: string[];
  deviations: string[];
  humanEffort: string;
  automatedEffort: string;
  customerResponses: string[];
  negativeOutcomes: string[];
  complaints: string[];
  optOuts: number;
  externalEvents: string[];
  missingObservations: string[];
  complianceIncidents: string[];
}

export function computeExecutionFidelity(input: FieldExecutionInput): number {
  // Fidelity = 1 - (deviation penalty + missing observation penalty + compliance penalty)
  const deviationPenalty = Math.min(0.5, input.deviations.length * 0.1);
  const missingPenalty = Math.min(0.2, input.missingObservations.length * 0.05);
  const compliancePenalty = input.complianceIncidents.length > 0 ? 0.3 : 0;
  return Math.max(0, 1 - deviationPenalty - missingPenalty - compliancePenalty);
}

export function stage7FieldExecution(
  run: GauntletRun,
  input: FieldExecutionInput,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "field_execution", "in_progress", "Executing in field", null, reviewer);
  const fidelity = computeExecutionFidelity(input);
  if (input.complianceIncidents.length > 0) {
    markStage(
      run,
      "field_execution",
      "rejected",
      "Compliance incident during execution",
      `${input.complianceIncidents.length} compliance incident(s)`,
      reviewer,
    );
    return run;
  }
  markStage(
    run,
    "field_execution",
    "passed",
    `Execution fidelity: ${fidelity.toFixed(2)}. ${input.deviations.length} deviation(s).`,
    null,
    reviewer,
  );
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 8 — Causal Reveal
// ---------------------------------------------------------------------------

export function stage8CausalReveal(
  run: GauntletRun,
  reveal: CausalReveal,
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "causal_reveal", "in_progress", "Revealing causal result", null, reviewer);
  if (reveal.classification === "compliance_blocked") {
    markStage(
      run,
      "causal_reveal",
      "rejected",
      "Compliance blocked",
      "Result cannot be promoted due to compliance",
      reviewer,
    );
    return run;
  }
  run.causalReveal = reveal;
  markStage(
    run,
    "causal_reveal",
    "passed",
    `Classification: ${reveal.classification}. Confidence: ${reveal.confidence.toFixed(2)}`,
    null,
    reviewer,
  );
  advanceCurrentStage(run);
  return run;
}

// ---------------------------------------------------------------------------
// Stage 9 — Derivative Generation
// ---------------------------------------------------------------------------

export interface DerivativeProposal {
  parentHypothesisId: string;
  mutationDescription: string;
  preservedVariables: string[];
  changedVariable: string;
  reasonForMutation: string;
  expectedMechanism: string;
  newRisks: string[];
  requiredEvidence: string[];
}

export function stage9DerivativeGeneration(
  run: GauntletRun,
  derivatives: DerivativeProposal[],
  reviewer: string | null = null,
): GauntletRun {
  markStage(run, "derivative_generation", "in_progress", "Generating derivatives", null, reviewer);
  if (derivatives.length === 0) {
    markStage(
      run,
      "derivative_generation",
      "passed",
      "No derivatives generated (terminal stage)",
      null,
      reviewer,
    );
  } else {
    markStage(
      run,
      "derivative_generation",
      "passed",
      `${derivatives.length} derivative(s) generated`,
      null,
      reviewer,
    );
  }
  run.complete = true;
  run.updatedAt = now();
  return run;
}

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

export function gauntletSummary(run: GauntletRun): {
  currentStageLabel: string;
  passedCount: number;
  revisionRequired: boolean;
  rejected: boolean;
  complete: boolean;
} {
  const passedCount = run.stages.filter((s) => s.status === "passed").length;
  const revisionRequired = run.stages.some((s) => s.status === "revision_required");
  const rejected = run.stages.some((s) => s.status === "rejected");
  return {
    currentStageLabel: STAGE_LABEL[run.currentStage],
    passedCount,
    revisionRequired,
    rejected,
    complete: run.complete,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run stages 1-6 (the pre-execution gauntlet) in sequence
// ---------------------------------------------------------------------------

export interface PreExecutionGauntletInput {
  claim: DissectedClaim;
  priorArt: PriorArtSweepInput;
  evidence: EvidenceIntegrityReport;
  novelty: NoveltyExtractionInput;
  confounders: GauntletConfounder[];
  design: ExperimentalDesign;
  reviewer?: string;
}

/**
 * Run the first six stages (the pre-execution gauntlet) in sequence.
 * Stops at the first stage that requires revision.
 */
export function runPreExecutionGauntlet(
  hypothesisId: string,
  input: PreExecutionGauntletInput,
): GauntletRun {
  const run = createGauntletRun(hypothesisId);
  stage1ClaimDissection(run, input.claim, input.reviewer ?? null);
  if (run.stages[0].status !== "passed") return run;
  stage2PriorArtSweep(run, input.priorArt, input.reviewer ?? null);
  if (run.stages[1].status !== "passed") return run;
  stage3EvidenceIntegrity(run, input.evidence, input.reviewer ?? null);
  if (run.stages[2].status !== "passed") return run;
  stage4NoveltyExtraction(run, input.novelty, input.reviewer ?? null);
  if (run.stages[3].status !== "passed") return run;
  stage5ConfounderAttack(run, input.confounders, input.reviewer ?? null);
  if (run.stages[4].status !== "passed") return run;
  stage6ExperimentalDesign(run, input.design, input.reviewer ?? null);
  return run;
}
