import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideAdmissibility,
  deriveInputFromSpin,
  evidenceTierToAdmissibility,
  canPromoteToGoldenNode,
  DEFAULT_ADMISSIBILITY_CONFIG,
  AdmissibilityInput,
} from "../spinor/admissibility";
import { EvidenceTier, createSPIN, AttributionClaim } from "../spinor/spin";

function baseInput(overrides: Partial<AdmissibilityInput> = {}): AdmissibilityInput {
  return {
    recordId: "REC-1",
    observationCount: 10,
    hasComparison: true,
    executionFidelity: 0.9,
    preRegistered: true,
    hasExplicitTreatmentAndComparison: true,
    hasEligibilityCriteria: true,
    hasAssignmentMethod: true,
    hasFixedPrimaryMetric: true,
    hasObservationWindow: true,
    hasFidelityCapture: true,
    prohibitedVariableChanged: false,
    complianceApproved: true,
    hasUnresolvedCompliance: false,
    claims: [],
    independentReplications: 0,
    experimentCount: 1,
    hasFailureBoundary: false,
    transferabilityDemonstrated: false,
    economicValueExceedsCost: false,
    hasCompleteContributionLedger: false,
    unresolvedConfounders: [],
    ...overrides,
  };
}

function makeClaim(overrides: Partial<AttributionClaim> = {}): AttributionClaim {
  return {
    claimId: "CLM-1",
    experimentId: "EXP-1",
    hypothesisId: "HYP-1",
    outcomeMetric: "conversion",
    outcomeValue: 0.13,
    counterfactualEstimate: 0.1,
    causalEffect: 0.03,
    confidence: 0.9,
    method: "rct",
    evidence: ["evidence-1"],
    segments: ["seg-1"],
    territories: ["territory-1"],
    testedBy: ["tester-1"],
    falsificationSurvived: true,
    significanceLevel: 0.05,
    ...overrides,
  };
}

