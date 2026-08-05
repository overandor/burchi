import { nanoid } from "nanoid";
import {
  EmployeeProfile,
  CompetitivePlan,
  CompetitiveScore,
  PerformanceTrajectory,
  ActionPortfolio,
  ActionRecommendation,
  ActionLane,
  ActionStatus,
  StrategyLearning,
  ExperimentContract,
  ExperimentVariantRole,
  ActionOutcome,
  StrategyLifecycleState,
  BarrierType,
  HCPFunnelState,
  ManagerLabView,
  PersonalChallenge,
  AntiGamingFlag,
  CompetitiveEngineState,
} from "@/types";
import { computeCompetitiveScore, getPrimaryConstraint } from "./scoring";
import { generateTrajectory } from "./trajectory";
import {
  isEmployeeEligible,
  assignVariant,
  getActiveExperiments,
  getCompletedExperiments,
} from "./experiment";
import {
  getValidatedStrategies,
  getExperimentalStrategies,
  getStrategiesForEmployee,
} from "./learning";
import { loadEngineState, saveEngineState } from "./store";
import { createSeedState } from "./seed-data";

function nowIso(): string {
  return new Date().toISOString();
}

export function getEngineState(): CompetitiveEngineState {
  const existing = loadEngineState();
  if (existing) return existing;

  const seed = createSeedState();
  saveEngineState(seed);
  return seed;
}

export function updateEngineState(state: CompetitiveEngineState): void {
  saveEngineState(state);
}

export function getEmployee(employeeId: string): EmployeeProfile | null {
  const state = getEngineState();
  return state.employees.find((e) => e.id === employeeId) ?? null;
}

export function getComparablePeers(employee: EmployeeProfile): EmployeeProfile[] {
  const state = getEngineState();
  return state.employees.filter(
    (e) =>
      e.id !== employee.id &&
      e.role === employee.role &&
      e.cohortTags.some((t) => employee.cohortTags.includes(t)),
  );
}

function pickProvenActions(
  employee: EmployeeProfile,
  strategies: StrategyLearning[],
  score: CompetitiveScore,
): ActionRecommendation[] {
  const validated = getValidatedStrategies(strategies);
  const relevant = getStrategiesForEmployee(employee, validated);

  return relevant.slice(0, 4).map((s, i) => ({
    id: nanoid(),
    lane: "proven" as ActionLane,
    title: s.action.split("—")[0]?.trim() || s.action.slice(0, 60),
    description: s.patternDescription,
    competitiveReason: s.observedOutcome,
    whyThisAction: `Validated strategy with ${Math.round(s.confidence * 100)}% confidence across ${s.sampleSize} observations.`,
    expectedEffortMin: 30 + i * 10,
    expectedUpside: s.effectSize > 0.2 ? "high" : s.effectSize > 0.1 ? "moderate" : "low",
    confidence: s.confidence,
    strategyStatus: s.lifecycleState,
    riskLevel: "low",
    status: "assigned" as ActionStatus,
    assignedAt: nowIso(),
  }));
}

