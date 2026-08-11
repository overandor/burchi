import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createGauntletRun,
  stage1ClaimDissection,
  stage2PriorArtSweep,
  stage3EvidenceIntegrity,
  stage4NoveltyExtraction,
  stage5ConfounderAttack,
  stage6ExperimentalDesign,
  stage7FieldExecution,
  stage8CausalReveal,
  stage9DerivativeGeneration,
  runPreExecutionGauntlet,
  gauntletSummary,
  computeEffect,
  computeExecutionFidelity,
  validateClaim,
  validateDesign,
  validateEvidenceIntegrity,
  STAGE_ORDER,
} from "../spinor/gauntlet";
import {
  DissectedClaim,
  EvidenceIntegrityReport,
  ExperimentalDesign,
  GauntletConfounder,
  CausalReveal,
} from "@/types";

function validClaim(): DissectedClaim {
  return {
    population: "US cardiologists",
    intervention: "async digital follow-up",
    comparison: "standard rep visit",
    outcome: "response rate",
    timePeriod: "2 weeks",
    mechanism: "reduced friction",
    risk: "low",
    falsificationCondition: "no difference in response rate",
  };
}

function validEvidence(): EvidenceIntegrityReport {
  return {
    baseline: 0.1,
    observed: 0.13,
    absoluteChange: 0.03,
    relativeChange: 0.3,
    sampleSize: 100,
    confidenceInterval: [0.01, 0.05],
    controlMethod: "historical baseline",
    population: "US cardiologists",
    timeWindow: "2 weeks",
    replications: 0,
    interventionCost: "$500",
    negativeOutcomes: [],
    missingData: [],
    knownLimitations: ["single territory"],
    complete: true,
  };
}

function validDesign(): ExperimentalDesign {
  return {
    eligiblePopulation: "US cardiologists with email",
    exclusionCriteria: ["no email"],
    treatmentCondition: "async follow-up",
    comparisonCondition: "standard visit",
    assignmentMethod: "stratified random",
    sampleTarget: 100,
    primaryMetric: "response rate",
    secondaryMetrics: ["time to response"],
    stoppingConditions: ["n=100"],
    observationWindow: "2 weeks",
    allowedDeviations: ["timing ±1 day"],
    complianceRestrictions: ["no off-label"],
    attributionPlan: "diff-in-diff",
    minimumInstrumentation: ["CRM log"],
    failureEscalationRules: ["escalate if <50% data"],
  };
}

function validConfounders(): GauntletConfounder[] {
  return [
    { description: "seasonality", status: "controlled", linkedExperiment: true },
    { description: "territory bias", status: "unresolved", linkedExperiment: true },
  ];
}

function validReveal(): CausalReveal {
  return {
    classification: "promising",
    observedResult: "13% vs 10% baseline",
    absoluteEffect: 0.03,
    relativeEffect: 0.3,
    likelyContributors: ["timing", "channel"],
    counterfactualEstimate: 0.1,
    confidence: 0.85,
    confounders: validConfounders(),
    portability: "medium",
    failureBoundaries: ["only tested in US East"],
    cost: "$500",
    burden: "low",
    customerValue: "faster response",
    nextResearchQuestion: "Does it transfer to US West?",
  };
}