describe("Admissibility Engine", () => {
  describe("decideAdmissibility", () => {
    it("returns non-admissible observation when no observations exist", () => {
      const decision = decideAdmissibility(baseInput({ observationCount: 0 }));
      assert.equal(decision.level, "observation");
      assert.equal(decision.admissible, false);
    });

    it("returns observation when observations exist but internal signal requirements fail", () => {
      const decision = decideAdmissibility(
        baseInput({ observationCount: 2, hasComparison: false }),
      );
      assert.equal(decision.level, "observation");
      assert.equal(decision.admissible, true);
    });

    it("returns internal_signal when min observations + comparison met but not pre-registered", () => {
      const decision = decideAdmissibility(
        baseInput({ preRegistered: false, hasExplicitTreatmentAndComparison: false }),
      );
      assert.equal(decision.level, "internal_signal");
      assert.equal(decision.admissible, true);
    });

    it("caps at internal_signal when unresolved confounders exist", () => {
      const decision = decideAdmissibility(
        baseInput({ unresolvedConfounders: ["seasonality"] }),
      );
      assert.equal(decision.level, "internal_signal");
      assert.ok(decision.blockingConfounders.includes("seasonality"));
    });

    it("returns controlled_experiment when all controlled requirements met but no replications", () => {
      const decision = decideAdmissibility(baseInput({ independentReplications: 0 }));
      assert.equal(decision.level, "controlled_experiment");
      assert.equal(decision.admissible, true);
    });

    it("returns valid_replication when 1+ independent replications but not golden-node-eligible", () => {
      const decision = decideAdmissibility(
        baseInput({ independentReplications: 1, experimentCount: 2 }),
      );
      assert.equal(decision.level, "valid_replication");
      assert.equal(decision.admissible, true);
    });

    it("returns golden_node_eligible when all requirements met", () => {
      const decision = decideAdmissibility(
        baseInput({
          independentReplications: 2,
          experimentCount: 2,
          claims: [makeClaim({ confidence: 0.9 })],
          hasFailureBoundary: true,
          transferabilityDemonstrated: true,
          economicValueExceedsCost: true,
          hasCompleteContributionLedger: true,
        }),
      );
      assert.equal(decision.level, "golden_node_eligible");
      assert.equal(decision.admissible, true);
    });

    it("stays at valid_replication when confidence below threshold", () => {
      const decision = decideAdmissibility(
        baseInput({
          independentReplications: 2,
          experimentCount: 2,
          claims: [makeClaim({ confidence: 0.5 })],
          hasFailureBoundary: true,
          transferabilityDemonstrated: true,
          economicValueExceedsCost: true,
          hasCompleteContributionLedger: true,
        }),
      );
      assert.equal(decision.level, "valid_replication");
    });

    it("stays at valid_replication when failure boundary missing", () => {
      const decision = decideAdmissibility(
        baseInput({
          independentReplications: 2,
          experimentCount: 2,
          claims: [makeClaim({ confidence: 0.9 })],
          hasFailureBoundary: false,
          transferabilityDemonstrated: true,
          economicValueExceedsCost: true,
          hasCompleteContributionLedger: true,
        }),
      );
      assert.equal(decision.level, "valid_replication");
    });

    it("is deterministic — same inputs produce same level", () => {
      const input = baseInput({ independentReplications: 1, experimentCount: 2 });
      const d1 = decideAdmissibility(input);
      const d2 = decideAdmissibility(input);
      assert.equal(d1.level, d2.level);
      assert.equal(d1.admissible, d2.admissible);
    });

    it("respects configurable thresholds", () => {
      const strictConfig = {
        ...DEFAULT_ADMISSIBILITY_CONFIG,
        minReplicationsGoldenNode: 5,
      };
      const decision = decideAdmissibility(
        baseInput({
          independentReplications: 2,
          experimentCount: 2,
          claims: [makeClaim({ confidence: 0.9 })],
          hasFailureBoundary: true,
          transferabilityDemonstrated: true,
          economicValueExceedsCost: true,
          hasCompleteContributionLedger: true,
        }),
        strictConfig,
      );
      assert.equal(decision.level, "valid_replication");
    });
  });

  describe("evidenceTierToAdmissibility", () => {
    it("maps OBSERVED to observation", () => {
      assert.equal(evidenceTierToAdmissibility(EvidenceTier.OBSERVED), "observation");
    });
    it("maps REPLICATED to valid_replication", () => {
      assert.equal(evidenceTierToAdmissibility(EvidenceTier.REPLICATED), "valid_replication");
    });
    it("maps EXPERIMENTALLY_DEMONSTRATED to controlled_experiment", () => {
      assert.equal(
        evidenceTierToAdmissibility(EvidenceTier.EXPERIMENTALLY_DEMONSTRATED),
        "controlled_experiment",
      );
    });
  });

  describe("canPromoteToGoldenNode", () => {
    it("returns true only for golden_node_eligible", () => {
      const gnDecision = decideAdmissibility(
        baseInput({
          independentReplications: 2,
          experimentCount: 2,
          claims: [makeClaim({ confidence: 0.9 })],
          hasFailureBoundary: true,
          transferabilityDemonstrated: true,
          economicValueExceedsCost: true,
          hasCompleteContributionLedger: true,
        }),
      );
      assert.ok(canPromoteToGoldenNode(gnDecision));

      const lowerDecision = decideAdmissibility(baseInput({ independentReplications: 0 }));
      assert.ok(!canPromoteToGoldenNode(lowerDecision));
    });
  });

  describe("deriveInputFromSpin", () => {
    it("derives input from a SPIN record", () => {
      const spin = createSPIN({
        hypothesisId: "HYP-1",
        employeeOwner: "EMP-1",
        claim: "Test claim",
        intervention: "Intervention A",
        control: "Control B",
        population: "Population X",
        primaryUncertainty: "Will it work?",
        complianceBoundary: "No off-label",
      });
      const input = deriveInputFromSpin(spin, [makeClaim()]);
      assert.equal(input.recordId, spin.spinId);
      assert.ok(input.hasExplicitTreatmentAndComparison);
    });
  });
});
