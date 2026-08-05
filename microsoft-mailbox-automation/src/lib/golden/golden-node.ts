import { nanoid } from "nanoid";
import {
  GoldenNode,
  AttributionLedgerEntry,
  GoldenNodeStage,
  HypothesisAnatomy,
  HypothesisAttribution,
  HypothesisOutcome,
} from "@/types";
import {
  loadGoldenNodes,
  saveGoldenNodes,
  loadAttributionLedger,
  saveAttributionLedger,
  loadHypotheses,
  loadHypothesisAttributions,
  loadHypothesisOutcomes,
  loadHypothesisAssignments,
  saveHypothesisAssignments,
  loadDiscoveryLedger,
  saveDiscoveryLedger,
} from "@/lib/config";
import { getHypothesisPerformance, computeEffectSize } from "./outcomes";
import { llmAssessGoldenNode } from "./llm-client";

const now = () => new Date().toISOString();

export function listGoldenNodes(): GoldenNode[] {
  return loadGoldenNodes();
}

export function getGoldenNodeById(id: string): GoldenNode | undefined {
  return loadGoldenNodes().find((g) => g.id === id);
}

export function getGoldenNodesForEmployee(employeeId: string): GoldenNode[] {
  return loadGoldenNodes().filter((g) => g.originEmployeeId === employeeId);
}

function upsertGoldenNode(g: GoldenNode): void {
  const all = loadGoldenNodes();
  const idx = all.findIndex((x) => x.id === g.id);
  if (idx >= 0) all[idx] = g;
  else all.push(g);
  saveGoldenNodes(all);
}

/** Criteria a hypothesis must meet to be identified as a Golden Node candidate.
 *  Measurable effect + repeatability + portability + defensible mechanism +
 *  reusable process + economic value. (GOLDEN NODE §9) */
export interface GoldenNodeCriteria {
  measurableEffect: boolean;
  repeatability: boolean;
  portability: boolean;
  defensibleMechanism: boolean;
  reusableProcess: boolean;
  economicValue: number;
}

export function evaluateCriteria(
  hypothesis: HypothesisAnatomy,
  outcomes: HypothesisOutcome[],
  attributions: HypothesisAttribution[],
  replicationCount: number
): GoldenNodeCriteria {
  const performance = getHypothesisPerformance(hypothesis.id);
  const supportedOutcomes = outcomes.filter((o) => !o.falsified);
  const avgEffect = performance.averageEffect;

  const measurableEffect = supportedOutcomes.length >= 2 && avgEffect > 0.1;
  const repeatability = replicationCount >= 2 && performance.falsificationCount / Math.max(1, performance.outcomeCount) < 0.3;
  const portability = replicationCount >= 3; // replicated across matched territories
  const defensibleMechanism =
    attributions.some((a) => a.responsibleFactor !== "unresolved" && a.responsibleFactor !== "external_change") &&
    hypothesis.novelComponent !== null;
  const reusableProcess = attributions.some((a) => a.responsibleFactor === "employee_modification" || a.responsibleFactor === "parent_hypothesis");
  const economicValue = estimateEconomicValue(avgEffect, supportedOutcomes.length, replicationCount);

  return {
    measurableEffect,
    repeatability,
    portability,
    defensibleMechanism,
    reusableProcess,
    economicValue,
  };
}

/**
 * LLM-enhanced Golden Node assessment: the LLM evaluates whether the evidence
 * meets the six criteria and recommends a stage. Falls back to the deterministic
 * evaluateCriteria if the LLM is unavailable. (GOLDEN NODE §8)
 */
export async function assessGoldenNodeWithLLM(
  hypothesisId: string,
  replicationCount: number
): Promise<{
  criteria: GoldenNodeCriteria;
  recommendedStage?: GoldenNodeStage;
  llmReasoning?: string;
  llmUsed: boolean;
  llmError?: string;
}> {
  const hypothesis = loadHypotheses().find((h) => h.id === hypothesisId);
  if (!hypothesis) return { criteria: evaluateCriteria(hypothesisId as any, [], [], 0), llmUsed: false };
  const outcomes = loadHypothesisOutcomes().filter((o) => o.hypothesisId === hypothesisId);
  const attributions = loadHypothesisAttributions().filter((a) => a.hypothesisId === hypothesisId);
  const deterministic = evaluateCriteria(hypothesis, outcomes, attributions, replicationCount);
  const observedResult = outcomes.map((o) => o.outcomeDescription).join("; ") || "No outcomes recorded.";

  const llmResult = await llmAssessGoldenNode(hypothesis.claim, observedResult, replicationCount, deterministic.economicValue);
  if (llmResult.used && llmResult.result) {
    const r = llmResult.result;
    const validStages: GoldenNodeStage[] = ["local_success", "rep_owned_process", "replicated_method", "organizational_capability", "productized_service", "independent_channel"];
    const stage = validStages.includes(r.recommendedStage) ? r.recommendedStage as GoldenNodeStage : undefined;
    return {
      criteria: {
        measurableEffect: Boolean(r.measurableEffect),
        repeatability: Boolean(r.repeatability),
        portability: Boolean(r.portability),
        defensibleMechanism: Boolean(r.defensibleMechanism),
        reusableProcess: Boolean(r.reusableProcess),
        economicValue: deterministic.economicValue,
      },
      recommendedStage: stage,
      llmReasoning: r.reasoning,
      llmUsed: true,
    };
  }
  return { criteria: deterministic, llmUsed: false, llmError: llmResult.error };
}

