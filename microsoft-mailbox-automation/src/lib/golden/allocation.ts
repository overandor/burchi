import { nanoid } from "nanoid";
import {
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisKind,
  RoleType,
  EngagementMode,
  InnovationDimension,
  ResearchReliabilityLevel,
} from "@/types";
import {
  loadHypotheses,
  saveHypotheses,
  loadHypothesisAssignments,
  saveHypothesisAssignments,
  loadDiscoveryLedger,
  saveDiscoveryLedger,
  loadResearchReliability,
} from "@/lib/config";
import { ensureGoldenSeeded, SEED_EMPLOYEES, SEED_ACCOUNTS, GoldenEmployee, GoldenAccount } from "./seed";
import { isAssignable } from "./prior-art";

const now = () => new Date().toISOString();

const MAX_ACTIVE_PER_EMPLOYEE = 3;
// Constrained exploration: each employee receives a mixture.
const TARGET_MIX: Record<HypothesisKind, number> = {
  reliable: 1,
  fit: 1,
  discovery: 1,
  builder: 0, // builder missions are gated by reliability level
};

/** What kinds of hypotheses an employee can safely own, by reliability level. */
export function allowedKindsForLevel(level: ResearchReliabilityLevel): HypothesisKind[] {
  switch (level) {
    case "participant":
      return ["reliable"];
    case "reliable_tester":
      return ["reliable", "fit"];
    case "replicator":
      return ["reliable", "fit", "discovery"];
    case "hypothesis_modifier":
      return ["reliable", "fit", "discovery"];
    case "process_builder":
      return ["reliable", "fit", "discovery", "builder"];
    case "strategy_architect":
      return ["reliable", "fit", "discovery", "builder"];
    case "golden_node_founder":
      return ["reliable", "fit", "discovery", "builder"];
  }
}

export interface AllocationContext {
  employeeId: string;
  role: RoleType;
  territory: string;
  reliabilityLevel: ResearchReliabilityLevel;
  engagementModesPresent: EngagementMode[];
}

export function listAssignments(): HypothesisAssignment[] {
  return loadHypothesisAssignments();
}

export function getAssignmentsForEmployee(employeeId: string): HypothesisAssignment[] {
  return loadHypothesisAssignments().filter((a) => a.employeeId === employeeId);
}

export function getActiveAssignmentsForEmployee(employeeId: string): HypothesisAssignment[] {
  return loadHypothesisAssignments().filter(
    (a) => a.employeeId === employeeId && !isTerminal(a.state)
  );
}

export function getAssignmentById(id: string): HypothesisAssignment | undefined {
  return loadHypothesisAssignments().find((a) => a.id === id);
}

export function upsertAssignment(assignment: HypothesisAssignment): void {
  const all = loadHypothesisAssignments();
  const idx = all.findIndex((a) => a.id === assignment.id);
  if (idx >= 0) all[idx] = assignment;
  else all.push(assignment);
  saveHypothesisAssignments(all);
}

function isTerminal(state: HypothesisAssignment["state"]): boolean {
  return state === "rejected" || state === "falsified" || state === "validated" || state === "scaled" || state === "productized" || state === "channel";
}

/** Score how well a hypothesis fits an employee for allocation. */
export function scoreFit(h: HypothesisAnatomy, ctx: AllocationContext): number {
  let score = 0;
  // Engagement-mode overlap with the employee's territory accounts.
  const overlap = h.targetEngagementModes.filter((m) => ctx.engagementModesPresent.includes(m)).length;
  score += overlap * 0.3;

  // Kind preference from target mix.
  score += TARGET_MIX[h.kind] * 0.15;

  // Research risk vs reliability: high-risk hypotheses need higher reliability.
  if (h.researchRisk === "high") {
    if (ctx.reliabilityLevel === "process_builder" || ctx.reliabilityLevel === "strategy_architect" || ctx.reliabilityLevel === "golden_node_founder") {
      score += 0.2;
    } else {
      score -= 0.3;
    }
  } else if (h.researchRisk === "moderate") {
    if (ctx.reliabilityLevel !== "participant") score += 0.1;
  } else {
    score += 0.1;
  }

  // Prior-art confidence contributes to "acceptable predicted performance".
  score += 0.1; // base; prior-art confidence already encoded in status/kind

  // Builder hypotheses only for builders.
  if (h.kind === "builder") {
    const allowed = allowedKindsForLevel(ctx.reliabilityLevel).includes("builder");
    score += allowed ? 0.2 : -1;
  }

  return score;
}

