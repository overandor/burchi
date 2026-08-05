import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import { ensureStrategiesSeeded, getSeedStrategies, getStrategyById, upsertStrategy } from "../strategy/library";
import {
  assignStrategies,
  getAssignmentsForEmployee,
  getPortfolio,
  acceptAssignment,
  modifyAssignment,
  rejectAssignment,
  computeExploreRatio,
  shouldExplore,
  EmployeeContext,
} from "../strategy/assignment";
import {
  recordOutcome,
  attributeOutcome,
  listOutcomes,
  listAttributions,
  getStrategyPerformance,
} from "../strategy/attribution";
import {
  proposeRecombination,
  validateProposal,
  deployProposal,
  decomposeStrategy,
  findEvolutionCandidates,
  listProposals,
} from "../strategy/evolution";
import {
  loadStrategies,
  saveStrategies,
  loadStrategyAssignments,
  saveStrategyAssignments,
  loadStrategyOutcomes,
  saveStrategyOutcomes,
  loadStrategyAttributions,
  saveStrategyAttributions,
  loadStrategyEvolution,
  saveStrategyEvolution,
} from "../config";

const dataDir = path.join(process.cwd(), "data");
const strategiesFile = path.join(dataDir, "strategies.json");
const assignmentsFile = path.join(dataDir, "strategy-assignments.json");
const outcomesFile = path.join(dataDir, "strategy-outcomes.json");
const attributionsFile = path.join(dataDir, "strategy-attributions.json");
const evolutionFile = path.join(dataDir, "strategy-evolution.json");

const filesToBackup = [
  { file: strategiesFile, backup: null as string | null, existed: false },
  { file: assignmentsFile, backup: null as string | null, existed: false },
  { file: outcomesFile, backup: null as string | null, existed: false },
  { file: attributionsFile, backup: null as string | null, existed: false },
  { file: evolutionFile, backup: null as string | null, existed: false },
];

before(() => {
  for (const f of filesToBackup) {
    f.existed = fs.existsSync(f.file);
    if (f.existed) {
      f.backup = fs.readFileSync(f.file, "utf-8");
    }
  }
  // Clean state for tests
  saveStrategies([]);
  saveStrategyAssignments([]);
  saveStrategyOutcomes([]);
  saveStrategyAttributions([]);
  saveStrategyEvolution([]);
});

after(() => {
  for (const f of filesToBackup) {
    try {
      if (f.existed) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(f.file, f.backup ?? "", "utf-8");
      } else if (fs.existsSync(f.file)) {
        fs.unlinkSync(f.file);
      }
    } catch {
      // ignore
    }
  }
});

// ─── Strategy Library Tests ────────────────────────────────────────

test("ensureStrategiesSeeded seeds the library when empty", () => {
  saveStrategies([]);
  const strategies = ensureStrategiesSeeded();
  assert.ok(strategies.length >= 6, "Should seed at least 6 strategies");
  assert.ok(strategies.every((s) => s.complianceValidated), "All seed strategies should be compliance-validated");
});

test("getStrategyById returns the correct strategy", () => {
  ensureStrategiesSeeded();
  const strategy = getStrategyById("strat_territory_cluster");
  assert.ok(strategy, "Should find strat_territory_cluster");
  assert.strictEqual(strategy!.name, "Territory Cluster Routing");
});

test("getStrategyById returns undefined for unknown id", () => {
  ensureStrategiesSeeded();
  const strategy = getStrategyById("nonexistent");
  assert.strictEqual(strategy, undefined);
});

test("upsertStrategy updates existing strategy", () => {
  ensureStrategiesSeeded();
  const strategy = getStrategyById("strat_territory_cluster")!;
  const updated = { ...strategy, description: "Updated description" };
  upsertStrategy(updated);
  const refetched = getStrategyById("strat_territory_cluster");
  assert.strictEqual(refetched!.description, "Updated description");
});

// ─── Assignment Engine Tests ───────────────────────────────────────

test("assignStrategies assigns strategies for a field representative", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_1",
    role: "field_representative",
    territoryType: "geographic",
    workloadLevel: "high",
  };
  const assignments = assignStrategies(ctx);
  assert.ok(assignments.length > 0, "Should assign at least one strategy");
  assert.ok(
    assignments.every((a) => a.employeeId === "emp_test_1"),
    "All assignments should be for the test employee"
  );
});

test("assignStrategies does not duplicate existing assignments", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_2",
    role: "field_representative",
  };
  const first = assignStrategies(ctx);
  const second = assignStrategies(ctx);
  const firstIds = new Set(first.map((a) => a.strategyId));
  const duplicateFound = second.some((a) => firstIds.has(a.strategyId));
  assert.ok(!duplicateFound, "Should not assign duplicate strategies on second call");
});

