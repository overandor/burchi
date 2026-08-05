import { nanoid } from "nanoid";
import {
  StrategyAssignment,
  StrategyGenome,
  StrategyPortfolio,
  RoleType,
  AssignmentReason,
  StrategyClass,
  StrategyContextCondition,
} from "@/types";
import { loadStrategyAssignments, saveStrategyAssignments, loadStrategies } from "@/lib/config";
import { ensureStrategiesSeeded, listStrategiesByRole } from "@/lib/strategy/library";

const now = () => new Date().toISOString();

const MAX_PROVEN = 3;
const MAX_PERSONALIZED = 2;
const MAX_EXPERIMENTAL = 1;
const TARGET_EXPLORE_RATIO = 0.3;

// ─── Context Matching ──────────────────────────────────────────────

export interface EmployeeContext {
  employeeId: string;
  role: RoleType;
  territoryType?: string;
  workloadLevel?: "low" | "medium" | "high";
  stakeholderSegment?: string;
  productPortfolio?: string[];
}

function contextMatches(
  conditions: StrategyContextCondition[],
  ctx: EmployeeContext
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((c) => {
    let actualValue: unknown;
    switch (c.field) {
      case "role":
        actualValue = ctx.role;
        break;
      case "territory_type":
        actualValue = ctx.territoryType || "geographic";
        break;
      case "workload_level":
        actualValue = ctx.workloadLevel || "medium";
        break;
      case "stakeholder_segment":
        actualValue = ctx.stakeholderSegment || "mixed";
        break;
      case "product_portfolio":
        actualValue = ctx.productPortfolio || [];
        break;
      default:
        return true;
    }

    switch (c.operator) {
      case "equals":
        return actualValue === c.value;
      case "contains":
        if (typeof actualValue === "string" && typeof c.value === "string") {
          return actualValue.includes(c.value);
        }
        if (Array.isArray(actualValue) && typeof c.value === "string") {
          return actualValue.includes(c.value);
        }
        return false;
      case "in_range":
        if (Array.isArray(c.value) && typeof actualValue === "string") {
          return c.value.includes(actualValue);
        }
        return false;
      case "greater_than":
        return typeof actualValue === "number" && typeof c.value === "number" && actualValue > c.value;
      case "less_than":
        return typeof actualValue === "number" && typeof c.value === "number" && actualValue < c.value;
      default:
        return true;
    }
  });
}

// ─── Assignment Store ──────────────────────────────────────────────

export function listAssignments(): StrategyAssignment[] {
  return loadStrategyAssignments();
}

export function getAssignmentsForEmployee(employeeId: string): StrategyAssignment[] {
  return loadStrategyAssignments().filter((a) => a.employeeId === employeeId && a.active);
}

export function getAssignmentById(id: string): StrategyAssignment | undefined {
  return loadStrategyAssignments().find((a) => a.id === id);
}

export function upsertAssignment(assignment: StrategyAssignment): void {
  const all = loadStrategyAssignments();
  const idx = all.findIndex((a) => a.id === assignment.id);
  if (idx >= 0) {
    all[idx] = assignment;
  } else {
    all.push(assignment);
  }
  saveStrategyAssignments(all);
}

export function deactivateAssignment(id: string): void {
  const all = loadStrategyAssignments();
  const idx = all.findIndex((a) => a.id === id);
  if (idx >= 0) {
    all[idx].active = false;
    all[idx].deactivatedAt = now();
    saveStrategyAssignments(all);
  }
}

// ─── Explore-vs-Exploit Engine ─────────────────────────────────────

export function computeExploreRatio(assignments: StrategyAssignment[]): number {
  if (assignments.length === 0) return 0;
  const exploreCount = assignments.filter(
    (a) => a.assignmentReason === "explore" || a.strategyClass === "experimental"
  ).length;
  return exploreCount / assignments.length;
}

export function shouldExplore(
  currentAssignments: StrategyAssignment[],
  candidateClass: StrategyClass
): boolean {
  const exploreRatio = computeExploreRatio(currentAssignments);
  if (exploreRatio >= TARGET_EXPLORE_RATIO) return false;
  return candidateClass === "experimental" || candidateClass === "personalized";
}

// ─── Assignment Engine ─────────────────────────────────────────────

