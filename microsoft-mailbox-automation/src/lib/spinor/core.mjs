import { createHash, randomUUID } from "node:crypto";

export const EVIDENCE_CLASSES = Object.freeze({
  OBSERVATION: "Observation",
  INTERNAL_SIGNAL: "Internal Signal",
  CONTROLLED_EXPERIMENT: "Controlled Experiment",
  VALID_REPLICATION: "Valid Replication",
  GOLDEN_NODE_ELIGIBLE: "Golden-Node-Eligible Evidence",
});

export const RESULT_STATES = Object.freeze({
  REJECTED: "Rejected",
  INCONCLUSIVE: "Inconclusive",
  PROMISING: "Promising",
  REPLICATED: "Replicated",
  GOLDEN_NODE_CANDIDATE: "Golden Node Candidate",
  GOLDEN_NODE: "Golden Node",
  COMPLIANCE_BLOCKED: "Compliance Blocked",
});

export const COMPLIANCE_STATES = Object.freeze({
  DRAFT: "draft",
  REVIEW_REQUIRED: "review_required",
  APPROVED: "approved",
  SUSPENDED: "suspended",
  BLOCKED: "blocked",
});

export const DEFAULT_THRESHOLDS = Object.freeze({
  minimumExecutionFidelity: 0.8,
  minimumAttributionConfidence: 0.7,
  minimumPortability: 0.6,
  minimumMechanismClarity: 0.6,
  minimumIndependentReplications: 1,
  minimumAdmissibleExperiments: 2,
  minimumAbsoluteEffectPoints: 1,
  minimumCustomerValue: 0,
  maximumUnresolvedCriticalConfounders: 0,
});

const CONFOUNDER_PENALTIES = Object.freeze({
  unresolved: 0.08,
  controlled: 0,
  measured: 0.03,
  unlikely: 0.01,
  confirmed: 0.18,
});

const COMPLIANCE_TRANSITIONS = Object.freeze({
  [COMPLIANCE_STATES.DRAFT]: new Set([
    COMPLIANCE_STATES.REVIEW_REQUIRED,
    COMPLIANCE_STATES.APPROVED,
    COMPLIANCE_STATES.BLOCKED,
  ]),
  [COMPLIANCE_STATES.REVIEW_REQUIRED]: new Set([
    COMPLIANCE_STATES.APPROVED,
    COMPLIANCE_STATES.BLOCKED,
  ]),
  [COMPLIANCE_STATES.APPROVED]: new Set([
    COMPLIANCE_STATES.SUSPENDED,
    COMPLIANCE_STATES.BLOCKED,
  ]),
  [COMPLIANCE_STATES.SUSPENDED]: new Set([
    COMPLIANCE_STATES.REVIEW_REQUIRED,
    COMPLIANCE_STATES.BLOCKED,
  ]),
  [COMPLIANCE_STATES.BLOCKED]: new Set(),
});

