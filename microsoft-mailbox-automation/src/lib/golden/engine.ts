import {
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisOutcome,
  HypothesisAttribution,
  HypothesisDerivative,
  GoldenNode,
  AttributionLedgerEntry,
  DiscoveryOpportunityLedger,
  ResearchReliability,
  ProcessDefinition,
  ResearchCompetitionEntry,
  GoldenEngineState,
  SuccessKind,
  InnovationDimension,
  GoldenNodeStage,
  ResearchCompetitionCategory,
} from "@/types";
import {
  loadHypotheses,
  loadPriorArt,
  loadHypothesisAssignments,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
  loadDerivatives,
  loadGoldenNodes,
  loadAttributionLedger,
  loadDiscoveryLedger,
  loadResearchReliability,
  loadProcesses,
  loadCompetitions,
} from "@/lib/config";
import { ensureGoldenSeeded, SEED_EMPLOYEES } from "./seed";
import { allocateHypotheses, contextForEmployee, acceptAssignment, rejectAssignment, modifyAssignment, AllocationContext } from "./allocation";
import { recordOutcome, attributeOutcome, OutcomeInput } from "./outcomes";
import { identifyGoldenNodeCandidate, promoteGoldenNode, recordUsefulFailure, recordSuccessfulReplication, recordStrategyContribution, markAssignmentCandidate } from "./golden-node";
import { proposeDerivative, promoteDerivativeToHypothesis, generateLlmPermutations, generateDerivativesFromAttribution } from "./derivatives";
import { createProcess, modifyProcess, ProcessInput, ProcessModification } from "./process-lab";
import { updateResearchReliability, submitCompetitionEntry, scoreOutcomeForCategory, rankEmployees, auditFairness } from "./ledger";

/**
 * GOLDEN NODE coordinator: the perpetual progress loop.
 *
 * Prior-art research → hypothesis → fair allocation → employee interpretation →
 * process creation → controlled execution → causal attribution → derivative
 * generation → replication → Golden Node → organizational capability →
 * possible new business channel → new hypotheses. (GOLDEN NODE §21)
 */
export class GoldenEngine {
  /** Ensure the store is seeded. */
  initialize(): HypothesisAnatomy[] {
    return ensureGoldenSeeded();
  }

  /** Allocate today's hypotheses for an employee (constrained exploration). */
  allocateForEmployee(employeeId: string): HypothesisAssignment[] {
    const ctx = contextForEmployee(employeeId);
    if (!ctx) return [];
    return allocateHypotheses(ctx);
  }

  /** Allocate for all seed employees. */
  allocateForAll(): HypothesisAssignment[] {
    const all: HypothesisAssignment[] = [];
    for (const emp of SEED_EMPLOYEES) {
      all.push(...this.allocateForEmployee(emp.id));
    }
    return all;
  }

  accept(assignmentId: string) {
    return acceptAssignment(assignmentId);
  }

  reject(assignmentId: string, note?: string) {
    return rejectAssignment(assignmentId, note);
  }

  modify(assignmentId: string, dimension: InnovationDimension, rationale: string) {
    return modifyAssignment(assignmentId, dimension, rationale);
  }

  /** Record an outcome and run attribution. Falsification is a valuable result. */
  executeAndObserve(input: OutcomeInput): {
    outcome: HypothesisOutcome;
    attribution?: HypothesisAttribution;
    derivatives: HypothesisDerivative[];
  } {
    const outcome = recordOutcome(input);
    const attribution = attributeOutcome(outcome.id);

    // Credit useful failures and replications in the discovery ledger.
    if (input.falsified) {
      recordUsefulFailure(outcome.employeeId);
    } else {
      recordSuccessfulReplication(outcome.employeeId);
      recordStrategyContribution(outcome.employeeId);
    }

    // Submit research competition entries based on the outcome.
    this.submitCompetitionForOutcome(outcome);

    // Update research reliability from execution behavior.
    this.updateReliabilityFromOutcome(outcome);

    // Derivatives are generated inside attributeOutcome from unexplained variance;
    // collect any newly generated ones for this hypothesis.
    const derivatives = attribution
      ? loadDerivatives().filter((d) => d.parentHypothesisId === outcome.hypothesisId)
      : [];

    return { outcome, attribution, derivatives };
  }

