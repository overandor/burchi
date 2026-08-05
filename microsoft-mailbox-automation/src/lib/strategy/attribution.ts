import { nanoid } from "nanoid";
import {
  AttributionResult,
  ContributionRecord,
  EvidenceLevel,
  RoleType,
  StrategyAssignment,
  StrategyOutcomeEvent,
  StrategyGenome,
} from "@/types";
import {
  loadStrategyAttributions,
  saveStrategyAttributions,
  loadStrategyOutcomes,
  saveStrategyOutcomes,
  loadStrategyAssignments,
} from "@/lib/config";
import { ensureStrategiesSeeded } from "@/lib/strategy/library";

const now = () => new Date().toISOString();

// ─── Outcome Event Store ───────────────────────────────────────────

export function recordOutcome(event: Omit<StrategyOutcomeEvent, "id" | "observedAt">): StrategyOutcomeEvent {
  const full: StrategyOutcomeEvent = {
    ...event,
    id: nanoid(12),
    observedAt: now(),
  };
  const all = loadStrategyOutcomes();
  all.push(full);
  saveStrategyOutcomes(all);
  return full;
}

export function listOutcomes(): StrategyOutcomeEvent[] {
  return loadStrategyOutcomes();
}

export function getOutcomesForEmployee(employeeId: string): StrategyOutcomeEvent[] {
  return loadStrategyOutcomes().filter((o) => o.employeeId === employeeId);
}

export function getOutcomesForAssignment(assignmentId: string): StrategyOutcomeEvent[] {
  return loadStrategyOutcomes().filter((o) => o.assignmentId === assignmentId);
}

export function getOutcomesForStrategy(strategyId: string): StrategyOutcomeEvent[] {
  return loadStrategyOutcomes().filter((o) => o.strategyId === strategyId);
}

// ─── Attribution Store ─────────────────────────────────────────────

export function listAttributions(): AttributionResult[] {
  return loadStrategyAttributions();
}

export function getAttributionById(id: string): AttributionResult | undefined {
  return loadStrategyAttributions().find((a) => a.id === id);
}

export function getAttributionForOutcome(outcomeEventId: string): AttributionResult | undefined {
  return loadStrategyAttributions().find((a) => a.outcomeEventId === outcomeEventId);
}

function saveAttribution(result: AttributionResult): void {
  const all = loadStrategyAttributions();
  const idx = all.findIndex((a) => a.id === result.id);
  if (idx >= 0) {
    all[idx] = result;
  } else {
    all.push(result);
  }
  saveStrategyAttributions(all);
}

// ─── Causal Attribution Engine ─────────────────────────────────────

export function attributeOutcome(outcomeEventId: string): AttributionResult | undefined {
  const outcomes = loadStrategyOutcomes();
  const event = outcomes.find((o) => o.id === outcomeEventId);
  if (!event) return undefined;

  const assignments = loadStrategyAssignments();
  const strategies = ensureStrategiesSeeded();

  const employeeAssignments = assignments.filter(
    (a) =>
      a.employeeId === event.employeeId &&
      a.active &&
      a.assignedAt <= event.observedAt
  );

  const concurrentStrategyIds = event.contextAtObservation.concurrentStrategies || [];
  const relevantAssignments = employeeAssignments.filter(
    (a) =>
      concurrentStrategyIds.length === 0 ||
      concurrentStrategyIds.includes(a.strategyId)
  );

  const contributions: ContributionRecord[] = [];
  const allOutcomes = loadStrategyOutcomes();

  for (const assignment of relevantAssignments) {
    const strategy = strategies.find((s) => s.id === assignment.strategyId);
    if (!strategy) continue;

    const strategyOutcomes = allOutcomes.filter(
      (o) => o.strategyId === assignment.strategyId && o.employeeId !== event.employeeId
    );

    const employeeStrategyOutcomes = allOutcomes.filter(
      (o) => o.strategyId === assignment.strategyId && o.employeeId === event.employeeId
    );

    const { estimatedContribution, evidenceLevel, method, counterfactual } = computeContribution(
      strategy,
      assignment,
      event,
      strategyOutcomes,
      employeeStrategyOutcomes,
      allOutcomes
    );

    contributions.push({
      strategyId: strategy.id,
      strategyName: strategy.name,
      assignmentId: assignment.id,
      estimatedContribution,
      evidenceLevel,
      reasoning: buildReasoning(strategy, assignment, method, estimatedContribution),
      counterfactualEstimate: counterfactual,
      dataPoints: strategyOutcomes.length + employeeStrategyOutcomes.length,
    });
  }

  const totalContribution = contributions.reduce((sum, c) => sum + c.estimatedContribution, 0);
  if (totalContribution > 1.0) {
    for (const c of contributions) {
      c.estimatedContribution = Math.round((c.estimatedContribution / totalContribution) * 100) / 100;
    }
  }

  const unexplainedVariance = Math.max(0, 1 - contributions.reduce((sum, c) => sum + c.estimatedContribution, 0));
  const overallConfidence = computeOverallConfidence(contributions, relevantAssignments.length);

  const hasComparisonData = allOutcomes.some(
    (o) =>
      o.employeeId !== event.employeeId &&
      relevantAssignments.some((a) => a.strategyId === o.strategyId)
  );
  const hasBeforeAfterData = employeeAssignments.some((a) => {
    const preStrategyOutcomes = allOutcomes.filter(
      (o) => o.employeeId === event.employeeId && o.observedAt < a.assignedAt
    );
    return preStrategyOutcomes.length > 0;
  });

  const attributionMethod: AttributionResult["attributionMethod"] = hasComparisonData
    ? "comparison_group"
    : hasBeforeAfterData
      ? "before_after"
      : contributions.length > 0
        ? "expert_judgment"
        : "unresolved";

  const result: AttributionResult = {
    id: nanoid(12),
    outcomeEventId: event.id,
    outcomeDescription: event.outcomeDescription,
    outcomeMetrics: event.outcomeMetrics,
    employeeId: event.employeeId,
    employeeRole: event.employeeRole,
    contributions,
    unexplainedVariance,
    overallConfidence,
    attributionMethod,
    attributedAt: now(),
    notes: buildAttributionNotes(attributionMethod, contributions.length, unexplainedVariance),
  };

  saveAttribution(result);

  const updatedOutcomes = loadStrategyOutcomes();
  const idx = updatedOutcomes.findIndex((o) => o.id === event.id);
  if (idx >= 0) {
    updatedOutcomes[idx].attributionId = result.id;
    saveStrategyOutcomes(updatedOutcomes);
  }

  return result;
}

