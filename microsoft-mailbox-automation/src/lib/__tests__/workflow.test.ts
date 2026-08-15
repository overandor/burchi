import { test, before, after, describe } from "node:test";
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
  loadHypothesisAssignments,
} from "../config";

import {
  acceptAssignment,
  rejectAssignment,
  saveIntel,
  skipIntel,
  commitExecutionPlan,
  recordObservation,
  runAttribution,
  finalizeAssignment,
  getWorkflowStatus,
  getActiveWorkflow,
  getCompletedCycles,
  intelQualityScore,
  type WorkflowStage,
} from "../golden/workflow";

import type { HypothesisAssignment, HypothesisAnatomy, PriorArtRecord } from "@/types";

// ─── Test setup ─────────────────────────────────────────────────────────

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
  // Restore backups
  for (const b of backups) {
    if (b.existed && b.backup) {
      fs.writeFileSync(b.file, b.backup);
    } else if (!b.existed && fs.existsSync(b.file)) {
      fs.unlinkSync(b.file);
    }
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────

function makeHypothesis(): HypothesisAnatomy {
  return {
    id: "hyp_test_001",
    priorArtId: "pa_test_001",
    priorArtStatus: "transfer_candidate",
    createdAt: new Date().toISOString(),
    origin: "research",
    kind: "fit",
    researchRisk: "low",
    claim: "Test hypothesis for workflow validation",
    sourceDomains: ["test"],
    targetCondition: "Test condition",
    intervention: "Test intervention",
    control: "Test control",
    primaryOutcome: "Test outcome",
    primaryUncertainty: "Test uncertainty",
    complianceBoundary: "Test compliance boundary",
    modifiableDimensions: ["timing", "channel"],
  } as any;
}

function makePriorArt(): PriorArtRecord {
  return {
    id: "pa_test_001",
    hypothesisClaim: "Test hypothesis for workflow validation",
    status: "transfer_candidate",
    evidenceState: "supported",
    sourceDomains: ["test"],
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Test support summary",
    responsibleComponent: "Test component",
    researchConfidence: 0.7,
    transferabilityScore: 0.6,
  } as any;
}

function makeAssignment(state: string = "assigned"): HypothesisAssignment {
  return {
    id: "asg_test_001",
    hypothesisId: "hyp_test_001",
    employeeId: "emp_test_001",
    employeeRole: "field_representative",
    kind: "fit",
    state: state as any,
    assignedAt: new Date().toISOString(),
    eligibleAccountIds: ["acct_001"],
    evaluationPeriodDays: 30,
    trialNumber: 1,
    allocationReason: "Test allocation",
    innovationWindow: ["timing", "channel"],
  } as any;
}

function setupTestData() {
  saveHypotheses([makeHypothesis()]);
  savePriorArt([makePriorArt()]);
  saveHypothesisAssignments([makeAssignment()]);
}

function resetAssignments(assignments: HypothesisAssignment[]) {
  saveHypothesisAssignments(assignments);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Workflow State Machine", () => {

  test("Stage 0: Briefing — assigned assignment shows briefing stage", () => {
    setupTestData();
    const a = loadHypothesisAssignments()[0];
    const status = getWorkflowStatus(a);

    assert.equal(status.stage, "briefing");
    assert.equal(status.stageIndex, 0);
    assert.equal(status.canProceed, true);
    assert.equal(status.nextAction, "Accept or reject this mission");
  });

  test("Stage 0→1: Accept transitions to accepted state", () => {
    setupTestData();
    const result = acceptAssignment("asg_test_001");

    assert.ok(result);
    assert.equal(result.state, "accepted");
    assert.ok(result.acceptedAt);
    assert.ok(result.stageTimestamps?.accepted);

    const status = getWorkflowStatus(result);
    assert.equal(status.stage, "intel");
    assert.equal(status.stageIndex, 1);
  });

  test("Cannot accept an already-accepted assignment", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    const second = acceptAssignment("asg_test_001");

    assert.equal(second, undefined);
  });

  test("Reject transitions to rejected state", () => {
    setupTestData();
    const result = rejectAssignment("asg_test_001", "Not relevant");

    assert.ok(result);
    assert.equal(result.state, "rejected");
    assert.equal(result.employeeNote, "Not relevant");

    const status = getWorkflowStatus(result);
    assert.equal(status.stage, "briefing");
    assert.equal(status.canProceed, false);
  });

  test("Cannot accept a rejected assignment", () => {
    setupTestData();
    rejectAssignment("asg_test_001");
    const result = acceptAssignment("asg_test_001");
    assert.equal(result, undefined);
  });
});