export function assignStrategies(ctx: EmployeeContext): StrategyAssignment[] {
  ensureStrategiesSeeded();

  const existing = getAssignmentsForEmployee(ctx.employeeId);
  const newAssignments: StrategyAssignment[] = [];

  const candidates = listStrategiesByRole(ctx.role).filter(
    (s) => !existing.some((a) => a.strategyId === s.id)
  );

  const contextMatched = candidates.filter((s) => contextMatches(s.applicableContext, ctx));
  const pool = contextMatched.length > 0 ? contextMatched : candidates;

  const byClass: Record<StrategyClass, StrategyGenome[]> = {
    proven: pool.filter((s) => s.strategyClass === "proven"),
    personalized: pool.filter((s) => s.strategyClass === "personalized"),
    experimental: pool.filter((s) => s.strategyClass === "experimental"),
  };

  // Assign proven strategies (exploit)
  const provenToAssign = Math.min(
    MAX_PROVEN - existing.filter((a) => a.strategyClass === "proven").length,
    byClass.proven.length
  );
  for (let i = 0; i < Math.max(0, provenToAssign); i++) {
    const strategy = byClass.proven[i];
    const assignment = createAssignment(strategy, ctx, "exploit", existing.length + newAssignments.length + 1);
    newAssignments.push(assignment);
    upsertAssignment(assignment);
  }

  // Assign personalized strategies
  const personalizedToAssign = Math.min(
    MAX_PERSONALIZED - existing.filter((a) => a.strategyClass === "personalized").length,
    byClass.personalized.length
  );
  for (let i = 0; i < Math.max(0, personalizedToAssign); i++) {
    const strategy = byClass.personalized[i];
    const reason: AssignmentReason = shouldExplore([...existing, ...newAssignments], "personalized")
      ? "personalized_fit"
      : "exploit";
    const assignment = createAssignment(strategy, ctx, reason, existing.length + newAssignments.length + 1);
    newAssignments.push(assignment);
    upsertAssignment(assignment);
  }

  // Assign experimental strategies (explore)
  const updatedAll = [...existing, ...newAssignments];
  if (shouldExplore(updatedAll, "experimental")) {
    const experimentalToAssign = Math.min(
      MAX_EXPERIMENTAL - existing.filter((a) => a.strategyClass === "experimental").length,
      byClass.experimental.length
    );
    for (let i = 0; i < Math.max(0, experimentalToAssign); i++) {
      const strategy = byClass.experimental[i];
      const assignment = createAssignment(strategy, ctx, "explore", existing.length + newAssignments.length + 1);
      newAssignments.push(assignment);
      upsertAssignment(assignment);
    }
  }

  return newAssignments;
}

function createAssignment(
  strategy: StrategyGenome,
  ctx: EmployeeContext,
  reason: AssignmentReason,
  trialNumber: number
): StrategyAssignment {
  return {
    id: nanoid(12),
    strategyId: strategy.id,
    employeeId: ctx.employeeId,
    employeeRole: ctx.role,
    strategyClass: strategy.strategyClass,
    assignmentReason: reason,
    assignedAt: now(),
    active: true,
    employeeAccepted: false,
    employeeModified: false,
    expectedOutcomeMetrics: strategy.expectedOutcomes.map((m) => ({ ...m })),
    contextSnapshot: {
      territoryType: ctx.territoryType,
      workloadLevel: ctx.workloadLevel,
      stakeholderSegment: ctx.stakeholderSegment,
      productPortfolio: ctx.productPortfolio,
    },
    trialNumber,
    confidenceAtAssignment: strategy.evidenceLevel === "experimentally_supported"
      ? 0.85
      : strategy.evidenceLevel === "probable_contribution"
        ? 0.65
        : strategy.evidenceLevel === "observed_association"
          ? 0.45
          : 0.25,
  };
}

// ─── Portfolio Generation ──────────────────────────────────────────

export function computeDiversityScore(assignments: StrategyAssignment[], strategies: StrategyGenome[]): number {
  if (assignments.length === 0) return 0;
  const domains = new Set<string>();
  for (const a of assignments) {
    const s = strategies.find((s) => s.id === a.strategyId);
    if (s) domains.add(s.domain);
  }
  return Math.round((domains.size / 8) * 100) / 100;
}

export function getPortfolio(employeeId: string, role: RoleType): StrategyPortfolio {
  ensureStrategiesSeeded();
  const allStrategies = loadStrategies();
  const active = getAssignmentsForEmployee(employeeId);

  const proven = active.filter((a) => a.strategyClass === "proven");
  const personalized = active.filter((a) => a.strategyClass === "personalized");
  const experimental = active.filter((a) => a.strategyClass === "experimental");

  const exploreRatio = computeExploreRatio(active);
  const exploitRatio = 1 - exploreRatio;
  const diversity = computeDiversityScore(active, allStrategies);

  return {
    employeeId,
    employeeRole: role,
    activeAssignments: active,
    provenStrategies: proven,
    personalizedStrategies: personalized,
    experimentalStrategies: experimental,
    portfolioDiversityScore: diversity,
    exploreRatio,
    exploitRatio,
    lastRebalancedAt: now(),
  };
}

// ─── Employee Acceptance ───────────────────────────────────────────

export function acceptAssignment(id: string): StrategyAssignment | undefined {
  const all = loadStrategyAssignments();
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return undefined;
  all[idx].employeeAccepted = true;
  saveStrategyAssignments(all);
  return all[idx];
}

export function modifyAssignment(id: string, notes: string): StrategyAssignment | undefined {
  const all = loadStrategyAssignments();
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return undefined;
  all[idx].employeeModified = true;
  all[idx].modificationNotes = notes;
  saveStrategyAssignments(all);
  return all[idx];
}

export function rejectAssignment(id: string): StrategyAssignment | undefined {
  deactivateAssignment(id);
  const all = loadStrategyAssignments();
  return all.find((a) => a.id === id);
}
