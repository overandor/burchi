/**
 * Demo seed — creates a complete end-to-end SPIN lifecycle so the
 * deployed app has real data on first load.
 *
 * Lifecycle: DRAFT → PRIOR_ART_CHECKED → NOVELTY_QUALIFIED → ELIGIBLE →
 * ASSIGNED → PREREGISTERED → EXECUTING → OBSERVED → ATTRIBUTED →
 * REPLICATION_PENDING → REPLICATED → GOLDEN_NODE_CANDIDATE →
 * SYSTEMIZATION_PENDING → AUTOMATED → REVERSE_TEST_REQUIRED →
 * ADVERSARIAL_EXECUTION → REVALIDATED → RESEARCH
 *
 * Also seeds a second SPIN that is mid-execution and a third that
 * failed its reverse test (NARROWED).
 */

import { nanoid } from "nanoid";
import {
  SPINState,
  AttributionClaim,
  AutomationStatus,
  EvidenceTier,
  ContributionRole,
  createNewSPIN,
  advanceSPIN,
  addClaimToSPIN,
  addReplicationClaim,
  runReverseTest,
  loadAllSpins,
  getSpinCount,
  getStateMachine,
} from "./spin-engine";
import { TransitionContext } from "./spin-state-machine";
import { saveSpin, loadSpin } from "./spin-db";

function makeClaim(params: Partial<AttributionClaim> & { hypothesisId: string; experimentId: string }): AttributionClaim {
  return {
    claimId: `CLM-${nanoid(10).toUpperCase()}`,
    outcomeMetric: params.outcomeMetric || "response_rate",
    outcomeValue: params.outcomeValue ?? 0.18,
    counterfactualEstimate: params.counterfactualEstimate ?? 0.06,
    causalEffect: params.causalEffect ?? 0.12,
    confidence: params.confidence ?? 0.92,
    method: params.method || "rct",
    evidence: params.evidence || ["controlled comparison", "pre-registered outcome"],
    segments: params.segments || ["enterprise"],
    territories: params.territories || ["northeast"],
    testedBy: params.testedBy || ["emp-001"],
    falsificationSurvived: params.falsificationSurvived ?? true,
    significanceLevel: params.significanceLevel ?? 0.05,
    ...params,
  } as AttributionClaim;
}

