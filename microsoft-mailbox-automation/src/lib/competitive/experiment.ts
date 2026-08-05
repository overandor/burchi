import { nanoid } from "nanoid";
import {
  EmployeeProfile,
  ExperimentContract,
  ExperimentVariant,
  ExperimentVariantRole,
  ExperimentStatus,
  StopReason,
  ActionOutcome,
  StrategyLearning,
  StrategyLifecycleState,
  StrategyContextKey,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

export function isEmployeeEligible(
  employee: EmployeeProfile,
  experiment: ExperimentContract,
): boolean {
  if (!employee.consentExperimental && experiment.status === "running") {
    return false;
  }

  if (employee.experienceLevel === "new") {
    if (experiment.excludedCriteria.some((c) => c.toLowerCase().includes("new hire"))) {
      return false;
    }
  }

  if (employee.marketRestrictions.includes("restricted_access")) {
    if (experiment.excludedCriteria.some((c) => c.toLowerCase().includes("restricted"))) {
      return false;
    }
  }

  return true;
}

export function assignVariant(
  employee: EmployeeProfile,
  experiment: ExperimentContract,
  existingAssignments: Map<string, ExperimentVariantRole>,
): ExperimentVariantRole | null {
  if (!isEmployeeEligible(employee, experiment)) {
    return null;
  }

  if (existingAssignments.has(employee.id)) {
    return existingAssignments.get(employee.id)!;
  }

  const variantRoles = experiment.variants.map((v) => v.role);
  const counts = new Map<ExperimentVariantRole, number>();
  for (const v of experiment.variants) {
    counts.set(v.role, v.assignedCount);
  }

  const minCount = Math.min(...variantRoles.map((r) => counts.get(r) || 0));
  const leastAssigned = variantRoles.filter((r) => counts.get(r) === minCount);
  const chosen = leastAssigned[Math.floor(Math.random() * leastAssigned.length)];

  return chosen;
}

export function createExperiment(input: {
  hypothesis: string;
  description: string;
  eligibleCriteria: string[];
  excludedCriteria: string[];
  primaryOutcome: string;
  secondaryOutcomes: string[];
  guardrails: string[];
  stopConditions: string[];
  variantDescriptions: { role: ExperimentVariantRole; description: string }[];
  durationDays: number;
  complianceValidated: boolean;
}): ExperimentContract {
  const variants: ExperimentVariant[] = input.variantDescriptions.map((v) => ({
    role: v.role,
    description: v.description,
    assignedCount: 0,
    progressionRate: 0,
    responseRate: 0,
    followUpCompletion: 0,
    representativeAcceptance: 0,
  }));

  return {
    id: nanoid(),
    hypothesis: input.hypothesis,
    description: input.description,
    eligibleCriteria: input.eligibleCriteria,
    excludedCriteria: input.excludedCriteria,
    primaryOutcome: input.primaryOutcome,
    secondaryOutcomes: input.secondaryOutcomes,
    guardrails: input.guardrails,
    stopConditions: input.stopConditions,
    variants,
    status: "running",
    durationDays: input.durationDays,
    startDate: nowIso(),
    endDate: daysAhead(input.durationDays),
    totalAssigned: 0,
    complianceValidated: input.complianceValidated,
    createdAt: nowIso(),
  };
}

export function stopExperiment(
  experiment: ExperimentContract,
  reason: StopReason,
  detail: string,
): ExperimentContract {
  return {
    ...experiment,
    status: reason === "sufficient_evidence" ? "analyzed" : "stopped",
    stopReason: reason,
    stopDetail: detail,
    endDate: nowIso(),
  };
}

export function analyzeExperiment(
  experiment: ExperimentContract,
  outcomes: ActionOutcome[],
): {
  winningVariant: ExperimentVariantRole;
  effectSize: number;
  confidenceLevel: number;
  updatedVariants: ExperimentVariant[];
} {
  const expOutcomes = outcomes.filter((o) => o.experimentId === experiment.id);

  const updatedVariants = experiment.variants.map((v) => {
    const vOutcomes = expOutcomes.filter((o) => o.variant === v.role);
    const total = vOutcomes.length || 1;
    const progressed = vOutcomes.filter(
      (o) => o.outcome === "account_progressed" || o.outcome === "barrier_resolved",
    ).length;
    const responded = vOutcomes.filter((o) => o.outcome === "meaningful_response").length;
    const followUp = vOutcomes.filter((o) => o.outcome === "follow_up_completed").length;

    return {
      ...v,
      assignedCount: v.assignedCount + vOutcomes.length,
      progressionRate: progressed / total,
      responseRate: responded / total,
      followUpCompletion: followUp / total,
      representativeAcceptance: v.representativeAcceptance,
    };
  });

  const control = updatedVariants.find((v) => v.role === "control");
  const nonControl = updatedVariants.filter((v) => v.role !== "control");

  let winner = nonControl[0];
  for (const v of nonControl) {
    if (v.progressionRate > winner.progressionRate) {
      winner = v;
    }
  }

  const controlRate = control?.progressionRate ?? 0;
  const effectSize = Math.max(0, winner.progressionRate - controlRate);

  const totalSample = updatedVariants.reduce((s, v) => s + v.assignedCount, 0);
  const confidenceLevel = Math.min(0.99, 0.50 + (totalSample / 100) * 0.25 + effectSize * 0.5);

  return {
    winningVariant: winner.role,
    effectSize: Math.round(effectSize * 100) / 100,
    confidenceLevel: Math.round(confidenceLevel * 100) / 100,
    updatedVariants,
  };
}

export function promoteStrategy(
  experiment: ExperimentContract,
  analysis: {
    winningVariant: ExperimentVariantRole;
    effectSize: number;
    confidenceLevel: number;
  },
  context: StrategyContextKey,
): StrategyLearning {
  const winner = experiment.variants.find((v) => v.role === analysis.winningVariant);
  const lifecycleState: StrategyLifecycleState =
    analysis.confidenceLevel >= 0.85
      ? "validated"
      : analysis.confidenceLevel >= 0.70
        ? "scaled"
        : "limited_experiment";

  return {
    id: nanoid(),
    context,
    action: winner?.description ?? experiment.hypothesis,
    observedOutcome: `${Math.round(analysis.effectSize * 100)}% improvement over control`,
    effectSize: analysis.effectSize,
    confidence: analysis.confidenceLevel,
    sampleSize: experiment.totalAssigned,
    lifecycleState,
    discoveredAt: experiment.createdAt,
    lastValidatedAt: nowIso(),
    patternDescription: experiment.hypothesis,
  };
}

export function getActiveExperiments(experiments: ExperimentContract[]): ExperimentContract[] {
  return experiments.filter((e) => e.status === "running");
}

export function getCompletedExperiments(experiments: ExperimentContract[]): ExperimentContract[] {
  return experiments.filter(
    (e) => e.status === "completed" || e.status === "analyzed" || e.status === "stopped",
  );
}