describe("Workflow Intel Stage", () => {

  test("Saving research intel increments evidence count", () => {
    setupTestData();
    acceptAssignment("asg_test_001");

    const result = saveIntel("asg_test_001", {
      research: {
        summary: "Test research summary",
        sourceDomains: ["domain1", "domain2"],
        adjacentSupport: "Test adjacent support",
      },
    });

    assert.ok(result);
    assert.ok(result.intel?.research);
    assert.equal(result.intel?.stepsCompleted, 1);
    assert.equal(result.intel?.skipped, false);
    assert.equal(result.state, "researched"); // transitions after first intel
  });

  test("Saving confounders intel raises quality score", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    saveIntel("asg_test_001", {
      research: { summary: "S", sourceDomains: [], adjacentSupport: "A" },
    });

    const result = saveIntel("asg_test_001", {
      confounders: { items: ["confounder1", "confounder2"] },
    });

    assert.ok(result);
    assert.equal(result.intel?.stepsCompleted, 2);
    assert.equal(result.intel?.confounders?.items.length, 2);

    const quality = intelQualityScore(result.intel);
    assert.equal(quality, 0.8); // 2 steps = 0.8
  });

  test("Saving all 3 intel steps gives max quality score", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    saveIntel("asg_test_001", { research: { summary: "S", sourceDomains: [], adjacentSupport: "A" } });
    saveIntel("asg_test_001", { confounders: { items: ["c1"] } });
    const result = saveIntel("asg_test_001", {
      challenge: { text: "Challenge text", weakestPoint: "Weak point", falsificationCondition: "Condition" },
    });

    assert.equal(result.intel?.stepsCompleted, 3);
    const quality = intelQualityScore(result.intel);
    assert.equal(quality, 1.0); // 3 steps = 1.0
  });

  test("Skip intel sets quality to 0.1 and transitions to researched", () => {
    setupTestData();
    acceptAssignment("asg_test_001");

    const result = skipIntel("asg_test_001");

    assert.ok(result);
    assert.equal(result.state, "researched");
    assert.equal(result.intel?.skipped, true);
    assert.equal(result.intel?.stepsCompleted, 0);

    const quality = intelQualityScore(result.intel);
    assert.equal(quality, 0.1);
  });

  test("Cannot save intel on an assignment that hasn't been accepted", () => {
    setupTestData();
    // Assignment is in "assigned" state, not "accepted"
    const result = saveIntel("asg_test_001", {
      research: { summary: "S", sourceDomains: [], adjacentSupport: "A" },
    });
    assert.equal(result, undefined);
  });

  test("Intel quality score is 0.1 for no intel", () => {
    assert.equal(intelQualityScore(undefined), 0.1);
    assert.equal(intelQualityScore({ stepsCompleted: 0, skipped: false }), 0.1);
  });

  test("Intel quality score scales: 1=0.6, 2=0.8, 3=1.0", () => {
    assert.equal(intelQualityScore({ stepsCompleted: 1, skipped: false }), 0.6);
    assert.equal(intelQualityScore({ stepsCompleted: 2, skipped: false }), 0.8);
    assert.equal(intelQualityScore({ stepsCompleted: 3, skipped: false }), 1.0);
  });
});

describe("Workflow Execution Plan Stage", () => {

  test("Commit plan transitions to executing state", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001");

    const result = commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: {
        metric: "response rate",
        expectedDirection: "increase",
        expectedMagnitude: "15%",
        unit: "percent",
      },
      falsificationCriteria: "No improvement after 30 days",
      evaluationDays: 30,
    });

    assert.ok(result);
    assert.equal(result.state, "executing");
    assert.ok(result.executionPlan);
    assert.equal(result.executionPlan?.prediction.metric, "response rate");
    assert.equal(result.executionPlan?.prediction.expectedDirection, "increase");
    assert.ok(result.stageTimestamps?.executionStarted);
  });

  test("Cannot commit plan without reaching intel stage first", () => {
    setupTestData();
    // Assignment is in "assigned" state — hasn't accepted yet
    const result = commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    assert.equal(result, undefined);
  });

  test("Plan with modification records the modification", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001");

    const result = commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      modification: {
        dimension: "timing",
        rationale: "Testing morning vs afternoon contact",
      },
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });

    assert.ok(result);
    assert.equal(result.modifiedDimension, "timing");
    assert.equal(result.modificationRationale, "Testing morning vs afternoon contact");
    assert.ok(result.modifiedAt);
  });
});