function computeContribution(
  strategy: StrategyGenome,
  assignment: StrategyAssignment,
  event: StrategyOutcomeEvent,
  peerOutcomes: StrategyOutcomeEvent[],
  selfOutcomes: StrategyOutcomeEvent[],
  allOutcomes: StrategyOutcomeEvent[]
): {
  estimatedContribution: number;
  evidenceLevel: EvidenceLevel;
  method: string;
  counterfactual: string;
} {
  if (peerOutcomes.length >= 3) {
    const peerAvgMetric = averageOutcomeMetric(peerOutcomes, event.outcomeMetrics);
    const selfMetric = averageOutcomeMetric([event], event.outcomeMetrics);
    const baselineMetric = strategy.expectedOutcomes[0]?.baseline || 0;

    const peerDelta = peerAvgMetric - baselineMetric;
    const selfDelta = selfMetric - baselineMetric;

    const contribution = selfDelta > 0
      ? Math.min(1, Math.max(0, (selfDelta - peerDelta) / Math.max(selfDelta, 0.001)))
      : 0;

    return {
      estimatedContribution: Math.round(contribution * 100) / 100,
      evidenceLevel: "experimentally_supported",
      method: "comparison_group",
      counterfactual: `Without this strategy, outcome would likely be closer to peer average (${peerAvgMetric.toFixed(2)} vs observed ${selfMetric.toFixed(2)}).`,
    };
  }

  const preStrategyOutcomes = allOutcomes.filter(
    (o) => o.employeeId === event.employeeId && o.observedAt < assignment.assignedAt
  );
  if (preStrategyOutcomes.length >= 2) {
    const preAvg = averageOutcomeMetric(preStrategyOutcomes, event.outcomeMetrics);
    const postAvg = averageOutcomeMetric([event], event.outcomeMetrics);
    const delta = postAvg - preAvg;
    const contribution = delta > 0 ? Math.min(0.8, delta / Math.max(postAvg, 0.001)) : 0;

    return {
      estimatedContribution: Math.round(contribution * 100) / 100,
      evidenceLevel: "probable_contribution",
      method: "before_after",
      counterfactual: `Before strategy adoption, average was ${preAvg.toFixed(2)}; observed ${postAvg.toFixed(2)}. Improvement may be partially attributable to the strategy, but other factors cannot be excluded.`,
    };
  }

  const expectedMetric = strategy.expectedOutcomes[0]?.expected || 0;
  const baselineMetric = strategy.expectedOutcomes[0]?.baseline || 0;
  const observedMetric = averageOutcomeMetric([event], event.outcomeMetrics);
  const expectedDelta = expectedMetric - baselineMetric;
  const observedDelta = observedMetric - baselineMetric;

  const contribution = expectedDelta > 0 && observedDelta > 0
    ? Math.min(0.5, observedDelta / Math.max(expectedDelta, 0.001) * 0.3)
    : 0;

  return {
    estimatedContribution: Math.round(contribution * 100) / 100,
    evidenceLevel: strategy.evidenceLevel === "experimentally_supported"
      ? "probable_contribution"
      : "observed_association",
    method: "expert_judgment",
    counterfactual: `Insufficient comparison data. Based on strategy's expected outcomes (baseline ${baselineMetric.toFixed(2)} -> expected ${expectedMetric.toFixed(2)}), the strategy may have contributed, but causal attribution is uncertain.`,
  };
}

