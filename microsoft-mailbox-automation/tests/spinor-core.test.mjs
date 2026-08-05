import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_STATES,
  EVIDENCE_CLASSES,
  activityGenomeSimilarity,
  assertComplianceTransition,
  calculateEffect,
  classifyEvidence,
  confounderAdjustedConfidence,
  createHypothesisRevision,
  createSpinRecord,
  evaluateGoldenNodeReadiness,
  evaluateMissionRepetition,
  normalizeMailboxEvidence,
} from "../src/lib/spinor/core.mjs";

test("effect reporting shows absolute and relative change together", () => {
  const effect = calculateEffect({
    baselineRate: 0.10,
    observedRate: 0.13,
    baselineSampleSize: 1000,
    observedSampleSize: 1000,
  });
  assert.equal(effect.absoluteChangePercentagePoints, 3);
  assert.equal(effect.relativeChangePercent, 30);
  assert.equal(effect.baselinePercent, 10);
  assert.equal(effect.observedPercent, 13);
  assert.ok(effect.uncertainty);
});

test("zero baseline does not manufacture an infinite relative lift", () => {
  const effect = calculateEffect({ baselineRate: 0, observedRate: 0.05 });
  assert.equal(effect.absoluteChangePercentagePoints, 5);
  assert.equal(effect.relativeChangePercent, null);
});

test("confirmed and unresolved confounders reduce confidence", () => {
  const clean = confounderAdjustedConfidence({ baseConfidence: 0.9, executionFidelity: 1 });
  const attacked = confounderAdjustedConfidence({
    baseConfidence: 0.9,
    executionFidelity: 0.9,
    confounders: [
      { status: "unresolved", severity: 1 },
      { status: "confirmed", severity: 0.5, critical: true },
    ],
  });
  assert.ok(attacked.adjustedConfidence < clean.adjustedConfidence);
  assert.ok(attacked.confounderPenalty > 0);
});

test("documented observational result remains an Internal Signal", () => {
  const classification = classifyEvidence({
    baselinePresent: true,
    visibleConfounders: true,
    executionFidelity: 0.92,
    complianceState: COMPLIANCE_STATES.APPROVED,
  });
  assert.equal(classification.evidenceClass, EVIDENCE_CLASSES.INTERNAL_SIGNAL);
  assert.equal(classification.admissible, true);
});

test("preregistered controlled protocol is a Controlled Experiment", () => {
  const classification = classifyEvidence({
    preregistered: true,
    treatmentDefined: true,
    comparisonDefined: true,
    eligibilityRulesDefined: true,
    assignmentMethodDefined: true,
    metricsFixed: true,
    observationWindowDefined: true,
    fidelityCaptured: true,
    statisticalPowerDisclosed: true,
    executionFidelity: 0.9,
    complianceState: COMPLIANCE_STATES.APPROVED,
  });
  assert.equal(classification.evidenceClass, EVIDENCE_CLASSES.CONTROLLED_EXPERIMENT);
  assert.equal(classification.admissible, true);
});

test("independent outcome capture is classified as a Valid Replication", () => {
  const classification = classifyEvidence({
    isIndependentReplication: true,
    parentExperimentId: "experiment-1",
    separateOutcomeCapture: true,
    deviationsDeclared: true,
    executionFidelity: 0.88,
    complianceState: COMPLIANCE_STATES.APPROVED,
  });
  assert.equal(classification.evidenceClass, EVIDENCE_CLASSES.VALID_REPLICATION);
});

test("an initial attractive result cannot become Golden-Node-Eligible", () => {
  const readiness = evaluateGoldenNodeReadiness({
    absoluteEffectPercentagePoints: 5,
    attributionConfidence: 0.9,
    portability: 0.9,
    mechanismClarity: 0.9,
    independentReplications: 0,
    admissibleExperiments: 1,
    unresolvedCriticalConfounders: 0,
    complianceState: COMPLIANCE_STATES.APPROVED,
    boundariesDocumented: true,
    contributionLedgerComplete: true,
    economicViabilityDocumented: true,
    customerValue: 1,
  });
  assert.equal(readiness.eligible, false);
  assert.equal(readiness.evidenceClass, EVIDENCE_CLASSES.INTERNAL_SIGNAL);
  assert.ok(readiness.reasons.some((reason) => reason.includes("Independent replication")));
});

