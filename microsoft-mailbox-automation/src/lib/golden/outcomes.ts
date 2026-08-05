import { nanoid } from "nanoid";
import {
  HypothesisOutcome,
  HypothesisAttribution,
  HypothesisAssignment,
  SuccessKind,
  HypothesisAnatomy,
} from "@/types";
import {
  loadHypothesisOutcomes,
  saveHypothesisOutcomes,
  loadHypothesisAttributions,
  saveHypothesisAttributions,
  loadHypothesisAssignments,
  saveHypothesisAssignments,
  loadHypotheses,
} from "@/lib/config";
import { llmAttributeOutcome } from "./llm-client";
import { generateDerivativesFromAttribution } from "./derivatives";

const now = () => new Date().toISOString();

export function listOutcomes(): HypothesisOutcome[] {
  return loadHypothesisOutcomes();
}

export function getOutcomesForEmployee(employeeId: string): HypothesisOutcome[] {
  return loadHypothesisOutcomes().filter((o) => o.employeeId === employeeId);
}

export function getOutcomesForAssignment(assignmentId: string): HypothesisOutcome[] {
  return loadHypothesisOutcomes().filter((o) => o.assignmentId === assignmentId);
}

export function getOutcomesForHypothesis(hypothesisId: string): HypothesisOutcome[] {
  return loadHypothesisOutcomes().filter((o) => o.hypothesisId === hypothesisId);
}

export interface OutcomeInput {
  assignmentId: string;
  successKind: SuccessKind;
  outcomeDescription: string;
  metrics: { metric: string; value: number; unit: string; baseline: number; higherIsBetter: boolean }[];
  falsified: boolean;
  falsificationEvidence?: string;
  contextAtObservation?: { externalFactors?: string[]; concurrentHypotheses?: string[] };
}

/** Record a measured outcome. Honest falsification is a valuable result, not a failure. */
export function recordOutcome(input: OutcomeInput): HypothesisOutcome {
  const assignment = loadHypothesisAssignments().find((a) => a.id === input.assignmentId);
  if (!assignment) throw new Error(`Assignment ${input.assignmentId} not found`);

  const outcome: HypothesisOutcome = {
    id: `out_${nanoid(10)}`,
    assignmentId: input.assignmentId,
    hypothesisId: assignment.hypothesisId,
    employeeId: assignment.employeeId,
    observedAt: now(),
    successKind: input.successKind,
    outcomeDescription: input.outcomeDescription,
    metrics: input.metrics,
    falsified: input.falsified,
    falsificationEvidence: input.falsificationEvidence,
    contextAtObservation: input.contextAtObservation || {},
  };

  const all = loadHypothesisOutcomes();
  all.push(outcome);
  saveHypothesisOutcomes(all);

  // Advance assignment state.
  assignment.state = input.falsified ? "falsified" : "observed";
  const assignments = loadHypothesisAssignments();
  const idx = assignments.findIndex((a) => a.id === assignment.id);
  if (idx >= 0) {
    assignments[idx] = assignment;
    saveHypothesisAssignments(assignments);
  }

  return outcome;
}

/** Compute a normalized effect size from outcome metrics vs baseline. */
export function computeEffectSize(outcome: HypothesisOutcome): number {
  if (outcome.metrics.length === 0) return 0;
  const effects = outcome.metrics.map((m) => {
    const delta = m.value - m.baseline;
    const normalized = m.baseline !== 0 ? delta / Math.abs(m.baseline) : delta / 100;
    return m.higherIsBetter ? normalized : -normalized;
  });
  const avg = effects.reduce((a, b) => a + b, 0) / effects.length;
  // Clamp to -1..1
  return Math.max(-1, Math.min(1, avg));
}

export function listAttributions(): HypothesisAttribution[] {
  return loadHypothesisAttributions();
}

export function getAttributionById(id: string): HypothesisAttribution | undefined {
  return loadHypothesisAttributions().find((a) => a.id === id);
}

export function getAttributionForOutcome(outcomeId: string): HypothesisAttribution | undefined {
  return loadHypothesisAttributions().find((a) => a.outcomeId === outcomeId);
}

/** Perform causal attribution for an outcome.
 *
 * Determines which component appears responsible: parent hypothesis, employee
 * modification, territory, execution quality, external change, or unresolved.
 * Generates derivatives from unexplained variance. (GOLDEN NODE §8, §7) */
