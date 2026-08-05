import { nanoid } from "nanoid";
import {
  DiscoveryOpportunityLedger,
  ResearchReliability,
  ResearchReliabilityLevel,
  ResearchCompetitionEntry,
  ResearchCompetitionCategory,
  HypothesisOutcome,
} from "@/types";
import {
  loadDiscoveryLedger,
  saveDiscoveryLedger,
  loadResearchReliability,
  saveResearchReliability,
  loadCompetitions,
  saveCompetitions,
  loadHypothesisOutcomes,
} from "@/lib/config";
import { computeEffectSize } from "./outcomes";

const now = () => new Date().toISOString();

// ─── Discovery Opportunity Ledger ──────────────────────────────────

export function listDiscoveryLedger(): DiscoveryOpportunityLedger[] {
  return loadDiscoveryLedger();
}

export function getDiscoveryLedgerForEmployee(employeeId: string): DiscoveryOpportunityLedger {
  const existing = loadDiscoveryLedger().find((l) => l.employeeId === employeeId);
  if (existing) return existing;
  return {
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
}

/** Fairness audit: detect whether high-upside opportunities are hoarded by top performers. */
export interface FairnessAudit {
  totalHighUpside: number;
  totalBuilderMissions: number;
  totalGoldenNodeCredit: number;
  perEmployee: { employeeId: string; highUpside: number; builderMissions: number; goldenNodeCredit: number }[];
  hoardingDetected: boolean;
  hoardingEmployees: string[];
}

export function auditFairness(): FairnessAudit {
  const ledger = loadDiscoveryLedger();
  const totalHighUpside = ledger.reduce((a, l) => a + l.highUpsideHypothesesReceived, 0);
  const totalBuilderMissions = ledger.reduce((a, l) => a + l.builderMissionsReceived, 0);
  const totalGoldenNodeCredit = ledger.reduce((a, l) => a + l.goldenNodeCreditEarned, 0);

  const perEmployee = ledger.map((l) => ({
    employeeId: l.employeeId,
    highUpside: l.highUpsideHypothesesReceived,
    builderMissions: l.builderMissionsReceived,
    goldenNodeCredit: l.goldenNodeCreditEarned,
  }));

  // Hoarding: any employee holding more than 50% of total high-upside opportunities
  // when there are >=3 employees with entries.
  const hoardingEmployees: string[] = [];
  if (ledger.length >= 3 && totalHighUpside > 0) {
    for (const e of perEmployee) {
      if (e.highUpside / totalHighUpside > 0.5) hoardingEmployees.push(e.employeeId);
    }
  }

  return {
    totalHighUpside,
    totalBuilderMissions,
    totalGoldenNodeCredit,
    perEmployee,
    hoardingDetected: hoardingEmployees.length > 0,
    hoardingEmployees,
  };
}

// ─── Research Reliability ──────────────────────────────────────────

export function listResearchReliability(): ResearchReliability[] {
  return loadResearchReliability();
}

export function getResearchReliabilityForEmployee(employeeId: string): ResearchReliability | undefined {
  return loadResearchReliability().find((r) => r.employeeId === employeeId);
}

/** Update research reliability from observed execution behavior.
 *  Effort signals, not activity theater. (GOLDEN NODE §13, §14) */
export interface ReliabilityUpdate {
  executionFidelity?: number;
  evidenceQuality?: number;
  usefulOverrides?: number;
  experimentCompletion?: number;
  confounderDetection?: number;
  derivativeQuality?: number;
  collaboration?: number;
}

export function updateResearchReliability(employeeId: string, update: ReliabilityUpdate): ResearchReliability {
  const all = loadResearchReliability();
  let entry = all.find((r) => r.employeeId === employeeId);
  if (!entry) {
    entry = {
      employeeId,
      level: "participant",
      executionFidelity: 0.5,
      evidenceQuality: 0.5,
      ethicalJudgment: 0.9,
      usefulOverrides: 0,
      experimentCompletion: 0.5,
      confounderDetection: 0.3,
      derivativeQuality: 0.2,
      collaboration: 0.7,
      updatedAt: now(),
    };
    all.push(entry);
  }
  Object.assign(entry, update);
  entry.level = computeLevel(entry);
  entry.updatedAt = now();
  saveResearchReliability(all);
  return entry;
}

/** Compute the reliability level from component scores. */
export function computeLevel(r: ResearchReliability): ResearchReliabilityLevel {
  const composite =
    r.executionFidelity * 0.2 +
    r.evidenceQuality * 0.2 +
    r.experimentCompletion * 0.15 +
    r.confounderDetection * 0.15 +
    r.derivativeQuality * 0.15 +
    r.collaboration * 0.05 +
    Math.min(r.usefulOverrides / 6, 1) * 0.1;

  if (composite >= 0.9 && r.derivativeQuality >= 0.9) return "golden_node_founder";
  if (composite >= 0.85) return "strategy_architect";
  if (composite >= 0.78) return "process_builder";
  if (composite >= 0.7) return "hypothesis_modifier";
  if (composite >= 0.6) return "replicator";
  if (composite >= 0.5) return "reliable_tester";
  return "participant";
}

/** Unlock path: Participant → Reliable tester → Replicator → Hypothesis modifier →
 *  Process builder → Strategy architect → Golden Node founder. */
export const UNLOCK_PATH: ResearchReliabilityLevel[] = [
  "participant",
  "reliable_tester",
  "replicator",
  "hypothesis_modifier",
  "process_builder",
  "strategy_architect",
  "golden_node_founder",
];

export function nextLevel(current: ResearchReliabilityLevel): ResearchReliabilityLevel | null {
  const idx = UNLOCK_PATH.indexOf(current);
  if (idx < 0 || idx >= UNLOCK_PATH.length - 1) return null;
  return UNLOCK_PATH[idx + 1];
}

// ─── Research Competition ──────────────────────────────────────────

export function listCompetitions(): ResearchCompetitionEntry[] {
  return loadCompetitions();
}

export function getCompetitionsByCategory(category: ResearchCompetitionCategory): ResearchCompetitionEntry[] {
  return loadCompetitions()
    .filter((c) => c.category === category)
    .sort((a, b) => b.score - a.score);
}

/** Score an outcome for a research competition category. */
export function scoreOutcomeForCategory(outcome: HypothesisOutcome, category: ResearchCompetitionCategory): number {
  const effect = computeEffectSize(outcome);
  switch (category) {
    case "best_validated_strategy":
      return outcome.falsified ? 0 : Math.max(0, effect) * 10;
    case "most_useful_falsification":
      return outcome.falsified ? (outcome.falsificationEvidence ? 8 : 5) : 0;
    case "highest_quality_replication":
      return outcome.falsified ? 0 : Math.max(0, effect) * 8;
    case "largest_efficiency_gain":
      return outcome.metrics.some((m) => /time|effort/i.test(m.metric))
        ? Math.max(0, effect) * 9
        : 0;
    case "strongest_process_derivative":
      return outcome.successKind === "system" ? Math.max(0, effect) * 9 : 0;
    case "best_new_channel_hypothesis":
      return outcome.successKind === "channel" ? Math.max(0, effect) * 10 : 0;
    case "most_transferable_workflow":
      return outcome.successKind === "system" ? Math.max(0, effect) * 7 : 0;
    case "most_accurate_model_challenge":
      return outcome.successKind === "boundary" ? 7 : 0;
  }
}

/** Submit an entry to the research competition. */
export function submitCompetitionEntry(
  category: ResearchCompetitionCategory,
  employeeId: string,
  hypothesisId: string,
  description: string,
  score: number
): ResearchCompetitionEntry {
  const entry: ResearchCompetitionEntry = {
    id: `comp_${nanoid(8)}`,
    category,
    employeeId,
    hypothesisId,
    description,
    score,
    rankedAt: now(),
  };
  const all = loadCompetitions();
  all.push(entry);
  saveCompetitions(all);
  return entry;
}

/** Rank employees across all competition categories. The skeptical investigator
 *  can outperform the aggressive closer in research value. (GOLDEN NODE §19) */
export interface CompetitionRanking {
  employeeId: string;
  totalScore: number;
  categoriesWon: ResearchCompetitionCategory[];
  entries: number;
}

export function rankEmployees(): CompetitionRanking[] {
  const entries = loadCompetitions();
  const byEmployee = new Map<string, ResearchCompetitionEntry[]>();
  for (const e of entries) {
    if (!byEmployee.has(e.employeeId)) byEmployee.set(e.employeeId, []);
    byEmployee.get(e.employeeId)!.push(e);
  }

  // Determine category winners.
  const categoryWinners = new Map<string, ResearchCompetitionCategory[]>();
  const allCategories: ResearchCompetitionCategory[] = [
    "best_validated_strategy",
    "most_useful_falsification",
    "highest_quality_replication",
    "largest_efficiency_gain",
    "strongest_process_derivative",
    "best_new_channel_hypothesis",
    "most_transferable_workflow",
    "most_accurate_model_challenge",
  ];
  for (const cat of allCategories) {
    const ranked = getCompetitionsByCategory(cat);
    if (ranked.length > 0) {
      const winner = ranked[0].employeeId;
      if (!categoryWinners.has(winner)) categoryWinners.set(winner, []);
      categoryWinners.get(winner)!.push(cat);
    }
  }

  const rankings: CompetitionRanking[] = [];
  for (const [employeeId, empEntries] of byEmployee.entries()) {
    const totalScore = empEntries.reduce((a, e) => a + e.score, 0);
    rankings.push({
      employeeId,
      totalScore,
      categoriesWon: categoryWinners.get(employeeId) || [],
      entries: empEntries.length,
    });
  }
  return rankings.sort((a, b) => b.totalScore - a.totalScore);
}

/** Convenience: get all outcomes (used by competition scoring UI). */
export function getAllOutcomes(): HypothesisOutcome[] {
  return loadHypothesisOutcomes();
}
