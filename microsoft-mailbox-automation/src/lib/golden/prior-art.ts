import { nanoid } from "nanoid";
import {
  PriorArtRecord,
  PriorArtStatus,
  PriorArtEvidenceState,
  HypothesisAnatomy,
} from "@/types";
import { loadPriorArt, savePriorArt } from "@/lib/config";
import { checkHypothesis } from "./compliance";
import { llmResearchPriorArt } from "./llm-client";

const now = () => new Date().toISOString();

export interface PriorArtInput {
  hypothesisClaim: string;
  testedInMarket: boolean;
  testedInAdjacentIndustries: boolean;
  adjacentSupportSummary: string;
  sourceDomains: string[];
  responsibleComponent: string | null;
  requiredConditions: string[];
  risksAndConfounders: string[];
  genuinelyUnknown: string[];
}

/**
 * Classify prior-art evidence into one of five statuses.
 *
 * The product must distinguish "nobody has tested this" from "somebody tested
 * this and it failed" from "the available research is too poor to know".
 * Otherwise "novelty" becomes ignorance wearing sunglasses. (GOLDEN NODE §2)
 */
export function classifyPriorArt(input: PriorArtInput): {
  status: PriorArtStatus;
  evidenceState: PriorArtEvidenceState;
  researchConfidence: number;
} {
  const {
    testedInMarket,
    testedInAdjacentIndustries,
    adjacentSupportSummary,
    genuinelyUnknown,
  } = input;

  // Evidence state resolution
  let evidenceState: PriorArtEvidenceState;
  const supportedAdjacent = /support/i.test(adjacentSupportSummary);
  const failedAdjacent = /fail|no effect|negative/i.test(adjacentSupportSummary);

  if (testedInMarket && supportedAdjacent) {
    evidenceState = "supported";
  } else if (testedInMarket && failedAdjacent && !supportedAdjacent) {
    evidenceState = "failed";
  } else if (testedInAdjacentIndustries && supportedAdjacent) {
    evidenceState = "supported"; // supported elsewhere, not yet in-market
  } else if (testedInAdjacentIndustries && failedAdjacent) {
    evidenceState = "failed";
  } else if (genuinelyUnknown.length > 0 && !testedInMarket && !testedInAdjacentIndustries) {
    evidenceState = "inconclusive";
  } else if (!testedInMarket && !testedInAdjacentIndustries) {
    evidenceState = "untested";
  } else {
    evidenceState = "inconclusive";
  }

  // Status resolution
  let status: PriorArtStatus;
  if (testedInMarket && evidenceState === "supported") {
    status = "established";
  } else if (!testedInMarket && testedInAdjacentIndustries && supportedAdjacent) {
    status = "transfer_candidate";
  } else if (testedInMarket && evidenceState === "supported" && input.responsibleComponent) {
    // Existing components arranged in a new sequence
    status = "novel_permutation";
  } else if (!testedInMarket && !testedInAdjacentIndustries && genuinelyUnknown.length === 0) {
    // Genuinely new workflow/channel/automation with a plausible mechanism
    status = "new_mechanism";
  } else if (evidenceState === "failed" || (genuinelyUnknown.length > 2 && !supportedAdjacent)) {
    status = "unsupported";
  } else if (evidenceState === "untested") {
    status = "new_mechanism";
  } else {
    status = "transfer_candidate";
  }

  // Unsupported must never be assigned.
  if (evidenceState === "failed" && !supportedAdjacent) {
    status = "unsupported";
  }

  const researchConfidence = computeConfidence(input, status, evidenceState);
  return { status, evidenceState, researchConfidence };
}

function computeConfidence(
  input: PriorArtInput,
  status: PriorArtStatus,
  evidenceState: PriorArtEvidenceState
): number {
  let c = 0.3;
  if (input.testedInMarket) c += 0.25;
  if (input.testedInAdjacentIndustries) c += 0.2;
  if (input.responsibleComponent) c += 0.1;
  if (input.requiredConditions.length > 0) c += 0.05;
  if (evidenceState === "supported") c += 0.15;
  if (evidenceState === "failed") c -= 0.2;
  if (evidenceState === "inconclusive") c -= 0.05;
  if (status === "unsupported") c = Math.min(c, 0.2);
  return Math.max(0, Math.min(1, c));
}

/**
 * LLM-enhanced research: the LLM investigates the claim and returns structured
 * prior-art evidence. Falls back to the deterministic classifier if the LLM is
 * unavailable. (GOLDEN NODE §8 — human–LLM innovation spinor)
 */