export function attributeOutcome(outcomeId: string): HypothesisAttribution | undefined {
  const outcome = loadHypothesisOutcomes().find((o) => o.id === outcomeId);
  if (!outcome) return undefined;
  if (getAttributionForOutcome(outcomeId)) return getAttributionForOutcome(outcomeId);

  const assignment = loadHypothesisAssignments().find((a) => a.id === outcome.assignmentId);
  if (!assignment) return undefined;

  const effect = computeEffectSize(outcome);
  const method = selectAttributionMethod(outcome, assignment);
  const { responsibleFactor, unexplainedVariance, confidence, reasoning, counterfactual } =
    resolveResponsibleFactor(outcome, assignment, effect, method);

  const attribution: HypothesisAttribution = {
    id: `attr_${nanoid(10)}`,
    outcomeId,
    hypothesisId: outcome.hypothesisId,
    employeeId: outcome.employeeId,
    estimatedEffect: effect,
    attributionConfidence: confidence,
    method,
    counterfactualEstimate: counterfactual,
    unexplainedVariance,
    responsibleFactor,
    reasoning,
    attributedAt: now(),
  };

  const all = loadHypothesisAttributions();
  all.push(attribution);
  saveHypothesisAttributions(all);

  // Link outcome to attribution.
  const outcomes = loadHypothesisOutcomes();
  const oIdx = outcomes.findIndex((o) => o.id === outcomeId);
  if (oIdx >= 0) {
    outcomes[oIdx].attributionId = attribution.id;
    saveHypothesisOutcomes(outcomes);
  }

  // Advance assignment state to attributed.
  const assignments = loadHypothesisAssignments();
  const aIdx = assignments.findIndex((a) => a.id === assignment.id);
  if (aIdx >= 0) {
    assignments[aIdx].state = "attributed";
    saveHypothesisAssignments(assignments);
  }

  // Generate derivatives from unexplained variance.
  const parentHypothesis = loadHypothesisAssignments(); // placeholder to satisfy linter
  void parentHypothesis;
  const hypothesis = getHypothesisForOutcome(outcome);
  if (hypothesis) {
    generateDerivativesFromAttribution(attribution, hypothesis);
  }

  return attribution;
}

/**
 * LLM-enhanced attribution: the LLM interprets which factor is responsible
 * for the observed outcome. Falls back to the deterministic attribution if
 * the LLM is unavailable. (GOLDEN NODE §8)
 */
export async function attributeOutcomeWithLLM(outcomeId: string): Promise<{
  attribution: HypothesisAttribution | undefined;
  llmUsed: boolean;
  llmError?: string;
}> {
  const outcome = loadHypothesisOutcomes().find((o) => o.id === outcomeId);
  if (!outcome) return { attribution: undefined, llmUsed: false };
  if (getAttributionForOutcome(outcomeId)) {
    return { attribution: getAttributionForOutcome(outcomeId), llmUsed: false };
  }
  const assignment = loadHypothesisAssignments().find((a) => a.id === outcome.assignmentId);
  if (!assignment) return { attribution: undefined, llmUsed: false };
  const hypothesis = (loadHypotheses() as HypothesisAnatomy[]).find((h) => h.id === outcome.hypothesisId);

  const llmResult = await llmAttributeOutcome(
    hypothesis?.claim || outcome.hypothesisId,
    outcome.outcomeDescription,
    outcome.metrics,
    Boolean(assignment.modifiedDimension),
    assignment.modifiedDimension,
    outcome.contextAtObservation.externalFactors
  );

  if (llmResult.used && llmResult.result) {
    const r = llmResult.result;
    const validFactors = ["parent_hypothesis", "employee_modification", "territory", "execution_quality", "external_change", "unresolved"];
    const factor = validFactors.includes(r.responsibleFactor) ? r.responsibleFactor : "unresolved";
    const effect = computeEffectSize(outcome);
    const method = selectAttributionMethod(outcome, assignment);
    const attribution: HypothesisAttribution = {
      id: `attr_${nanoid(10)}`,
      outcomeId,
      hypothesisId: outcome.hypothesisId,
      employeeId: outcome.employeeId,
      estimatedEffect: effect,
      attributionConfidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
      method,
      counterfactualEstimate: r.counterfactualEstimate || "Counterfactual not estimated.",
      unexplainedVariance: Math.max(0, Math.min(1, Number(r.unexplainedVariance) || 0.3)),
      responsibleFactor: factor as HypothesisAttribution["responsibleFactor"],
      reasoning: r.reasoning || "LLM attribution reasoning unavailable.",
      attributedAt: now(),
    };
    const all = loadHypothesisAttributions();
    all.push(attribution);
    saveHypothesisAttributions(all);
    const outcomes = loadHypothesisOutcomes();
    const oIdx = outcomes.findIndex((o) => o.id === outcomeId);
    if (oIdx >= 0) { outcomes[oIdx].attributionId = attribution.id; saveHypothesisOutcomes(outcomes); }
    const assignments = loadHypothesisAssignments();
    const aIdx = assignments.findIndex((a) => a.id === assignment.id);
    if (aIdx >= 0) { assignments[aIdx].state = "attributed"; saveHypothesisAssignments(assignments); }
    if (hypothesis) generateDerivativesFromAttribution(attribution, hypothesis);
    return { attribution, llmUsed: true };
  }

  // Deterministic fallback
  return { attribution: attributeOutcome(outcomeId), llmUsed: false, llmError: llmResult.error };
}