  private submitCompetitionForOutcome(outcome: HypothesisOutcome): void {
    const categories: ResearchCompetitionCategory[] = [
      "best_validated_strategy",
      "most_useful_falsification",
      "largest_efficiency_gain",
      "strongest_process_derivative",
      "best_new_channel_hypothesis",
      "most_transferable_workflow",
      "most_accurate_model_challenge",
    ];
    for (const category of categories) {
      const score = scoreOutcomeForCategory(outcome, category);
      if (score > 0) {
        submitCompetitionEntry(
          category,
          outcome.employeeId,
          outcome.hypothesisId,
          outcome.outcomeDescription,
          score
        );
      }
    }
  }

  private updateReliabilityFromOutcome(outcome: HypothesisOutcome): void {
    // Effort signals, not activity theater. (GOLDEN NODE §13)
    const evidenceQuality = outcome.metrics.length >= 2 ? 0.85 : 0.6;
    const experimentCompletion = 1;
    const confounderDetection = outcome.contextAtObservation.externalFactors?.length ? 0.8 : 0.6;
    updateResearchReliability(outcome.employeeId, {
      evidenceQuality,
      experimentCompletion,
      confounderDetection,
    });
  }

  /** Identify a Golden Node candidate from accumulated evidence. */
  identifyGoldenNode(
    hypothesisId: string,
    originEmployeeId: string,
    originAssignmentId: string,
    replicationCount: number,
    replicationTerritories: string[]
  ): GoldenNode | undefined {
    const node = identifyGoldenNodeCandidate(hypothesisId, originEmployeeId, originAssignmentId, replicationCount, replicationTerritories);
    if (node) markAssignmentCandidate(originAssignmentId);
    return node;
  }

  promoteGoldenNode(id: string, toStage: GoldenNodeStage, channelName?: string) {
    return promoteGoldenNode(id, toStage, channelName);
  }

  proposeDerivative(
    parentHypothesisId: string,
    claim: string,
    modifiedDimension: InnovationDimension,
    rationale: string,
    proposedByEmployeeId?: string
  ) {
    return proposeDerivative({
      parentHypothesisId,
      claim,
      modifiedDimension,
      origin: "derivative_human",
      proposedByEmployeeId,
      rationale,
    });
  }

  generateLlmPermutations(hypothesisId: string): HypothesisDerivative[] {
    const h = loadHypotheses().find((x) => x.id === hypothesisId);
    if (!h) return [];
    return generateLlmPermutations(h);
  }

  promoteDerivative(derivativeId: string) {
    return promoteDerivativeToHypothesis(derivativeId);
  }

  createProcess(input: ProcessInput) {
    return createProcess(input);
  }

  modifyProcess(processId: string, modification: ProcessModification) {
    return modifyProcess(processId, modification);
  }

  /** Full engine state snapshot. */
  snapshot(): GoldenEngineState {
    return {
      hypotheses: loadHypotheses(),
      priorArt: loadPriorArt(),
      assignments: loadHypothesisAssignments(),
      outcomes: loadHypothesisOutcomes(),
      attributions: loadHypothesisAttributions(),
      derivatives: loadDerivatives(),
      goldenNodes: loadGoldenNodes(),
      attributionLedger: loadAttributionLedger(),
      discoveryLedger: loadDiscoveryLedger(),
      researchReliability: loadResearchReliability(),
      processes: loadProcesses(),
      competitions: loadCompetitions(),
    };
  }

  rankEmployees() {
    return rankEmployees();
  }

  auditFairness() {
    return auditFairness();
  }
}

/** Singleton engine instance for API routes. */
export const goldenEngine = new GoldenEngine();

export { allocateHypotheses, contextForEmployee, SEED_EMPLOYEES };
export type { AllocationContext };
export type { OutcomeInput, ProcessInput, ProcessModification };
export type { SuccessKind };