function clamp(value, minimum = 0, maximum = 1) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertRate(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite proportion between 0 and 1.`);
  }
}

function deriveRate(rate, successes, sampleSize, label) {
  if (rate !== undefined && rate !== null) {
    assertRate(label, rate);
    return rate;
  }
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    throw new RangeError(`${label} requires a positive sample size when no rate is supplied.`);
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > sampleSize) {
    throw new RangeError(`${label} successes must be an integer between 0 and sample size.`);
  }
  return successes / sampleSize;
}

/**
 * Calculate an effect without hiding the absolute change behind a relative lift.
 * Rates are proportions: 0.10 means 10 percent.
 */
export function calculateEffect(input) {
  const baselineRate = deriveRate(
    input.baselineRate,
    input.baselineSuccesses,
    input.baselineSampleSize,
    "baselineRate",
  );
  const observedRate = deriveRate(
    input.observedRate,
    input.observedSuccesses,
    input.observedSampleSize,
    "observedRate",
  );

  const absoluteChange = observedRate - baselineRate;
  const relativeChange = baselineRate === 0 ? null : absoluteChange / baselineRate;

  let uncertainty = null;
  if (
    Number.isInteger(input.baselineSampleSize) && input.baselineSampleSize > 0 &&
    Number.isInteger(input.observedSampleSize) && input.observedSampleSize > 0
  ) {
    const standardError = Math.sqrt(
      (baselineRate * (1 - baselineRate)) / input.baselineSampleSize +
      (observedRate * (1 - observedRate)) / input.observedSampleSize,
    );
    const margin = 1.96 * standardError;
    uncertainty = {
      method: "normal-approximation-difference-in-proportions",
      confidenceLevel: 0.95,
      lowerPercentagePoints: round((absoluteChange - margin) * 100, 3),
      upperPercentagePoints: round((absoluteChange + margin) * 100, 3),
    };
  }

  return {
    baselineRate: round(baselineRate),
    observedRate: round(observedRate),
    baselinePercent: round(baselineRate * 100, 3),
    observedPercent: round(observedRate * 100, 3),
    absoluteChange: round(absoluteChange),
    absoluteChangePercentagePoints: round(absoluteChange * 100, 3),
    relativeChange: relativeChange === null ? null : round(relativeChange),
    relativeChangePercent: relativeChange === null ? null : round(relativeChange * 100, 3),
    baselineSampleSize: input.baselineSampleSize ?? null,
    observedSampleSize: input.observedSampleSize ?? null,
    uncertainty,
  };
}

export function confounderAdjustedConfidence({
  baseConfidence,
  confounders = [],
  executionFidelity = 1,
}) {
  const base = clamp(baseConfidence);
  const fidelity = clamp(executionFidelity);
  const penalty = Math.min(
    0.75,
    confounders.reduce((sum, confounder) => {
      const statusPenalty = CONFOUNDER_PENALTIES[confounder.status] ?? CONFOUNDER_PENALTIES.unresolved;
      const severity = clamp(confounder.severity ?? 1);
      const criticalMultiplier = confounder.critical ? 1.5 : 1;
      return sum + statusPenalty * severity * criticalMultiplier;
    }, 0),
  );

  return {
    baseConfidence: round(base),
    executionFidelity: round(fidelity),
    confounderPenalty: round(penalty),
    adjustedConfidence: round(clamp(base * fidelity * (1 - penalty))),
  };
}

function allTruthy(record, fields) {
  return fields.every((field) => Boolean(record[field]));
}

/**
 * Classifies one evidence record. Aggregate promotion is handled separately by
 * evaluateGoldenNodeReadiness so a single attractive result cannot self-promote.
 */
export function classifyEvidence(record, thresholds = DEFAULT_THRESHOLDS) {
  const complianceBlocked =
    record.criticalComplianceProblem === true ||
    record.complianceState === COMPLIANCE_STATES.BLOCKED;

  if (complianceBlocked) {
    return {
      evidenceClass: EVIDENCE_CLASSES.OBSERVATION,
      resultState: RESULT_STATES.COMPLIANCE_BLOCKED,
      admissible: false,
      reasons: ["Critical or blocked compliance state prevents admissibility."],
    };
  }

  const fidelity = clamp(record.executionFidelity ?? 0);
  const controlledFields = [
    "preregistered",
    "treatmentDefined",
    "comparisonDefined",
    "eligibilityRulesDefined",
    "assignmentMethodDefined",
    "metricsFixed",
    "observationWindowDefined",
    "fidelityCaptured",
    "statisticalPowerDisclosed",
  ];

  if (
    record.isIndependentReplication &&
    record.parentExperimentId &&
    record.separateOutcomeCapture &&
    record.deviationsDeclared &&
    fidelity >= thresholds.minimumExecutionFidelity &&
    record.complianceState === COMPLIANCE_STATES.APPROVED
  ) {
    return {
      evidenceClass: EVIDENCE_CLASSES.VALID_REPLICATION,
      resultState: RESULT_STATES.REPLICATED,
      admissible: true,
      reasons: [],
    };
  }

  if (
    allTruthy(record, controlledFields) &&
    fidelity >= thresholds.minimumExecutionFidelity &&
    record.complianceState === COMPLIANCE_STATES.APPROVED
  ) {
    return {
      evidenceClass: EVIDENCE_CLASSES.CONTROLLED_EXPERIMENT,
      resultState: RESULT_STATES.PROMISING,
      admissible: true,
      reasons: [],
    };
  }

  if (
    (record.baselinePresent || record.comparisonDefined) &&
    record.visibleConfounders &&
    fidelity >= thresholds.minimumExecutionFidelity
  ) {
    return {
      evidenceClass: EVIDENCE_CLASSES.INTERNAL_SIGNAL,
      resultState: RESULT_STATES.PROMISING,
      admissible: true,
      reasons: ["Useful internal signal, but controlled-experiment requirements are incomplete."],
    };
  }

  return {
    evidenceClass: EVIDENCE_CLASSES.OBSERVATION,
    resultState: RESULT_STATES.INCONCLUSIVE,
    admissible: false,
    reasons: ["Record lacks the comparison, fidelity, or disclosed-confounder requirements for an Internal Signal."],
  };
}

export function evaluateGoldenNodeReadiness(input, thresholds = DEFAULT_THRESHOLDS) {
  const reasons = [];
  const effectPoints = Math.abs(input.absoluteEffectPercentagePoints ?? 0);

  if (effectPoints < thresholds.minimumAbsoluteEffectPoints) {
    reasons.push(`Absolute effect is below ${thresholds.minimumAbsoluteEffectPoints} percentage point(s).`);
  }
  if ((input.attributionConfidence ?? 0) < thresholds.minimumAttributionConfidence) {
    reasons.push("Attribution confidence is below the configured threshold.");
  }
  if ((input.portability ?? 0) < thresholds.minimumPortability) {
    reasons.push("Portability evidence is insufficient.");
  }
  if ((input.mechanismClarity ?? 0) < thresholds.minimumMechanismClarity) {
    reasons.push("Mechanism clarity is insufficient.");
  }
  if ((input.independentReplications ?? 0) < thresholds.minimumIndependentReplications) {
    reasons.push("Independent replication requirement is not met.");
  }
  if ((input.admissibleExperiments ?? 0) < thresholds.minimumAdmissibleExperiments) {
    reasons.push("Multiple admissible experiments are required.");
  }
  if ((input.unresolvedCriticalConfounders ?? 0) > thresholds.maximumUnresolvedCriticalConfounders) {
    reasons.push("Critical confounders remain unresolved.");
  }
  if (input.complianceState !== COMPLIANCE_STATES.APPROVED) {
    reasons.push("Compliance approval is required.");
  }
  if (!input.boundariesDocumented) reasons.push("Failure boundaries are not documented.");
  if (!input.contributionLedgerComplete) reasons.push("Contribution ledger is incomplete.");
  if (!input.economicViabilityDocumented) reasons.push("Economic viability is not documented.");
  if ((input.customerValue ?? 0) < thresholds.minimumCustomerValue) {
    reasons.push("Customer value is below the configured threshold.");
  }

  const eligible = reasons.length === 0;
  return {
    eligible,
    evidenceClass: eligible
      ? EVIDENCE_CLASSES.GOLDEN_NODE_ELIGIBLE
      : input.independentReplications > 0
        ? EVIDENCE_CLASSES.VALID_REPLICATION
        : EVIDENCE_CLASSES.INTERNAL_SIGNAL,
    resultState: eligible
      ? RESULT_STATES.GOLDEN_NODE_CANDIDATE
      : input.complianceState === COMPLIANCE_STATES.BLOCKED
        ? RESULT_STATES.COMPLIANCE_BLOCKED
        : input.independentReplications > 0
          ? RESULT_STATES.REPLICATED
          : RESULT_STATES.PROMISING,
    reasons,
    thresholds: { ...thresholds },
  };
}

export function assertComplianceTransition(from, to) {
  if (!COMPLIANCE_TRANSITIONS[from]) {
    throw new Error(`Unknown compliance state: ${from}`);
  }
  if (!COMPLIANCE_TRANSITIONS[from].has(to)) {
    throw new Error(`Invalid compliance transition: ${from} -> ${to}`);
  }
  return true;
}

export function createComplianceEvent({ organizationId, subjectId, from, to, actorId, reason }) {
  assertComplianceTransition(from, to);
  if (!organizationId || !subjectId || !actorId || !reason) {
    throw new Error("Compliance events require organizationId, subjectId, actorId, and reason.");
  }
  return Object.freeze({
    id: randomUUID(),
    type: "compliance.transitioned",
    organizationId,
    subjectId,
    from,
    to,
    actorId,
    reason,
    occurredAt: new Date().toISOString(),
  });
}

function genomeTokens(genome = {}) {
  const tokens = new Set();
  for (const [key, value] of Object.entries(genome)) {
    if (Array.isArray(value)) {
      value.forEach((item) => tokens.add(`${key}:${String(item).toLowerCase()}`));
    } else if (value !== null && value !== undefined && value !== "") {
      tokens.add(`${key}:${String(value).toLowerCase()}`);
    }
  }
  return tokens;
}

export function activityGenomeSimilarity(left, right) {
  const a = genomeTokens(left);
  const b = genomeTokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return round(union === 0 ? 0 : intersection / union);
}

export function evaluateMissionRepetition(candidate, recentMissions = [], options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.72;
  const maximumSimilarMissions = options.maximumSimilarMissions ?? 2;
  const similarities = recentMissions.map((mission) => activityGenomeSimilarity(candidate, mission));
  const similarCount = similarities.filter((score) => score >= similarityThreshold).length;
  return {
    rotate: similarCount >= maximumSimilarMissions,
    similarCount,
    maximumSimilarity: similarities.length ? Math.max(...similarities) : 0,
    similarities,
    similarityThreshold,
  };
}

function requireFields(input, fields, label) {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length) throw new Error(`${label} is missing required fields: ${missing.join(", ")}`);
}

export function createSpinRecord(input) {
  requireFields(input, [
    "organizationId",
    "assignedUserId",
    "hypothesisVersionId",
    "population",
    "treatment",
    "comparison",
    "allocationMethod",
    "startedAt",
  ], "SPIN record");

  const now = new Date().toISOString();
  return Object.freeze({
    id: input.id ?? randomUUID(),
    version: input.version ?? 1,
    organizationId: input.organizationId,
    assignedUserId: input.assignedUserId,
    hypothesisVersionId: input.hypothesisVersionId,
    population: input.population,
    accountIds: input.accountIds ?? [],
    treatment: input.treatment,
    comparison: input.comparison,
    allocationMethod: input.allocationMethod,
    timing: input.timing ?? null,
    permittedVariables: input.permittedVariables ?? [],
    prohibitedVariables: input.prohibitedVariables ?? [],
    modelContribution: input.modelContribution ?? null,
    humanModifications: input.humanModifications ?? [],
    executionEvents: input.executionEvents ?? [],
    deviations: input.deviations ?? [],
    confounders: input.confounders ?? [],
    outcomes: input.outcomes ?? [],
    attributionEstimate: input.attributionEstimate ?? null,
    confidence: input.confidence ?? null,
    portability: input.portability ?? null,
    evidenceStatus: input.evidenceStatus ?? EVIDENCE_CLASSES.OBSERVATION,
    complianceStatus: input.complianceStatus ?? COMPLIANCE_STATES.DRAFT,
    parentSpinId: input.parentSpinId ?? null,
    derivativeIds: input.derivativeIds ?? [],
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  });
}

export function createHypothesisRevision(original, patch, actorId, rationale) {
  requireFields(original, ["id", "organizationId", "version"], "Hypothesis");
  if (!actorId || !rationale) throw new Error("Hypothesis revisions require actorId and rationale.");
  const immutableFields = new Set(["id", "organizationId", "createdAt"]);
  for (const field of immutableFields) {
    if (patch[field] !== undefined && patch[field] !== original[field]) {
      throw new Error(`Hypothesis revision cannot change immutable field: ${field}`);
    }
  }
  const now = new Date().toISOString();
  return Object.freeze({
    ...original,
    ...patch,
    id: randomUUID(),
    parentHypothesisId: original.id,
    version: original.version + 1,
    revisionActorId: actorId,
    revisionRationale: rationale,
    createdAt: now,
    updatedAt: now,
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function hashRecord(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function normalizeMailboxEvidence(record, context) {
  requireFields(context, ["organizationId", "provider"], "Mailbox evidence context");
  requireFields(record, ["id", "emailId", "subject", "sender", "receivedDate", "processedAt"], "Processed mailbox record");

  const sourceSnapshot = {
    recordId: record.id,
    messageId: record.emailId,
    subject: record.subject,
    sender: record.sender,
    receivedDate: record.receivedDate,
    processedAt: record.processedAt,
    category: record.category,
    confidence: record.confidence,
    extractedData: record.extractedData,
    analysis: record.analysis ?? null,
  };

  return Object.freeze({
    id: randomUUID(),
    organizationId: context.organizationId,
    evidenceClass: EVIDENCE_CLASSES.OBSERVATION,
    sourceType: "mailbox",
    provider: context.provider,
    sourceRecordId: record.id,
    sourceMessageId: record.emailId,
    sourceMailbox: context.mailbox ?? null,
    occurredAt: record.receivedDate,
    ingestedAt: new Date().toISOString(),
    actorId: context.actorId ?? "system:mailbox-adapter",
    category: record.category,
    extractionConfidence: record.confidence,
    summary: record.extractedData?.summary ?? "",
    fields: record.extractedData?.fields ?? [],
    tables: record.extractedData?.tables ?? [],
    analysis: record.analysis ?? null,
    provenance: {
      provider: context.provider,
      pipelineVersion: context.pipelineVersion ?? "mailbox-scientific-data/v1",
      sourceHash: hashRecord(sourceSnapshot),
      importedFrom: context.importedFrom ?? null,
    },
  });
}
