import { test } from "node:test";
import assert from "node:assert";
import { generateFollowUps, classifyRisk, draftEmail, generateActionPlan } from "../followup/executor";
import { InteractionCapture, TerritoryAccount, FollowUpAction } from "@/types";

const account: TerritoryAccount = {
  id: "acc-1", hcpName: "Jane Smith", specialty: "Oncology", territory: "West-1",
  funnelState: "barrier_identified", barrier: "formulary",
  eligiblePatientOpportunity: 0.7, unmetInfoNeed: 0.6, accessProbability: 0.4,
  expectedResponsiveness: 0.5, evidenceConfidence: 0.7, fieldTimeRequired: 1,
  operationalFriction: 0.3, uncertaintyRisk: 0.2, priorityScore: 0.65,
  reasonCodes: [], recommendedAction: { action: "share formulary info", rationale: "r", fieldRole: "rep", permittedChannel: "email", approvedContentId: "APR-001", estimatedTimeMin: 30, expectedOutcome: "info delivered", confidenceLevel: 0.8, evidenceThatWouldDisprove: "x", autonomyClass: 2 },
};

const capture: InteractionCapture = {
  accountId: "acc-1", hcpName: "Jane Smith", rawInput: "met with HCP",
  knowledgeState: "familiar with on-label data", primaryBarrier: "formulary",
  secondaryBarrier: "reimbursement", requestedFollowUp: "please send approved formulary materials",
  nextBestAction: "share approved formulary status", confidence: 0.85,
  evidenceSource: "in-person", humanConfirmationRequired: false, structuredAt: "2025-01-15T10:00:00Z",
};

test("generateFollowUps produces actions with consistent risk/behavior", () => {
  const actions = generateFollowUps(capture, account);
  assert.ok(actions.length > 0, "should produce actions");
  for (const a of actions) {
    const map = { low: "auto_record", moderate: "draft_and_approve", high: "route_to_compliance", prohibited: "block_and_document" } as const;
    assert.equal(a.systemBehavior, map[a.riskLevel], `behavior matches risk for ${a.type}`);
  }
  console.log("types:", actions.map(a => a.type).join(", "));
  console.log("risks:", actions.map(a => a.riskLevel).join(", "));
});

test("draftEmail is fair-balanced and references approved material", () => {
  const email = draftEmail(capture, account);
  assert.match(email, /APR-001/);
  assert.match(email, /fair-balanced/i);
  assert.doesNotMatch(email, /off-label/i);
  assert.doesNotMatch(email, /guarantee/i);
});

test("generateActionPlan includes prioritized steps and compliance reminders", () => {
  const plan = generateActionPlan(capture, account);
  assert.match(plan, /Prioritized Next Steps/);
  assert.match(plan, /Compliance Reminders/);
  assert.match(plan, /formulary/i);
});

test("prohibited content is blocked and documented", () => {
  const bad = { ...capture, requestedFollowUp: "please send off-label use information" };
  const actions = generateFollowUps(bad, account);
  const blocked = actions.find(a => a.systemBehavior === "block_and_document");
  assert.ok(blocked, "should have a blocked action");
  assert.equal(blocked!.riskLevel, "prohibited");
});

test("classifyRisk escalates high-risk content on low-baseline type", () => {
  const action: FollowUpAction = {
    type: "crm_note", description: "note about adverse event report",
    riskLevel: "low", systemBehavior: "auto_record",
  };
  assert.equal(classifyRisk(action), "high");
});

test("action plan with instructional off-label reminders is NOT prohibited", () => {
  const actions = generateFollowUps(capture, account);
  const plan = actions.find(a => a.type === "action_plan");
  assert.ok(plan, "action plan should exist");
  assert.notEqual(plan!.riskLevel, "prohibited", "instructional off-label mention must not be blocked");
  assert.match(plan!.draftContent ?? "", /off-label/i, "plan should contain the compliance reminder");
});

test("explicit intent to send off-label is blocked even in a crm_note", () => {
  const action: FollowUpAction = {
    type: "crm_note", description: "send off-label information to HCP",
    riskLevel: "low", systemBehavior: "auto_record",
  };
  assert.equal(classifyRisk(action), "prohibited");
});
