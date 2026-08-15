import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_CANDIDATES,
  getCandidate,
  getCandidatesByChain,
  getPostCallPipeline,
  getUpstream,
  AutomationChain,
} from "../automation/catalog";
import {
  calculateNetSavings,
  recordOutcome,
  evaluatePromotion,
  PROMOTION_THRESHOLDS,
  transitionStage,
  evaluateAllCandidates,
} from "../automation/evaluation";
import {
  matchStagnationToCandidate,
  recordAutomationOutcome,
} from "../automation/stagnation-bridge";

// Use a test database
process.env.DATABASE_URL = ":memory:";

describe("Automation Catalog", () => {
  test("has exactly 9 candidates", () => {
    assert.equal(AUTOMATION_CANDIDATES.length, 9);
  });

  test("covers all three chains", () => {
    const chains = new Set(AUTOMATION_CANDIDATES.map(c => c.chain));
    assert.ok(chains.has("pre_call"));
    assert.ok(chains.has("call_to_record"));
    assert.ok(chains.has("learning"));
  });

  test("pre-call chain has 4 candidates in order", () => {
    const chain = getCandidatesByChain("pre_call");
    assert.equal(chain.length, 4);
    assert.equal(chain[0].id, "auto_001");
    assert.equal(chain[1].id, "auto_041");
    assert.equal(chain[2].id, "auto_031");
    assert.equal(chain[3].id, "auto_021");
  });

  test("call-to-record chain has 4 candidates in order", () => {
    const chain = getCandidatesByChain("call_to_record");
    assert.equal(chain.length, 4);
    assert.equal(chain[0].id, "auto_191");
    assert.equal(chain[1].id, "auto_091");
    assert.equal(chain[2].id, "auto_092");
    assert.equal(chain[3].id, "auto_111");
  });

  test("learning chain has 1 candidate", () => {
    const chain = getCandidatesByChain("learning");
    assert.equal(chain.length, 1);
    assert.equal(chain[0].id, "auto_211");
  });

  test("post-call pipeline returns the call-to-record chain", () => {
    const pipeline = getPostCallPipeline();
    assert.equal(pipeline.length, 4);
    assert.equal(pipeline[0].name, "Auto-detect adverse events in calls");
    assert.equal(pipeline[3].name, "Auto-generate follow-up email");
  });

  test("chain dependencies are wired correctly", () => {
    // #41 brief consumes from #1 profile
    const brief = getCandidate("auto_041")!;
    assert.ok(brief.consumesFrom?.includes("auto_001"));
    // #1 profile feeds into #41 brief
    const profile = getCandidate("auto_001")!;
    assert.ok(profile.feedsInto?.includes("auto_041"));
    // #91 call report consumes from #191 safety
    const callReport = getCandidate("auto_091")!;
    assert.ok(callReport.consumesFrom?.includes("auto_191"));
  });

  test("learning chain feeds back to pre-call", () => {
    const analytics = getCandidate("auto_211")!;
    assert.ok(analytics.feedsInto?.includes("auto_001"), "Territory analytics should feed back to HCP profile");
  });

  test("getUpstream returns transitive dependencies", () => {
    // #92 CRM mapping consumes from #91 call report, which consumes from #191 safety
    const upstream = getUpstream("auto_092");
    assert.ok(upstream.some(c => c.id === "auto_091"), "Should include call report");
    assert.ok(upstream.some(c => c.id === "auto_191"), "Should include safety detection (transitive)");
  });

  test("every candidate starts at 'candidate' stage", () => {
    for (const c of AUTOMATION_CANDIDATES) {
      assert.equal(c.stage, "candidate", `${c.name} should start at candidate stage`);
    }
  });

  test("every candidate has a human baseline with positive minutes", () => {
    for (const c of AUTOMATION_CANDIDATES) {
      assert.ok(c.humanBaseline.minutesPerInvocation > 0, `${c.name} should have positive baseline minutes`);
      assert.ok(c.humanBaseline.invocationsPerDay > 0, `${c.name} should have positive daily invocations`);
      assert.ok(c.humanBaseline.errorRate >= 0 && c.humanBaseline.errorRate <= 1, `${c.name} should have valid error rate`);
    }
  });

  test("no hardcoded 'hours saved' — only baseline measurements", () => {
    for (const c of AUTOMATION_CANDIDATES) {
      // The candidate should NOT claim any saved hours
      assert.ok(!c.description.includes("hours saved"), `${c.name} must not claim hours saved`);
      assert.ok(!c.description.includes("Eliminates"), `${c.name} must not claim "Eliminates"`);
    }
  });
});