function pickPersonalizedActions(
  employee: EmployeeProfile,
  score: CompetitiveScore,
  outcomes: ActionOutcome[],
): ActionRecommendation[] {
  const actions: ActionRecommendation[] = [];
  const constraint = getPrimaryConstraint(score);

  if (constraint.dimension.includes("Follow-up")) {
    actions.push({
      id: nanoid(),
      lane: "personalized",
      title: "Complete eight unresolved account commitments before adding new visits",
      description:
        "Your follow-up completion is below peer benchmarks. Close existing commitments first.",
      competitiveReason:
        "Unresolved commitments degrade account trust and waste prior engagement investment.",
      whyThisAction: `Your follow-up completion rate is ${constraint.currentScore}/100 vs peer average ${constraint.peerAverage}/100.`,
      expectedEffortMin: 90,
      expectedUpside: "high",
      confidence: 0.87,
      strategyStatus: "scaled",
      riskLevel: "low",
      status: "assigned",
      assignedAt: nowIso(),
    });
  }

  if (constraint.dimension.includes("Field-time")) {
    actions.push({
      id: nanoid(),
      lane: "personalized",
      title: "Replace two afternoon office visits with remote follow-ups",
      description:
        "Your remote follow-up completion is above peer average, while afternoon office access is below average.",
      competitiveReason: "Reallocating low-access visits to remote follow-ups saves time without losing progression.",
      whyThisAction: `Field-time efficiency is ${constraint.currentScore}/100 vs peer average ${constraint.peerAverage}/100.`,
      expectedEffortMin: 0,
      expectedUpside: "moderate",
      confidence: 0.84,
      strategyStatus: "validated",
      riskLevel: "low",
      status: "assigned",
      assignedAt: nowIso(),
    });
  }

  if (constraint.dimension.includes("Stakeholder")) {
    actions.push({
      id: nanoid(),
      lane: "personalized",
      title: "Identify and engage secondary stakeholders in 3 priority accounts",
      description:
        "Expand stakeholder diversity in accounts where primary HCP engagement has plateaued.",
      competitiveReason:
        "Accounts with broader stakeholder coverage progress more often than those with single-contact engagement.",
      whyThisAction: `Stakeholder coverage is ${constraint.currentScore}/100 vs peer average ${constraint.peerAverage}/100.`,
      expectedEffortMin: 120,
      expectedUpside: "high",
      confidence: 0.79,
      strategyStatus: "validated",
      riskLevel: "low",
      status: "assigned",
      assignedAt: nowIso(),
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: nanoid(),
      lane: "personalized",
      title: `Improve ${constraint.dimension.toLowerCase()} to peer average`,
      description: `Your ${constraint.dimension.toLowerCase()} score of ${constraint.currentScore} is below the peer average of ${constraint.peerAverage}.`,
      competitiveReason: `This is your largest correctable disadvantage.`,
      whyThisAction: `Gap of ${constraint.gap} points below peer average.`,
      expectedEffortMin: 60,
      expectedUpside: "moderate",
      confidence: 0.75,
      strategyStatus: "validated",
      riskLevel: "low",
      status: "assigned",
      assignedAt: nowIso(),
    });
  }

  return actions.slice(0, 3);
}

function pickExperimentalActions(
  employee: EmployeeProfile,
  experiments: ExperimentContract[],
  existingAssignments: Map<string, ExperimentVariantRole>,
): ActionRecommendation[] {
  const active = getActiveExperiments(experiments);
  const actions: ActionRecommendation[] = [];

  for (const exp of active) {
    if (!isEmployeeEligible(employee, exp)) continue;
    if (actions.length >= 2) break;

    const variant = assignVariant(employee, exp, existingAssignments);
    if (!variant) continue;

    const variantData = exp.variants.find((v) => v.role === variant);
    if (!variantData) continue;

    actions.push({
      id: nanoid(),
      lane: "experimental",
      title: variantData.description,
      description: exp.hypothesis,
      competitiveReason: exp.description,
      whyThisAction: `Your account mix matches the experiment criteria. You were selected for the ${variant.replace("_", " ")} group.`,
      expectedEffortMin: 35,
      expectedUpside: "moderate",
      confidence: 0.61,
      strategyStatus: "limited_experiment",
      experimentId: exp.id,
      experimentVariant: variant,
      experimentDurationDays: exp.durationDays,
      experimentProtections: exp.guardrails,
      riskLevel: "low",
      status: "assigned",
      assignedAt: nowIso(),
    });
  }

  return actions;
}

