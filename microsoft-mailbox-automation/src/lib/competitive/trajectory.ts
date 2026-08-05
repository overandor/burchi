import {
  EmployeeProfile,
  PerformanceTrajectory,
  TrajectoryStep,
  CompetitiveScore,
  ActionOutcome,
  StrategyLearning,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

interface ConstraintAnalysis {
  primaryConstraint: string;
  description: string;
  steps: Omit<TrajectoryStep, "order">[];
  expectedPercentile30Day: { low: number; high: number };
}

function analyzeConstraint(
  employee: EmployeeProfile,
  score: CompetitiveScore,
  outcomes: ActionOutcome[],
  strategies: StrategyLearning[],
): ConstraintAnalysis {
  const sortedDims = [...score.dimensions].sort((a, b) => a.score - b.score);
  const worst = sortedDims[0];
  const second = sortedDims[1];
  const third = sortedDims[2];

  const empOutcomes = outcomes.filter((o) => o.employeeId === employee.id);
  const followUpRate =
    empOutcomes.length > 0
      ? empOutcomes.filter((o) => o.outcome === "follow_up_completed").length / empOutcomes.length
      : 0.68;

  const steps: Omit<TrajectoryStep, "order">[] = [];

  if (worst.label.includes("Follow-up")) {
    steps.push({
      objective: "Raise follow-up completion above 85%",
      currentState: `${Math.round(followUpRate * 100)}% completion`,
      targetState: "85%+ completion",
      metric: "follow_up_completion_rate",
      currentValue: Math.round(followUpRate * 100),
      targetValue: 85,
      status: followUpRate >= 0.85 ? "achieved" : "in_progress",
    });
  }

  if (worst.label.includes("Stakeholder") || second.label.includes("Stakeholder")) {
    steps.push({
      objective: "Expand stakeholder coverage in priority accounts",
      currentState: `${worst.label.includes("Stakeholder") ? worst.score : second.score} / 100`,
      targetState: "70+ / 100",
      metric: "stakeholder_coverage_score",
      currentValue: worst.label.includes("Stakeholder") ? worst.score : second.score,
      targetValue: 70,
      status: "pending",
    });
  }

  if (worst.label.includes("Field-time") || second.label.includes("Field-time")) {
    steps.push({
      objective: "Reduce low-value travel and optimize field time",
      currentState: `${worst.label.includes("Field-time") ? worst.score : second.score} / 100`,
      targetState: "85+ / 100",
      metric: "field_time_efficiency",
      currentValue: worst.label.includes("Field-time") ? worst.score : second.score,
      targetValue: 85,
      status: "pending",
    });
  }

  if (worst.label.includes("Opportunity") || second.label.includes("Opportunity")) {
    steps.push({
      objective: "Improve progression in access-ready accounts",
      currentState: `${worst.label.includes("Opportunity") ? worst.score : second.score} / 100`,
      targetState: "75+ / 100",
      metric: "opportunity_realization",
      currentValue: worst.label.includes("Opportunity") ? worst.score : second.score,
      targetValue: 75,
      status: "pending",
    });
  }

  steps.push({
    objective: "Test advanced sequencing strategies",
    currentState: "Participating in active experiments",
    targetState: "Validated personal strategy portfolio",
    metric: "experiment_participation",
    currentValue: empOutcomes.filter((o) => o.experimentId).length,
    targetValue: 5,
    status: "in_progress",
  });

  while (steps.length < 3) {
    const dim = sortedDims[steps.length] || sortedDims[0];
    steps.push({
      objective: `Improve ${dim.label.toLowerCase()}`,
      currentState: `${dim.score} / 100`,
      targetState: `${dim.peerAverage} / 100`,
      metric: dim.label.toLowerCase().replace(/\s+/g, "_"),
      currentValue: dim.score,
      targetValue: dim.peerAverage,
      status: "pending",
    });
  }

  const maxSteps = 5;
  const finalSteps = steps.slice(0, maxSteps);

  const currentPercentile = score.adjustedPercentile;
  const improvementPotential = Math.min(25, Math.max(5, 100 - currentPercentile - 20));
  const expectedLow = Math.min(100, currentPercentile + Math.round(improvementPotential * 0.4));
  const expectedHigh = Math.min(100, currentPercentile + Math.round(improvementPotential * 0.7));

  const constraintLabel = worst.label;
  let description: string;

  if (worst.label.includes("Follow-up")) {
    description =
      "High-value accounts are receiving engagement, but follow-up completion is below peer benchmarks. " +
      "Completing unresolved commitments is the highest-leverage improvement.";
  } else if (worst.label.includes("Stakeholder")) {
    description =
      "Account engagement is concentrated on primary HCPs. Expanding stakeholder diversity will unlock " +
      "progression in accounts that are blocked by operational rather than clinical barriers.";
  } else if (worst.label.includes("Opportunity")) {
    description =
      "Territory has actionable accounts that are not progressing. Prioritization and barrier-targeted " +
      "engagement will improve opportunity realization.";
  } else if (worst.label.includes("Field-time")) {
    description =
      "Field time is being spent on low-value visits. Route optimization and remote follow-up substitution " +
      "will free capacity for high-priority accounts.";
  } else {
    description = `${worst.label} is below peer average. Targeted improvement in this dimension ` +
      `will yield the largest competitive position gain.`;
  }

  return {
    primaryConstraint: constraintLabel,
    description,
    steps: finalSteps,
    expectedPercentile30Day: { low: expectedLow, high: expectedHigh },
  };
}

export function generateTrajectory(
  employee: EmployeeProfile,
  score: CompetitiveScore,
  outcomes: ActionOutcome[],
  strategies: StrategyLearning[],
): PerformanceTrajectory {
  const analysis = analyzeConstraint(employee, score, outcomes, strategies);

  return {
    employeeId: employee.id,
    primaryConstraint: analysis.primaryConstraint,
    constraintDescription: analysis.description,
    steps: analysis.steps.map((s, i) => ({ ...s, order: i + 1 })),
    expectedPercentile30Day: analysis.expectedPercentile30Day,
    generatedAt: nowIso(),
  };
}
