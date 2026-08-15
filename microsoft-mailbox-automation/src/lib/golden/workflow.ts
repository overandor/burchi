/**
 * Workflow Engine — the game loop for hypothesis execution.
 *
 * The chain:
 *   assigned → accepted → researched → executing → observed → attributed → finalized
 *
 * Game-like properties (without looking like a game):
 *   - Sequential unlock: each stage gates the next
 *   - Quality compounds: more intel evidence → higher attribution confidence → better derivatives
 *   - Risk/reward: you CAN skip intel, but attribution degrades to "unresolved"
 *   - Evidence chain: each stage's output is input to the next
 *   - Pre-registration: your execution plan is a prediction; observation compares against it
 *
 * No badges, no points, no levels. Just a chain where your choices have
 * consequences downstream, and the loop always tells you what's next.
 */

import { HypothesisAssignment, WorkflowIntel, WorkflowExecutionPlan, InnovationDimension } from "@/types";
import {
  loadHypothesisAssignments,
  saveHypothesisAssignments,
} from "@/lib/config";
import { recordOutcome, attributeOutcome, OutcomeInput } from "./outcomes";
import { generateDerivativesFromAttribution } from "./derivatives";
import { recordUsefulFailure, recordSuccessfulReplication, recordStrategyContribution } from "./golden-node";
import { loadHypotheses } from "@/lib/config";

const now = () => new Date().toISOString();

function getAssignment(id: string): HypothesisAssignment | undefined {
  return loadHypothesisAssignments().find((a) => a.id === id);
}

function saveAssignment(assignment: HypothesisAssignment): void {
  const all = loadHypothesisAssignments();
  const idx = all.findIndex((a) => a.id === assignment.id);
  if (idx >= 0) {
    all[idx] = assignment;
    saveHypothesisAssignments(all);
  }
}

// ─── Stage 1: Accept ────────────────────────────────────────────────────

export function acceptAssignment(id: string): HypothesisAssignment | undefined {
  const a = getAssignment(id);
  if (!a) return undefined;
  if (a.state !== "assigned") return undefined;
  a.state = "accepted";
  a.acceptedAt = now();
  a.stageTimestamps = { ...a.stageTimestamps, accepted: now() };
  saveAssignment(a);
  return a;
}

export function rejectAssignment(id: string, note?: string): HypothesisAssignment | undefined {
  const a = getAssignment(id);
  if (!a) return undefined;
  a.state = "rejected";
  a.rejectedAt = now();
  a.employeeNote = note;
  saveAssignment(a);
  return a;
}

// ─── Stage 2: Intel ─────────────────────────────────────────────────────

/** Save intel evidence (research, confounders, challenge) to the assignment.
 *  Each piece of intel raises the attribution confidence ceiling. */
export function saveIntel(
  assignmentId: string,
  intel: Partial<WorkflowIntel>,
): HypothesisAssignment | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  if (a.state !== "accepted" && a.state !== "researched") return undefined;

  // Merge with existing intel
  const existing = a.intel || { stepsCompleted: 0, skipped: false };
  const nowIso = now();
  // Stamp runAt on any new intel pieces
  const stamped: Partial<WorkflowIntel> = { ...intel };
  if (stamped.research) stamped.research = { ...stamped.research, runAt: stamped.research.runAt || nowIso };
  if (stamped.confounders) stamped.confounders = { ...stamped.confounders, runAt: stamped.confounders.runAt || nowIso };
  if (stamped.challenge) stamped.challenge = { ...stamped.challenge, runAt: stamped.challenge.runAt || nowIso };

  const merged: WorkflowIntel = {
    ...existing,
    ...stamped,
    stepsCompleted: countIntelSteps({ ...existing, ...stamped }),
    skipped: false,
  };

  a.intel = merged;
  // Transition to "researched" once at least one intel step is done
  if (merged.stepsCompleted > 0 && a.state === "accepted") {
    a.state = "researched";
    a.stageTimestamps = { ...a.stageTimestamps, intelComplete: now() };
  }
  saveAssignment(a);
  return a;
}