function computePortfolioSplit(employee: EmployeeProfile): {
  proven: number;
  personalized: number;
  experimental: number;
} {
  switch (employee.experienceLevel) {
    case "new":
      return { proven: 80, personalized: 20, experimental: 0 };
    case "intermediate":
      return { proven: 60, personalized: 25, experimental: 15 };
    case "expert":
      return { proven: 50, personalized: 30, experimental: 20 };
    case "elite":
      return { proven: 40, personalized: 30, experimental: 30 };
    default:
      return { proven: 60, personalized: 25, experimental: 15 };
  }
}

export function generateCompetitivePlan(employeeId: string): CompetitivePlan | null {
  const state = getEngineState();
  const employee = state.employees.find((e) => e.id === employeeId);
  if (!employee) return null;

  const peers = getComparablePeers(employee);
  const comparisonGroup = peers.length > 0 ? peers : state.employees.filter((e) => e.id !== employee.id);

  const score = computeCompetitiveScore(
    employee,
    [employee, ...comparisonGroup],
    state.outcomes,
    state.strategies,
  );

  const trajectory = generateTrajectory(employee, score, state.outcomes, state.strategies);

  const provenActions = pickProvenActions(employee, state.strategies, score);
  const personalizedActions = pickPersonalizedActions(employee, score, state.outcomes);

  const existingAssignments = new Map<string, ExperimentVariantRole>();
  for (const outcome of state.outcomes) {
    if (outcome.employeeId === employee.id && outcome.variant) {
      existingAssignments.set(employee.id, outcome.variant);
    }
  }

  const experimentalActions = pickExperimentalActions(
    employee,
    state.experiments,
    existingAssignments,
  );

  const split = computePortfolioSplit(employee);
  const allActions = [...provenActions, ...personalizedActions, ...experimentalActions];

  const portfolio: ActionPortfolio = {
    employeeId: employee.id,
    provenPercent: split.proven,
    personalizedPercent: split.personalized,
    experimentalPercent: split.experimental,
    actions: allActions,
    generatedAt: nowIso(),
  };

  const constraint = getPrimaryConstraint(score);
  const bestAction = allActions[0];

  return {
    employeeId: employee.id,
    currentPositionPercentile: score.adjustedPercentile,
    expectedPosition30Day: trajectory.expectedPercentile30Day,
    primaryPerformanceConstraint: constraint.dimension,
    constraintDescription: trajectory.constraintDescription,
    bestNextAction: bestAction?.title ?? "No actions available",
    expectedEffect: bestAction
      ? `+${Math.round(bestAction.confidence * 10)}-${Math.round(bestAction.confidence * 15)}% account progression probability`
      : "Insufficient data",
    evidenceConfidence: bestAction?.confidence ?? 0,
    portfolio,
    trajectory,
    score,
    generatedAt: nowIso(),
  };
}

export function recordActionOutcome(input: {
  actionId: string;
  employeeId: string;
  experimentId?: string;
  variant?: ExperimentVariantRole;
  actionTaken: string;
  outcome: ActionOutcome["outcome"];
  timeToOutcomeHours: number;
  context: ActionOutcome["context"];
}): ActionOutcome {
  const state = getEngineState();
  const outcome: ActionOutcome = {
    id: nanoid(),
    ...input,
    capturedAt: nowIso(),
  };

  state.outcomes.push(outcome);

  const actionIdx = state.actionHistory.findIndex((a) => a.id === input.actionId);
  if (actionIdx >= 0) {
    state.actionHistory[actionIdx] = {
      ...state.actionHistory[actionIdx],
      status: "completed",
      completedAt: nowIso(),
    };
  }

  saveEngineState(state);
  return outcome;
}

