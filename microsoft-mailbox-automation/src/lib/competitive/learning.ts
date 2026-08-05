import { nanoid } from "nanoid";
import {
  StrategyLearning,
  StrategyLifecycleState,
  ActionOutcome,
  StrategyContextKey,
  EmployeeProfile,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

export function learnFromOutcomes(
  outcomes: ActionOutcome[],
  existingStrategies: StrategyLearning[],
): StrategyLearning[] {
  const newLearnings: StrategyLearning[] = [];
  const grouped = new Map<string, ActionOutcome[]>();

  for (const outcome of outcomes) {
    const key = contextKeyToString(outcome.context);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(outcome);
  }

  for (const [key, groupOutcomes] of grouped) {
    const total = groupOutcomes.length;
    if (total < 3) continue;

    const positive = groupOutcomes.filter(
      (o) =>
        o.outcome === "account_progressed" ||
        o.outcome === "barrier_resolved" ||
        o.outcome === "meaningful_response" ||
        o.outcome === "follow_up_completed",
    ).length;

    const successRate = positive / total;
    if (successRate < 0.3) continue;

    const context = groupOutcomes[0].context;
    const action = groupOutcomes[0].actionTaken;

    const existing = existingStrategies.find(
      (s) =>
        contextKeyToString(s.context) === key &&
        s.action.toLowerCase() === action.toLowerCase(),
    );

    if (existing) {
      continue;
    }

    const lifecycleState: StrategyLifecycleState =
      successRate > 0.7 && total >= 10
        ? "validated"
        : successRate > 0.5 && total >= 5
          ? "limited_experiment"
          : "proposed";

    newLearnings.push({
      id: nanoid(),
      context,
      action,
      observedOutcome: `${Math.round(successRate * 100)}% positive outcome rate across ${total} observations`,
      effectSize: Math.round(successRate * 100) / 100,
      confidence: Math.min(0.99, 0.40 + (total / 20) * 0.3),
      sampleSize: total,
      lifecycleState,
      discoveredAt: nowIso(),
      lastValidatedAt: nowIso(),
      patternDescription: `Observed pattern: ${action} in ${key} produces ${Math.round(successRate * 100)}% positive outcomes.`,
    });
  }

  return newLearnings;
}

function contextKeyToString(ctx: StrategyContextKey): string {
  return [
    ctx.territoryMaturity || "any",
    ctx.barrierType || "any",
    ctx.accountState || "any",
    ctx.employeeExperience || "any",
    ctx.channel || "any",
  ].join("|");
}

export function getValidatedStrategies(strategies: StrategyLearning[]): StrategyLearning[] {
  return strategies.filter(
    (s) =>
      s.lifecycleState === "validated" ||
      s.lifecycleState === "scaled" ||
      s.lifecycleState === "monitored",
  );
}

export function getExperimentalStrategies(strategies: StrategyLearning[]): StrategyLearning[] {
  return strategies.filter(
    (s) =>
      s.lifecycleState === "limited_experiment" ||
      s.lifecycleState === "shadow_tested" ||
      s.lifecycleState === "simulated",
  );
}

export function getStrategiesForEmployee(
  employee: EmployeeProfile,
  strategies: StrategyLearning[],
): StrategyLearning[] {
  return strategies.filter(
    (s) =>
      s.context.territoryMaturity === employee.territoryMaturity ||
      s.context.employeeExperience === employee.experienceLevel ||
      !s.context.territoryMaturity,
  );
}

export function advanceLifecycle(
  strategy: StrategyLearning,
  outcomes: ActionOutcome[],
): StrategyLearning {
  const relevantOutcomes = outcomes.filter(
    (o) => contextKeyToString(o.context) === contextKeyToString(strategy.context),
  );

  if (relevantOutcomes.length < 5) return strategy;

  const positive = relevantOutcomes.filter(
    (o) =>
      o.outcome === "account_progressed" ||
      o.outcome === "barrier_resolved" ||
      o.outcome === "meaningful_response",
  ).length;

  const successRate = positive / relevantOutcomes.length;
  const newState: StrategyLifecycleState =
    successRate > 0.7 && strategy.sampleSize >= 20
      ? "validated"
      : successRate > 0.5 && strategy.sampleSize >= 10
        ? "scaled"
        : strategy.lifecycleState;

  return {
    ...strategy,
    lifecycleState: newState,
    sampleSize: strategy.sampleSize + relevantOutcomes.length,
    confidence: Math.min(0.99, strategy.confidence + 0.05),
    lastValidatedAt: nowIso(),
  };
}

export function retireStaleStrategies(
  strategies: StrategyLearning[],
  maxAgeDays: number = 180,
): StrategyLearning[] {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  return strategies.map((s) => {
    if (new Date(s.lastValidatedAt).getTime() < cutoff && s.lifecycleState !== "retired") {
      return { ...s, lifecycleState: "retired" as StrategyLifecycleState };
    }
    return s;
  });
}