function estimateEconomicValue(avgEffect: number, supportedCount: number, replicationCount: number): number {
  // Deterministic, conservative estimate (no fabricated revenue).
  const base = Math.max(0, avgEffect) * 10000 * Math.max(1, supportedCount);
  return Math.round(base * (1 + replicationCount * 0.2));
}

/** Identify a Golden Node candidate from a hypothesis with sufficient evidence. */
export function identifyGoldenNodeCandidate(
  hypothesisId: string,
  originEmployeeId: string,
  originAssignmentId: string,
  replicationCount: number,
  replicationTerritories: string[]
): GoldenNode | undefined {
  const hypothesis = loadHypotheses().find((h) => h.id === hypothesisId);
  if (!hypothesis) return undefined;
  const outcomes = loadHypothesisOutcomes().filter((o) => o.hypothesisId === hypothesisId);
  const attributions = loadHypothesisAttributions().filter((a) => a.hypothesisId === hypothesisId);
  if (outcomes.length === 0) return undefined;

  const criteria = evaluateCriteria(hypothesis, outcomes, attributions, replicationCount);
  const allCriteriaMet =
    criteria.measurableEffect &&
    criteria.repeatability &&
    criteria.portability &&
    criteria.defensibleMechanism &&
    criteria.reusableProcess;

  const existing = loadGoldenNodes().find((g) => g.hypothesisId === hypothesisId);
  if (existing) {
    // Update stage based on new evidence.
    existing.stage = advanceStage(existing.stage, replicationCount, criteria);
    existing.replicationCount = Math.max(existing.replicationCount, replicationCount);
    existing.replicationTerritories = Array.from(new Set([...existing.replicationTerritories, ...replicationTerritories]));
    existing.economicValue = criteria.economicValue;
    upsertGoldenNode(existing);
    return existing;
  }

  const node: GoldenNode = {
    id: `gn_${nanoid(8)}`,
    hypothesisId,
    originEmployeeId,
    originAssignmentId,
    stage: allCriteriaMet ? "replicated_method" : "local_success",
    claim: hypothesis.claim,
    observedResult: outcomes[0].outcomeDescription,
    primaryMechanism: hypothesis.novelComponent || hypothesis.intervention,
    repContribution: describeRepContribution(attributions),
    replicationCount,
    replicationTerritories,
    measurableEffect: criteria.measurableEffect,
    repeatability: criteria.repeatability,
    portability: criteria.portability,
    defensibleMechanism: criteria.defensibleMechanism,
    reusableProcess: criteria.reusableProcess,
    economicValue: criteria.economicValue,
    economicValueConfidence: Math.min(0.9, attributions.length * 0.15),
    attributionLedgerId: "",
    createdAt: now(),
  };

  // Create the attribution ledger entry so credit survives scaling.
  const ledgerEntry = createAttributionLedgerEntry(node, hypothesis, attributions);
  node.attributionLedgerId = ledgerEntry.id;
  upsertGoldenNode(node);

  // Credit the employee in the discovery ledger.
  creditGoldenNode(originEmployeeId);

  return node;
}

function describeRepContribution(attributions: HypothesisAttribution[]): string {
  const mod = attributions.find((a) => a.responsibleFactor === "employee_modification");
  if (mod) return "Designed a process modification that attribution identifies as the responsible factor.";
  const parent = attributions.find((a) => a.responsibleFactor === "parent_hypothesis");
  if (parent) return "Executed the parent hypothesis faithfully; attribution credits the parent mechanism.";
  return "Executed and observed the hypothesis; attribution partially unresolved.";
}