export function updateActionStatus(
  actionId: string,
  status: ActionStatus,
  feedback?: string,
): ActionRecommendation | null {
  const state = getEngineState();
  const idx = state.actionHistory.findIndex((a) => a.id === actionId);

  if (idx >= 0) {
    state.actionHistory[idx] = {
      ...state.actionHistory[idx],
      status,
      employeeFeedback: feedback ?? state.actionHistory[idx].employeeFeedback,
    };
    saveEngineState(state);
    return state.actionHistory[idx];
  }

  const updated: ActionRecommendation = {
    id: actionId,
    lane: "proven",
    title: "Action",
    description: "",
    competitiveReason: "",
    whyThisAction: "",
    expectedEffortMin: 0,
    expectedUpside: "low",
    confidence: 0,
    strategyStatus: "proposed",
    riskLevel: "low",
    status,
    employeeFeedback: feedback,
    assignedAt: nowIso(),
  };

  state.actionHistory.push(updated);
  saveEngineState(state);
  return updated;
}

export function getManagerLabView(managerId: string): ManagerLabView | null {
  const state = getEngineState();
  const manager = state.employees.find((e) => e.id === managerId);
  if (!manager || manager.role !== "regional_manager") return null;

  const validated = getValidatedStrategies(state.strategies);
  const experimental = getExperimentalStrategies(state.strategies);
  const activeExperiments = getActiveExperiments(state.experiments);
  const stopped = state.experiments.filter(
    (e) => e.status === "stopped" || e.status === "analyzed",
  );

  const promising = experimental.filter((s) => s.confidence > 0.55);
  const topStrategy = promising.sort((a, b) => b.confidence - a.confidence)[0];

  const fieldReps = state.employees.filter((e) => e.role === "field_representative");

  const employeeDevelopment = fieldReps.map((rep) => {
    const repOutcomes = state.outcomes.filter((o) => o.employeeId === rep.id);
    const score = computeCompetitiveScore(rep, state.employees, state.outcomes, state.strategies);
    const constraint = getPrimaryConstraint(score);
    const bestDim = [...score.dimensions].sort((a, b) => b.score - a.score)[0];

    return {
      employeeId: rep.id,
      name: rep.name,
      primaryStrength: bestDim.label,
      primaryConstraint: constraint.dimension,
      currentIntervention: repOutcomes.some((o) => o.experimentId)
        ? "Automated commitment queue + experiment participation"
        : "Standard coaching",
      observedEffect: `${repOutcomes.length} tracked outcomes, ${repOutcomes.filter((o) => o.outcome === "account_progressed").length} progressed`,
    };
  });

  return {
    validatedStrategies: validated.length,
    activeExperiments: activeExperiments.length,
    promisingStrategies: promising.length,
    stoppedStrategies: stopped.length,
    topEmergingAdvantage: topStrategy?.action ?? "No emerging advantages",
    measuredEffect: topStrategy?.observedOutcome ?? "N/A",
    confidence: topStrategy?.confidence ?? 0,
    eligibleTerritories: fieldReps.length,
    employeeDevelopment,
  };
}

export function getPersonalChallenge(employeeId: string): PersonalChallenge | null {
  const state = getEngineState();
  return state.challenges.find((c) => c.employeeId === employeeId && c.status === "active") ?? null;
}

export function getAntiGamingFlags(employeeId?: string): AntiGamingFlag[] {
  const state = getEngineState();
  return employeeId
    ? state.antiGamingFlags.filter((f) => f.employeeId === employeeId)
    : state.antiGamingFlags;
}

export function detectAntiGaming(employeeId: string): AntiGamingFlag | null {
  const state = getEngineState();
  const empOutcomes = state.outcomes.filter((o) => o.employeeId === employeeId);

  const duplicateCount = empOutcomes.length - new Set(empOutcomes.map((o) => o.actionTaken)).size;
  if (duplicateCount > 3) {
    const flag: AntiGamingFlag = {
      type: "duplicate_engagement",
      employeeId,
      detail: `${duplicateCount} duplicate engagements detected. Possible activity inflation.`,
      severity: "moderate",
      detectedAt: nowIso(),
    };
    state.antiGamingFlags.push(flag);
    saveEngineState(state);
    return flag;
  }

  return null;
}
