export const EVIDENCE_CLASSES: Readonly<Record<string, string>>;
export const RESULT_STATES: Readonly<Record<string, string>>;
export const COMPLIANCE_STATES: Readonly<Record<string, string>>;
export const DEFAULT_THRESHOLDS: Readonly<{
  minimumExecutionFidelity: number;
  minimumAttributionConfidence: number;
  minimumPortability: number;
  minimumMechanismClarity: number;
  minimumIndependentReplications: number;
  minimumAdmissibleExperiments: number;
  minimumAbsoluteEffectPoints: number;
  minimumCustomerValue: number;
  maximumUnresolvedCriticalConfounders: number;
}>;

export interface EffectInput {
  baselineRate?: number;
  observedRate?: number;
  baselineSuccesses?: number;
  observedSuccesses?: number;
  baselineSampleSize?: number;
  observedSampleSize?: number;
}

export interface EffectResult {
  baselineRate: number;
  observedRate: number;
  baselinePercent: number;
  observedPercent: number;
  absoluteChange: number;
  absoluteChangePercentagePoints: number;
  relativeChange: number | null;
  relativeChangePercent: number | null;
  baselineSampleSize: number | null;
  observedSampleSize: number | null;
  uncertainty: null | {
    method: string;
    confidenceLevel: number;
    lowerPercentagePoints: number;
    upperPercentagePoints: number;
  };
}

export interface Confounder {
  status: "unresolved" | "controlled" | "measured" | "unlikely" | "confirmed" | string;
  severity?: number;
  critical?: boolean;
  [key: string]: unknown;
}

export function calculateEffect(input: EffectInput): EffectResult;
export function confounderAdjustedConfidence(input: {
  baseConfidence: number;
  confounders?: Confounder[];
  executionFidelity?: number;
}): {
  baseConfidence: number;
  executionFidelity: number;
  confounderPenalty: number;
  adjustedConfidence: number;
};

export function classifyEvidence(record: Record<string, unknown>, thresholds?: Record<string, number>): {
  evidenceClass: string;
  resultState: string;
  admissible: boolean;
  reasons: string[];
};

export function evaluateGoldenNodeReadiness(input: Record<string, unknown>, thresholds?: Record<string, number>): {
  eligible: boolean;
  evidenceClass: string;
  resultState: string;
  reasons: string[];
  thresholds: Record<string, number>;
};

export function assertComplianceTransition(from: string, to: string): true;
export function createComplianceEvent(input: {
  organizationId: string;
  subjectId: string;
  from: string;
  to: string;
  actorId: string;
  reason: string;
}): Readonly<Record<string, unknown>>;

export function activityGenomeSimilarity(left: Record<string, unknown>, right: Record<string, unknown>): number;
export function evaluateMissionRepetition(
  candidate: Record<string, unknown>,
  recentMissions?: Record<string, unknown>[],
  options?: { similarityThreshold?: number; maximumSimilarMissions?: number },
): {
  rotate: boolean;
  similarCount: number;
  maximumSimilarity: number;
  similarities: number[];
  similarityThreshold: number;
};

export function createSpinRecord(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createHypothesisRevision(
  original: Record<string, unknown>,
  patch: Record<string, unknown>,
  actorId: string,
  rationale: string,
): Readonly<Record<string, unknown>>;
export function hashRecord(value: unknown): string;
export function normalizeMailboxEvidence(record: Record<string, any>, context: Record<string, any>): Readonly<Record<string, unknown>>;