test("getPortfolio returns a valid portfolio", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_3",
    role: "regional_manager",
  };
  assignStrategies(ctx);
  const portfolio = getPortfolio("emp_test_3", "regional_manager");
  assert.strictEqual(portfolio.employeeId, "emp_test_3");
  assert.ok(portfolio.activeAssignments.length > 0, "Portfolio should have active assignments");
  assert.ok(portfolio.exploreRatio >= 0 && portfolio.exploreRatio <= 1, "Explore ratio should be 0-1");
  assert.ok(portfolio.exploitRatio >= 0 && portfolio.exploitRatio <= 1, "Exploit ratio should be 0-1");
});

test("computeExploreRatio returns 0 for empty assignments", () => {
  assert.strictEqual(computeExploreRatio([]), 0);
});

test("shouldExplore returns true when explore ratio is low", () => {
  const assignments = [
    { strategyClass: "proven", assignmentReason: "exploit", id: "1", strategyId: "s1", employeeId: "e1", employeeRole: "field_representative", assignedAt: "", active: true, employeeAccepted: false, employeeModified: false, expectedOutcomeMetrics: [], contextSnapshot: {}, confidenceAtAssignment: 0.8 },
  ] as any[];
  assert.ok(shouldExplore(assignments, "experimental"), "Should explore when explore ratio is 0");
});

test("shouldExplore returns false when explore ratio is high", () => {
  const assignments = [
    { strategyClass: "experimental", assignmentReason: "explore", id: "1", strategyId: "s1", employeeId: "e1", employeeRole: "field_representative", assignedAt: "", active: true, employeeAccepted: false, employeeModified: false, expectedOutcomeMetrics: [], contextSnapshot: {}, confidenceAtAssignment: 0.3 },
    { strategyClass: "experimental", assignmentReason: "explore", id: "2", strategyId: "s2", employeeId: "e1", employeeRole: "field_representative", assignedAt: "", active: true, employeeAccepted: false, employeeModified: false, expectedOutcomeMetrics: [], contextSnapshot: {}, confidenceAtAssignment: 0.3 },
    { strategyClass: "experimental", assignmentReason: "explore", id: "3", strategyId: "s3", employeeId: "e1", employeeRole: "field_representative", assignedAt: "", active: true, employeeAccepted: false, employeeModified: false, expectedOutcomeMetrics: [], contextSnapshot: {}, confidenceAtAssignment: 0.3 },
  ] as any[];
  assert.ok(!shouldExplore(assignments, "experimental"), "Should not explore when explore ratio is already high");
});

test("acceptAssignment marks assignment as accepted", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_4",
    role: "field_representative",
  };
  const assignments = assignStrategies(ctx);
  const accepted = acceptAssignment(assignments[0].id);
  assert.ok(accepted?.employeeAccepted, "Assignment should be marked as accepted");
});

test("modifyAssignment marks assignment as modified with notes", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_5",
    role: "field_representative",
  };
  const assignments = assignStrategies(ctx);
  const modified = modifyAssignment(assignments[0].id, "Adjusted cadence to biweekly");
  assert.ok(modified?.employeeModified, "Assignment should be marked as modified");
  assert.strictEqual(modified!.modificationNotes, "Adjusted cadence to biweekly");
});

test("rejectAssignment deactivates assignment", () => {
  saveStrategyAssignments([]);
  const ctx: EmployeeContext = {
    employeeId: "emp_test_6",
    role: "field_representative",
  };
  const assignments = assignStrategies(ctx);
  const rejected = rejectAssignment(assignments[0].id);
  assert.ok(!rejected?.active, "Assignment should be deactivated");
  assert.ok(rejected?.deactivatedAt, "Deactivated timestamp should be set");
});

// ─── Attribution Engine Tests ──────────────────────────────────────

test("recordOutcome stores an outcome event", () => {
  const event = recordOutcome({
    assignmentId: "asgn_test_1",
    strategyId: "strat_territory_cluster",
    employeeId: "emp_attr_1",
    employeeRole: "field_representative",
    outcomeDescription: "Increased daily visit count",
    outcomeMetrics: [
      { metric: "accounts_visited_per_day", value: 8, unit: "count", baseline: 6 },
    ],
    contextAtObservation: { workloadLevel: "high" },
  });
  assert.ok(event.id, "Outcome event should have an id");
  assert.ok(event.observedAt, "Outcome event should have observedAt");
  const outcomes = listOutcomes();
  assert.ok(outcomes.some((o) => o.id === event.id), "Outcome should be in the list");
});

