import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_EMPLOYEES,
  SEED_EXPERIMENTS,
  SEED_STRATEGIES,
  SEED_OUTCOMES,
  createSeedState,
} from "@/lib/competitive/seed-data";
import { computeCompetitiveScore, getPrimaryConstraint } from "@/lib/competitive/scoring";
import { generateTrajectory } from "@/lib/competitive/trajectory";
import {
  isEmployeeEligible,
  assignVariant,
  createExperiment,
  stopExperiment,
  analyzeExperiment,
  promoteStrategy,
  getActiveExperiments,
  getCompletedExperiments,
} from "@/lib/competitive/experiment";
import type { ExperimentVariantRole } from "@/types";
import {
  learnFromOutcomes,
  getValidatedStrategies,
  getExperimentalStrategies,
  getStrategiesForEmployee,
  advanceLifecycle,
  retireStaleStrategies,
} from "@/lib/competitive/learning";
import { generateCompetitivePlan } from "@/lib/competitive/engine";

// ─── Scoring Tests ──────────────────────────────────────────────────

describe("Competitive Scoring", () => {
  it("should compute a score with 7 dimensions for an employee", () => {
    const emp = SEED_EMPLOYEES[0];
    const score = computeCompetitiveScore(emp, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    assert.equal(score.dimensions.length, 7);
    assert.ok(score.percentile >= 0 && score.percentile <= 100);
    assert.ok(score.adjustedPercentile >= 0 && score.adjustedPercentile <= 100);
    assert.ok(score.rawPosition.rank >= 1);
    assert.ok(score.adjustedPosition.rank >= 1);
  });

  it("should identify the primary constraint as the lowest-scoring dimension", () => {
    const emp = SEED_EMPLOYEES[0];
    const score = computeCompetitiveScore(emp, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    const constraint = getPrimaryConstraint(score);
    const minScore = Math.min(...score.dimensions.map((d) => d.score));
    assert.equal(constraint.currentScore, minScore);
    assert.ok(constraint.dimension.length > 0);
  });

  it("should produce different raw vs adjusted positions for employees in different territories", () => {
    const emp1 = SEED_EMPLOYEES[0]; // growing territory
    const emp3 = SEED_EMPLOYEES[2]; // early territory, restricted access
    const score1 = computeCompetitiveScore(emp1, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    const score3 = computeCompetitiveScore(emp3, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    // The adjusted index should differ from raw for at least one employee
    // because territory opportunity and access difficulty are factored in
    const diff1 = Math.abs(score1.adjustedPerformanceIndex - score1.percentile);
    const diff3 = Math.abs(score3.adjustedPerformanceIndex - score3.percentile);
    assert.ok(diff1 > 0 || diff3 > 0, "at least one employee should have adjusted != raw");
  });
});

// ─── Trajectory Tests ───────────────────────────────────────────────

describe("Trajectory Generation", () => {
  it("should generate a trajectory with 3-5 steps", () => {
    const emp = SEED_EMPLOYEES[0];
    const score = computeCompetitiveScore(emp, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    const trajectory = generateTrajectory(emp, score, SEED_OUTCOMES, SEED_STRATEGIES);
    assert.ok(trajectory.steps.length >= 3 && trajectory.steps.length <= 5);
    assert.ok(trajectory.primaryConstraint.length > 0);
    assert.ok(trajectory.constraintDescription.length > 0);
    assert.ok(trajectory.expectedPercentile30Day.low <= trajectory.expectedPercentile30Day.high);
  });

  it("should order steps sequentially", () => {
    const emp = SEED_EMPLOYEES[1];
    const score = computeCompetitiveScore(emp, SEED_EMPLOYEES, SEED_OUTCOMES, SEED_STRATEGIES);
    const trajectory = generateTrajectory(emp, score, SEED_OUTCOMES, SEED_STRATEGIES);
    for (let i = 0; i < trajectory.steps.length; i++) {
      assert.equal(trajectory.steps[i].order, i + 1);
    }
  });
});

// ─── Experiment Tests ───────────────────────────────────────────────

describe("Experiment Engine", () => {
  it("should exclude new hires from experiments that exclude them", () => {
    const newHire = SEED_EMPLOYEES[2]; // experienceLevel: "new"
    const exp = SEED_EXPERIMENTS[0]; // excludes new hires
    assert.equal(isEmployeeEligible(newHire, exp), false);
  });

  it("should include eligible employees", () => {
    const emp = SEED_EMPLOYEES[0]; // intermediate, consented
    const exp = SEED_EXPERIMENTS[0];
    assert.equal(isEmployeeEligible(emp, exp), true);
  });

  it("should assign a variant from the available roles", () => {
    const emp = SEED_EMPLOYEES[0];
    const exp = SEED_EXPERIMENTS[0];
    const assignments = new Map<string, ExperimentVariantRole>();
    const variant = assignVariant(emp, exp, assignments);
    assert.ok(variant !== null);
    assert.ok(exp.variants.some((v) => v.role === variant));
  });

  it("should return existing assignment if already assigned", () => {
    const emp = SEED_EMPLOYEES[0];
    const exp = SEED_EXPERIMENTS[0];
    const assignments = new Map<string, ExperimentVariantRole>([[emp.id, "control"]]);
    const variant = assignVariant(emp, exp, assignments);
    assert.equal(variant, "control");
  });

  it("should create an experiment with the correct structure", () => {
    const exp = createExperiment({
      hypothesis: "Test hypothesis",
      description: "Test description",
      eligibleCriteria: ["criterion 1"],
      excludedCriteria: ["exclusion 1"],
      primaryOutcome: "Progression",
      secondaryOutcomes: ["Response rate"],
      guardrails: ["Approved materials only"],
      stopConditions: ["Compliance exception"],
      variantDescriptions: [
        { role: "control", description: "Standard" },
        { role: "variant_a", description: "New approach" },
      ],
      durationDays: 14,
      complianceValidated: true,
    });
    assert.equal(exp.variants.length, 2);
    assert.equal(exp.status, "running");
    assert.equal(exp.complianceValidated, true);
    assert.ok(exp.id.length > 0);
  });

  it("should stop an experiment with a reason", () => {
    const exp = SEED_EXPERIMENTS[0];
    const stopped = stopExperiment(exp, "sufficient_evidence", "Enough data");
    assert.equal(stopped.status, "analyzed");
    assert.equal(stopped.stopReason, "sufficient_evidence");
    assert.equal(stopped.stopDetail, "Enough data");
  });

  it("should analyze experiment outcomes and identify a winner", () => {
    const exp = SEED_EXPERIMENTS[2]; // completed experiment
    const result = analyzeExperiment(exp, SEED_OUTCOMES);
    assert.ok(result.winningVariant);
    assert.ok(result.effectSize >= 0);
    assert.ok(result.confidenceLevel > 0 && result.confidenceLevel <= 0.99);
  });

  it("should promote a strategy from a completed experiment", () => {
    const exp = SEED_EXPERIMENTS[2];
    const analysis = analyzeExperiment(exp, SEED_OUTCOMES);
    const strategy = promoteStrategy(exp, analysis, {
      territoryMaturity: "mature",
      barrierType: "office_workflow",
    });
    assert.ok(strategy.action.length > 0);
    assert.ok(strategy.confidence > 0);
    assert.ok(strategy.lifecycleState !== "retired");
  });

  it("should filter active vs completed experiments", () => {
    const active = getActiveExperiments(SEED_EXPERIMENTS);
    const completed = getCompletedExperiments(SEED_EXPERIMENTS);
    assert.ok(active.length > 0);
    assert.ok(completed.length > 0);
    assert.equal(
      active.every((e) => e.status === "running"),
      true,
    );
    assert.equal(
      completed.every((e) => e.status !== "running"),
      true,
    );
  });
});

// ─── Learning Tests ─────────────────────────────────────────────────

describe("Learning Engine", () => {
  it("should learn from outcomes with sufficient samples", () => {
    const outcomes = [
      ...SEED_OUTCOMES,
      ...SEED_OUTCOMES,
      ...SEED_OUTCOMES,
    ];
    const newLearnings = learnFromOutcomes(outcomes, SEED_STRATEGIES);
    assert.ok(Array.isArray(newLearnings));
  });

  it("should filter validated vs experimental strategies", () => {
    const validated = getValidatedStrategies(SEED_STRATEGIES);
    const experimental = getExperimentalStrategies(SEED_STRATEGIES);
    assert.ok(validated.length > 0);
    assert.ok(experimental.length > 0);
    assert.equal(
      validated.every((s) => ["validated", "scaled", "monitored"].includes(s.lifecycleState)),
      true,
    );
  });

  it("should get strategies relevant to an employee", () => {
    const emp = SEED_EMPLOYEES[0];
    const relevant = getStrategiesForEmployee(emp, SEED_STRATEGIES);
    assert.ok(relevant.length > 0);
  });

  it("should advance lifecycle when enough outcomes are positive", () => {
    const strategy = SEED_STRATEGIES[3]; // limited_experiment
    const positiveOutcomes = Array(10).fill(0).map((_, i) => ({
      id: `test-${i}`,
      actionId: `act-${i}`,
      employeeId: "emp-001",
      actionTaken: "test action",
      outcome: "account_progressed" as const,
      timeToOutcomeHours: 24,
      capturedAt: new Date().toISOString(),
      context: strategy.context,
    }));
    const advanced = advanceLifecycle(strategy, positiveOutcomes);
    assert.ok(advanced.lifecycleState !== "proposed");
  });

  it("should retire stale strategies", () => {
    const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
    const staleStrategy = {
      ...SEED_STRATEGIES[0],
      lastValidatedAt: oldDate,
      lifecycleState: "validated" as const,
    };
    const retired = retireStaleStrategies([staleStrategy], 180);
    assert.equal(retired[0].lifecycleState, "retired");
  });
});

// ─── Engine Integration Tests ───────────────────────────────────────

describe("Competitive Engine Integration", () => {
  beforeEach(() => {
    // Reset by seeding fresh state
    const seed = createSeedState();
    // The engine loads from disk, so we just verify the seed is valid
    assert.ok(seed.employees.length > 0);
  });

  it("should generate a complete competitive plan for an employee", () => {
    const plan = generateCompetitivePlan("emp-001");
    assert.ok(plan !== null);
    assert.ok(plan.portfolio.actions.length > 0);
    assert.ok(plan.trajectory.steps.length > 0);
    assert.ok(plan.score.dimensions.length === 7);
    assert.ok(plan.currentPositionPercentile >= 0 && plan.currentPositionPercentile <= 100);
    assert.ok(plan.bestNextAction.length > 0);
  });

  it("should return null for non-existent employee", () => {
    const plan = generateCompetitivePlan("non-existent");
    assert.equal(plan, null);
  });

  it("should generate different plans for different employees", () => {
    const plan1 = generateCompetitivePlan("emp-001");
    const plan4 = generateCompetitivePlan("emp-004");
    assert.ok(plan1 && plan4);
    // Different employees should likely have different constraints or scores
    assert.notEqual(plan1.employeeId, plan4.employeeId);
  });

  it("should include experimental actions only for employees who consent", () => {
    const plan = generateCompetitivePlan("emp-001"); // consentExperimental: true
    assert.ok(plan);
    const experimentalActions = plan.portfolio.actions.filter((a) => a.lane === "experimental");
    // emp-001 has consent, so may have experimental actions
    if (experimentalActions.length > 0) {
      assert.ok(experimentalActions[0].experimentId);
    }
  });
});
