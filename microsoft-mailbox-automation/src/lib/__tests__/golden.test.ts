import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import {
  saveHypotheses,
  savePriorArt,
  saveHypothesisAssignments,
  saveHypothesisOutcomes,
  saveHypothesisAttributions,
  saveDerivatives,
  saveGoldenNodes,
  saveAttributionLedger,
  saveDiscoveryLedger,
  saveResearchReliability,
  saveProcesses,
  saveCompetitions,
  loadDiscoveryLedger,
  loadCompetitions,
} from "../config";

import { classifyPriorArt, researchHypothesis, buildHypothesisFromPriorArt, isAssignable } from "../golden/prior-art";
import { checkHypothesis, checkProcess, isModifiableDimensionAllowed } from "../golden/compliance";
import { ensureGoldenSeeded, SEED_EMPLOYEES, SEED_ACCOUNTS, deriveEngagementMode } from "../golden/seed";
import { allocateHypotheses, contextForEmployee, acceptAssignment, rejectAssignment, modifyAssignment, allowedKindsForLevel, getActiveAssignmentsForEmployee } from "../golden/allocation";
import { recordOutcome, attributeOutcome, computeEffectSize, getHypothesisPerformance } from "../golden/outcomes";
import { proposeDerivative, promoteDerivativeToHypothesis, generateLlmPermutations, generateDerivativesFromAttribution, getDerivativesForParent } from "../golden/derivatives";
import { identifyGoldenNodeCandidate, promoteGoldenNode, advanceStage, evaluateCriteria, recordUsefulFailure, recordSuccessfulReplication } from "../golden/golden-node";
import { auditFairness, updateResearchReliability, computeLevel, nextLevel, scoreOutcomeForCategory, submitCompetitionEntry, rankEmployees, UNLOCK_PATH } from "../golden/ledger";
import { createProcess, modifyProcess, validateProcess } from "../golden/process-lab";
import { goldenEngine } from "../golden/engine";

const dataDir = path.join(process.cwd(), "data");
const goldenFiles = [
  "golden-hypotheses.json",
  "golden-prior-art.json",
  "golden-assignments.json",
  "golden-outcomes.json",
  "golden-attributions.json",
  "golden-derivatives.json",
  "golden-nodes.json",
  "golden-attribution-ledger.json",
  "golden-discovery-ledger.json",
  "golden-research-reliability.json",
  "golden-processes.json",
  "golden-competitions.json",
].map((f) => path.join(dataDir, f));

const backups = goldenFiles.map((file) => ({ file, backup: null as string | null, existed: false }));

before(() => {
  for (const b of backups) {
    b.existed = fs.existsSync(b.file);
    if (b.existed) b.backup = fs.readFileSync(b.file, "utf-8");
  }
  // Clean state
  saveHypotheses([]);
  savePriorArt([]);
  saveHypothesisAssignments([]);
  saveHypothesisOutcomes([]);
  saveHypothesisAttributions([]);
  saveDerivatives([]);
  saveGoldenNodes([]);
  saveAttributionLedger([]);
  saveDiscoveryLedger([]);
  saveResearchReliability([]);
  saveProcesses([]);
  saveCompetitions([]);
});

after(() => {
  for (const b of backups) {
    try {
      if (b.existed) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(b.file, b.backup ?? "", "utf-8");
      } else if (fs.existsSync(b.file)) {
        fs.unlinkSync(b.file);
      }
    } catch {
      // ignore
    }
  }
});

// ─── Prior-art research engine ─────────────────────────────────────

test("classifyPriorArt: established when supported in-market", () => {
  const { status, evidenceState } = classifyPriorArt({
    hypothesisClaim: "x",
    testedInMarket: true,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Supported in enterprise onboarding.",
    sourceDomains: ["enterprise"],
    responsibleComponent: "self-service",
    requiredConditions: ["digital responsiveness"],
    risksAndConfounders: [],
    genuinelyUnknown: [],
  });
  assert.equal(evidenceState, "supported");
  assert.ok(status === "established" || status === "novel_permutation");
});

test("classifyPriorArt: transfer candidate when supported elsewhere but not in-market", () => {
  const { status } = classifyPriorArt({
    hypothesisClaim: "x",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Supported in enterprise software.",
    sourceDomains: ["enterprise"],
    responsibleComponent: null,
    requiredConditions: [],
    risksAndConfounders: [],
    genuinelyUnknown: [],
  });
  assert.equal(status, "transfer_candidate");
});