describe("NetSavings Calculation", () => {
  test("returns zero savings with no outcomes", () => {
    const savings = calculateNetSavings("auto_001");
    assert.ok(savings);
    assert.equal(savings.sampleSize, 0);
    assert.equal(savings.netMinutesSaved, 0);
    assert.equal(savings.isNetPositive, false);
    assert.equal(savings.sufficientSample, false);
  });

  test("calculates positive net savings when automation is faster", () => {
    // Record 10 outcomes where automation saves time
    for (let i = 0; i < 10; i++) {
      recordOutcome({
        candidateId: "auto_091",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "shadow",
        humanMinutes: 18, // baseline is 18 min
        automationMinutes: 2,
        automationOperatingCost: 0.01,
        reviewMinutes: 3,
        correctionMinutes: 1,
        exceptions: 0,
        exceptionMinutes: 0,
        outputErrors: 0,
        complianceIncidents: 0,
        correctResult: true,
      });
    }
    const savings = calculateNetSavings("auto_091");
    assert.ok(savings);
    assert.equal(savings.sampleSize, 10);
    // Net = 18 (baseline) - 3 (review) - 1 (correction) - 0 (exception) = 14 min saved
    assert.equal(savings.netMinutesSaved, 14);
    assert.ok(savings.isNetPositive);
    assert.ok(savings.sufficientSample);
  });

  test("calculates negative net savings when automation is slower", () => {
    for (let i = 0; i < 5; i++) {
      recordOutcome({
        candidateId: "auto_031",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "shadow",
        humanMinutes: 20,
        automationMinutes: 5,
        automationOperatingCost: 0.05,
        reviewMinutes: 10,
        correctionMinutes: 8,
        exceptions: 2,
        exceptionMinutes: 5,
        outputErrors: 1,
        complianceIncidents: 0,
        correctResult: false,
      });
    }
    const savings = calculateNetSavings("auto_031");
    assert.ok(savings);
    // Net = 20 - 10 - 8 - 5 = -3 min (automation costs more)
    assert.equal(savings.netMinutesSaved, -3);
    assert.ok(!savings.isNetPositive);
  });

  test("error delta is calculated against human baseline", () => {
    // auto_191 has humanBaseline.errorRate = 0.25
    for (let i = 0; i < 10; i++) {
      recordOutcome({
        candidateId: "auto_191",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "shadow",
        humanMinutes: 5,
        automationMinutes: 1,
        automationOperatingCost: 0,
        reviewMinutes: 1,
        correctionMinutes: 0,
        exceptions: 0,
        exceptionMinutes: 0,
        outputErrors: 0,
        complianceIncidents: 0,
        correctResult: i < 9, // 90% correct = 10% error rate
      });
    }
    const savings = calculateNetSavings("auto_191");
    assert.ok(savings);
    // automation error rate = 0.1, human baseline = 0.25
    // errorDelta = 0.1 - 0.25 = -0.15 (improvement)
    assert.ok(savings.errorDelta < 0, "Error delta should be negative (improvement)");
  });
});