/** Skip intel entirely — allowed, but flagged for attribution degradation. */
export function skipIntel(assignmentId: string): HypothesisAssignment | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  if (a.state !== "accepted") return undefined;

  a.intel = { stepsCompleted: 0, skipped: true };
  a.state = "researched";
  a.stageTimestamps = { ...a.stageTimestamps, intelComplete: now() };
  saveAssignment(a);
  return a;
}

function countIntelSteps(intel: WorkflowIntel): number {
  let count = 0;
  if (intel.research) count++;
  if (intel.confounders) count++;
  if (intel.challenge) count++;
  return count;
}

/** Compute intel quality score (0-1). Used as attribution confidence ceiling. */
export function intelQualityScore(intel?: WorkflowIntel): number {
  if (!intel || intel.skipped) return 0.1; // floor — you can still attribute, but poorly
  // 3 steps = 1.0, 2 = 0.8, 1 = 0.6, 0 = 0.1
  const steps = intel.stepsCompleted;
  if (steps >= 3) return 1.0;
  if (steps === 2) return 0.8;
  if (steps === 1) return 0.6;
  return 0.1;
}

// ─── Stage 3: Execution Plan ────────────────────────────────────────────

/** Commit to an execution plan. This is the pre-registration — your prediction
 *  is locked before you observe results, preventing hindsight bias. */
export function commitExecutionPlan(
  assignmentId: string,
  plan: Omit<WorkflowExecutionPlan, "committedAt">,
): HypothesisAssignment | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  // Must have at least reached "researched" (intel or skip-intel)
  if (a.state !== "researched" && a.state !== "accepted") return undefined;

  a.executionPlan = { ...plan, committedAt: now() };
  a.state = "executing";
  a.stageTimestamps = { ...a.stageTimestamps, executionStarted: now() };

  // Record modification if the employee chose one
  if (plan.modification) {
    a.modifiedDimension = plan.modification.dimension;
    a.modificationRationale = plan.modification.rationale;
    a.modifiedAt = now();
  }

  saveAssignment(a);
  return a;
}

// ─── Stage 4: Observation ───────────────────────────────────────────────

/** Record what actually happened. This is the field report — the moment of truth.
 *  The system compares your observation against your pre-registered prediction. */
export function recordObservation(
  assignmentId: string,
  input: {
    successKind: "confirmed" | "falsified" | "inconclusive" | "partial";
    outcomeDescription: string;
    metrics: { metric: string; value: number; unit: string; baseline: number; higherIsBetter: boolean }[];
    falsified: boolean;
    falsificationEvidence?: string;
    externalFactors?: string[];
  },
): { assignment: HypothesisAssignment; outcomeId: string } | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  if (a.state !== "executing") return undefined;

  // Check if observation matches prediction
  const predictionMatch = checkPredictionMatch(a.executionPlan, input.metrics);

  const outcomeInput: OutcomeInput = {
    assignmentId,
    successKind: input.successKind as any,
    outcomeDescription: input.outcomeDescription,
    metrics: input.metrics,
    falsified: input.falsified,
    falsificationEvidence: input.falsificationEvidence,
    contextAtObservation: {
      externalFactors: input.externalFactors,
      concurrentHypotheses: [],
    },
    skipGauntlet: true, // we're managing the workflow ourselves now
  };

  const outcome = recordOutcome(outcomeInput);

  a.observationId = outcome.id;
  a.state = "observed";
  a.stageTimestamps = { ...a.stageTimestamps, observed: now() };
  saveAssignment(a);

  return { assignment: a, outcomeId: outcome.id, predictionMatch } as any;
}