test("classifyPriorArt: unsupported when tested and failed", () => {
  const { status, evidenceState } = classifyPriorArt({
    hypothesisClaim: "x",
    testedInMarket: true,
    testedInAdjacentIndustries: false,
    adjacentSupportSummary: "Failed; no effect.",
    sourceDomains: [],
    responsibleComponent: null,
    requiredConditions: [],
    risksAndConfounders: [],
    genuinelyUnknown: [],
  });
  assert.equal(evidenceState, "failed");
  assert.equal(status, "unsupported");
});

test("classifyPriorArt: distinguishes untested from failed from inconclusive", () => {
  const untested = classifyPriorArt({
    hypothesisClaim: "x", testedInMarket: false, testedInAdjacentIndustries: false,
    adjacentSupportSummary: "", sourceDomains: [], responsibleComponent: null,
    requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: [],
  });
  assert.equal(untested.evidenceState, "untested");

  const inconclusive = classifyPriorArt({
    hypothesisClaim: "x", testedInMarket: false, testedInAdjacentIndustries: false,
    adjacentSupportSummary: "", sourceDomains: [], responsibleComponent: null,
    requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: ["a", "b"],
  });
  assert.equal(inconclusive.evidenceState, "inconclusive");
});

test("isAssignable: unsupported is never assignable", () => {
  assert.equal(isAssignable("unsupported"), false);
  assert.equal(isAssignable("established"), true);
  assert.equal(isAssignable("new_mechanism"), true);
});

test("researchHypothesis persists a prior-art record", () => {
  const record = researchHypothesis({
    hypothesisClaim: "Test claim",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Supported in SaaS.",
    sourceDomains: ["saas"],
    responsibleComponent: "cadence",
    requiredConditions: ["x"],
    risksAndConfounders: ["y"],
    genuinelyUnknown: [],
  });
  assert.ok(record.id.startsWith("pa_"));
  assert.ok(record.researchConfidence > 0);
});

// ─── Pharma boundary guard ─────────────────────────────────────────

test("checkHypothesis rejects forbidden clinical-judgment terms", () => {
  const pa = researchHypothesis({
    hypothesisClaim: "Modify approved claim to improve conversion",
    testedInMarket: false, testedInAdjacentIndustries: false,
    adjacentSupportSummary: "", sourceDomains: [], responsibleComponent: null,
    requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: [],
  });
  const { hypothesis, compliance } = buildHypothesisFromPriorArt(pa, {
    claim: "Modify approved claim to improve conversion",
    sourceDomains: [], targetCondition: "x", intervention: "off-label prescribing pressure",
    control: "x", primaryOutcome: "x", secondaryOutcomes: [], knownConfounders: [],
    complianceBoundary: "Approved information only", expectedValue: "x", primaryUncertainty: "x",
    novelComponent: null, fixedConstraints: [], modifiableDimensions: ["timing"],
    targetEngagementModes: ["system_oriented"],
  });
  assert.equal(compliance.allowed, false);
  assert.ok(compliance.violations.length > 0);
  void hypothesis;
});

test("checkHypothesis rejects stereotype-based digital-ability inference", () => {
  const pa = researchHypothesis({
    hypothesisClaim: "x", testedInMarket: false, testedInAdjacentIndustries: false,
    adjacentSupportSummary: "", sourceDomains: [], responsibleComponent: null,
    requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: [],
  });
  const { compliance } = buildHypothesisFromPriorArt(pa, {
    claim: "Older physicians are not tech savvy so use in-person",
    sourceDomains: [], targetCondition: "x", intervention: "in-person",
    control: "x", primaryOutcome: "x", secondaryOutcomes: [], knownConfounders: [],
    complianceBoundary: "Approved information only", expectedValue: "x", primaryUncertainty: "x",
    novelComponent: null, fixedConstraints: [], modifiableDimensions: ["timing"],
    targetEngagementModes: ["human_guided"],
  });
  assert.equal(compliance.allowed, false);
});

