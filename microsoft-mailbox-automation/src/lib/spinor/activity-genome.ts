/**
 * Activity Genome & Anti-Fatigue Engine.
 *
 * Each mission is represented as a multi-dimensional genome describing its
 * conceptual fingerprint. The engine computes similarity between a candidate
 * mission and recent history, and rotates the activity mode when repetition
 * exceeds a configurable threshold.
 *
 * Goal: enough continuity to build mastery, enough novelty to sustain
 * attention, enough discipline to produce trustworthy evidence.
 */

import {
  ActivityGenome,
  ActivityMode,
  GenomeSimilarityResult,
} from "@/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ActivityGenomeConfig {
  /** Jaccard/cosine similarity above which a mission is considered repetitive. */
  fatigueThreshold: number;
  /** Number of recent missions to compare against. */
  recentWindowSize: number;
  /** How many recent missions of the same mode before forced rotation. */
  maxConsecutiveSameMode: number;
}

export const DEFAULT_GENOME_CONFIG: ActivityGenomeConfig = {
  fatigueThreshold: 0.75,
  recentWindowSize: 5,
  maxConsecutiveSameMode: 3,
};

// ---------------------------------------------------------------------------
// Mode labels
// ---------------------------------------------------------------------------

export const MODE_LABEL: Record<ActivityMode, string> = {
  execution: "Execution",
  observation: "Observation",
  experiment_design: "Experiment Design",
  customer_research: "Customer Research",
  workflow_creation: "Workflow Creation",
  automation: "Automation",
  replication: "Replication",
  adversarial_review: "Adversarial Review",
  process_teaching: "Process Teaching",
  failure_analysis: "Failure Analysis",
  cross_functional: "Cross-Functional Collaboration",
  business_model_exploration: "Business-Model Exploration",
};

// ---------------------------------------------------------------------------
// Derive the activity mode from a genome
// ---------------------------------------------------------------------------

export function deriveMode(genome: ActivityGenome): ActivityMode {
  // Deterministic mapping based on the dominant genome dimensions.
  if (genome.uncertaintyLevel > 0.7 && genome.cognitiveMode === "analysis") {
    return "experiment_design";
  }
  if (genome.cognitiveMode === "observation" || genome.socialInteraction < 0.2) {
    return "observation";
  }
  if (genome.skillRequired === "automation" || genome.automationLevel > 0.7) {
    return "automation";
  }
  if (genome.skillRequired === "workflow_design") {
    return "workflow_creation";
  }
  if (genome.skillRequired === "customer_research") {
    return "customer_research";
  }
  if (genome.skillRequired === "replication") {
    return "replication";
  }
  if (genome.skillRequired === "adversarial_review") {
    return "adversarial_review";
  }
  if (genome.skillRequired === "teaching") {
    return "process_teaching";
  }
  if (genome.skillRequired === "failure_analysis") {
    return "failure_analysis";
  }
  if (genome.collaborationLevel > 0.7) {
    return "cross_functional";
  }
  if (genome.skillRequired === "business_model") {
    return "business_model_exploration";
  }
  return "execution";
}

// ---------------------------------------------------------------------------
// Genome similarity — weighted Jaccard over categorical + numeric dimensions
// ---------------------------------------------------------------------------

/**
 * Compute similarity between two genomes in [0, 1].
 * Categorical dimensions use exact-match (1 if same, 0 otherwise).
 * Numeric dimensions use 1 - |a-b| (normalized to 0..1).
 */