test("attributeOutcome returns attribution for a recorded outcome", () => {
  saveStrategyAssignments([]);
  saveStrategyOutcomes([]);
  saveStrategyAttributions([]);

  // Set up an assignment
  const ctx: EmployeeContext = {
    employeeId: "emp_attr_2",
    role: "field_representative",
  };
  const assignments = assignStrategies(ctx);
  assert.ok(assignments.length > 0, "Need assignments for attribution test");

  // Record an outcome
  const event = recordOutcome({
    assignmentId: assignments[0].id,
    strategyId: assignments[0].strategyId,
    employeeId: "emp_attr_2",
    employeeRole: "field_representative",
    outcomeDescription: "Improved territory coverage",
    outcomeMetrics: [
      { metric: "accounts_visited_per_day", value: 9, unit: "count", baseline: 6 },
    ],
    contextAtObservation: { concurrentStrategies: [assignments[0].strategyId] },
  });

  // Attribute
  const attribution = attributeOutcome(event.id);
  assert.ok(attribution, "Should get an attribution result");
  assert.ok(attribution!.contributions.length > 0, "Should have at least one contribution");
  assert.ok(attribution!.unexplainedVariance >= 0, "Unexplained variance should be non-negative");
  assert.ok(attribution!.overallConfidence >= 0 && attribution!.overallConfidence <= 1, "Confidence should be 0-1");
});

test("attributeOutcome returns undefined for nonexistent outcome", () => {
  const result = attributeOutcome("nonexistent_id");
  assert.strictEqual(result, undefined);
});

test("getStrategyPerformance returns summary for a strategy", () => {
  ensureStrategiesSeeded();
  const perf = getStrategyPerformance("strat_territory_cluster");
  assert.ok(perf, "Should get performance summary");
  assert.strictEqual(perf!.strategyId, "strat_territory_cluster");
  assert.ok(perf!.totalOutcomes >= 0, "Total outcomes should be non-negative");
});

// ─── Evolution Engine Tests ────────────────────────────────────────

test("decomposeStrategy returns components from a strategy", () => {
  ensureStrategiesSeeded();
  const components = decomposeStrategy("strat_territory_cluster");
  assert.ok(components.length > 0, "Should decompose into components");
  assert.ok(components.every((c) => c.component.id), "Each component should have an id");
  assert.ok(components.every((c) => c.sourceStrategyId === "strat_territory_cluster"), "Components should reference source strategy");
});

test("proposeRecombination creates a proposal from parent strategies", () => {
  ensureStrategiesSeeded();
  const proposal = proposeRecombination(
    ["strat_territory_cluster", "strat_data_driven_targeting"],
    "Combine geographic clustering with data-driven scoring for better targeting",
    "Expected 15% improvement in target accuracy"
  );
  assert.ok(proposal.id, "Proposal should have an id");
  assert.strictEqual(proposal.status, "proposed");
  assert.ok(proposal.proposedComponents.length > 0, "Proposal should have components");
  assert.strictEqual(proposal.parentStrategyIds.length, 2);
});

test("validateProposal validates a clean proposal", () => {
  ensureStrategiesSeeded();
  const proposal = proposeRecombination(
    ["strat_territory_cluster", "strat_time_block_discipline"],
    "Combine routing with time management",
    "Expected 10% improvement in proactive time"
  );
  const validated = validateProposal(proposal.id);
  assert.ok(validated, "Should get validated proposal");
  assert.strictEqual(validated!.status, "validated");
  assert.ok(validated!.complianceValidated, "Clean proposal should pass compliance");
});

test("validateProposal rejects a proposal with compliance issues", () => {
  ensureStrategiesSeeded();
  // Create a proposal with a component that triggers compliance flags
  const proposal = proposeRecombination(
    ["strat_proactive_compliance"],
    "Test compliance rejection",
    "Expected test behavior"
  );
  // Manually inject a problematic component
  const all = loadStrategyEvolution();
  const idx = all.findIndex((p) => p.id === proposal.id);
  all[idx].proposedComponents.push({
    id: "comp_test_bad",
    name: "Patient-level targeting",
    description: "Target individual patients based on prescribing data",
    category: "tactic",
    parameters: {},
  });
  saveStrategyEvolution(all);

  const validated = validateProposal(proposal.id);
  assert.strictEqual(validated!.status, "rejected");
  assert.ok(!validated!.complianceValidated, "Proposal with compliance issues should be rejected");
});

test("deployProposal creates a new strategy genome from a validated proposal", () => {
  ensureStrategiesSeeded();
  const proposal = proposeRecombination(
    ["strat_territory_cluster", "strat_stakeholder_matrix"],
    "Combine routing with stakeholder management",
    "Expected 20% improvement in coverage"
  );
  const validated = validateProposal(proposal.id);
  assert.strictEqual(validated!.status, "validated");

  const deployed = deployProposal(proposal.id);
  assert.ok(deployed, "Should get a deployed strategy genome");
  assert.strictEqual(deployed!.strategyClass, "experimental");
  assert.strictEqual(deployed!.evidenceLevel, "unresolved");
  assert.ok(deployed!.parentIds.includes("strat_territory_cluster"), "Should list parent strategies");

  // Verify proposal status updated
  const proposals = listProposals();
  const updated = proposals.find((p) => p.id === proposal.id);
  assert.strictEqual(updated!.status, "deployed");
});

test("findEvolutionCandidates returns candidates based on performance", () => {
  ensureStrategiesSeeded();
  const candidates = findEvolutionCandidates();
  assert.ok(Array.isArray(candidates), "Should return an array");
  // With no outcome data, candidates may be empty - that's fine
});