test("independent replication and complete governance unlock eligibility", () => {
  const readiness = evaluateGoldenNodeReadiness({
    absoluteEffectPercentagePoints: 3,
    attributionConfidence: 0.82,
    portability: 0.78,
    mechanismClarity: 0.74,
    independentReplications: 2,
    admissibleExperiments: 3,
    unresolvedCriticalConfounders: 0,
    complianceState: COMPLIANCE_STATES.APPROVED,
    boundariesDocumented: true,
    contributionLedgerComplete: true,
    economicViabilityDocumented: true,
    customerValue: 1,
  });
  assert.equal(readiness.eligible, true);
  assert.equal(readiness.evidenceClass, EVIDENCE_CLASSES.GOLDEN_NODE_ELIGIBLE);
});

test("compliance state machine rejects silent reopening of blocked work", () => {
  assert.equal(assertComplianceTransition(COMPLIANCE_STATES.DRAFT, COMPLIANCE_STATES.REVIEW_REQUIRED), true);
  assert.throws(
    () => assertComplianceTransition(COMPLIANCE_STATES.BLOCKED, COMPLIANCE_STATES.APPROVED),
    /Invalid compliance transition/,
  );
});

test("Activity Genome detects conceptual repetition rather than cosmetic wording", () => {
  const candidate = {
    customerType: "independent-practice",
    stakeholder: "office-manager",
    channel: "email",
    cognitiveMode: "execution",
    researchQuestion: "follow-up timing",
    automationLevel: "assisted",
  };
  const recent = [
    { ...candidate, duration: "15m" },
    { ...candidate, duration: "20m" },
    { ...candidate, channel: "phone", cognitiveMode: "customer-research" },
  ];
  assert.ok(activityGenomeSimilarity(candidate, recent[0]) > 0.7);
  const decision = evaluateMissionRepetition(candidate, recent, {
    similarityThreshold: 0.7,
    maximumSimilarMissions: 2,
  });
  assert.equal(decision.rotate, true);
});

test("SPIN record requires the complete causal combination", () => {
  assert.throws(() => createSpinRecord({ organizationId: "org-1" }), /missing required fields/);
  const spin = createSpinRecord({
    organizationId: "org-1",
    assignedUserId: "user-1",
    hypothesisVersionId: "hypothesis-v1",
    population: { eligibility: "approved accounts" },
    treatment: { workflow: "staff-first" },
    comparison: { workflow: "standard" },
    allocationMethod: "constrained-randomization",
    startedAt: "2026-08-04T12:00:00.000Z",
  });
  assert.equal(spin.organizationId, "org-1");
  assert.equal(spin.version, 1);
});

test("hypothesis edits create a derivative instead of overwriting history", () => {
  const original = {
    id: "hypothesis-1",
    organizationId: "org-1",
    version: 1,
    claim: "Original claim",
    createdAt: "2026-08-04T12:00:00.000Z",
  };
  const revision = createHypothesisRevision(
    original,
    { claim: "Narrowed claim" },
    "user-1",
    "Local stakeholder ownership differs.",
  );
  assert.notEqual(revision.id, original.id);
  assert.equal(revision.parentHypothesisId, original.id);
  assert.equal(revision.version, 2);
  assert.equal(original.claim, "Original claim");
});

test("mailbox evidence retains stable source provenance", () => {
  const record = {
    id: "record-1",
    emailId: "message-1",
    subject: "Account workflow question",
    sender: "Office Manager",
    receivedDate: "2026-08-04T12:00:00.000Z",
    processedAt: "2026-08-04T12:01:00.000Z",
    category: "Operational Signal",
    confidence: 0.88,
    extractedData: {
      summary: "Office requests an asynchronous workflow.",
      fields: [],
      tables: [],
    },
  };
  const context = { organizationId: "org-1", provider: "gmail" };
  const first = normalizeMailboxEvidence(record, context);
  const second = normalizeMailboxEvidence(record, context);
  assert.equal(first.sourceMessageId, "message-1");
  assert.equal(first.provenance.sourceHash, second.provenance.sourceHash);
  assert.notEqual(first.id, second.id);
});
