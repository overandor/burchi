import {
  CompetitiveScore,
  CompetitiveScoreDimension,
  EmployeeProfile,
  ActionOutcome,
  StrategyLearning,
  BarrierType,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

const SCORE_DIMENSIONS = [
  "Opportunity realization",
  "Account progression",
  "Follow-up reliability",
  "Field-time efficiency",
  "Data and CRM quality",
  "Stakeholder coverage",
  "Learning adaptability",
] as const;

interface RawMetrics {
  opportunityRealization: number;
  accountProgression: number;
  followUpReliability: number;
  fieldTimeEfficiency: number;
  crmQuality: number;
  stakeholderCoverage: number;
  learningAdaptability: number;
  territoryOpportunity: number;
  accessDifficulty: number;
  marketMaturity: number;
  availableResources: number;
}

function computeRawMetrics(
  employee: EmployeeProfile,
  outcomes: ActionOutcome[],
  strategies: StrategyLearning[],
): RawMetrics {
  const empOutcomes = outcomes.filter((o) => o.employeeId === employee.id);
  const totalActions = empOutcomes.length || 1;
  const progressed = empOutcomes.filter(
    (o) => o.outcome === "account_progressed" || o.outcome === "barrier_resolved",
  ).length;
  const meaningfulResponse = empOutcomes.filter(
    (o) => o.outcome === "meaningful_response",
  ).length;
  const followUpCompleted = empOutcomes.filter(
    (o) => o.outcome === "follow_up_completed",
  ).length;

  const avgTimeToOutcome =
    empOutcomes.length > 0
      ? empOutcomes.reduce((s, o) => s + o.timeToOutcomeHours, 0) / empOutcomes.length
      : 48;

  const territoryOpportunity =
    employee.territoryMaturity === "mature"
      ? 0.85
      : employee.territoryMaturity === "growing"
        ? 0.65
        : employee.territoryMaturity === "early"
          ? 0.40
          : 0.30;

  const accessDifficulty =
    employee.marketRestrictions.includes("restricted_access") ? 0.70 : 0.35;

  const marketMaturity =
    employee.territoryMaturity === "mature"
      ? 0.90
      : employee.territoryMaturity === "growing"
        ? 0.60
        : 0.35;

  const availableResources =
    employee.experienceLevel === "elite"
      ? 0.95
      : employee.experienceLevel === "expert"
        ? 0.80
        : employee.experienceLevel === "intermediate"
          ? 0.60
          : 0.40;

  const opportunityRealization = Math.min(
    100,
    Math.round(((meaningfulResponse + progressed) / totalActions) * 100 * territoryOpportunity),
  );

  const accountProgression = Math.min(
    100,
    Math.round((progressed / totalActions) * 100 * 1.2),
  );

  const followUpReliability = Math.min(
    100,
    Math.round((followUpCompleted / totalActions) * 100 + 30),
  );

  const fieldTimeEfficiency = Math.min(
    100,
    Math.round(Math.max(0, 100 - (avgTimeToOutcome - 20) * 1.5)),
  );

  const crmQuality = Math.min(
    100,
    Math.round(60 + availableResources * 30 + (empOutcomes.length > 3 ? 10 : 0)),
  );

  const stakeholderCoverage = Math.min(
    100,
    Math.round(40 + (meaningfulResponse / totalActions) * 60),
  );

  const empStrategyCount = strategies.filter(
    (s) =>
      s.context.employeeExperience === employee.experienceLevel ||
      s.context.territoryMaturity === employee.territoryMaturity,
  ).length;
  const learningAdaptability = Math.min(100, 50 + empStrategyCount * 8);

  return {
    opportunityRealization,
    accountProgression,
    followUpReliability,
    fieldTimeEfficiency,
    crmQuality,
    stakeholderCoverage,
    learningAdaptability,
    territoryOpportunity,
    accessDifficulty,
    marketMaturity,
    availableResources,
  };
}

export function computeCompetitiveScore(
  employee: EmployeeProfile,
  allEmployees: EmployeeProfile[],
  outcomes: ActionOutcome[],
  strategies: StrategyLearning[],
): CompetitiveScore {
  const metrics = computeRawMetrics(employee, outcomes, strategies);

  const rawScores = [
    metrics.opportunityRealization,
    metrics.accountProgression,
    metrics.followUpReliability,
    metrics.fieldTimeEfficiency,
    metrics.crmQuality,
    metrics.stakeholderCoverage,
    metrics.learningAdaptability,
  ];

  const allRawScores = allEmployees.map((emp) => {
    const m = computeRawMetrics(emp, outcomes, strategies);
    return [
      m.opportunityRealization,
      m.accountProgression,
      m.followUpReliability,
      m.fieldTimeEfficiency,
      m.crmQuality,
      m.stakeholderCoverage,
      m.learningAdaptability,
    ];
  });

  const peerAverages = rawScores.map((_, i) =>
    Math.round(allRawScores.reduce((s, scores) => s + scores[i], 0) / allRawScores.length),
  );

  const sortedDim = [...allRawScores].map((scores) => scores.reduce((s, v) => s + v, 0) / 7);
  const sorted = [...sortedDim].sort((a, b) => b - a);
  const topQuartileThreshold = sorted[Math.floor(sorted.length * 0.25)] || 80;

  const dimensions: CompetitiveScoreDimension[] = SCORE_DIMENSIONS.map((label, i) => ({
    label,
    score: rawScores[i],
    peerAverage: peerAverages[i],
    topQuartile: Math.round(topQuartileThreshold),
  }));

  const rawComposite = rawScores.reduce((s, v) => s + v, 0) / rawScores.length;

  const adjustmentDenominator = Math.max(
    0.01,
    metrics.territoryOpportunity *
      (1 - metrics.accessDifficulty * 0.5) *
      metrics.marketMaturity *
      metrics.availableResources,
  );

  const adjustedPerformanceIndex = Math.min(
    100,
    Math.round((rawComposite / adjustmentDenominator) * 0.35),
  );

  const allAdjusted = allEmployees.map((emp) => {
    const m = computeRawMetrics(emp, outcomes, strategies);
    const empRaw = (m.opportunityRealization + m.accountProgression + m.followUpReliability +
      m.fieldTimeEfficiency + m.crmQuality + m.stakeholderCoverage + m.learningAdaptability) / 7;
    const empDenom = Math.max(
      0.01,
      m.territoryOpportunity * (1 - m.accessDifficulty * 0.5) * m.marketMaturity * m.availableResources,
    );
    return Math.min(100, Math.round((empRaw / empDenom) * 0.35));
  });

  const sortedAdjusted = [...allAdjusted].sort((a, b) => b - a);
  const adjustedRank = sortedAdjusted.indexOf(adjustedPerformanceIndex) + 1;
  const rawRank = [...sortedDim].sort((a, b) => b - a).indexOf(rawComposite) + 1;

  const percentile = Math.round(((allEmployees.length - rawRank) / allEmployees.length) * 100);
  const adjustedPercentile = Math.round(
    ((allEmployees.length - adjustedRank) / allEmployees.length) * 100,
  );

  return {
    employeeId: employee.id,
    dimensions,
    rawPosition: { rank: rawRank, total: allEmployees.length },
    adjustedPosition: { rank: adjustedRank, total: allEmployees.length },
    adjustedPerformanceIndex,
    percentile,
    adjustedPercentile,
    computedAt: nowIso(),
  };
}

export function getPrimaryConstraint(score: CompetitiveScore): {
  dimension: string;
  gap: number;
  currentScore: number;
  peerAverage: number;
} {
  const sorted = [...score.dimensions].sort(
    (a, b) => a.score - b.score,
  );
  const worst = sorted[0];
  return {
    dimension: worst.label,
    gap: worst.peerAverage - worst.score,
    currentScore: worst.score,
    peerAverage: worst.peerAverage,
  };
}