function checkPredictionMatch(
  plan: WorkflowExecutionPlan | undefined,
  metrics: { metric: string; value: number; baseline: number; higherIsBetter: boolean }[],
): { matched: boolean; direction: string } {
  if (!plan) return { matched: false, direction: "no_prediction" };

  const relevantMetric = metrics.find((m) =>
    m.metric.toLowerCase().includes(plan.prediction.metric.toLowerCase()),
  );
  if (!relevantMetric) return { matched: false, direction: "metric_not_found" };

  const delta = relevantMetric.value - relevantMetric.baseline;
  const actualDirection =
    delta > 0 ? "increase" : delta < 0 ? "decrease" : "no_change";

  return {
    matched: actualDirection === plan.prediction.expectedDirection,
    direction: actualDirection,
  };
}

// ─── Stage 5: Attribution ───────────────────────────────────────────────

/** Run causal attribution on the observation. The intel quality score
 *  caps the attribution confidence — if you skipped intel, you get
 *  "unresolved" attribution even if the result was clear. */
export function runAttribution(
  assignmentId: string,
): { assignment: HypothesisAssignment; attribution: any; derivatives: any[] } | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  if (a.state !== "observed") return undefined;
  if (!a.observationId) return undefined;

  const attribution = attributeOutcome(a.observationId);
  if (!attribution) return undefined;

  // Cap confidence by intel quality
  const intelScore = intelQualityScore(a.intel);
  if (attribution.attributionConfidence > intelScore) {
    attribution.attributionConfidence = intelScore;
    if (intelScore < 0.3) {
      attribution.responsibleFactor = "unresolved";
      attribution.unexplainedVariance = 1 - intelScore;
    }
  }

  // Generate derivatives from the attribution
  const parentHypothesis = loadHypotheses().find((h) => h.id === a.hypothesisId);
  const derivatives = parentHypothesis
    ? generateDerivativesFromAttribution(attribution, parentHypothesis)
    : [];

  a.attributionId = attribution.id;
  a.state = "attributed";
  a.stageTimestamps = { ...a.stageTimestamps, attributed: now() };
  saveAssignment(a);

  return { assignment: a, attribution, derivatives };
}

// ─── Stage 6: Finalize ──────────────────────────────────────────────────

/** Close the loop. Records the outcome in the discovery ledger,
 *  updates reliability, and unlocks the next mission. */
export function finalizeAssignment(
  assignmentId: string,
): { assignment: HypothesisAssignment; unlocked: boolean; nextMissionHint?: string } | undefined {
  const a = getAssignment(assignmentId);
  if (!a) return undefined;
  if (a.state !== "attributed") return undefined;

  // Credit the employee — check if the outcome was falsified
  if (a.observationId) {
    const { loadHypothesisOutcomes } = require("@/lib/config");
    const outcomes = loadHypothesisOutcomes();
    const outcome = outcomes.find((o: any) => o.id === a.observationId);
    const wasFalsified = outcome?.falsified === true;

    if (wasFalsified) {
      recordUsefulFailure(a.employeeId);
    } else {
      recordSuccessfulReplication(a.employeeId);
      recordStrategyContribution(a.employeeId);
    }
  }

  a.state = "finalized";
  a.stageTimestamps = { ...a.stageTimestamps, finalized: now() };
  saveAssignment(a);

  // Check if next mission is available
  const allAssignments = loadHypothesisAssignments();
  const hasNext = allAssignments.some(
    (next) => next.employeeId === a.employeeId && next.state === "assigned",
  );

  return {
    assignment: a,
    unlocked: hasNext,
    nextMissionHint: hasNext
      ? "Your next mission is waiting."
      : "Plant a new Daily Seed to continue the loop.",
  };
}

// ─── Workflow Status ────────────────────────────────────────────────────

export type WorkflowStage = "briefing" | "intel" | "execution" | "observation" | "attribution" | "finalized";

export interface WorkflowStatus {
  stage: WorkflowStage;
  stageIndex: number; // 0-5
  totalStages: number;
  stageLabel: string;
  nextAction: string;
  canProceed: boolean;
  intelQuality: number;
  evidenceCount: number;
}