export function genomeSimilarity(a: ActivityGenome, b: ActivityGenome): number {
  const categoricalKeys: (keyof ActivityGenome)[] = [
    "customerType",
    "stakeholder",
    "channel",
    "taskStructure",
    "location",
    "cognitiveMode",
    "researchQuestion",
    "skillRequired",
    "timeHorizon",
  ];
  const numericKeys: (keyof ActivityGenome)[] = [
    "automationLevel",
    "socialInteraction",
    "collaborationLevel",
    "uncertaintyLevel",
  ];

  let sum = 0;
  let count = 0;

  for (const key of categoricalKeys) {
    const va = String(a[key] ?? "").toLowerCase();
    const vb = String(b[key] ?? "").toLowerCase();
    sum += va === vb && va !== "" ? 1 : 0;
    count += 1;
  }
  for (const key of numericKeys) {
    const va = Number(a[key] ?? 0);
    const vb = Number(b[key] ?? 0);
    sum += 1 - Math.min(1, Math.abs(va - vb));
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Anti-fatigue evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a candidate mission against recent history.
 * Returns the similarity to the most similar recent mission, whether the
 * fatigue threshold is exceeded, and the recommended mode.
 */
export function evaluateFatigue(
  candidate: ActivityGenome,
  recent: ActivityGenome[],
  config: ActivityGenomeConfig = DEFAULT_GENOME_CONFIG,
): GenomeSimilarityResult {
  const window = recent.slice(0, config.recentWindowSize);

  let mostSimilarId: string | null = null;
  let maxSim = 0;
  for (const past of window) {
    const sim = genomeSimilarity(candidate, past);
    if (sim > maxSim) {
      maxSim = sim;
      mostSimilarId = past.missionId;
    }
  }

  const exceeds = maxSim >= config.fatigueThreshold;

  // Determine consecutive same-mode count
  const candidateMode = deriveMode(candidate);
  const recentModes = window.map(deriveMode);
  let consecutive = 0;
  for (const m of recentModes) {
    if (m === candidateMode) consecutive += 1;
    else break;
  }

  let recommendedMode = candidateMode;
  let rationale = `Candidate mode: ${MODE_LABEL[candidateMode]}. Similarity to nearest recent mission: ${maxSim.toFixed(2)}.`;

  if (exceeds) {
    recommendedMode = rotateMode(candidateMode, recentModes);
    rationale = `Fatigue threshold (${config.fatigueThreshold}) exceeded (similarity ${maxSim.toFixed(2)} to mission ${mostSimilarId}). Rotating from ${MODE_LABEL[candidateMode]} to ${MODE_LABEL[recommendedMode]}.`;
  } else if (consecutive >= config.maxConsecutiveSameMode) {
    recommendedMode = rotateMode(candidateMode, recentModes);
    rationale = `${consecutive} consecutive ${MODE_LABEL[candidateMode]} missions. Rotating to ${MODE_LABEL[recommendedMode]} to sustain attention.`;
  }

  return {
    candidateId: candidate.missionId,
    mostSimilarMissionId: mostSimilarId,
    similarity: Math.round(maxSim * 10000) / 10000,
    exceedsFatigueThreshold: exceeds,
    recommendedMode,
    rationale,
  };
}

// ---------------------------------------------------------------------------
// Mode rotation — deterministic, avoids recent modes
// ---------------------------------------------------------------------------

const ALL_MODES: ActivityMode[] = [
  "execution",
  "observation",
  "experiment_design",
  "customer_research",
  "workflow_creation",
  "automation",
  "replication",
  "adversarial_review",
  "process_teaching",
  "failure_analysis",
  "cross_functional",
  "business_model_exploration",
];

/**
 * Pick a mode that is different from the current one and least represented
 * in recent history. This ensures diversity without randomness.
 */
export function rotateMode(current: ActivityMode, recentModes: ActivityMode[]): ActivityMode {
  const counts = new Map<ActivityMode, number>();
  for (const m of ALL_MODES) counts.set(m, 0);
  for (const m of recentModes) {
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }

  // Exclude the current mode; prefer modes with the lowest recent count
  const candidates = ALL_MODES.filter((m) => m !== current);
  candidates.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

  return candidates[0] ?? "execution";
}

// ---------------------------------------------------------------------------
// Mastery detection — for automation-as-leveling
// ---------------------------------------------------------------------------

export interface MasterySignal {
  missionId: string;
  repeatedSuccess: boolean;
  stableQuality: boolean;
  lowDeviation: boolean;
  lowJudgmentRequired: boolean;
  predictableInputs: boolean;
  acceptableRisk: boolean;
  complianceSuitable: boolean;
  lowExceptionRate: boolean;
  mastered: boolean;
}

export interface MasteryInput {
  missionId: string;
  successCount: number;
  failureCount: number;
  qualityVariance: number; // 0..1, lower is better
  deviationRate: number; // 0..1, lower is better
  judgmentRequired: boolean;
  inputPredictability: number; // 0..1, higher is better
  riskLevel: "low" | "moderate" | "high";
  complianceSensitive: boolean;
  exceptionRate: number; // 0..1, lower is better
}

export interface MasteryConfig {
  minSuccessCount: number;
  maxQualityVariance: number;
  maxDeviationRate: number;
  minInputPredictability: number;
  maxExceptionRate: number;
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  minSuccessCount: 4,
  maxQualityVariance: 0.15,
  maxDeviationRate: 0.1,
  minInputPredictability: 0.8,
  maxExceptionRate: 0.1,
};

/**
 * Determine whether a workflow has been mastered and is a candidate for
 * automation. Mastered routines stop being recurring missions and unlock
 * a higher-level mission instead.
 */
export function detectMastery(
  input: MasteryInput,
  config: MasteryConfig = DEFAULT_MASTERY_CONFIG,
): MasterySignal {
  const repeatedSuccess = input.successCount >= config.minSuccessCount && input.failureCount === 0;
  const stableQuality = input.qualityVariance <= config.maxQualityVariance;
  const lowDeviation = input.deviationRate <= config.maxDeviationRate;
  const lowJudgmentRequired = !input.judgmentRequired;
  const predictableInputs = input.inputPredictability >= config.minInputPredictability;
  const acceptableRisk = input.riskLevel === "low";
  const complianceSuitable = !input.complianceSensitive;
  const lowExceptionRate = input.exceptionRate <= config.maxExceptionRate;

  const mastered =
    repeatedSuccess && stableQuality && lowDeviation && lowJudgmentRequired &&
    predictableInputs && acceptableRisk && complianceSuitable && lowExceptionRate;

  return {
    missionId: input.missionId,
    repeatedSuccess,
    stableQuality,
    lowDeviation,
    lowJudgmentRequired,
    predictableInputs,
    acceptableRisk,
    complianceSuitable,
    lowExceptionRate,
    mastered,
  };
}

/**
 * Components that may be automated once mastery is detected.
 * Human ownership is retained for strategy, relationship judgment,
 * experiment modification, external approval, exceptions, interpretation,
 * and compliance-sensitive decisions.
 */
export const AUTOMATABLE_COMPONENTS = [
  "data_preparation",
  "account_matching",
  "scheduling",
  "approved_draft_preparation",
  "crm_documentation",
  "reminder_generation",
  "outcome_monitoring",
  "internal_routing",
] as const;

export const HUMAN_RETAINED_COMPONENTS = [
  "strategy_selection",
  "relationship_judgment",
  "experiment_modification",
  "external_approval",
  "exception_handling",
  "result_interpretation",
  "compliance_sensitive_decisions",
] as const;
