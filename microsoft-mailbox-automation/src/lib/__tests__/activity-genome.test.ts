import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  genomeSimilarity,
  evaluateFatigue,
  deriveMode,
  rotateMode,
  detectMastery,
  DEFAULT_GENOME_CONFIG,
  DEFAULT_MASTERY_CONFIG,
} from "../spinor/activity-genome";
import { ActivityGenome, ActivityMode } from "@/types";

function makeGenome(overrides: Partial<ActivityGenome> = {}): ActivityGenome {
  return {
    missionId: "M-1",
    customerType: "physician",
    stakeholder: "cardiology",
    channel: "email",
    taskStructure: "follow_up",
    location: "us_east",
    cognitiveMode: "execution",
    researchQuestion: "does timing matter?",
    skillRequired: "execution",
    automationLevel: 0.2,
    socialInteraction: 0.5,
    timeHorizon: "short",
    collaborationLevel: 0.3,
    uncertaintyLevel: 0.4,
    ...overrides,
  };
}

describe("Activity Genome", () => {
  describe("genomeSimilarity", () => {
    it("returns 1 for identical genomes", () => {
      const g = makeGenome();
      assert.equal(genomeSimilarity(g, g), 1);
    });

    it("returns lower similarity for different genomes", () => {
      const a = makeGenome({ missionId: "A" });
      const b = makeGenome({
        missionId: "B",
        customerType: "pharmacy",
        stakeholder: "oncology",
        channel: "phone",
        taskStructure: "discovery",
        location: "eu_west",
        cognitiveMode: "analysis",
        researchQuestion: "different question",
        skillRequired: "customer_research",
        automationLevel: 0.9,
        socialInteraction: 0.1,
        collaborationLevel: 0.8,
        uncertaintyLevel: 0.9,
      });
      const sim = genomeSimilarity(a, b);
      assert.ok(sim < 0.4, `expected < 0.4, got ${sim}`);
    });

    it("is symmetric", () => {
      const a = makeGenome({ missionId: "A", channel: "email" });
      const b = makeGenome({ missionId: "B", channel: "phone" });
      assert.equal(genomeSimilarity(a, b), genomeSimilarity(b, a));
    });
  });

  describe("deriveMode", () => {
    it("returns experiment_design for high uncertainty + analysis", () => {
      const g = makeGenome({ cognitiveMode: "analysis", uncertaintyLevel: 0.9 });
      assert.equal(deriveMode(g), "experiment_design");
    });

    it("returns automation for high automation level", () => {
      const g = makeGenome({ skillRequired: "automation", automationLevel: 0.9 });
      assert.equal(deriveMode(g), "automation");
    });

    it("defaults to execution", () => {
      const g = makeGenome({ skillRequired: "execution", cognitiveMode: "execution", uncertaintyLevel: 0.3 });
      assert.equal(deriveMode(g), "execution");
    });
  });

  describe("evaluateFatigue", () => {
    it("does not flag fatigue for novel mission", () => {
      const candidate = makeGenome({
        missionId: "C",
        customerType: "pharmacy",
        stakeholder: "oncology",
        channel: "in_person",
        taskStructure: "discovery",
        location: "eu_west",
        cognitiveMode: "analysis",
        researchQuestion: "different question",
        skillRequired: "customer_research",
        automationLevel: 0.9,
        socialInteraction: 0.1,
        collaborationLevel: 0.8,
        uncertaintyLevel: 0.9,
      });
      const recent = [makeGenome({ missionId: "R1" })];
      const result = evaluateFatigue(candidate, recent);
      assert.ok(!result.exceedsFatigueThreshold, `similarity ${result.similarity} exceeded threshold`);
      assert.ok(result.similarity < DEFAULT_GENOME_CONFIG.fatigueThreshold);
    });

    it("flags fatigue when candidate is nearly identical to recent", () => {
      const candidate = makeGenome({ missionId: "C" });
      const recent = [makeGenome({ missionId: "R1" })];
      const result = evaluateFatigue(candidate, recent);
      assert.ok(result.exceedsFatigueThreshold);
      assert.ok(result.similarity >= DEFAULT_GENOME_CONFIG.fatigueThreshold);
    });

    it("rotates mode when fatigue threshold exceeded", () => {
      const candidate = makeGenome({ missionId: "C" });
      const recent = [makeGenome({ missionId: "R1" })];
      const result = evaluateFatigue(candidate, recent);
      assert.notEqual(result.recommendedMode, deriveMode(candidate));
    });

    it("rotates mode after maxConsecutiveSameMode", () => {
      const candidate = makeGenome({ missionId: "C", channel: "different_channel_xyz" });
      const recent = [
        makeGenome({ missionId: "R1" }),
        makeGenome({ missionId: "R2" }),
        makeGenome({ missionId: "R3" }),
      ];
      const result = evaluateFatigue(candidate, recent);
      // Even if not fatigued by similarity, 3 consecutive same mode triggers rotation
      assert.notEqual(result.recommendedMode, deriveMode(candidate));
    });
  });

  describe("rotateMode", () => {
    it("never returns the current mode", () => {
      const result = rotateMode("execution", ["execution", "execution"]);
      assert.notEqual(result, "execution");
    });

    it("prefers least-recently-used mode", () => {
      const recent: ActivityMode[] = ["observation", "observation", "execution"];
      const result = rotateMode("execution", recent);
      // Should pick a mode with 0 recent occurrences
      assert.notEqual(result, "observation");
      assert.notEqual(result, "execution");
    });
  });

  describe("detectMastery", () => {
    it("detects mastery when all conditions met", () => {
      const result = detectMastery({
        missionId: "M-1",
        successCount: 5,
        failureCount: 0,
        qualityVariance: 0.05,
        deviationRate: 0.02,
        judgmentRequired: false,
        inputPredictability: 0.9,
        riskLevel: "low",
        complianceSensitive: false,
        exceptionRate: 0.01,
      });
      assert.ok(result.mastered);
    });

    it("does not detect mastery when success count too low", () => {
      const result = detectMastery({
        missionId: "M-1",
        successCount: 2,
        failureCount: 0,
        qualityVariance: 0.05,
        deviationRate: 0.02,
        judgmentRequired: false,
        inputPredictability: 0.9,
        riskLevel: "low",
        complianceSensitive: false,
        exceptionRate: 0.01,
      });
      assert.ok(!result.mastered);
    });

    it("does not detect mastery when compliance-sensitive", () => {
      const result = detectMastery({
        missionId: "M-1",
        successCount: 5,
        failureCount: 0,
        qualityVariance: 0.05,
        deviationRate: 0.02,
        judgmentRequired: false,
        inputPredictability: 0.9,
        riskLevel: "low",
        complianceSensitive: true,
        exceptionRate: 0.01,
      });
      assert.ok(!result.mastered);
    });

    it("does not detect mastery when judgment required", () => {
      const result = detectMastery({
        missionId: "M-1",
        successCount: 5,
        failureCount: 0,
        qualityVariance: 0.05,
        deviationRate: 0.02,
        judgmentRequired: true,
        inputPredictability: 0.9,
        riskLevel: "low",
        complianceSensitive: false,
        exceptionRate: 0.01,
      });
      assert.ok(!result.mastered);
    });
  });
});