function averageOutcomeMetric(
  outcomes: StrategyOutcomeEvent[],
  referenceMetrics: { metric: string; value: number; unit: string; baseline: number }[]
): number {
  if (outcomes.length === 0 || referenceMetrics.length === 0) return 0;
  const primaryMetric = referenceMetrics[0].metric;
  const values = outcomes
    .flatMap((o) => o.outcomeMetrics)
    .filter((m) => m.metric === primaryMetric)
    .map((m) => m.value);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeOverallConfidence(contributions: ContributionRecord[], assignmentCount: number): number {
  if (contributions.length === 0) return 0;
  const evidenceWeights: Record<EvidenceLevel, number> = {
    experimentally_supported: 0.9,
    probable_contribution: 0.6,
    observed_association: 0.3,
    unresolved: 0.1,
  };
  const totalWeight = contributions.reduce((sum, c) => sum + evidenceWeights[c.evidenceLevel], 0);
  return Math.round((totalWeight / contributions.length) * 100) / 100;
}

function buildReasoning(
  strategy: StrategyGenome,
  assignment: StrategyAssignment,
  method: string,
  contribution: number
): string {
  return `Strategy "${strategy.name}" (class: ${strategy.strategyClass}, evidence: ${strategy.evidenceLevel}) ` +
    `was active for employee ${assignment.employeeId} since ${assignment.assignedAt}. ` +
    `Attribution method: ${method}. Estimated contribution: ${(contribution * 100).toFixed(0)}%. ` +
    `Assignment reason: ${assignment.assignmentReason}.`;
}

function buildAttributionNotes(method: string, contributionCount: number, unexplained: number): string {
  const methodDescriptions: Record<string, string> = {
    comparison_group: "Attribution based on comparison with peer employees using the same strategy.",
    before_after: "Attribution based on before-vs-after comparison for the same employee.",
    matched_pairs: "Attribution based on matched-pair comparison.",
    expert_judgment: "Attribution based on strategy evidence and expected outcomes (no comparison data available).",
    unresolved: "Insufficient data to attribute causality. Outcome remains unexplained.",
  };
  return `${methodDescriptions[method] || methodDescriptions.expert_judgment} ` +
    `${contributionCount} contributing strategies identified. ${(unexplained * 100).toFixed(0)}% of variance unexplained.`;
}

// ─── Strategy Performance Summary ──────────────────────────────────

export interface StrategyPerformanceSummary {
  strategyId: string;
  strategyName: string;
  totalOutcomes: number;
  averageContribution: number;
  evidenceLevel: EvidenceLevel;
  adoptionCount: number;
  successRate: number;
}

export function getStrategyPerformance(strategyId: string): StrategyPerformanceSummary | undefined {
  const strategies = ensureStrategiesSeeded();
  const strategy = strategies.find((s) => s.id === strategyId);
  if (!strategy) return undefined;

  const outcomes = getOutcomesForStrategy(strategyId);
  const attributions = loadStrategyAttributions().filter((a) =>
    a.contributions.some((c) => c.strategyId === strategyId)
  );

  const contributions = attributions.flatMap((a) =>
    a.contributions.filter((c) => c.strategyId === strategyId)
  );

  const avgContribution = contributions.length > 0
    ? contributions.reduce((sum, c) => sum + c.estimatedContribution, 0) / contributions.length
    : 0;

  const assignments = loadStrategyAssignments().filter((a) => a.strategyId === strategyId);
  const successfulOutcomes = outcomes.filter((o) => {
    const attr = attributions.find((a) => a.outcomeEventId === o.id);
    if (!attr) return false;
    const contrib = attr.contributions.find((c) => c.strategyId === strategyId);
    return contrib && contrib.estimatedContribution > 0.1;
  }).length;

  return {
    strategyId,
    strategyName: strategy.name,
    totalOutcomes: outcomes.length,
    averageContribution: Math.round(avgContribution * 100) / 100,
    evidenceLevel: strategy.evidenceLevel,
    adoptionCount: assignments.length,
    successRate: outcomes.length > 0 ? Math.round((successfulOutcomes / outcomes.length) * 100) / 100 : 0,
  };
}