function createAttributionLedgerEntry(
  node: GoldenNode,
  hypothesis: HypothesisAnatomy,
  attributions: HypothesisAttribution[]
): AttributionLedgerEntry {
  const employeeModifications = attributions
    .filter((a) => a.responsibleFactor === "employee_modification")
    .map((a) => a.reasoning);

  const entry: AttributionLedgerEntry = {
    id: `al_${nanoid(8)}`,
    goldenNodeId: node.id,
    originalHypothesisSource: hypothesis.origin === "research" ? "Prior-art research pipeline" : "Derivative branch",
    assignedEmployeeId: node.originEmployeeId,
    employeeModifications,
    supportingCollaborators: [],
    replicationTeams: node.replicationTerritories,
    automationContributors: [],
    crossFunctionalContributors: [],
    attributionConfidence: attributions.length
      ? attributions.reduce((a, b) => a + b.attributionConfidence, 0) / attributions.length
      : 0,
    economicValueCreated: node.economicValue,
    recognition: deriveRecognition(node, hypothesis),
    createdAt: now(),
  };
  const all = loadAttributionLedger();
  all.push(entry);
  saveAttributionLedger(all);
  return entry;
}

/** Recognition must survive scaling; the platform must not steal employee
 *  innovation and rename it "management best practice". (GOLDEN NODE §18) */
function deriveRecognition(node: GoldenNode, hypothesis: HypothesisAnatomy): string[] {
  const recognition: string[] = [
    `Named process ownership: ${node.primaryMechanism}`,
    "Research reputation credit",
  ];
  if (node.stage === "productized_service" || node.stage === "independent_channel") {
    recognition.push("Formal contributor status for productization");
    recognition.push("Participation in productization under transparent policy");
  }
  if (hypothesis.origin !== "research") {
    recognition.push("Derivative inventor credit");
  }
  return recognition;
}

function creditGoldenNode(employeeId: string): void {
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
  entry.goldenNodeCreditEarned += 1;
  entry.updatedAt = now();
  saveDiscoveryLedger(ledger);
}

/** Advance a Golden Node through its lifecycle stages. */
export function advanceStage(
  current: GoldenNodeStage,
  replicationCount: number,
  criteria: GoldenNodeCriteria
): GoldenNodeStage {
  const order: GoldenNodeStage[] = [
    "hypothesis",
    "local_success",
    "rep_owned_process",
    "replicated_method",
    "organizational_capability",
    "productized_service",
    "independent_channel",
  ];
  const idx = order.indexOf(current);
  // Replication count targets specific stages.
  if (replicationCount >= 7) return order[Math.min(order.indexOf("independent_channel"), Math.max(idx, order.indexOf("organizational_capability")))];
  if (replicationCount >= 3) return order[Math.min(order.indexOf("replicated_method"), Math.max(idx, order.indexOf("replicated_method")))];
  if (criteria.measurableEffect && idx < order.indexOf("rep_owned_process")) {
    return "rep_owned_process";
  }
  return current;
}

/** Promote a Golden Node to a productized service or independent channel. */
export function promoteGoldenNode(id: string, toStage: GoldenNodeStage, channelName?: string): GoldenNode | undefined {
  const node = getGoldenNodeById(id);
  if (!node) return undefined;
  node.stage = toStage;
  node.promotedAt = now();
  if (channelName) node.candidateChannelName = channelName;
  upsertGoldenNode(node);

  // Update attribution ledger recognition.
  const ledger = loadAttributionLedger();
  const entry = ledger.find((l) => l.id === node.attributionLedgerId);
  if (entry) {
    entry.recognition = Array.from(new Set([...entry.recognition, "Leadership of next campaign", "Productization participation"]));
    saveAttributionLedger(ledger);
  }

  return node;
}

export function listAttributionLedger(): AttributionLedgerEntry[] {
  return loadAttributionLedger();
}

export function getAttributionLedgerForNode(goldenNodeId: string): AttributionLedgerEntry | undefined {
  return loadAttributionLedger().find((l) => l.goldenNodeId === goldenNodeId);
}

/** Mark an assignment as a useful failure (falsification has research value). */
export function recordUsefulFailure(employeeId: string): void {
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
  entry.usefulFailuresGenerated += 1;
  entry.updatedAt = now();
  saveDiscoveryLedger(ledger);
}

/** Mark a successful replication for credit. */
export function recordSuccessfulReplication(employeeId: string): void {
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
  entry.successfulReplicationsCompleted += 1;
  entry.updatedAt = now();
  saveDiscoveryLedger(ledger);
}

/** Mark a strategy contribution for credit. */
export function recordStrategyContribution(employeeId: string): void {
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
  entry.strategiesContributed += 1;
  entry.updatedAt = now();
  saveDiscoveryLedger(ledger);
}

// Re-export for engine composition.
export { computeEffectSize };

// Advance assignment state to candidate when a golden node is identified.
export function markAssignmentCandidate(assignmentId: string): void {
  const all = loadHypothesisAssignments();
  const idx = all.findIndex((a) => a.id === assignmentId);
  if (idx >= 0) {
    all[idx].state = "candidate";
    saveHypothesisAssignments(all);
  }
}