export function seedDemoSPINs(): { created: number; skipped: boolean } {
  // Don't re-seed if data already exists
  if (getSpinCount() > 0) {
    return { created: 0, skipped: true };
  }

  let created = 0;

  // =====================================================================
  // SPIN 1: Complete successful lifecycle (revalidated)
  // =====================================================================
  const spin1 = createNewSPIN({
    hypothesisId: "HYP-DEMO-001",
    employeeOwner: "emp-001",
    claim: "Sending a compliance pre-check summary 48 hours before a field visit reduces compliance violations by 30% in enterprise accounts",
    intervention: "48-hour compliance pre-check summary email",
    control: "No pre-check summary (standard visit protocol)",
    population: "Enterprise pharma accounts in northeast territory",
    primaryUncertainty: "Whether the pre-check effect is driven by rep preparation or customer awareness",
    complianceBoundary: "Must not reference specific products or off-label uses in the pre-check summary",
  });

  // Set prior art
  spin1.priorArt.testedInMarket = false;
  spin1.priorArt.testedInAdjacentIndustries = true;
  spin1.priorArt.adjacentSupportSummary = "Adjacent SaaS industry shows 15-25% reduction in compliance incidents with pre-visit checklists";
  spin1.priorArt.sourceDomains = ["saas-compliance.com", "fieldops-research.org"];
  spin1.priorArt.responsibleComponent = "Pre-visit preparation ritual";
  spin1.priorArt.requiredConditions = ["Rep has access to compliance checklist", "48-hour window is feasible"];
  spin1.priorArt.risksAndConfounders = ["Seasonal compliance cycles", "Rep experience level", "Account complexity"];
  spin1.priorArt.genuinelyUnknown = ["Effect in regulated pharma field execution with FDA constraints"];
  spin1.priorArt.noveltyDelta = "No prior test of pre-visit compliance summaries in pharma field execution with FDA compliance constraints";
  saveSpin(spin1);

  // DRAFT → PRIOR_ART_CHECKED
  advanceSPIN(spin1.spinId, SPINState.PRIOR_ART_CHECKED, {
    actorId: "system",
    actorRole: "researcher",
    priorArtChecked: true,
  });

  // → NOVELTY_QUALIFIED
  advanceSPIN(spin1.spinId, SPINState.NOVELTY_QUALIFIED, {
    actorId: "system",
    actorRole: "researcher",
    noveltyQualified: true,
  });

  // → ELIGIBLE
  advanceSPIN(spin1.spinId, SPINState.ELIGIBLE, {
    actorId: "system",
    actorRole: "manager",
  });

  // → ASSIGNED
  const s1 = loadSpin(spin1.spinId)!;
  s1.missionIds.push("MSN-DEMO-001");
  saveSpin(s1);
  advanceSPIN(spin1.spinId, SPINState.ASSIGNED, {
    actorId: "system",
    actorRole: "manager",
  });

  // → PREREGISTERED (employee accepts as-is, no modification)
  advanceSPIN(spin1.spinId, SPINState.PREREGISTERED, {
    actorId: "emp-001",
    actorRole: "employee",
    preRegistered: true,
  });

  // → EXECUTING
  const s1b = loadSpin(spin1.spinId)!;
  s1b.experimentIds.push("EXP-DEMO-001");
  saveSpin(s1b);
  advanceSPIN(spin1.spinId, SPINState.EXECUTING, {
    actorId: "emp-001",
    actorRole: "employee",
  });

  // → OBSERVED (add outcome claim)
  const claim1 = makeClaim({
    hypothesisId: "HYP-DEMO-001",
    experimentId: "EXP-DEMO-001",
    outcomeValue: 0.18,
    counterfactualEstimate: 0.06,
    causalEffect: 0.12,
    confidence: 0.93,
    method: "rct",
    testedBy: ["emp-001"],
    segments: ["enterprise"],
    territories: ["northeast"],
  });
  addClaimToSPIN(spin1.spinId, claim1);
  advanceSPIN(spin1.spinId, SPINState.OBSERVED, {
    actorId: "system",
    actorRole: "system",
    claims: [claim1],
  });

  // → ATTRIBUTED
  advanceSPIN(spin1.spinId, SPINState.ATTRIBUTED, {
    actorId: "system",
    actorRole: "analyst",
    claims: [claim1],
  });

  // → REPLICATION_PENDING
  advanceSPIN(spin1.spinId, SPINState.REPLICATION_PENDING, {
    actorId: "system",
    actorRole: "system",
  });

  // Add replication claims from different testers/segments
  const rep1 = makeClaim({
    claimId: `CLM-${nanoid(10).toUpperCase()}`,
    hypothesisId: "HYP-DEMO-001",
    experimentId: "EXP-DEMO-002",
    testedBy: ["emp-002"],
    segments: ["hospital"],
    territories: ["west"],
    outcomeValue: 0.15,
    causalEffect: 0.10,
    confidence: 0.89,
  });
  const rep2 = makeClaim({
    claimId: `CLM-${nanoid(10).toUpperCase()}`,
    hypothesisId: "HYP-DEMO-001",
    experimentId: "EXP-DEMO-003",
    testedBy: ["emp-003"],
    segments: ["clinic"],
    territories: ["south"],
    outcomeValue: 0.20,
    causalEffect: 0.14,
    confidence: 0.91,
  });
  addReplicationClaim(spin1.spinId, rep1);
  addReplicationClaim(spin1.spinId, rep2);

  // → REPLICATED
  advanceSPIN(spin1.spinId, SPINState.REPLICATED, {
    actorId: "system",
    actorRole: "replication_executor",
    replicationClaims: [claim1, rep1, rep2],
  });

  // → GOLDEN_NODE_CANDIDATE
  advanceSPIN(spin1.spinId, SPINState.GOLDEN_NODE_CANDIDATE, {
    actorId: "system",
    actorRole: "manager",
    mechanism: "Pre-visit preparation ritual activates rep's compliance checklist review, reducing oversight gaps",
  });

  // → SYSTEMIZATION_PENDING
  advanceSPIN(spin1.spinId, SPINState.SYSTEMIZATION_PENDING, {
    actorId: "system",
    actorRole: "manager",
  });

  // → AUTOMATED
  const s1c = loadSpin(spin1.spinId)!;
  s1c.automationStatus = AutomationStatus.SUPERVISED_AUTOMATION;
  s1c.automationLayerId = "auto-compliance-precheck-v1";
  saveSpin(s1c);
  advanceSPIN(spin1.spinId, SPINState.AUTOMATED, {
    actorId: "system_builder",
    actorRole: "system_builder",
    automationReady: true,
    automationLayerId: "auto-compliance-precheck-v1",
  });

  // → REVERSE_TEST_REQUIRED (triggers automatic reverse test scheduling)
  advanceSPIN(spin1.spinId, SPINState.REVERSE_TEST_REQUIRED, {
    actorId: "system",
    actorRole: "system",
  });

  // → ADVERSARIAL_EXECUTION
  advanceSPIN(spin1.spinId, SPINState.ADVERSARIAL_EXECUTION, {
    actorId: "adversarial_tester",
    actorRole: "adversarial_tester",
  });

  // Reverse test passes
  runReverseTest(spin1.spinId, true, {
    replicated_in: "midwest territory, hospital segment",
    confounders_checked: ["seasonal", "rep_experience", "account_complexity"],
    falsification_survived: true,
  });

  // → REVALIDATED
  advanceSPIN(spin1.spinId, SPINState.REVALIDATED, {
    actorId: "adversarial_tester",
    actorRole: "adversarial_tester",
    reverseTestPassed: true,
  });

  // → RESEARCH (renewal)
  advanceSPIN(spin1.spinId, SPINState.RESEARCH, {
    actorId: "system",
    actorRole: "system",
  });

  created++;

  // =====================================================================
  // SPIN 2: Mid-execution (currently EXECUTING)
  // =====================================================================
  const spin2 = createNewSPIN({
    hypothesisId: "HYP-DEMO-002",
    employeeOwner: "emp-002",
    claim: "Personalized follow-up cadence based on engagement signals increases meeting acceptance rate by 20%",
    intervention: "Signal-adaptive follow-up cadence (3/7/14 day intervals based on open/click signals)",
    control: "Fixed 7-day follow-up cadence",
    population: "Mid-market accounts in west territory",
    primaryUncertainty: "Whether engagement signals are reliable enough to drive cadence decisions",
    complianceBoundary: "Must not exceed 3 follow-ups per 30 days per account",
  });

  spin2.priorArt.testedInAdjacentIndustries = true;
  spin2.priorArt.adjacentSupportSummary = "B2B SaaS research shows 18% lift from signal-adaptive cadence";
  spin2.priorArt.sourceDomains = ["b2b-sales-research.com"];
  spin2.priorArt.noveltyDelta = "No prior test in pharma field execution with compliance-constrained follow-up limits";
  saveSpin(spin2);

  advanceSPIN(spin2.spinId, SPINState.PRIOR_ART_CHECKED, { actorId: "system", actorRole: "researcher", priorArtChecked: true });
  advanceSPIN(spin2.spinId, SPINState.NOVELTY_QUALIFIED, { actorId: "system", actorRole: "researcher", noveltyQualified: true });
  advanceSPIN(spin2.spinId, SPINState.ELIGIBLE, { actorId: "system", actorRole: "manager" });

  const s2 = loadSpin(spin2.spinId)!;
  s2.missionIds.push("MSN-DEMO-002");
  saveSpin(s2);
  advanceSPIN(spin2.spinId, SPINState.ASSIGNED, { actorId: "system", actorRole: "manager" });

  // Employee modifies the hypothesis
  const s2b = loadSpin(spin2.spinId)!;
  saveSpin(s2b);

  // Record a human modification
  const { recordModification } = require("./spin");
  const s2c = loadSpin(spin2.spinId)!;
  recordModification(s2c, "emp-002", {
    timing: { from: "3/7/14 day", to: "2/5/10 day" },
    channel: { from: "email only", to: "email + linkedin" },
  }, "Faster initial follow-up may capture intent while it's high; LinkedIn provides a secondary channel", "HYP-DEMO-002", "HYP-DEMO-002-MOD1");
  saveSpin(s2c);

  advanceSPIN(spin2.spinId, SPINState.HUMAN_MODIFIED, { actorId: "emp-002", actorRole: "employee" });
  advanceSPIN(spin2.spinId, SPINState.PREREGISTERED, { actorId: "emp-002", actorRole: "employee", preRegistered: true });

  const s2d = loadSpin(spin2.spinId)!;
  s2d.experimentIds.push("EXP-DEMO-004");
  saveSpin(s2d);
  advanceSPIN(spin2.spinId, SPINState.EXECUTING, { actorId: "emp-002", actorRole: "employee" });

  created++;

  // =====================================================================
  // SPIN 3: Failed reverse test (NARROWED)
  // =====================================================================
  const spin3 = createNewSPIN({
    hypothesisId: "HYP-DEMO-003",
    employeeOwner: "emp-003",
    claim: "Pre-meeting brief with physician's staff increases physician face-time by 15 minutes",
    intervention: "Staff pre-brief document sent 24 hours before meeting",
    control: "No pre-brief (standard meeting protocol)",
    population: "Physician offices in south territory",
    primaryUncertainty: "Whether staff pre-brief actually translates to physician availability",
    complianceBoundary: "Pre-brief must not contain promotional claims",
  });

  spin3.priorArt.testedInAdjacentIndustries = false;
  spin3.priorArt.genuinelyUnknown = ["Effect of staff mediation on physician time allocation in pharma"];
  spin3.priorArt.noveltyDelta = "Completely novel — no prior research on staff-mediated physician time extension";
  saveSpin(spin3);

  advanceSPIN(spin3.spinId, SPINState.PRIOR_ART_CHECKED, { actorId: "system", actorRole: "researcher", priorArtChecked: true });
  advanceSPIN(spin3.spinId, SPINState.NOVELTY_QUALIFIED, { actorId: "system", actorRole: "researcher", noveltyQualified: true });
  advanceSPIN(spin3.spinId, SPINState.ELIGIBLE, { actorId: "system", actorRole: "manager" });

  const s3 = loadSpin(spin3.spinId)!;
  s3.missionIds.push("MSN-DEMO-003");
  saveSpin(s3);
  advanceSPIN(spin3.spinId, SPINState.ASSIGNED, { actorId: "system", actorRole: "manager" });
  advanceSPIN(spin3.spinId, SPINState.PREREGISTERED, { actorId: "emp-003", actorRole: "employee", preRegistered: true });

  const s3b = loadSpin(spin3.spinId)!;
  s3b.experimentIds.push("EXP-DEMO-005");
  saveSpin(s3b);
  advanceSPIN(spin3.spinId, SPINState.EXECUTING, { actorId: "emp-003", actorRole: "employee" });

  const claim3 = makeClaim({
    hypothesisId: "HYP-DEMO-003",
    experimentId: "EXP-DEMO-005",
    outcomeValue: 12,
    counterfactualEstimate: 2,
    causalEffect: 10,
    confidence: 0.88,
    method: "diff_in_diff",
    testedBy: ["emp-003"],
    segments: ["physician_office"],
    territories: ["south"],
  });
  addClaimToSPIN(spin3.spinId, claim3);
  advanceSPIN(spin3.spinId, SPINState.OBSERVED, { actorId: "system", actorRole: "system", claims: [claim3] });
  advanceSPIN(spin3.spinId, SPINState.ATTRIBUTED, { actorId: "system", actorRole: "analyst", claims: [claim3] });
  advanceSPIN(spin3.spinId, SPINState.REPLICATION_PENDING, { actorId: "system", actorRole: "system" });

  const rep3a = makeClaim({
    claimId: `CLM-${nanoid(10).toUpperCase()}`,
    hypothesisId: "HYP-DEMO-003",
    experimentId: "EXP-DEMO-006",
    testedBy: ["emp-004"],
    segments: ["physician_office"],
    territories: ["midwest"],
    outcomeValue: 8,
    causalEffect: 6,
    confidence: 0.85,
  });
  const rep3b = makeClaim({
    claimId: `CLM-${nanoid(10).toUpperCase()}`,
    hypothesisId: "HYP-DEMO-003",
    experimentId: "EXP-DEMO-007",
    testedBy: ["emp-005"],
    segments: ["physician_office"],
    territories: ["west"],
    outcomeValue: 7,
    causalEffect: 5,
    confidence: 0.86,
  });
  addReplicationClaim(spin3.spinId, rep3a);
  addReplicationClaim(spin3.spinId, rep3b);

  advanceSPIN(spin3.spinId, SPINState.REPLICATED, {
    actorId: "system",
    actorRole: "replication_executor",
    replicationClaims: [claim3, rep3a, rep3b],
  });

  advanceSPIN(spin3.spinId, SPINState.GOLDEN_NODE_CANDIDATE, {
    actorId: "system",
    actorRole: "manager",
    mechanism: "Staff pre-brief creates expectation of longer meeting, staff adjusts physician schedule",
  });

  advanceSPIN(spin3.spinId, SPINState.SYSTEMIZATION_PENDING, { actorId: "system", actorRole: "manager" });

  const s3c = loadSpin(spin3.spinId)!;
  s3c.automationStatus = AutomationStatus.SUPERVISED_AUTOMATION;
  s3c.automationLayerId = "auto-staff-prebrief-v1";
  saveSpin(s3c);
  advanceSPIN(spin3.spinId, SPINState.AUTOMATED, {
    actorId: "system_builder",
    actorRole: "system_builder",
    automationReady: true,
    automationLayerId: "auto-staff-prebrief-v1",
  });

  advanceSPIN(spin3.spinId, SPINState.REVERSE_TEST_REQUIRED, { actorId: "system", actorRole: "system" });
  advanceSPIN(spin3.spinId, SPINState.ADVERSARIAL_EXECUTION, { actorId: "adversarial_tester", actorRole: "adversarial_tester" });

  // Reverse test FAILS — effect narrows
  runReverseTest(spin3.spinId, false, {
    finding: "Effect only holds in small practices (<5 physicians). In large group practices, staff pre-brief has no effect on physician face-time.",
    confounder: "Practice size moderates the effect — original experiment was in small practices only",
  });

  advanceSPIN(spin3.spinId, SPINState.NARROWED, {
    actorId: "adversarial_tester",
    actorRole: "adversarial_tester",
    reverseTestPassed: false,
  });

  created++;

  return { created, skipped: false };
}