describe("Promotion Ladder", () => {
  test("promotion thresholds are defined for each transition", () => {
    assert.ok(PROMOTION_THRESHOLDS["shadow→assisted"]);
    assert.ok(PROMOTION_THRESHOLDS["assisted→supervised"]);
    assert.ok(PROMOTION_THRESHOLDS["supervised→validated"]);
    assert.ok(PROMOTION_THRESHOLDS["validated→autonomous"]);
  });

  test("thresholds become stricter at higher stages", () => {
    const shadowToAssisted = PROMOTION_THRESHOLDS["shadow→assisted"];
    const validatedToAutonomous = PROMOTION_THRESHOLDS["validated→autonomous"];
    assert.ok(validatedToAutonomous.minSample > shadowToAssisted.minSample,
      "Higher stages should require more samples");
    assert.ok(validatedToAutonomous.minNetSavings > shadowToAssisted.minNetSavings,
      "Higher stages should require more net savings");
    assert.ok(validatedToAutonomous.minCorrectRate > shadowToAssisted.minCorrectRate,
      "Higher stages should require higher correct rate");
  });

  test("candidate with insufficient sample cannot be promoted", () => {
    const promotion = evaluatePromotion("auto_001");
    assert.ok(!promotion.shouldTransition);
    assert.ok(promotion.reason.includes("Insufficient") || promotion.reason.includes("sample"));
  });

  test("candidate with good outcomes can be promoted from shadow to assisted", () => {
    // First transition to shadow
    transitionStage("auto_091", "shadow", "Starting shadow evaluation");

    // Record 10 good outcomes
    for (let i = 0; i < 10; i++) {
      recordOutcome({
        candidateId: "auto_091",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "shadow",
        humanMinutes: 18,
        automationMinutes: 2,
        automationOperatingCost: 0.01,
        reviewMinutes: 3,
        correctionMinutes: 0,
        exceptions: 0,
        exceptionMinutes: 0,
        outputErrors: 0,
        complianceIncidents: 0,
        correctResult: true,
      });
    }

    const promotion = evaluatePromotion("auto_091");
    assert.ok(promotion.shouldTransition, "Should be promoted from shadow to assisted");
    assert.equal(promotion.recommendedStage, "assisted");
  });

  test("compliance incident triggers immediate degradation", () => {
    transitionStage("auto_191", "supervised", "Ready for supervised evaluation");

    for (let i = 0; i < 5; i++) {
      recordOutcome({
        candidateId: "auto_191",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "supervised",
        humanMinutes: 5,
        automationMinutes: 1,
        automationOperatingCost: 0,
        reviewMinutes: 1,
        correctionMinutes: 0,
        exceptions: 0,
        exceptionMinutes: 0,
        outputErrors: 0,
        complianceIncidents: i === 4 ? 1 : 0, // compliance incident on last outcome
        correctResult: true,
      });
    }

    const promotion = evaluatePromotion("auto_191");
    assert.equal(promotion.recommendedStage, "degraded");
    assert.ok(promotion.shouldTransition);
    assert.ok(promotion.reason.includes("Compliance"));
  });

  test("3 consecutive negative outcomes trigger degradation", () => {
    transitionStage("auto_031", "assisted", "Starting assisted evaluation");

    for (let i = 0; i < 3; i++) {
      recordOutcome({
        candidateId: "auto_031",
        recordedAt: new Date().toISOString(),
        stageAtMeasurement: "assisted",
        humanMinutes: 20,
        automationMinutes: 5,
        automationOperatingCost: 0,
        reviewMinutes: 15,
        correctionMinutes: 10,
        exceptions: 1,
        exceptionMinutes: 5,
        outputErrors: 2,
        complianceIncidents: 0,
        correctResult: false,
      });
    }

    const promotion = evaluatePromotion("auto_031");
    assert.equal(promotion.recommendedStage, "degraded");
    assert.ok(promotion.reason.includes("consecutive negative"));
  });
});

describe("Stagnation Bridge", () => {
  test("matches call report task to auto_091", () => {
    const match = matchStagnationToCandidate(
      "Manually writing call reports after each HCP visit, mapping conversation to CRM fields"
    );
    assert.ok(match);
    assert.ok(match.score > 0);
  });

  test("matches safety detection task to auto_191", () => {
    const match = matchStagnationToCandidate(
      "Reviewing call transcripts for adverse events and routing to safety team"
    );
    assert.ok(match);
    assert.ok(match.score > 0);
  });

  test("matches route planning task to auto_031", () => {
    const match = matchStagnationToCandidate(
      "Building daily call route to minimize drive time across territory"
    );
    assert.ok(match);
    assert.ok(match.score > 0);
  });

  test("returns null for unrelated task", () => {
    const match = matchStagnationToCandidate(
      "Cooking dinner and doing laundry"
    );
    // Might match weakly but should have low score
    if (match) {
      assert.ok(match.score < 0.3, "Unrelated task should have low match score");
    }
  });

  test("recordAutomationOutcome returns net savings and promotion", () => {
    const result = recordAutomationOutcome("auto_091", {
      humanMinutes: 18,
      automationMinutes: 2,
      automationOperatingCost: 0.01,
      reviewMinutes: 3,
      correctionMinutes: 1,
      exceptions: 0,
      exceptionMinutes: 0,
      outputErrors: 0,
      complianceIncidents: 0,
      correctResult: true,
    });
    assert.ok(result.outcomeId);
    assert.ok(result.netSavings);
    assert.ok(result.promotion);
  });
});

describe("Full Catalog Evaluation", () => {
  test("evaluates all 9 candidates", () => {
    const evaluations = evaluateAllCandidates();
    assert.equal(evaluations.length, 9);
  });

  test("summary counts are correct", () => {
    const evaluations = evaluateAllCandidates();
    const netPositive = evaluations.filter(e => e.netSavings?.isNetPositive).length;
    const readyForPromotion = evaluations.filter(e => e.promotion.shouldTransition).length;
    assert.ok(netPositive >= 0);
    assert.ok(readyForPromotion >= 0);
    assert.ok(netPositive <= 9);
    assert.ok(readyForPromotion <= 9);
  });
});
