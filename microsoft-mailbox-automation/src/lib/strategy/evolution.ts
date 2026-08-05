import { nanoid } from "nanoid";
import {
  StrategyEvolutionProposal,
  StrategyGenome,
  StrategyComponent,
  StrategyExecutionPattern,
  StrategyContextCondition,
  EvidenceLevel,
} from "@/types";
import {
  loadStrategyEvolution,
  saveStrategyEvolution,
  saveStrategies,
} from "@/lib/config";
import { ensureStrategiesSeeded } from "@/lib/strategy/library";
import { getStrategyPerformance } from "@/lib/strategy/attribution";

const now = () => new Date().toISOString();

// ─── Evolution Store ───────────────────────────────────────────────

export function listProposals(): StrategyEvolutionProposal[] {
  return loadStrategyEvolution();
}

export function getProposalById(id: string): StrategyEvolutionProposal | undefined {
  return loadStrategyEvolution().find((p) => p.id === id);
}

function saveProposal(proposal: StrategyEvolutionProposal): void {
  const all = loadStrategyEvolution();
  const idx = all.findIndex((p) => p.id === proposal.id);
  if (idx >= 0) {
    all[idx] = proposal;
  } else {
    all.push(proposal);
  }
  saveStrategyEvolution(all);
}

// ─── Component Decomposition ───────────────────────────────────────

export interface DecomposedComponent {
  component: StrategyComponent;
  sourceStrategyId: string;
  sourceStrategyName: string;
  performanceScore: number;
}

export function decomposeStrategy(strategyId: string): DecomposedComponent[] {
  const strategies = ensureStrategiesSeeded();
  const strategy = strategies.find((s) => s.id === strategyId);
  if (!strategy) return [];

  const perf = getStrategyPerformance(strategyId);
  const performanceScore = perf ? perf.averageContribution * perf.successRate : 0;

  return strategy.components.map((component) => ({
    component: { ...component },
    sourceStrategyId: strategy.id,
    sourceStrategyName: strategy.name,
    performanceScore,
  }));
}

// ─── Component Recombination ───────────────────────────────────────

export function proposeRecombination(
  parentStrategyIds: string[],
  rationale: string,
  expectedImprovement: string
): StrategyEvolutionProposal {
  const strategies = ensureStrategiesSeeded();
  const parents = parentStrategyIds
    .map((id) => strategies.find((s) => s.id === id))
    .filter((s): s is StrategyGenome => s !== undefined);

  if (parents.length === 0) {
    throw new Error("No valid parent strategies found for recombination");
  }

  // Decompose all parents and select best-performing components
  const allComponents: DecomposedComponent[] = [];
  for (const parent of parents) {
    allComponents.push(...decomposeStrategy(parent.id));
  }

  // Sort by performance score descending, take top components
  const sortedComponents = allComponents.sort((a, b) => b.performanceScore - a.performanceScore);

  // Select unique components (by name) up to 5
  const seenNames = new Set<string>();
  const selectedComponents: StrategyComponent[] = [];
  for (const dc of sortedComponents) {
    if (!seenNames.has(dc.component.name) && selectedComponents.length < 5) {
      seenNames.add(dc.component.name);
      selectedComponents.push({
        ...dc.component,
        id: nanoid(10),
      });
    }
  }

  // Merge execution patterns from parents
  const mergedPattern: StrategyExecutionPattern = {
    stepOrder: dedupe(parents.flatMap((p) => p.executionPattern.stepOrder)),
    toolsUsed: dedupe(parents.flatMap((p) => p.executionPattern.toolsUsed)),
    timeAllocation: parents[0].executionPattern.timeAllocation,
    decisionRules: dedupe(parents.flatMap((p) => p.executionPattern.decisionRules)),
  };

  // Merge applicable context from parents
  const mergedContext: StrategyContextCondition[] = [];
  const contextKeys = new Set<string>();
  for (const parent of parents) {
    for (const c of parent.applicableContext) {
      const key = `${c.field}_${c.operator}_${JSON.stringify(c.value)}`;
      if (!contextKeys.has(key)) {
        contextKeys.add(key);
        mergedContext.push({ ...c });
      }
    }
  }

  const proposal: StrategyEvolutionProposal = {
    id: nanoid(12),
    parentStrategyIds,
    proposedComponents: selectedComponents,
    proposedExecutionPattern: mergedPattern,
    proposedContext: mergedContext,
    rationale,
    expectedImprovement,
    status: "proposed",
    complianceValidated: false,
    proposedAt: now(),
  };

  saveProposal(proposal);
  return proposal;
}

// ─── Proposal Validation & Deployment ──────────────────────────────