export async function researchHypothesisWithLLM(claim: string): Promise<{
  record: PriorArtRecord;
  llmUsed: boolean;
  llmError?: string;
}> {
  const llmResult = await llmResearchPriorArt(claim);
  let input: PriorArtInput;
  if (llmResult.used && llmResult.result) {
    const r = llmResult.result;
    input = {
      hypothesisClaim: claim,
      testedInMarket: Boolean(r.testedInMarket),
      testedInAdjacentIndustries: Boolean(r.testedInAdjacentIndustries),
      adjacentSupportSummary: r.adjacentSupportSummary || "LLM research inconclusive.",
      sourceDomains: Array.isArray(r.sourceDomains) ? r.sourceDomains : [],
      responsibleComponent: r.responsibleComponent || null,
      requiredConditions: Array.isArray(r.requiredConditions) ? r.requiredConditions : [],
      risksAndConfounders: Array.isArray(r.risksAndConfounders) ? r.risksAndConfounders : [],
      genuinelyUnknown: Array.isArray(r.genuinelyUnknown) ? r.genuinelyUnknown : [],
    };
  } else {
    // Deterministic fallback: classify as untested.
    input = {
      hypothesisClaim: claim,
      testedInMarket: false,
      testedInAdjacentIndustries: false,
      adjacentSupportSummary: "No prior-art research available (deterministic fallback).",
      sourceDomains: [],
      responsibleComponent: null,
      requiredConditions: [],
      risksAndConfounders: [],
      genuinelyUnknown: [claim],
    };
  }
  const record = researchHypothesis(input);
  return { record, llmUsed: llmResult.used, llmError: llmResult.error };
}

/** Run the research pipeline and persist a prior-art record. */
export function researchHypothesis(input: PriorArtInput): PriorArtRecord {
  const { status, evidenceState, researchConfidence } = classifyPriorArt(input);
  const record: PriorArtRecord = {
    id: `pa_${nanoid(10)}`,
    hypothesisClaim: input.hypothesisClaim,
    status,
    evidenceState,
    sourceDomains: input.sourceDomains,
    testedInMarket: input.testedInMarket,
    testedInAdjacentIndustries: input.testedInAdjacentIndustries,
    adjacentSupportSummary: input.adjacentSupportSummary,
    responsibleComponent: input.responsibleComponent,
    requiredConditions: input.requiredConditions,
    risksAndConfounders: input.risksAndConfounders,
    genuinelyUnknown: input.genuinelyUnknown,
    researchConfidence,
    researchedAt: now(),
  };
  const all = loadPriorArt();
  all.push(record);
  savePriorArt(all);
  return record;
}

export function listPriorArt(): PriorArtRecord[] {
  return loadPriorArt();
}

export function getPriorArtById(id: string): PriorArtRecord | undefined {
  return loadPriorArt().find((p) => p.id === id);
}

/** Whether a hypothesis with this prior-art status may be assigned to employees. */
export function isAssignable(status: PriorArtStatus): boolean {
  return status !== "unsupported";
}

/** Build a HypothesisAnatomy from a prior-art record and anatomy fields. */
export function buildHypothesisFromPriorArt(
  pa: PriorArtRecord,
  anatomy: Omit<
    HypothesisAnatomy,
    "id" | "priorArtId" | "priorArtStatus" | "createdAt" | "origin" | "kind" | "researchRisk"
  > & {
    kind?: HypothesisAnatomy["kind"];
    researchRisk?: HypothesisAnatomy["researchRisk"];
  }
): { hypothesis: HypothesisAnatomy; compliance: ReturnType<typeof checkHypothesis> } {
  const hypothesis: HypothesisAnatomy = {
    id: `hn_${nanoid(8)}`,
    priorArtId: pa.id,
    priorArtStatus: pa.status,
    createdAt: now(),
    origin: "research",
    kind: anatomy.kind || defaultKindForStatus(pa.status),
    researchRisk: anatomy.researchRisk || defaultRiskForStatus(pa.status),
    claim: anatomy.claim,
    sourceDomains: anatomy.sourceDomains,
    targetCondition: anatomy.targetCondition,
    intervention: anatomy.intervention,
    control: anatomy.control,
    primaryOutcome: anatomy.primaryOutcome,
    secondaryOutcomes: anatomy.secondaryOutcomes,
    knownConfounders: anatomy.knownConfounders,
    complianceBoundary: anatomy.complianceBoundary,
    expectedValue: anatomy.expectedValue,
    primaryUncertainty: anatomy.primaryUncertainty,
    novelComponent: anatomy.novelComponent,
    fixedConstraints: anatomy.fixedConstraints,
    modifiableDimensions: anatomy.modifiableDimensions,
    targetEngagementModes: anatomy.targetEngagementModes,
    parentHypothesisId: anatomy.parentHypothesisId,
  };
  const compliance = checkHypothesis(hypothesis);
  return { hypothesis, compliance };
}

function defaultKindForStatus(status: PriorArtStatus): HypothesisAnatomy["kind"] {
  switch (status) {
    case "established":
      return "reliable";
    case "transfer_candidate":
      return "fit";
    case "novel_permutation":
      return "discovery";
    case "new_mechanism":
      return "builder";
    default:
      return "discovery";
  }
}

function defaultRiskForStatus(status: PriorArtStatus): HypothesisAnatomy["researchRisk"] {
  switch (status) {
    case "established":
      return "low";
    case "transfer_candidate":
      return "low";
    case "novel_permutation":
      return "moderate";
    case "new_mechanism":
      return "high";
    default:
      return "moderate";
  }
}