describe("Workflow Observation Stage", () => {

  test("Recording observation transitions to observed state", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001");
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "response rate", expectedDirection: "increase", expectedMagnitude: "15%", unit: "percent" },
      falsificationCriteria: "No improvement",
      evaluationDays: 30,
    });

    const result = recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "Response rate increased as predicted",
      metrics: [{ metric: "response rate", value: 18, unit: "percent", baseline: 12, higherIsBetter: true }],
      falsified: false,
    });

    assert.ok(result);
    assert.equal(result.assignment.state, "observed");
    assert.ok(result.outcomeId);
    assert.ok(result.assignment.observationId);
    assert.ok(result.assignment.stageTimestamps?.observed);
  });

  test("Cannot observe an assignment that isn't executing", () => {
    setupTestData();
    // Assignment is in "assigned" state
    const result = recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "test",
      metrics: [],
      falsified: false,
    });
    assert.equal(result, undefined);
  });

  test("Recording falsified observation works", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001");
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });

    const result = recordObservation("asg_test_001", {
      successKind: "falsified",
      outcomeDescription: "No improvement observed",
      metrics: [{ metric: "m", value: 10, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: true,
      falsificationEvidence: "Metric unchanged over 30 days",
    });

    assert.ok(result);
    assert.equal(result.assignment.state, "observed");
  });
});

describe("Workflow Attribution Stage", () => {

  test("Run attribution transitions to attributed state", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    saveIntel("asg_test_001", {
      research: { summary: "S", sourceDomains: [], adjacentSupport: "A" },
      confounders: { items: ["c1"] },
      challenge: { text: "T", weakestPoint: "W", falsificationCondition: "F" },
    });
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "It worked",
      metrics: [{ metric: "m", value: 15, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: false,
    });

    const result = runAttribution("asg_test_001");

    assert.ok(result);
    assert.equal(result.assignment.state, "attributed");
    assert.ok(result.attribution);
    assert.ok(result.assignment.attributionId);
  });

  test("Attribution confidence is capped by intel quality", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001"); // intel quality = 0.1
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "It worked",
      metrics: [{ metric: "m", value: 15, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: false,
    });

    const result = runAttribution("asg_test_001");

    assert.ok(result);
    // Confidence should be capped at 0.1 because intel was skipped
    assert.ok(result.attribution.attributionConfidence <= 0.1,
      `Expected confidence <= 0.1 but got ${result.attribution.attributionConfidence}`);
    // With such low confidence, factor should be unresolved
    assert.equal(result.attribution.responsibleFactor, "unresolved");
  });

  test("Cannot attribute an assignment that hasn't been observed", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    const result = runAttribution("asg_test_001");
    assert.equal(result, undefined);
  });
});

describe("Workflow Finalize Stage", () => {

  test("Finalize transitions to finalized state", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    saveIntel("asg_test_001", {
      research: { summary: "S", sourceDomains: [], adjacentSupport: "A" },
    });
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "It worked",
      metrics: [{ metric: "m", value: 15, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: false,
    });
    runAttribution("asg_test_001");

    const result = finalizeAssignment("asg_test_001");

    assert.ok(result);
    assert.equal(result.assignment.state, "finalized");
    assert.ok(result.assignment.stageTimestamps?.finalized);
  });

  test("Cannot finalize without attribution", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    const result = finalizeAssignment("asg_test_001");
    assert.equal(result, undefined);
  });

  test("Finalize reports whether next mission is unlocked", () => {
    setupTestData();
    acceptAssignment("asg_test_001");
    saveIntel("asg_test_001", { research: { summary: "S", sourceDomains: [], adjacentSupport: "A" } });
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "It worked",
      metrics: [{ metric: "m", value: 15, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: false,
    });
    runAttribution("asg_test_001");

    const result = finalizeAssignment("asg_test_001");

    assert.ok(result);
    assert.equal(result.unlocked, false); // no other assigned missions
    assert.ok(result.nextMissionHint);
  });
});

