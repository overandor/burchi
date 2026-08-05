import { nanoid } from "nanoid";
import {
  HypothesisDerivative,
  HypothesisAnatomy,
  InnovationDimension,
  HypothesisAttribution,
} from "@/types";
import { loadDerivatives, saveDerivatives, loadHypotheses, saveHypotheses } from "@/lib/config";
import { buildHypothesisFromPriorArt } from "./prior-art";
import { getPriorArtById } from "./prior-art";
import { llmProposeDerivatives } from "./llm-client";

const now = () => new Date().toISOString();

export function listDerivatives(): HypothesisDerivative[] {
  return loadDerivatives();
}

export function getDerivativeById(id: string): HypothesisDerivative | undefined {
  return loadDerivatives().find((d) => d.id === id);
}

export function getDerivativesForParent(parentHypothesisId: string): HypothesisDerivative[] {
  return loadDerivatives().filter((d) => d.parentHypothesisId === parentHypothesisId);
}

function upsertDerivative(d: HypothesisDerivative): void {
  const all = loadDerivatives();
  const idx = all.findIndex((x) => x.id === d.id);
  if (idx >= 0) all[idx] = d;
  else all.push(d);
  saveDerivatives(all);
}

export interface DerivativeProposal {
  parentHypothesisId: string;
  claim: string;
  modifiedDimension: InnovationDimension;
  origin: "derivative_human" | "derivative_llm" | "derivative_attribution";
  proposedByEmployeeId?: string;
  rationale: string;
  generatedFromUnexplainedVariance?: boolean;
}

/** A representative can propose a derivative. The LLM can propose a derivative.
 *  The attribution system can generate a derivative from unexplained results. */
export function proposeDerivative(p: DerivativeProposal): HypothesisDerivative {
  const derivative: HypothesisDerivative = {
    id: `der_${nanoid(10)}`,
    parentHypothesisId: p.parentHypothesisId,
    claim: p.claim,
    modifiedDimension: p.modifiedDimension,
    origin: p.origin,
    proposedByEmployeeId: p.proposedByEmployeeId,
    rationale: p.rationale,
    status: "proposed",
    createdAt: now(),
    generatedFromUnexplainedVariance: p.generatedFromUnexplainedVariance,
  };
  upsertDerivative(derivative);
  return derivative;
}

/** Generate derivative candidates from unexplained variance in an attribution result. */
export function generateDerivativesFromAttribution(
  attribution: HypothesisAttribution,
  parent: HypothesisAnatomy
): HypothesisDerivative[] {
  const generated: HypothesisDerivative[] = [];
  if (attribution.unexplainedVariance < 0.15) return generated;
  if (attribution.responsibleFactor === "employee_modification") {
    // The employee's modification appears responsible; branch on the same dimension.
    const dim = inferDimensionFromReasoning(attribution.reasoning) || "stakeholder";
    generated.push(
      proposeDerivative({
        parentHypothesisId: parent.id,
        claim: `Variant of parent emphasizing the ${dim.replace(/_/g, " ")} modification.`,
        modifiedDimension: dim,
        origin: "derivative_attribution",
        rationale: `Attribution identified employee modification as the responsible factor (unexplained variance ${attribution.unexplainedVariance.toFixed(2)}).`,
        generatedFromUnexplainedVariance: true,
      })
    );
  }
  if (attribution.responsibleFactor === "territory") {
    generated.push(
      proposeDerivative({
        parentHypothesisId: parent.id,
        claim: `Territory-conditioned variant: parent may only hold in specific territory structures.`,
        modifiedDimension: "stakeholder",
        origin: "derivative_attribution",
        rationale: `Attribution identified territory as the responsible factor; isolate the territory condition.`,
        generatedFromUnexplainedVariance: true,
      })
    );
  }
  if (attribution.responsibleFactor === "unresolved") {
    // Generate one derivative per modifiable dimension to probe what mattered.
    for (const dim of parent.modifiableDimensions.slice(0, 3)) {
      generated.push(
        proposeDerivative({
          parentHypothesisId: parent.id,
          claim: `Probe whether ${dim.replace(/_/g, " ")} is the active ingredient.`,
          modifiedDimension: dim,
          origin: "derivative_attribution",
          rationale: `Attribution unresolved (unexplained variance ${attribution.unexplainedVariance.toFixed(2)}); isolate ${dim}.`,
          generatedFromUnexplainedVariance: true,
        })
      );
    }
  }
  return generated;
}

function inferDimensionFromReasoning(reasoning: string): InnovationDimension | null {
  const r = reasoning.toLowerCase();
  if (r.includes("stakeholder")) return "stakeholder";
  if (r.includes("timing")) return "timing";
  if (r.includes("channel")) return "channel";
  if (r.includes("content") || r.includes("sequence")) return "content_sequence";
  if (r.includes("automation")) return "automation_step";
  if (r.includes("followup") || r.includes("follow-up") || r.includes("interval")) return "followup_interval";
  return null;
}