/** Get the current workflow status for an assignment — what stage am I in,
 *  what do I do next, can I proceed. This is what drives the UI. */
export function getWorkflowStatus(assignment: HypothesisAssignment): WorkflowStatus {
  const state = assignment.state;
  const intelScore = intelQualityScore(assignment.intel);
  const evidenceCount = assignment.intel?.stepsCompleted || 0;

  switch (state) {
    case "assigned":
      return {
        stage: "briefing",
        stageIndex: 0,
        totalStages: 6,
        stageLabel: "Briefing",
        nextAction: "Accept or reject this mission",
        canProceed: true,
        intelQuality: 0,
        evidenceCount: 0,
      };
    case "accepted":
      return {
        stage: "intel",
        stageIndex: 1,
        totalStages: 6,
        stageLabel: "Intel Gathering",
        nextAction: "Run research, confounders, and challenge — or skip to execution",
        canProceed: true,
        intelQuality: 0,
        evidenceCount,
      };
    case "researched":
      return {
        stage: "execution",
        stageIndex: 2,
        totalStages: 6,
        stageLabel: "Execution Plan",
        nextAction: "Commit your prediction and plan",
        canProceed: true,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "executing":
      return {
        stage: "observation",
        stageIndex: 3,
        totalStages: 6,
        stageLabel: "Field Observation",
        nextAction: "Record what actually happened",
        canProceed: true,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "observed":
      return {
        stage: "attribution",
        stageIndex: 4,
        totalStages: 6,
        stageLabel: "Causal Attribution",
        nextAction: "Run attribution analysis",
        canProceed: true,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "attributed":
      return {
        stage: "attribution",
        stageIndex: 4,
        totalStages: 6,
        stageLabel: "Attribution Complete",
        nextAction: "Finalize to close the loop and unlock next mission",
        canProceed: true,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "finalized":
      return {
        stage: "finalized",
        stageIndex: 5,
        totalStages: 6,
        stageLabel: "Loop Complete",
        nextAction: "Start your next mission",
        canProceed: false,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "falsified":
      return {
        stage: "finalized",
        stageIndex: 5,
        totalStages: 6,
        stageLabel: "Falsified (valuable result)",
        nextAction: "Start your next mission",
        canProceed: false,
        intelQuality: intelScore,
        evidenceCount,
      };
    case "rejected":
      return {
        stage: "briefing",
        stageIndex: 0,
        totalStages: 6,
        stageLabel: "Rejected",
        nextAction: "Plant a new seed",
        canProceed: false,
        intelQuality: 0,
        evidenceCount: 0,
      };
    default:
      return {
        stage: "briefing",
        stageIndex: 0,
        totalStages: 6,
        stageLabel: state,
        nextAction: "Unknown state",
        canProceed: false,
        intelQuality: 0,
        evidenceCount: 0,
      };
  }
}

/** Get all assignments for an employee, sorted by workflow progress.
 *  The "current" assignment is the one furthest along but not yet finalized. */
export function getActiveWorkflow(employeeId: string): HypothesisAssignment | undefined {
  const assignments = loadHypothesisAssignments().filter((a) => a.employeeId === employeeId);
  const active = assignments.filter(
    (a) => a.state !== "finalized" && a.state !== "rejected" && a.state !== "falsified",
  );
  if (active.length === 0) return undefined;

  // Sort by stage index descending — the furthest-along assignment is "current"
  const sorted = active.sort((a, b) => {
    const aStatus = getWorkflowStatus(a);
    const bStatus = getWorkflowStatus(b);
    return bStatus.stageIndex - aStatus.stageIndex;
  });

  return sorted[0];
}

/** Get completed cycles count for an employee — how many loops have they closed? */
export function getCompletedCycles(employeeId: string): number {
  return loadHypothesisAssignments().filter(
    (a) => a.employeeId === employeeId && (a.state === "finalized" || a.state === "falsified"),
  ).length;
}