/** Fair-opportunity penalty: employees who already received many high-upside hypotheses
 *  are deprioritized so promising opportunities are not hoarded by top performers. */
export function fairOpportunityPenalty(employeeId: string, kind: HypothesisKind): number {
  const ledger = loadDiscoveryLedger().find((l) => l.employeeId === employeeId);
  if (!ledger) return 0;
  const highUpsideLoad = ledger.highUpsideHypothesesReceived + ledger.builderMissionsReceived;
  const basePenalty = Math.min(highUpsideLoad * 0.05, 0.3);
  if (kind === "builder") return basePenalty + Math.min(ledger.builderMissionsReceived * 0.08, 0.3);
  if (kind === "discovery") return basePenalty + Math.min(ledger.experimentalRiskAssumed * 0.03, 0.2);
  return basePenalty;
}

/** Allocate the daily hypothesis set for an employee using constrained exploration. */
export function allocateHypotheses(ctx: AllocationContext): HypothesisAssignment[] {
  ensureGoldenSeeded();
  const allHypotheses = loadHypotheses();
  const active = getActiveAssignmentsForEmployee(ctx.employeeId);
  const newAssignments: HypothesisAssignment[] = [];

  const allowedKinds = allowedKindsForLevel(ctx.reliabilityLevel);
  const eligiblePool = allHypotheses.filter(
    (h) => isAssignable(h.priorArtStatus) && allowedKinds.includes(h.kind)
  );

  // Build a per-kind candidate list, excluding already-assigned hypotheses.
  const candidatesByKind: Record<HypothesisKind, HypothesisAnatomy[]> = {
    reliable: eligiblePool.filter((h) => h.kind === "reliable"),
    fit: eligiblePool.filter((h) => h.kind === "fit"),
    discovery: eligiblePool.filter((h) => h.kind === "discovery"),
    builder: eligiblePool.filter((h) => h.kind === "builder"),
  };

  const slotsRemaining = MAX_ACTIVE_PER_EMPLOYEE - active.length;
  if (slotsRemaining <= 0) return [];

  // Order kinds by target mix priority.
  const kindOrder: HypothesisKind[] = ["reliable", "fit", "discovery", "builder"];
  let assigned = 0;

  for (const kind of kindOrder) {
    if (assigned >= slotsRemaining) break;
    const target = TARGET_MIX[kind];
    const alreadyOfKind = active.filter((a) => a.kind === kind).length;
    const want = Math.max(0, target - alreadyOfKind);
    if (want <= 0) continue;

    const candidates = candidatesByKind[kind]
      .filter((h) => !active.some((a) => a.hypothesisId === h.id) && !newAssignments.some((a) => a.hypothesisId === h.id))
      .map((h) => ({
        h,
        score: scoreFit(h, ctx) - fairOpportunityPenalty(ctx.employeeId, h.kind),
      }))
      .sort((a, b) => b.score - a.score);

    for (let i = 0; i < Math.min(want, candidates.length) && assigned < slotsRemaining; i++) {
      const { h } = candidates[i];
      const assignment = createAssignment(h, ctx, kind, active.length + assigned + 1);
      newAssignments.push(assignment);
      upsertAssignment(assignment);
      recordDiscoveryOpportunity(ctx.employeeId, kind);
      assigned++;
    }
  }

  // If no assignment yet (e.g. all target kinds exhausted), fall back to best-fit eligible.
  if (newAssignments.length === 0 && slotsRemaining > 0) {
    const fallback = eligiblePool
      .filter((h) => !active.some((a) => a.hypothesisId === h.id))
      .map((h) => ({ h, score: scoreFit(h, ctx) - fairOpportunityPenalty(ctx.employeeId, h.kind) }))
      .sort((a, b) => b.score - a.score);
    if (fallback.length > 0) {
      const { h } = fallback[0];
      const assignment = createAssignment(h, ctx, h.kind, active.length + 1);
      newAssignments.push(assignment);
      upsertAssignment(assignment);
      recordDiscoveryOpportunity(ctx.employeeId, h.kind);
    }
  }

  return newAssignments;
}