function getHypothesisForOutcome(outcome: HypothesisOutcome): HypothesisAnatomy | undefined {
  // Lazy import to avoid circular load-order issues.
  const { loadHypotheses } = require("@/lib/config");
  return (loadHypotheses() as HypothesisAnatomy[]).find((h) => h.id === outcome.hypothesisId);
}

function selectAttributionMethod(
  outcome: HypothesisOutcome,
  assignment: HypothesisAssignment
): HypothesisAttribution["method"] {
  // If there are concurrent hypotheses, comparison group is unreliable.
  const concurrent = outcome.contextAtObservation.concurrentHypotheses?.length || 0;
  if (concurrent === 0 && assignment.trialNumber > 1) return "matched_pairs";
  if (concurrent === 0) return "before_after";
  if (concurrent > 0 && assignment.trialNumber > 1) return "comparison_group";
  return "expert_judgment";
}

function resolveResponsibleFactor(
  outcome: HypothesisOutcome,
  assignment: HypothesisAssignment,
  effect: number,
  method: HypothesisAttribution["method"]
): {
  responsibleFactor: HypothesisAttribution["responsibleFactor"];
  unexplainedVariance: number;
  confidence: number;
  reasoning: string;
  counterfactual: string;
} {
  // Heuristic attribution model (deterministic, no fabricated data).
  let unexplained = 0.3; // base uncertainty
  let confidence = 0.5;
  let factor: HypothesisAttribution["responsibleFactor"] = "unresolved";
  const reasons: string[] = [];

  if (assignment.state === "modified" || assignment.modifiedDimension) {
    factor = "employee_modification";
    unexplained = 0.2;
    confidence = 0.65;
    reasons.push(`Employee modified the ${assignment.modifiedDimension?.replace(/_/g, " ")} dimension.`);
  } else if (effect > 0.15) {
    factor = "parent_hypothesis";
    unexplained = 0.25;
    confidence = 0.6;
    reasons.push("Positive effect with no employee modification; parent hypothesis is the leading explanation.");
  } else if (effect <= 0.05 && effect >= -0.05) {
    factor = "external_change";
    unexplained = 0.4;
    confidence = 0.35;
    reasons.push("Effect near zero; external change or noise is plausible.");
  } else if (effect < -0.05) {
    factor = "execution_quality";
    unexplained = 0.35;
    confidence = 0.4;
    reasons.push("Negative effect; execution quality or mismatch is a candidate.");
  }

  // External factors increase unexplained variance.
  const external = outcome.contextAtObservation.externalFactors?.length || 0;
  unexplained = Math.min(0.8, unexplained + external * 0.05);
  if (external > 0) {
    reasons.push(`${external} external factor(s) recorded, raising unexplained variance.`);
    if (factor === "parent_hypothesis") {
      factor = "unresolved";
      confidence -= 0.1;
    }
  }

  // Method confidence adjustment.
  if (method === "matched_pairs") confidence += 0.1;
  if (method === "comparison_group") confidence += 0.05;
  if (method === "expert_judgment") confidence -= 0.1;
  confidence = Math.max(0.1, Math.min(0.95, confidence));

  // Territory factor: if multiple territories involved, territory is a candidate.
  if (factor === "unresolved" && assignment.trialNumber > 2) {
    factor = "territory";
    reasons.push("Repeated trials with unresolved attribution; territory structure is a candidate.");
  }

  const reasoning = reasons.join(" ");
  const counterfactual = `Without the intervention, predicted outcome ≈ baseline (effect ${effect.toFixed(2)} attributed to ${factor}).`;

  return { responsibleFactor: factor, unexplainedVariance: unexplained, confidence, reasoning, counterfactual };
}

/** Summarize performance for a hypothesis across all its outcomes. */
export interface HypothesisPerformance {
  hypothesisId: string;
  outcomeCount: number;
  averageEffect: number;
  falsificationCount: number;
  supportedCount: number;
  averageConfidence: number;
}

export function getHypothesisPerformance(hypothesisId: string): HypothesisPerformance {
  const outcomes = getOutcomesForHypothesis(hypothesisId);
  const attributions = loadHypothesisAttributions().filter((a) => a.hypothesisId === hypothesisId);
  const effects = outcomes.map((o) => computeEffectSize(o));
  const averageEffect = effects.length ? effects.reduce((a, b) => a + b, 0) / effects.length : 0;
  return {
    hypothesisId,
    outcomeCount: outcomes.length,
    averageEffect,
    falsificationCount: outcomes.filter((o) => o.falsified).length,
    supportedCount: outcomes.filter((o) => !o.falsified).length,
    averageConfidence: attributions.length
      ? attributions.reduce((a, b) => a + b.attributionConfidence, 0) / attributions.length
      : 0,
  };
}