describe("Workflow Full Chain (end-to-end)", () => {

  test("Complete full chain: assigned → accepted → researched → executing → observed → attributed → finalized", () => {
    setupTestData();

    // Stage 0: Briefing
    let a = loadHypothesisAssignments()[0];
    assert.equal(getWorkflowStatus(a).stage, "briefing");

    // Stage 0→1: Accept
    a = acceptAssignment("asg_test_001")!;
    assert.equal(a.state, "accepted");
    assert.equal(getWorkflowStatus(a).stage, "intel");

    // Stage 1→2: Intel (all 3 steps)
    a = saveIntel("asg_test_001", { research: { summary: "S", sourceDomains: [], adjacentSupport: "A" } })!;
    a = saveIntel("asg_test_001", { confounders: { items: ["c1", "c2"] } })!;
    a = saveIntel("asg_test_001", { challenge: { text: "T", weakestPoint: "W", falsificationCondition: "F" } })!;
    assert.equal(a.state, "researched");
    assert.equal(intelQualityScore(a.intel), 1.0);
    assert.equal(getWorkflowStatus(a).stage, "execution");

    // Stage 2→3: Commit plan
    a = commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "response rate", expectedDirection: "increase", expectedMagnitude: "15%", unit: "percent" },
      falsificationCriteria: "No improvement after 30 days",
      evaluationDays: 30,
    })!;
    assert.equal(a.state, "executing");
    assert.equal(getWorkflowStatus(a).stage, "observation");

    // Stage 3→4: Record observation
    const obs = recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "Response rate increased from 12% to 18%",
      metrics: [{ metric: "response rate", value: 18, unit: "percent", baseline: 12, higherIsBetter: true }],
      falsified: false,
    })!;
    assert.equal(obs.assignment.state, "observed");
    assert.equal(getWorkflowStatus(obs.assignment).stage, "attribution");

    // Stage 4→5: Attribution
    const attr = runAttribution("asg_test_001")!;
    assert.equal(attr.assignment.state, "attributed");
    // With full intel, confidence should NOT be capped to 0.1
    assert.ok(attr.attribution.attributionConfidence > 0.1,
      `Expected confidence > 0.1 with full intel, got ${attr.attribution.attributionConfidence}`);

    // Stage 5→6: Finalize
    const fin = finalizeAssignment("asg_test_001")!;
    assert.equal(fin.assignment.state, "finalized");
    assert.equal(getWorkflowStatus(fin.assignment).stage, "finalized");
    assert.equal(getWorkflowStatus(fin.assignment).canProceed, false);
  });

  test("Skip-intel path: full chain with skipped intel degrades attribution", () => {
    setupTestData();

    acceptAssignment("asg_test_001");
    skipIntel("asg_test_001");
    commitExecutionPlan("asg_test_001", {
      accountIds: ["acct_001"],
      prediction: { metric: "m", expectedDirection: "increase", expectedMagnitude: "10%", unit: "u" },
      falsificationCriteria: "none",
      evaluationDays: 30,
    });
    recordObservation("asg_test_001", {
      successKind: "confirmed",
      outcomeDescription: "It worked",
      metrics: [{ metric: "m", value: 15, unit: "u", baseline: 10, higherIsBetter: true }],
      falsified: false,
    });
    const result = runAttribution("asg_test_001")!;

    // Attribution should be unresolved because intel was skipped
    assert.equal(result.attribution.responsibleFactor, "unresolved");
    assert.ok(result.attribution.attributionConfidence <= 0.1);

    // Can still finalize
    const fin = finalizeAssignment("asg_test_001")!;
    assert.equal(fin.assignment.state, "finalized");
  });
});

describe("Workflow Helper Functions", () => {

  test("getActiveWorkflow returns the furthest-along assignment", () => {
    saveHypotheses([makeHypothesis()]);
    savePriorArt([makePriorArt()]);
    saveHypothesisAssignments([
      { ...makeAssignment("assigned"), id: "asg_a" },
      { ...makeAssignment("accepted"), id: "asg_b" },
      { ...makeAssignment("executing"), id: "asg_c" },
    ]);

    const active = getActiveWorkflow("emp_test_001");
    assert.ok(active);
    assert.equal(active.id, "asg_c"); // executing is furthest along
  });

  test("getActiveWorkflow excludes finalized and rejected", () => {
    saveHypotheses([makeHypothesis()]);
    savePriorArt([makePriorArt()]);
    saveHypothesisAssignments([
      { ...makeAssignment("finalized"), id: "asg_a" },
      { ...makeAssignment("rejected"), id: "asg_b" },
    ]);

    const active = getActiveWorkflow("emp_test_001");
    assert.equal(active, undefined);
  });

  test("getCompletedCycles counts finalized and falsified", () => {
    saveHypothesisAssignments([
      { ...makeAssignment("finalized"), id: "asg_a", employeeId: "emp_test_001" },
      { ...makeAssignment("falsified"), id: "asg_b", employeeId: "emp_test_001" },
      { ...makeAssignment("assigned"), id: "asg_c", employeeId: "emp_test_001" },
    ]);

    const count = getCompletedCycles("emp_test_001");
    assert.equal(count, 2);
  });

  test("Workflow status for finalized shows canProceed=false", () => {
    const a = { ...makeAssignment("finalized") };
    const status = getWorkflowStatus(a);
    assert.equal(status.stage, "finalized");
    assert.equal(status.canProceed, false);
    assert.equal(status.stageLabel, "Loop Complete");
  });

  test("Workflow status for rejected shows canProceed=false", () => {
    const a = { ...makeAssignment("rejected") };
    const status = getWorkflowStatus(a);
    assert.equal(status.canProceed, false);
    assert.equal(status.stageLabel, "Rejected");
  });
});
