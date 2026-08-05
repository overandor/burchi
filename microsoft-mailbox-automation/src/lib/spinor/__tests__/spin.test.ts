/**
 * SPIN engine integration tests.
 *
 * Uses Node's built-in test runner (node:test).
 * Run: node --test --import tsx src/lib/spinor/__tests__/spin.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import { strictEqual, notStrictEqual, ok, deepStrictEqual } from "node:assert";
import { createNewSPIN, advanceSPIN, addClaimToSPIN, addReplicationClaim, runReverseTest, loadSpin, loadAllSpins, deleteSpin, getSpinCount, getDashboardStats, dbHealth } from "@/lib/spinor/spin-engine";
import { SPINState, AutomationStatus, EvidenceTier, ContributionRole, createSPIN, computeEvidenceTier, verifyChain, recordModification } from "@/lib/spinor/spin";
import { SPINStateMachine, TransitionContext } from "@/lib/spinor/spin-state-machine";
import { nanoid } from "nanoid";

// Use a temp DB for tests
process.env.SPINOR_DB_PATH = `/tmp/spinor-test-${Date.now()}.db`;

function makeClaim(overrides: Record<string, unknown> = {}) {
  return {
    claimId: `CLM-${nanoid(8).toUpperCase()}`,
    experimentId: "EXP-TEST",
    hypothesisId: "HYP-TEST",
    outcomeMetric: "test_metric",
    outcomeValue: 0.2,
    counterfactualEstimate: 0.05,
    causalEffect: 0.15,
    confidence: 0.92,
    method: "rct" as const,
    evidence: ["controlled"],
    segments: ["enterprise"],
    territories: ["northeast"],
    testedBy: ["emp-001"],
    falsificationSurvived: true,
    significanceLevel: 0.05,
    ...overrides,
  };
}

function makeSpin() {
  return createSPIN({
    hypothesisId: "HYP-1", employeeOwner: "emp-1", claim: "Test claim",
    intervention: "Test intervention", control: "Test control",
    population: "Test population", primaryUncertainty: "Test uncertainty",
    complianceBoundary: "Test boundary",
  });
}

describe("SPIN causal unit", () => {
  it("creates SPIN with initial snapshot", () => {
    const spin = makeSpin();
    strictEqual(spin.state, SPINState.DRAFT);
    strictEqual(spin.snapshots.length, 1);
    ok(spin.snapshots[0].contentDigest.length > 0);
    ok(verifyChain(spin));
  });

  it("records human modification with structured delta", () => {
    const spin = makeSpin();
    const mod = recordModification(spin, "emp-1", {
      timing: { from: "morning", to: "afternoon" },
    }, "Afternoon is better", "HYP-1", "HYP-2");
    strictEqual(spin.modifications.length, 1);
    deepStrictEqual(mod.changedVariables.timing, { from: "morning", to: "afternoon" });
    strictEqual(spin.contributions.length, 1);
    strictEqual(spin.contributions[0].contributorRole, ContributionRole.HUMAN_MODIFIER);
  });

  it("snapshot chain is tamper-evident", () => {
    const spin = makeSpin();
    ok(verifyChain(spin));
    spin.snapshots[0].reason = "tampered";
    ok(!verifyChain(spin));
  });
});

describe("Evidence tier computation", () => {
  it("no claims → observed", () => {
    const result = computeEvidenceTier([]);
    strictEqual(result.tier, EvidenceTier.OBSERVED);
  });

  it("claims but none significant → associated", () => {
    const result = computeEvidenceTier([makeClaim({ falsificationSurvived: false, confidence: 0.3 })]);
    strictEqual(result.tier, EvidenceTier.ASSOCIATED);
  });

  it("significant RCT → experimentally demonstrated", () => {
    const result = computeEvidenceTier([makeClaim()]);
    strictEqual(result.tier, EvidenceTier.EXPERIMENTALLY_DEMONSTRATED);
  });

  it("3+ independent contexts → replicated", () => {
    const claims = [
      makeClaim({ testedBy: ["emp-1"], segments: ["enterprise"] }),
      makeClaim({ testedBy: ["emp-2"], segments: ["hospital"] }),
      makeClaim({ testedBy: ["emp-3"], segments: ["clinic"] }),
    ];
    const result = computeEvidenceTier(claims, 3);
    strictEqual(result.tier, EvidenceTier.REPLICATED);
  });

  it("deterministic", () => {
    const claims = [makeClaim(), makeClaim({ testedBy: ["emp-2"] })];
    const r1 = computeEvidenceTier(claims);
    const r2 = computeEvidenceTier(claims);
    strictEqual(r1.tier, r2.tier);
  });
});

describe("SPIN state machine", () => {
  it("rejects undefined transition", () => {
    const sm = new SPINStateMachine();
    const spin = makeSpin();
    const ctx: TransitionContext = { actorId: "sys", actorRole: "system" };
    const { ok: canOk, reason } = sm.canTransition(spin, SPINState.REPLICATED, ctx);
    ok(!canOk);
    ok(reason.includes("no transition defined"));
  });

  it("rejects unauthorized actor", () => {
    const sm = new SPINStateMachine();
    const spin = makeSpin();
    const ctx: TransitionContext = { actorId: "emp-1", actorRole: "compliance", priorArtChecked: true };
    const { ok: canOk, reason } = sm.canTransition(spin, SPINState.PRIOR_ART_CHECKED, ctx);
    ok(!canOk);
    ok(reason.includes("not authorized"));
  });

  it("promotion triggers reverse test scheduling", () => {
    const sm = new SPINStateMachine();
    const spin = makeSpin();
    spin.state = SPINState.AUTOMATED;
    spin.automationStatus = AutomationStatus.SUPERVISED_AUTOMATION;
    const ctx: TransitionContext = { actorId: "sys", actorRole: "system" };
    sm.transition(spin, SPINState.REVERSE_TEST_REQUIRED, ctx);
    notStrictEqual(spin.reverseTest, null);
    strictEqual(spin.reverseTest!.status, "scheduled");
  });
});

describe("SPIN persistence", () => {
  it("create, load, and delete SPIN", () => {
    const spin = createNewSPIN({
      hypothesisId: "HYP-PERSIST", employeeOwner: "emp-test", claim: "persist test",
      intervention: "i", control: "c", population: "p", primaryUncertainty: "u", complianceBoundary: "b",
    });
    const loaded = loadSpin(spin.spinId);
    notStrictEqual(loaded, null);
    strictEqual(loaded!.spinId, spin.spinId);
    strictEqual(loaded!.claim, "persist test");

    const countBefore = getSpinCount();
    deleteSpin(spin.spinId);
    strictEqual(getSpinCount(), countBefore - 1);
  });

  it("dashboard stats", () => {
    const stats = getDashboardStats();
    ok("totalSpins" in stats);
    ok("stateDistribution" in stats);
    ok("chainIntegrityOk" in stats);
  });

  it("db health", () => {
    const health = dbHealth();
    strictEqual(health.ok, true);
    ok(health.path.includes("spinor"));
  });
});