describe("Research Gauntlet", () => {
  describe("createGauntletRun", () => {
    it("creates a run with 9 pending stages", () => {
      const run = createGauntletRun("HYP-1");
      assert.equal(run.stages.length, 9);
      assert.equal(run.currentStage, "claim_dissection");
      assert.ok(!run.complete);
      assert.equal(run.hypothesisId, "HYP-1");
    });
  });

  describe("computeEffect", () => {
    it("computes absolute and relative change", () => {
      const { absolute, relative } = computeEffect(0.1, 0.13);
      assert.equal(absolute, 0.03);
      assert.equal(relative, 0.3);
    });

    it("returns 0 relative when baseline is 0", () => {
      const { absolute, relative } = computeEffect(0, 0.05);
      assert.equal(absolute, 0.05);
      assert.equal(relative, 0);
    });
  });

  describe("validateClaim", () => {
    it("validates a complete claim", () => {
      const { valid, missing } = validateClaim(validClaim());
      assert.ok(valid);
      assert.equal(missing.length, 0);
    });

    it("rejects a claim missing fields", () => {
      const claim = validClaim();
      claim.population = "";
      const { valid, missing } = validateClaim(claim);
      assert.ok(!valid);
      assert.ok(missing.includes("population"));
    });
  });

  describe("validateEvidenceIntegrity", () => {
    it("validates complete evidence", () => {
      const { valid } = validateEvidenceIntegrity(validEvidence());
      assert.ok(valid);
    });

    it("rejects evidence missing baseline", () => {
      const report = validEvidence();
      report.baseline = null;
      const { valid, issues } = validateEvidenceIntegrity(report);
      assert.ok(!valid);
      assert.ok(issues.some((i) => i.includes("baseline")));
    });
  });

  describe("validateDesign", () => {
    it("validates a complete design", () => {
      const { valid } = validateDesign(validDesign());
      assert.ok(valid);
    });

    it("rejects design with zero sample target", () => {
      const design = validDesign();
      design.sampleTarget = 0;
      const { valid, missing } = validateDesign(design);
      assert.ok(!valid);
    });
  });

  describe("computeExecutionFidelity", () => {
    it("returns 1 for clean execution", () => {
      const fidelity = computeExecutionFidelity({
        assignedProtocol: "p",
        approvedProtocol: "p",
        actualExecuted: "p",
        changedVariables: [],
        deviations: [],
        humanEffort: "high",
        automatedEffort: "low",
        customerResponses: [],
        negativeOutcomes: [],
        complaints: [],
        optOuts: 0,
        externalEvents: [],
        missingObservations: [],
        complianceIncidents: [],
      });
      assert.equal(fidelity, 1);
    });

    it("reduces fidelity with deviations", () => {
      const fidelity = computeExecutionFidelity({
        assignedProtocol: "p",
        approvedProtocol: "p",
        actualExecuted: "p",
        changedVariables: [],
        deviations: ["d1", "d2"],
        humanEffort: "high",
        automatedEffort: "low",
        customerResponses: [],
        negativeOutcomes: [],
        complaints: [],
        optOuts: 0,
        externalEvents: [],
        missingObservations: [],
        complianceIncidents: [],
      });
      assert.ok(fidelity < 1);
      assert.ok(fidelity > 0);
    });

    it("heavily penalizes compliance incidents", () => {
      const fidelity = computeExecutionFidelity({
        assignedProtocol: "p",
        approvedProtocol: "p",
        actualExecuted: "p",
        changedVariables: [],
        deviations: [],
        humanEffort: "high",
        automatedEffort: "low",
        customerResponses: [],
        negativeOutcomes: [],
        complaints: [],
        optOuts: 0,
        externalEvents: [],
        missingObservations: [],
        complianceIncidents: ["incident-1"],
      });
      assert.ok(fidelity <= 0.7);
    });
  });

  describe("stage1ClaimDissection", () => {
    it("passes a valid claim", () => {
      const run = createGauntletRun("HYP-1");
      stage1ClaimDissection(run, validClaim());
      assert.equal(run.stages[0].status, "passed");
      assert.equal(run.currentStage, "prior_art_sweep");
      assert.ok(run.dissectedClaim);
    });

    it("requires revision for incomplete claim", () => {
      const run = createGauntletRun("HYP-1");
      const claim = validClaim();
      claim.falsificationCondition = "";
      stage1ClaimDissection(run, claim);
      assert.equal(run.stages[0].status, "revision_required");
      assert.equal(run.currentStage, "claim_dissection");
    });
  });

  describe("stage2PriorArtSweep", () => {
    it("passes with sources", () => {
      const run = createGauntletRun("HYP-1");
      stage1ClaimDissection(run, validClaim());
      stage2PriorArtSweep(run, {
        evidenceClass: "plausible",
        sources: ["pubmed"],
        negativeResults: [],
        abandonedMethods: [],
        regulatoryRestrictions: [],
        summary: "Adjacent support found",
      });
      assert.equal(run.stages[1].status, "passed");
    });

    it("requires revision with no sources", () => {
      const run = createGauntletRun("HYP-1");
      stage1ClaimDissection(run, validClaim());
      stage2PriorArtSweep(run, {
        evidenceClass: "untested",
        sources: [],
        negativeResults: [],
        abandonedMethods: [],
        regulatoryRestrictions: [],
        summary: "",
      });
      assert.equal(run.stages[1].status, "revision_required");
    });
  });

  describe("stage5ConfounderAttack", () => {
    it("requires at least one confounder", () => {
      const run = createGauntletRun("HYP-1");
      stage1ClaimDissection(run, validClaim());
      stage2PriorArtSweep(run, {
        evidenceClass: "plausible",
        sources: ["s"],
        negativeResults: [],
        abandonedMethods: [],
        regulatoryRestrictions: [],
        summary: "ok",
      });
      stage3EvidenceIntegrity(run, validEvidence());
      stage4NoveltyExtraction(run, {
        noveltyDimensions: ["timing"],
        experimentalVariable: "follow-up timing",
        familiarityNote: "mostly familiar",
      });
      stage5ConfounderAttack(run, []);
      assert.equal(run.stages[4].status, "revision_required");
    });
  });

  describe("stage7FieldExecution", () => {
    it("rejects on compliance incident", () => {
      const run = createGauntletRun("HYP-1");
      // Advance to field_execution stage
      run.currentStage = "field_execution";
      stage7FieldExecution(run, {
        assignedProtocol: "p",
        approvedProtocol: "p",
        actualExecuted: "p",
        changedVariables: [],
        deviations: [],
        humanEffort: "high",
        automatedEffort: "low",
        customerResponses: [],
        negativeOutcomes: [],
        complaints: [],
        optOuts: 0,
        externalEvents: [],
        missingObservations: [],
        complianceIncidents: ["off-label"],
      });
      assert.equal(run.stages[6].status, "rejected");
    });
  });

  describe("stage8CausalReveal", () => {
    it("rejects compliance_blocked classification", () => {
      const run = createGauntletRun("HYP-1");
      run.currentStage = "causal_reveal";
      const reveal = validReveal();
      reveal.classification = "compliance_blocked";
      stage8CausalReveal(run, reveal);
      assert.equal(run.stages[7].status, "rejected");
    });
  });

  describe("runPreExecutionGauntlet", () => {
    it("runs stages 1-6 in sequence", () => {
      const run = runPreExecutionGauntlet("HYP-1", {
        claim: validClaim(),
        priorArt: {
          evidenceClass: "plausible",
          sources: ["pubmed"],
          negativeResults: [],
          abandonedMethods: [],
          regulatoryRestrictions: [],
          summary: "ok",
        },
        evidence: validEvidence(),
        novelty: {
          noveltyDimensions: ["timing"],
          experimentalVariable: "follow-up timing",
          familiarityNote: "familiar",
        },
        confounders: validConfounders(),
        design: validDesign(),
      });
      assert.equal(run.stages[5].status, "passed");
      assert.equal(run.currentStage, "field_execution");
    });

    it("halts at stage 1 if claim invalid", () => {
      const claim = validClaim();
      claim.population = "";
      const run = runPreExecutionGauntlet("HYP-1", {
        claim,
        priorArt: {
          evidenceClass: "plausible",
          sources: ["s"],
          negativeResults: [],
          abandonedMethods: [],
          regulatoryRestrictions: [],
          summary: "ok",
        },
        evidence: validEvidence(),
        novelty: {
          noveltyDimensions: [],
          experimentalVariable: "x",
          familiarityNote: "",
        },
        confounders: validConfounders(),
        design: validDesign(),
      });
      assert.equal(run.stages[0].status, "revision_required");
      assert.equal(run.currentStage, "claim_dissection");
    });
  });

  describe("gauntletSummary", () => {
    it("reports completion state", () => {
      const run = runPreExecutionGauntlet("HYP-1", {
        claim: validClaim(),
        priorArt: {
          evidenceClass: "plausible",
          sources: ["s"],
          negativeResults: [],
          abandonedMethods: [],
          regulatoryRestrictions: [],
          summary: "ok",
        },
        evidence: validEvidence(),
        novelty: {
          noveltyDimensions: ["timing"],
          experimentalVariable: "timing",
          familiarityNote: "",
        },
        confounders: validConfounders(),
        design: validDesign(),
      });
      const summary = gauntletSummary(run);
      assert.equal(summary.passedCount, 6);
      assert.ok(!summary.complete);
    });
  });

  describe("stage9DerivativeGeneration", () => {
    it("completes the gauntlet", () => {
      const run = createGauntletRun("HYP-1");
      run.currentStage = "derivative_generation";
      stage9DerivativeGeneration(run, []);
      assert.ok(run.complete);
      assert.equal(run.stages[8].status, "passed");
    });
  });
});