function createAssignment(
  h: HypothesisAnatomy,
  ctx: AllocationContext,
  kind: HypothesisKind,
  trialNumber: number
): HypothesisAssignment {
  const eligibleAccounts = selectEligibleAccounts(h, ctx);
  return {
    id: `ga_${nanoid(10)}`,
    hypothesisId: h.id,
    employeeId: ctx.employeeId,
    employeeRole: ctx.role,
    kind,
    state: "assigned",
    assignedAt: now(),
    eligibleAccountIds: eligibleAccounts.map((a) => a.id),
    evaluationPeriodDays: h.researchRisk === "high" ? 21 : h.researchRisk === "moderate" ? 14 : 7,
    trialNumber,
    allocationReason: buildAllocationReason(h, ctx),
    innovationWindow: h.modifiableDimensions,
  };
}

function selectEligibleAccounts(h: HypothesisAnatomy, ctx: AllocationContext): GoldenAccount[] {
  return SEED_ACCOUNTS.filter(
    (a) => a.territory === ctx.territory && h.targetEngagementModes.includes(a.engagementMode)
  ).slice(0, 2);
}

function buildAllocationReason(h: HypothesisAnatomy, ctx: AllocationContext): string {
  const accounts = SEED_ACCOUNTS.filter(
    (a) => a.territory === ctx.territory && h.targetEngagementModes.includes(a.engagementMode)
  );
  return `You have ${accounts.length} eligible account${accounts.length === 1 ? "" : "s"} and ${ctx.reliabilityLevel.replace(/_/g, " ")} research reliability.`;
}

function recordDiscoveryOpportunity(employeeId: string, kind: HypothesisKind): void {
  const ledger = loadDiscoveryLedger();
  let entry = ledger.find((l) => l.employeeId === employeeId);
  if (!entry) {
    entry = {
      employeeId,
      highUpsideHypothesesReceived: 0,
      builderMissionsReceived: 0,
      experimentalRiskAssumed: 0,
      successfulReplicationsCompleted: 0,
      usefulFailuresGenerated: 0,
      strategiesContributed: 0,
      goldenNodeCreditEarned: 0,
      updatedAt: now(),
    };
    ledger.push(entry);
  }
  if (kind === "builder") entry.builderMissionsReceived += 1;
  if (kind === "discovery") entry.experimentalRiskAssumed += 1;
  if (kind === "reliable" || kind === "fit") entry.highUpsideHypothesesReceived += 1;
  entry.updatedAt = now();
  saveDiscoveryLedger(ledger);
}

// ─── Employee actions on assignments ───────────────────────────────

export function acceptAssignment(id: string): HypothesisAssignment | undefined {
  const a = getAssignmentById(id);
  if (!a) return undefined;
  a.state = "accepted";
  a.acceptedAt = now();
  upsertAssignment(a);
  return a;
}

export function rejectAssignment(id: string, note?: string): HypothesisAssignment | undefined {
  const a = getAssignmentById(id);
  if (!a) return undefined;
  a.state = "rejected";
  a.rejectedAt = now();
  a.employeeNote = note;
  upsertAssignment(a);
  return a;
}

export function modifyAssignment(
  id: string,
  dimension: InnovationDimension,
  rationale: string
): HypothesisAssignment | undefined {
  const a = getAssignmentById(id);
  if (!a) return undefined;
  if (!a.innovationWindow.includes(dimension)) return undefined;
  a.state = "modified";
  a.modifiedAt = now();
  a.modifiedDimension = dimension;
  a.modificationRationale = rationale;
  upsertAssignment(a);
  return a;
}

/** Convenience: build an AllocationContext for any employee.
 *  Falls back to a default field-rep context for unknown users so real
 *  authenticated accounts can receive Daily Seed allocations.
 */
export function contextForEmployee(employeeId: string): AllocationContext | undefined {
  const emp = SEED_EMPLOYEES.find((e) => e.id === employeeId);
  if (emp) {
    const reliability = loadResearchReliability().find((r) => r.employeeId === employeeId);
    const modesPresent = SEED_ACCOUNTS.filter((a) => a.territory === emp.territory).map((a) => a.engagementMode);
    return {
      employeeId: emp.id,
      role: emp.role,
      territory: emp.territory,
      reliabilityLevel: reliability?.level || emp.reliabilityLevel,
      engagementModesPresent: Array.from(new Set(modesPresent)),
    };
  }

  // Default context for any authenticated user who is not a seed employee.
  const reliability = loadResearchReliability().find((r) => r.employeeId === employeeId);
  return {
    employeeId,
    role: "field_representative",
    territory: "National",
    reliabilityLevel: reliability?.level || "replicator",
    engagementModesPresent: ["human_guided", "hybrid", "system_oriented"],
  };
}

export { SEED_EMPLOYEES, SEED_ACCOUNTS };
export type { GoldenEmployee, GoldenAccount };