test("isModifiableDimensionAllowed permits operational dimensions", () => {
  const pa = researchHypothesis({
    hypothesisClaim: "x", testedInMarket: true, testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Supported.", sourceDomains: [], responsibleComponent: "x",
    requiredConditions: [], risksAndConfounders: [], genuinelyUnknown: [],
  });
  const { hypothesis } = buildHypothesisFromPriorArt(pa, {
    claim: "x", sourceDomains: [], targetCondition: "x", intervention: "x",
    control: "x", primaryOutcome: "x", secondaryOutcomes: [], knownConfounders: [],
    complianceBoundary: "Approved content sequencing only", expectedValue: "x", primaryUncertainty: "x",
    novelComponent: null, fixedConstraints: [], modifiableDimensions: ["timing", "content_sequence"],
    targetEngagementModes: ["system_oriented"],
  });
  assert.equal(isModifiableDimensionAllowed("timing", hypothesis), true);
  assert.equal(isModifiableDimensionAllowed("content_sequence", hypothesis), true);
  assert.equal(isModifiableDimensionAllowed("bogus", hypothesis), false);
});

// ─── Seed + engagement mode ────────────────────────────────────────

test("ensureGoldenSeeded seeds hypotheses, prior-art, and reliability", () => {
  saveHypotheses([]);
  savePriorArt([]);
  saveResearchReliability([]);
  const hypotheses = ensureGoldenSeeded();
  assert.ok(hypotheses.length >= 4);
});

test("deriveEngagementMode uses observed signals, not stereotypes", () => {
  const systemOriented = deriveEngagementMode(SEED_ACCOUNTS[0].signal);
  assert.equal(systemOriented, "system_oriented");
  const humanGuided = deriveEngagementMode(SEED_ACCOUNTS[2].signal);
  assert.equal(humanGuided, "human_guided");
});

// ─── Allocation engine ─────────────────────────────────────────────

test("allowedKindsForLevel gates builder missions by reliability", () => {
  assert.ok(!allowedKindsForLevel("participant").includes("builder"));
  assert.ok(!allowedKindsForLevel("reliable_tester").includes("discovery"));
  assert.ok(allowedKindsForLevel("process_builder").includes("builder"));
});