/** LLM-style permutation generator: produce derivative candidates by permuting
 *  each modifiable dimension of the parent. Uses the deterministic fallback
 *  (one per dimension) — call generateLlmPermutationsAsync for real LLM proposals. */
export function generateLlmPermutations(parent: HypothesisAnatomy): HypothesisDerivative[] {
  const generated: HypothesisDerivative[] = [];
  for (const dim of parent.modifiableDimensions) {
    generated.push(
      proposeDerivative({
        parentHypothesisId: parent.id,
        claim: `LLM permutation: vary ${dim.replace(/_/g, " ")} of the parent hypothesis.`,
        modifiedDimension: dim,
        origin: "derivative_llm",
        rationale: `System-generated permutation to isolate the contribution of the ${dim.replace(/_/g, " ")} dimension.`,
      })
    );
  }
  return generated;
}

/**
 * LLM-powered derivative generation: the LLM proposes intelligent derivatives
 * based on the parent hypothesis and (optionally) observed outcomes. Falls back
 * to the deterministic permutation generator if the LLM is unavailable.
 */
export async function generateLlmPermutationsAsync(
  parent: HypothesisAnatomy,
  outcomeDescription?: string,
  attributionReasoning?: string
): Promise<{ derivatives: HypothesisDerivative[]; llmUsed: boolean; llmError?: string }> {
  const llmResult = await llmProposeDerivatives(
    parent.claim,
    parent.modifiableDimensions,
    outcomeDescription,
    attributionReasoning
  );
  if (llmResult.used && llmResult.derivatives.length > 0) {
    const generated: HypothesisDerivative[] = [];
    for (const d of llmResult.derivatives) {
      const dim = resolveDimension(d.modifiedDimension, parent.modifiableDimensions);
      if (!dim) continue; // skip derivatives with unrecognized dimensions
      generated.push(
        proposeDerivative({
          parentHypothesisId: parent.id,
          claim: d.claim,
          modifiedDimension: dim,
          origin: "derivative_llm",
          rationale: d.rationale,
        })
      );
    }
    if (generated.length > 0) {
      return { derivatives: generated, llmUsed: true };
    }
  }
  // Deterministic fallback
  return { derivatives: generateLlmPermutations(parent), llmUsed: false, llmError: llmResult.error };
}

function resolveDimension(input: string, allowed: InnovationDimension[]): InnovationDimension | null {
  const lower = input.toLowerCase().replace(/[\s-]/g, "_");
  if (allowed.includes(lower as InnovationDimension)) return lower as InnovationDimension;
  // Fuzzy match
  for (const a of allowed) {
    if (lower.includes(a) || a.includes(lower)) return a;
  }
  return null;
}

/** Promote a derivative into a full HypothesisAnatomy so it can be assigned and tested. */
export function promoteDerivativeToHypothesis(derivativeId: string): HypothesisAnatomy | undefined {
  const d = getDerivativeById(derivativeId);
  if (!d) return undefined;
  const parent = loadHypotheses().find((h) => h.id === d.parentHypothesisId);
  if (!parent) return undefined;
  const pa = getPriorArtById(parent.priorArtId);
  if (!pa) return undefined;

  const { hypothesis } = buildHypothesisFromPriorArt(pa, {
    claim: d.claim,
    sourceDomains: parent.sourceDomains,
    targetCondition: parent.targetCondition,
    intervention: parent.intervention,
    control: parent.control,
    primaryOutcome: parent.primaryOutcome,
    secondaryOutcomes: parent.secondaryOutcomes,
    knownConfounders: parent.knownConfounders,
    complianceBoundary: parent.complianceBoundary,
    expectedValue: parent.expectedValue,
    primaryUncertainty: `Whether the ${d.modifiedDimension.replace(/_/g, " ")} modification is the active ingredient.`,
    novelComponent: d.claim,
    fixedConstraints: parent.fixedConstraints,
    modifiableDimensions: parent.modifiableDimensions.filter((m) => m !== d.modifiedDimension),
    targetEngagementModes: parent.targetEngagementModes,
    parentHypothesisId: parent.id,
    kind: "discovery",
    researchRisk: "moderate",
  });
  hypothesis.origin = d.origin;
  hypothesis.id = `hn_${nanoid(8)}`;

  const all = loadHypotheses();
  all.push(hypothesis);
  saveHypotheses(all);

  d.status = "testing";
  upsertDerivative(d);
  return hypothesis;
}

export function markDerivativeSupported(derivativeId: string): HypothesisDerivative | undefined {
  const d = getDerivativeById(derivativeId);
  if (!d) return undefined;
  d.status = "supported";
  upsertDerivative(d);
  return d;
}

export function markDerivativeFalsified(derivativeId: string): HypothesisDerivative | undefined {
  const d = getDerivativeById(derivativeId);
  if (!d) return undefined;
  d.status = "falsified";
  upsertDerivative(d);
  return d;
}