export function validateProposal(id: string): StrategyEvolutionProposal | undefined {
  const proposal = getProposalById(id);
  if (!proposal) return undefined;

  // Compliance validation: check that no component involves external communication,
  // claim modification, or patient-level targeting
  const complianceFlags: string[] = [];
  for (const comp of proposal.proposedComponents) {
    const nameLower = comp.name.toLowerCase();
    const descLower = comp.description.toLowerCase();
    if (nameLower.includes("claim") || descLower.includes("claim")) {
      complianceFlags.push(`Component "${comp.name}" may involve claims - requires compliance review.`);
    }
    if (descLower.includes("patient-level") || descLower.includes("patient level")) {
      complianceFlags.push(`Component "${comp.name}" may involve patient-level targeting - prohibited.`);
    }
    if (descLower.includes("unapproved") || descLower.includes("off-label")) {
      complianceFlags.push(`Component "${comp.name}" may involve unapproved/off-label content - prohibited.`);
    }
  }

  const complianceValidated = complianceFlags.length === 0;

  const updated: StrategyEvolutionProposal = {
    ...proposal,
    status: complianceValidated ? "validated" : "rejected",
    complianceValidated,
    validatedAt: now(),
  };

  saveProposal(updated);
  return updated;
}

export function deployProposal(id: string): StrategyGenome | undefined {
  const proposal = getProposalById(id);
  if (!proposal || proposal.status !== "validated" || !proposal.complianceValidated) {
    return undefined;
  }

  const parentStrategies = proposal.parentStrategyIds
    .map((pid) => ensureStrategiesSeeded().find((s) => s.id === pid))
    .filter((s): s is StrategyGenome => s !== undefined);

  if (parentStrategies.length === 0) return undefined;

  // Determine domain from most common parent domain
  const domainCounts: Record<string, number> = {};
  for (const p of parentStrategies) {
    domainCounts[p.domain] = (domainCounts[p.domain] || 0) + 1;
  }
  const domain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as StrategyGenome["domain"];

  // Merge expected outcomes from parents
  const mergedOutcomes = parentStrategies[0].expectedOutcomes.map((o) => ({ ...o, observed: 0 }));

  const newGenome: StrategyGenome = {
    id: nanoid(12),
    name: `Evolved Strategy from ${parentStrategies.map((p) => p.name).join(" + ")}`,
    description: `Recombined strategy. ${proposal.rationale}`,
    domain,
    strategyClass: "experimental",
    components: proposal.proposedComponents,
    applicableContext: proposal.proposedContext,
    executionPattern: proposal.proposedExecutionPattern,
    expectedOutcomes: mergedOutcomes,
    evidenceLevel: "unresolved",
    evidenceCount: 0,
    parentIds: proposal.parentStrategyIds,
    childIds: [],
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    deprecated: false,
    complianceValidated: true,
    complianceNotes: `Evolved from validated proposal ${proposal.id}. Compliance checked at validation time.`,
  };

  // Save new strategy
  const allStrategies = ensureStrategiesSeeded();
  allStrategies.push(newGenome);

  // Update parent childIds
  for (const pid of proposal.parentStrategyIds) {
    const idx = allStrategies.findIndex((s) => s.id === pid);
    if (idx >= 0) {
      allStrategies[idx].childIds.push(newGenome.id);
    }
  }

  saveStrategies(allStrategies);

  // Update proposal status
  const updatedProposal: StrategyEvolutionProposal = {
    ...proposal,
    status: "deployed",
  };
  saveProposal(updatedProposal);

  return newGenome;
}

export function rejectProposal(id: string): StrategyEvolutionProposal | undefined {
  const proposal = getProposalById(id);
  if (!proposal) return undefined;
  const updated: StrategyEvolutionProposal = {
    ...proposal,
    status: "rejected",
    validatedAt: now(),
  };
  saveProposal(updated);
  return updated;
}

// ─── Helpers ───────────────────────────────────────────────────────

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ─── Auto-Evolution: Find Best Candidates ──────────────────────────

export interface EvolutionCandidate {
  strategyId: string;
  strategyName: string;
  reason: string;
  performanceScore: number;
}

export function findEvolutionCandidates(): EvolutionCandidate[] {
  const strategies = ensureStrategiesSeeded().filter((s) => !s.deprecated);
  const candidates: EvolutionCandidate[] = [];

  for (const strategy of strategies) {
    const perf = getStrategyPerformance(strategy.id);
    if (!perf) continue;

    const score = perf.averageContribution * perf.successRate;

    // High performers: good candidates for recombination with others
    if (score > 0.3 && perf.totalOutcomes >= 3) {
      candidates.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        reason: `High performance (contribution: ${perf.averageContribution}, success: ${perf.successRate}, outcomes: ${perf.totalOutcomes})`,
        performanceScore: score,
      });
    }

    // Low performers with unresolved evidence: candidates for decomposition and improvement
    if (score < 0.1 && perf.totalOutcomes >= 2 && strategy.evidenceLevel === "unresolved") {
      candidates.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        reason: `Low performance, needs improvement (contribution: ${perf.averageContribution}, outcomes: ${perf.totalOutcomes})`,
        performanceScore: score,
      });
    }
  }

  return candidates.sort((a, b) => b.performanceScore - a.performanceScore);
}
