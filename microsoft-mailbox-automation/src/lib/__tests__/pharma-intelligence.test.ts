import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  heuristicPICO,
  heuristicAdversarial,
  heuristicMechanism,
  heuristicHypothesis,
  scanPharmacovigilance,
  predictClaimResonance,
} from "../pharma-intelligence";

describe("Pharma Intelligence — local (no-LLM) analysis", () => {
  // ─── PICO Extraction ──────────────────────────────────────────────
  describe("heuristicPICO", () => {
    test("extracts claims from email with drug name and outcome", () => {
      const claims = heuristicPICO(
        "Biktarvy study results",
        "Our Phase 3 RCT shows Biktarvy improves viral suppression in treatment-naive patients compared to Descovy."
      );
      assert.ok(claims.length > 0, "Should extract at least one claim");
      assert.ok(claims[0].intervention.length > 0);
      assert.ok(claims[0].outcome.length > 0);
      assert.ok(claims[0].population.includes("treatment-naive"));
    });

    test("detects evidence level from text", () => {
      const claims = heuristicPICO(
        "Meta-analysis results",
        "A systematic review and meta-analysis shows Keytruda improves overall survival."
      );
      assert.ok(claims.length > 0);
      assert.equal(claims[0].evidenceLevel, "systematic-review");
    });

    test("returns empty array for email with no scientific content", () => {
      const claims = heuristicPICO(
        "Lunch tomorrow?",
        "Hey, want to grab lunch tomorrow at noon?"
      );
      assert.equal(claims.length, 0);
    });
  });

  // ─── Adversarial Self-Testing ─────────────────────────────────────
  describe("heuristicAdversarial", () => {
    test("generates different counterarguments for different messages", () => {
      const result1 = heuristicAdversarial(
        "Our data shows Biktarvy has superior efficacy over Descovy in treatment-naive patients."
      );
      const result2 = heuristicAdversarial(
        "This drug cures everything with no side effects. 100% guaranteed."
      );
      assert.notEqual(result1.counterargument, result2.counterargument,
        "Different messages must produce different counterarguments");
    });

    test("flags missing safety profile", () => {
      const result = heuristicAdversarial(
        "Biktarvy demonstrates 95% viral suppression in treatment-naive patients."
      );
      assert.ok(result.vulnerabilities.some(v => v.includes("safety")),
        "Should flag missing safety profile");
    });

    test("flags missing comparator", () => {
      const result = heuristicAdversarial(
        "Biktarvy demonstrates 95% viral suppression. The data is from a Phase 3 RCT."
      );
      assert.ok(result.vulnerabilities.some(v => v.includes("comparator") || v.includes("alternative")),
        "Should flag missing comparator");
    });

    test("detects restricted terms", () => {
      const result = heuristicAdversarial(
        "This is a breakthrough cure that is 100% guaranteed with no side effects."
      );
      assert.ok(result.vulnerabilities.some(v => v.includes("restricted") || v.includes("compliant")),
        "Should flag restricted/non-compliant terminology");
    });

    test("scores are in valid range", () => {
      const result = heuristicAdversarial("Some outreach message about a drug.");
      assert.ok(result.originalScore >= 0 && result.originalScore <= 100);
      assert.ok(result.counterScore >= 0 && result.counterScore <= 100);
    });

    test("provides actionable rebuttal", () => {
      const result = heuristicAdversarial(
        "Our drug is better than the competitor. Trust me."
      );
      assert.ok(result.rebuttal.length > 10, "Rebuttal should be actionable");
    });
  });

  // ─── Mechanism Isolation ──────────────────────────────────────────
  describe("heuristicMechanism", () => {
    test("analyzes actual email content", () => {
      const result = heuristicMechanism({
        subject: "Phase 3 RCT data: Biktarvy 95% suppression rate",
        from: "medical.affairs@gilead.com",
        date: "2026-08-15T09:00:00Z",
        body: "Key results from our Phase 3 trial:\n- 95% viral suppression\n- p<0.001 vs comparator\n\nSchedule a meeting to discuss.",
      });
      assert.ok(result.components.length > 0);
      assert.ok(result.components.some(c => c.component === "scientific-claim" && c.contribution > 10),
        "Should weight scientific content heavily when trial data present");
      assert.ok(result.components.some(c => c.component === "cta"),
        "Should detect the call-to-action");
      assert.equal(result.isolationMethod, "local content analysis (no LLM)");
    });

    test("contributions sum to approximately 100", () => {
      const result = heuristicMechanism({
        subject: "Test",
        from: "test@test.com",
        date: "2026-08-15T09:00:00Z",
        body: "Test body",
      });
      const total = result.components.reduce((sum, c) => sum + c.contribution, 0);
      assert.ok(total >= 95 && total <= 105, `Contributions should sum to ~100, got ${total}`);
    });

    test("penalizes no-reply sender", () => {
      const result = heuristicMechanism({
        subject: "Test",
        from: "no-reply@company.com",
        date: "2026-08-15T09:00:00Z",
        body: "Test body",
      });
      const senderComponent = result.components.find(c => c.component === "sender");
      assert.ok(senderComponent && senderComponent.contribution < 15,
        "No-reply sender should have low contribution");
    });
  });

  // ─── Hypothesis Generation ────────────────────────────────────────
  describe("heuristicHypothesis", () => {
    test("generates different hypotheses for different emails", () => {
      const h1 = heuristicHypothesis(
        "Formulary review",
        "Aligning Biktarvy outreach to P&T committee formulary review cycles."
      );
      const h2 = heuristicHypothesis(
        "Schedule a meeting",
        "Please schedule a meeting with Dr. Chen to discuss the data."
      );
      assert.notEqual(h1.hypothesis, h2.hypothesis,
        "Different emails should produce different hypotheses");
    });

    test("detects formulary context", () => {
      const h = heuristicHypothesis(
        "Formulary review",
        "Aligning outreach to P&T committee formulary review cycles increases approval."
      );
      assert.ok(h.hypothesis.includes("formulary"), "Should detect formulary context");
    });

    test("detects meeting context", () => {
      const h = heuristicHypothesis(
        "Meeting request",
        "Please schedule a meeting with Dr. Chen next week."
      );
      assert.ok(h.primaryMetric.includes("meeting"), "Should detect meeting context");
    });
  });

  // ─── Pharmacovigilance ────────────────────────────────────────────
  describe("scanPharmacovigilance", () => {
    test("detects adverse events", () => {
      const scan = scanPharmacovigilance(
        "Patient report",
        "The patient experienced a serious adverse event including hospitalization."
      );
      assert.ok(scan.adverseEvents.length > 0, "Should detect adverse events");
    });

    test("detects restricted terms", () => {
      const scan = scanPharmacovigilance(
        "Breakthrough cure",
        "This is a breakthrough cure that is 100% guaranteed."
      );
      assert.ok(scan.restrictedTerms.length > 0, "Should detect restricted terms");
    });

    test("detects off-label mentions", () => {
      const scan = scanPharmacovigilance(
        "Off-label use",
        "This off-label use has shown promising results."
      );
      assert.ok(scan.offLabelMentions.length > 0, "Should detect off-label mentions");
    });

    test("clean email returns empty findings", () => {
      const scan = scanPharmacovigilance(
        "Lunch tomorrow",
        "Hey, want to grab lunch?"
      );
      assert.equal(scan.adverseEvents.length, 0);
      assert.equal(scan.restrictedTerms.length, 0);
      assert.equal(scan.offLabelMentions.length, 0);
    });
  });
});