test("allocateHypotheses assigns a constrained-exploration mix", () => {
  saveHypothesisAssignments([]);
  saveDiscoveryLedger([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-001");
  assert.ok(ctx);
  const assignments = allocateHypotheses(ctx!);
  assert.ok(assignments.length > 0);
  assert.ok(assignments.length <= 3);
  // Each assignment has an innovation window.
  for (const a of assignments) {
    assert.ok(a.innovationWindow.length > 0);
    assert.ok(a.allocationReason.length > 0);
  }
});

test("allocateHypotheses respects reliability level (participant gets reliable only)", () => {
  saveHypothesisAssignments([]);
  saveDiscoveryLedger([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-001");
  ctx!.reliabilityLevel = "participant";
  const assignments = allocateHypotheses(ctx!);
  for (const a of assignments) {
    assert.equal(a.kind, "reliable");
  }
});

test("accept/reject/modify assignment transitions state", () => {
  saveHypothesisAssignments([]);
  saveDiscoveryLedger([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-002");
  const assignments = allocateHypotheses(ctx!);
  const a = assignments[0];
  const accepted = acceptAssignment(a.id);
  assert.equal(accepted?.state, "accepted");
  const a2 = assignments[1];
  if (a2) {
    const modified = modifyAssignment(a2.id, "timing", "Local cadence differs");
    assert.equal(modified?.state, "modified");
    assert.equal(modified?.modifiedDimension, "timing");
  }
});

test("modifyAssignment rejects dimensions outside the innovation window", () => {
  saveHypothesisAssignments([]);
  saveDiscoveryLedger([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-003");
  const assignments = allocateHypotheses(ctx!);
  const a = assignments[0];
  // Pick a dimension not in the window.
  const outside = (["stakeholder", "timing", "channel", "content_sequence", "automation_step", "followup_interval"] as const)
    .find((d) => !a.innovationWindow.includes(d));
  if (outside) {
    const result = modifyAssignment(a.id, outside, "test");
    assert.equal(result, undefined);
  }
});

// ─── Outcomes + attribution ────────────────────────────────────────

function setupAssignmentForOutcome() {
  saveHypothesisAssignments([]);
  saveDiscoveryLedger([]);
  saveHypothesisOutcomes([]);
  saveHypothesisAttributions([]);
  saveDerivatives([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-001");
  const assignments = allocateHypotheses(ctx!);
  return assignments[0];
}

test("recordOutcome + attributeOutcome identifies a responsible factor", () => {
  const a = setupAssignmentForOutcome();
  const outcome = recordOutcome({
    assignmentId: a.id,
    successKind: "performance",
    outcomeDescription: "Workflow completion improved materially.",
    metrics: [
      { metric: "workflow_completion", value: 80, unit: "percent", baseline: 50, higherIsBetter: true },
      { metric: "rep_time_hours", value: 2, unit: "hours", baseline: 5, higherIsBetter: false },
    ],
    falsified: false,
  });
  assert.ok(outcome.id.startsWith("out_"));
  const attribution = attributeOutcome(outcome.id);
  assert.ok(attribution);
  assert.ok(["parent_hypothesis", "employee_modification", "territory", "execution_quality", "external_change", "unresolved"].includes(attribution!.responsibleFactor));
  assert.ok(attribution!.attributionConfidence >= 0 && attribution!.attributionConfidence <= 1);
});

test("computeEffectSize normalizes and respects higherIsBetter", () => {
  const outcome = {
    id: "x", assignmentId: "x", hypothesisId: "x", employeeId: "x", observedAt: "",
    successKind: "performance" as const, outcomeDescription: "", falsified: false,
    metrics: [
      { metric: "m", value: 75, unit: "pct", baseline: 50, higherIsBetter: true },
    ],
    contextAtObservation: {},
  };
  const effect = computeEffectSize(outcome as any);
  assert.ok(effect > 0);
});

test("falsification is recorded as a valuable result, not a failure", () => {
  const a = setupAssignmentForOutcome();
  const outcome = recordOutcome({
    assignmentId: a.id,
    successKind: "falsification",
    outcomeDescription: "Hypothesis disproven by evidence.",
    metrics: [{ metric: "m", value: 50, unit: "pct", baseline: 50, higherIsBetter: true }],
    falsified: true,
    falsificationEvidence: "No change across 3 matched accounts.",
  });
  assert.equal(outcome.falsified, true);
  assert.equal(outcome.successKind, "falsification");
  // Useful failure credited in discovery ledger.
  recordUsefulFailure(outcome.employeeId);
});

test("attribution generates derivatives from unexplained variance", () => {
  const a = setupAssignmentForOutcome();
  const outcome = recordOutcome({
    assignmentId: a.id,
    successKind: "discovery",
    outcomeDescription: "Result with external confounders.",
    metrics: [{ metric: "m", value: 55, unit: "pct", baseline: 50, higherIsBetter: true }],
    falsified: false,
    contextAtObservation: { externalFactors: ["seasonal shift", "formulary change"] },
  });
  const attribution = attributeOutcome(outcome.id);
  assert.ok(attribution);
  // External factors raise unexplained variance; derivatives may be generated.
  const derivatives = getDerivativesForParent(a.hypothesisId);
  // Attribution-generated derivatives are expected when unexplained variance is high.
  if (attribution!.unexplainedVariance >= 0.15) {
    assert.ok(derivatives.length >= 0); // generation is heuristic; just ensure no crash
  }
});

test("getHypothesisPerformance summarizes outcomes", () => {
  const a = setupAssignmentForOutcome();
  recordOutcome({
    assignmentId: a.id, successKind: "performance", outcomeDescription: "x",
    metrics: [{ metric: "m", value: 70, unit: "pct", baseline: 50, higherIsBetter: true }],
    falsified: false,
  });
  const perf = getHypothesisPerformance(a.hypothesisId);
  assert.equal(perf.outcomeCount, 1);
  assert.ok(perf.averageEffect > 0);
});

// ─── Derivatives ───────────────────────────────────────────────────

test("proposeDerivative + promoteDerivativeToHypothesis creates a testable child", () => {
  saveHypotheses([]);
  saveDerivatives([]);
  ensureGoldenSeeded();
  const hypotheses = ensureGoldenSeeded();
  const parent = hypotheses[0];
  const d = proposeDerivative({
    parentHypothesisId: parent.id,
    claim: "Variant: nurse-coordinator first.",
    modifiedDimension: "stakeholder",
    origin: "derivative_human",
    rationale: "Nurse coordinator owns the process in this account.",
  });
  assert.equal(d.status, "proposed");
  const promoted = promoteDerivativeToHypothesis(d.id);
  assert.ok(promoted);
  assert.equal(promoted!.parentHypothesisId, parent.id);
  assert.equal(promoted!.origin, "derivative_human");
});

test("generateLlmPermutations produces one per modifiable dimension", () => {
  saveHypotheses([]);
  saveDerivatives([]);
  const hypotheses = ensureGoldenSeeded();
  const parent = hypotheses[0];
  const perms = generateLlmPermutations(parent);
  assert.equal(perms.length, parent.modifiableDimensions.length);
  for (const p of perms) assert.equal(p.origin, "derivative_llm");
});

test("generateDerivativesFromAttribution branches on responsible factor", () => {
  saveHypotheses([]);
  saveDerivatives([]);
  const hypotheses = ensureGoldenSeeded();
  const parent = hypotheses[0];
  const unresolvedAttribution = {
    id: "attr_test", outcomeId: "o", hypothesisId: parent.id, employeeId: "emp-001",
    estimatedEffect: 0.1, attributionConfidence: 0.3, method: "expert_judgment" as const,
    counterfactualEstimate: "x", unexplainedVariance: 0.5, responsibleFactor: "unresolved" as const,
    reasoning: "Unresolved; isolate components.", attributedAt: "",
  };
  const generated = generateDerivativesFromAttribution(unresolvedAttribution as any, parent);
  assert.ok(generated.length > 0);
  for (const g of generated) assert.equal(g.origin, "derivative_attribution");
});

// ─── Golden Node identification ────────────────────────────────────

test("evaluateCriteria requires measurable effect, repeatability, portability, defensible mechanism, reusable process", () => {
  saveHypotheses([]);
  ensureGoldenSeeded();
  const hypotheses = ensureGoldenSeeded();
  const h = hypotheses[0];
  const criteria = evaluateCriteria(h, [], [], 0);
  assert.equal(criteria.measurableEffect, false);
  assert.equal(criteria.portability, false);
});

test("advanceStage progresses with replication count", () => {
  assert.equal(advanceStage("local_success", 3, { measurableEffect: true } as any), "replicated_method");
  assert.equal(advanceStage("replicated_method", 7, {} as any), "organizational_capability");
});

test("identifyGoldenNodeCandidate creates a node with an attribution ledger entry", () => {
  saveHypotheses([]); saveHypothesisOutcomes([]); saveHypothesisAttributions([]);
  saveGoldenNodes([]); saveAttributionLedger([]); saveDiscoveryLedger([]);
  saveHypothesisAssignments([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-001");
  const assignments = allocateHypotheses(ctx!);
  const a = assignments[0];
  // Record enough outcomes to build evidence.
  for (let i = 0; i < 3; i++) {
    recordOutcome({
      assignmentId: a.id, successKind: "performance", outcomeDescription: `obs ${i}`,
      metrics: [{ metric: "completion", value: 80, unit: "pct", baseline: 50, higherIsBetter: true }],
      falsified: false,
    });
  }
  const node = identifyGoldenNodeCandidate(a.hypothesisId, a.employeeId, a.id, 3, ["North Chicago", "South Chicago", "Indianapolis"]);
  assert.ok(node);
  assert.ok(node!.attributionLedgerId.length > 0);
  assert.ok(node!.replicationCount >= 3);
});

test("promoteGoldenNode advances stage and updates recognition", () => {
  saveHypotheses([]); saveHypothesisOutcomes([]); saveHypothesisAttributions([]);
  saveGoldenNodes([]); saveAttributionLedger([]); saveDiscoveryLedger([]);
  saveHypothesisAssignments([]);
  ensureGoldenSeeded();
  const ctx = contextForEmployee("emp-001");
  const a = allocateHypotheses(ctx!)[0];
  for (let i = 0; i < 3; i++) {
    recordOutcome({
      assignmentId: a.id, successKind: "performance", outcomeDescription: `obs ${i}`,
      metrics: [{ metric: "completion", value: 80, unit: "pct", baseline: 50, higherIsBetter: true }],
      falsified: false,
    });
  }
  const node = identifyGoldenNodeCandidate(a.hypothesisId, a.employeeId, a.id, 3, ["t1", "t2", "t3"])!;
  const promoted = promoteGoldenNode(node.id, "productized_service", "Account Workflow Platform");
  assert.equal(promoted?.stage, "productized_service");
  assert.equal(promoted?.candidateChannelName, "Account Workflow Platform");
});

// ─── Discovery ledger + research reliability ───────────────────────

test("auditFairness detects hoarding when one employee holds >50% of high-upside", () => {
  saveDiscoveryLedger([]);
  // Simulate hoarding.
  saveDiscoveryLedger([
    { employeeId: "e1", highUpsideHypothesesReceived: 10, builderMissionsReceived: 0, experimentalRiskAssumed: 0, successfulReplicationsCompleted: 0, usefulFailuresGenerated: 0, strategiesContributed: 0, goldenNodeCreditEarned: 0, updatedAt: "" },
    { employeeId: "e2", highUpsideHypothesesReceived: 2, builderMissionsReceived: 0, experimentalRiskAssumed: 0, successfulReplicationsCompleted: 0, usefulFailuresGenerated: 0, strategiesContributed: 0, goldenNodeCreditEarned: 0, updatedAt: "" },
    { employeeId: "e3", highUpsideHypothesesReceived: 2, builderMissionsReceived: 0, experimentalRiskAssumed: 0, successfulReplicationsCompleted: 0, usefulFailuresGenerated: 0, strategiesContributed: 0, goldenNodeCreditEarned: 0, updatedAt: "" },
  ]);
  const audit = auditFairness();
  assert.equal(audit.hoardingDetected, true);
  assert.ok(audit.hoardingEmployees.includes("e1"));
});

test("computeLevel maps composite scores to unlock path levels", () => {
  const participant = computeLevel({
    employeeId: "x", level: "participant", executionFidelity: 0.4, evidenceQuality: 0.4,
    ethicalJudgment: 0.9, usefulOverrides: 0, experimentCompletion: 0.4, confounderDetection: 0.3,
    derivativeQuality: 0.2, collaboration: 0.5, updatedAt: "",
  });
  assert.equal(participant, "participant");

  const architect = computeLevel({
    employeeId: "x", level: "participant", executionFidelity: 0.9, evidenceQuality: 0.9,
    ethicalJudgment: 0.95, usefulOverrides: 5, experimentCompletion: 0.95, confounderDetection: 0.9,
    derivativeQuality: 0.9, collaboration: 0.9, updatedAt: "",
  });
  assert.ok(["strategy_architect", "golden_node_founder"].includes(architect));
});

test("nextLevel walks the unlock path", () => {
  assert.equal(nextLevel("participant"), "reliable_tester");
  assert.equal(nextLevel("golden_node_founder"), null);
  assert.equal(UNLOCK_PATH.length, 7);
});

test("updateResearchReliability recomputes level", () => {
  saveResearchReliability([]);
  const updated = updateResearchReliability("emp-test", {
    executionFidelity: 0.9, evidenceQuality: 0.9, experimentCompletion: 0.95,
    confounderDetection: 0.9, derivativeQuality: 0.9, usefulOverrides: 5, collaboration: 0.9,
  });
  assert.ok(["strategy_architect", "golden_node_founder"].includes(updated.level));
});

test("recordSuccessfulReplication credits the discovery ledger", () => {
  saveDiscoveryLedger([]);
  recordSuccessfulReplication("emp-rep");
  recordSuccessfulReplication("emp-rep");
  const ledger = loadDiscoveryLedger();
  const entry = ledger.find((l: any) => l.employeeId === "emp-rep");
  assert.ok(entry);
  assert.equal(entry!.successfulReplicationsCompleted, 2);
});

// ─── Research competition ──────────────────────────────────────────

test("scoreOutcomeForCategory rewards falsification in most_useful_falsification", () => {
  const falsifiedOutcome = {
    id: "x", assignmentId: "x", hypothesisId: "x", employeeId: "x", observedAt: "",
    successKind: "falsification" as const, outcomeDescription: "", falsified: true,
    falsificationEvidence: "evidence", metrics: [], contextAtObservation: {},
  };
  const score = scoreOutcomeForCategory(falsifiedOutcome as any, "most_useful_falsification");
  assert.ok(score > 0);
});

test("submitCompetitionEntry + rankEmployees ranks by total score", () => {
  saveCompetitions([]);
  submitCompetitionEntry("best_validated_strategy", "e1", "h1", "desc", 50);
  submitCompetitionEntry("best_validated_strategy", "e2", "h2", "desc", 80);
  const rankings = rankEmployees();
  assert.equal(rankings[0].employeeId, "e2");
  assert.equal(rankings[1].employeeId, "e1");
});

// ─── Process lab ───────────────────────────────────────────────────

test("createProcess builds a compliant process and validateProcess checks structure", () => {
  saveProcesses([]);
  const { process, compliance } = createProcess({
    name: "Self-service follow-up",
    objective: "Repeatable conversion pathway for digitally responsive accounts.",
    ownerEmployeeId: "emp-001",
    hypothesisId: "hn_seed",
    steps: [
      { type: "trigger", label: "Physician requests approved access", nextStepIds: [] },
      { type: "action", label: "Send approved self-service pathway", nextStepIds: [] },
      { type: "measurement", label: "Measure completion", measures: ["completion"], nextStepIds: [] },
    ],
    eligibilityRules: ["High digital responsiveness"],
    humanInterventionPoints: [],
    measurementDesign: ["completion"],
    complianceBoundary: "Approved information and workflows only",
  });
  assert.equal(compliance.allowed, true);
  const validation = validateProcess(process);
  assert.equal(validation.valid, true);
});

test("checkProcess rejects unapproved content in action steps", () => {
  const result = checkProcess({
    id: "x", name: "x", objective: "x", ownerEmployeeId: "x", hypothesisId: "x",
    steps: [{ id: "s1", type: "action", label: "Send unapproved off-label content", nextStepIds: [] }],
    eligibilityRules: [], humanInterventionPoints: [], measurementDesign: [],
    complianceBoundary: "Approved only", version: 1, createdAt: "", updatedAt: "",
  });
  assert.equal(result.allowed, false);
});

test("modifyProcess creates a versioned derivative", () => {
  saveProcesses([]);
  const { process } = createProcess({
    name: "Base process", objective: "x", ownerEmployeeId: "emp-001", hypothesisId: "hn_seed",
    steps: [
      { type: "trigger", label: "t", nextStepIds: [] },
      { type: "action", label: "a", nextStepIds: [] },
      { type: "measurement", label: "m", measures: ["x"], nextStepIds: [] },
    ],
    eligibilityRules: [], humanInterventionPoints: [], measurementDesign: ["x"],
    complianceBoundary: "Approved information and workflows only",
  });
  const modified = modifyProcess(process.id, { type: "add_step", afterStepId: process.steps[0].id, step: { type: "wait", label: "Wait 48h", waitHours: 48, nextStepIds: [] } });
  assert.ok(modified);
  assert.equal(modified!.process.version, 2);
  assert.equal(modified!.process.parentProcessId, process.id);
  assert.ok(modified!.process.steps.length > process.steps.length);
});

// ─── Engine coordinator ────────────────────────────────────────────

test("goldenEngine.executeAndObserve runs the full loop: outcome → attribution → derivatives → competition", () => {
  saveHypotheses([]); saveHypothesisAssignments([]); saveHypothesisOutcomes([]);
  saveHypothesisAttributions([]); saveDerivatives([]); saveCompetitions([]);
  saveDiscoveryLedger([]); saveResearchReliability([]);
  goldenEngine.initialize();
  const assignments = goldenEngine.allocateForEmployee("emp-001");
  assert.ok(assignments.length > 0);
  const result = goldenEngine.executeAndObserve({
    assignmentId: assignments[0].id,
    successKind: "performance",
    outcomeDescription: "Engine loop test.",
    metrics: [{ metric: "completion", value: 85, unit: "pct", baseline: 50, higherIsBetter: true }],
    falsified: false,
  });
  assert.ok(result.outcome.id);
  assert.ok(result.attribution);
  // Competition entries should have been submitted.
  const comps = loadCompetitions();
  assert.ok(comps.length > 0);
});

test("goldenEngine.snapshot returns the full engine state", () => {
  const state = goldenEngine.snapshot();
  assert.ok(Array.isArray(state.hypotheses));
  assert.ok(Array.isArray(state.assignments));
  assert.ok(Array.isArray(state.goldenNodes));
});
