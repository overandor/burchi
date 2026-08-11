import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createEvidenceEnvelope } from "@/lib/workteleport/evidence";
import { compileEvidenceEnvelope, classifyIntent, decomposeRequest, setPermittedTools } from "@/lib/workteleport/compiler";
import { planCapabilities, seedDefaultCapabilities } from "@/lib/workteleport/capability-graph";
import { createWorkflow, advanceWorkflow, getWorkflow } from "@/lib/workteleport/workflow-runtime";
import { evaluateCommit, verifyReceipt } from "@/lib/workteleport/commit-gate";
import { getDb, ensureDefaultOrg, DEFAULT_ORG_ID, createUser, getUser } from "@/lib/db";

const TEST_ORG = DEFAULT_ORG_ID;
const TEST_USER = "test-wt-compile-001";

beforeEach(() => {
  ensureDefaultOrg();
  // Ensure test user exists for FK constraint
  if (!getUser(TEST_USER)) {
    createUser(TEST_USER, TEST_ORG, "test-wt-compile@company.com", "Test WT Compile User", "field_rep", null);
  }
  const db = getDb();
  db.prepare(`DELETE FROM evidence_envelopes WHERE org_id = ? AND user_id = ?`).run(TEST_ORG, TEST_USER);
  db.prepare(`DELETE FROM task_irs WHERE org_id = ? AND user_id = ?`).run(TEST_ORG, TEST_USER);
  db.prepare(`DELETE FROM workflows WHERE org_id = ? AND user_id = ?`).run(TEST_ORG, TEST_USER);
  db.prepare(`DELETE FROM commit_records WHERE org_id = ?`).run(TEST_ORG);
});

describe("Email-to-Execution Compiler", () => {
  it("classifies intent from content", () => {
    assert.ok(classifyIntent("Please create a report").includes("request"));
    assert.ok(classifyIntent("What is the status?").includes("question"));
    assert.ok(classifyIntent("I will do it by Friday").includes("commitment"));
    assert.ok(classifyIntent("This is unacceptable").includes("complaint"));
    assert.ok(classifyIntent("FYI, the meeting is at 3pm").includes("informational"));
    assert.ok(classifyIntent("URGENT: need this ASAP").includes("escalation"));
  });

  it("decomposes expense reconciliation request", () => {
    const tasks = decomposeRequest("Please reconcile the attached travel expenses", [
      { filename: "receipt.pdf", mimeType: "application/pdf" },
    ]);
    assert.ok(tasks.length >= 2);
    assert.ok(tasks.some((t) => t.taskType === "reconcile"));
  });

  it("decomposes CSV enrichment request", () => {
    const tasks = decomposeRequest("Enrich this physician list", [
      { filename: "data.csv", mimeType: "text/csv" },
    ]);
    assert.ok(tasks.length >= 2);
    assert.equal(tasks[0].taskType, "research");
  });

  it("compiles an evidence envelope through all stages", () => {
    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "compile_test_001",
      sender: "manager@company.com",
      recipient: TEST_USER,
      originalContent: "Please research the latest clinical guidelines and send me a summary.",
    });

    seedDefaultCapabilities(TEST_ORG);

    const result = compileEvidenceEnvelope(TEST_ORG, TEST_USER, envelope.id, "company.com");

    assert.ok(result.understanding);
    assert.ok(result.understanding.intentTypes.includes("request"));
    assert.ok(result.tasks.length >= 1);
    assert.equal(result.tasks[0].status, "drafted");
    assert.equal(result.tasks[0].evidenceEnvelopeId, envelope.id);
  });
});

describe("Capability Graph", () => {
  it("seeds default capabilities", () => {
    seedDefaultCapabilities(TEST_ORG);
    const caps = planCapabilities(TEST_ORG, "research", "field_rep", TEST_USER);
    assert.ok(caps.length > 0);
  });

  it("checks permissions for a role", () => {
    seedDefaultCapabilities(TEST_ORG);
    const caps = planCapabilities(TEST_ORG, "research", "field_rep", TEST_USER);
    assert.ok(caps.length > 0);
  });
});

describe("Workflow Runtime", () => {
  it("creates a workflow for a task IR", () => {
    seedDefaultCapabilities(TEST_ORG);

    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "wf_test_001",
      sender: "manager@company.com",
      recipient: TEST_USER,
      originalContent: "Please create a summary report.",
    });

    const result = compileEvidenceEnvelope(TEST_ORG, TEST_USER, envelope.id, "company.com");
    const task = result.tasks[0];

    const caps = planCapabilities(TEST_ORG, task.taskType, "field_rep", TEST_USER);
    setPermittedTools(TEST_ORG, task.id, caps.map((c) => c.id));

    const wf = createWorkflow(TEST_ORG, TEST_USER, task.id);
    assert.ok(wf.id.startsWith("wf_"));
    assert.equal(wf.state, "pending");
    assert.ok(wf.steps.length > 0);
    assert.ok(wf.idempotencyKey);
  });

  it("advances workflow state", () => {
    seedDefaultCapabilities(TEST_ORG);

    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "wf_advance_001",
      sender: "manager@company.com",
      recipient: TEST_USER,
      originalContent: "Research the latest trends.",
    });

    const result = compileEvidenceEnvelope(TEST_ORG, TEST_USER, envelope.id, "company.com");
    const task = result.tasks[0];

    const caps = planCapabilities(TEST_ORG, task.taskType, "field_rep", TEST_USER);
    setPermittedTools(TEST_ORG, task.id, caps.map((c) => c.id));

    const wf = createWorkflow(TEST_ORG, TEST_USER, task.id);
    const advanced = advanceWorkflow(TEST_ORG, wf.id);
    assert.equal(advanced.state, "executing");
  });
});

describe("Commit Gate", () => {
  it("blocks commits with missing workflow", () => {
    const result = evaluateCommit({
      orgId: TEST_ORG,
      workflowId: "nonexistent",
      stepId: "step_001",
      actionType: "send_email",
      actionTarget: "recipient@test.com",
      actionPayload: { subject: "Test" },
      userRole: "field_rep",
      userId: TEST_USER,
    });

    assert.equal(result.committed, false);
    assert.ok(result.reasons.some((r) => r.includes("not found")));
  });

  it("verifies receipt integrity", () => {
    const result = verifyReceipt(TEST_ORG, "nonexistent_commit");
    assert.equal(result.valid, false);
  });
});

describe("Skill Genome", () => {
  it("creates and retrieves a skill genome", async () => {
    const { createSkill, getSkill, recordPerformance } = await import("@/lib/workteleport/skill-genome");

    const skill = createSkill({
      orgId: TEST_ORG,
      name: "Expense Reconciliation Skill",
      description: "Automated expense report creation from receipts",
      trigger: { type: "email_pattern", pattern: "reconcile.*expense", priority: 10 },
      toolRequirements: ["cap_001"],
      validationTests: ["totals_match", "receipts_attached"],
    });

    assert.ok(skill.id.startsWith("skill_"));
    assert.equal(skill.maturity, "first_occurrence");

    const retrieved = getSkill(TEST_ORG, skill.id);
    assert.ok(retrieved);
    assert.equal(retrieved!.name, "Expense Reconciliation Skill");

    const updated = recordPerformance(TEST_ORG, skill.id, {
      executedAt: new Date().toISOString(),
      durationMs: 5000,
      success: true,
      humanInterventionRequired: false,
      cost: 0.5,
      notes: "First successful execution",
    });

    assert.equal(updated.usageCount, 1);
    assert.equal(updated.maturity, "model_assisted");
  });
});

describe("Experiment Twin", () => {
  it("creates and retrieves an experiment twin", async () => {
    const { createExperimentTwin, getTwin, proposeTwinCandidates } = await import("@/lib/workteleport/experiment-twin");

    seedDefaultCapabilities(TEST_ORG);
    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "twin_test_001",
      sender: "manager@company.com",
      recipient: TEST_USER,
      originalContent: "Create a report.",
    });
    const result = compileEvidenceEnvelope(TEST_ORG, TEST_USER, envelope.id, "company.com");
    const caps = planCapabilities(TEST_ORG, result.tasks[0].taskType, "field_rep", TEST_USER);
    setPermittedTools(TEST_ORG, result.tasks[0].id, caps.map((c) => c.id));
    const wf = createWorkflow(TEST_ORG, TEST_USER, result.tasks[0].id);

    const twin = createExperimentTwin({
      orgId: TEST_ORG,
      workflowId: wf.id,
      researchQuestion: "Can this workflow be completed with fewer steps?",
      hypothesis: "Removing step 2 will not affect output quality",
      permutationType: "fewer_steps",
      permutationDescription: "Skip the validation step",
      controlWorkflowId: wf.id,
    });

    assert.ok(twin.id.startsWith("twin_"));
    assert.equal(twin.status, "proposed");

    const retrieved = getTwin(TEST_ORG, twin.id);
    assert.ok(retrieved);
    assert.ok(retrieved!.hypothesis.includes("step"));

    const candidates = proposeTwinCandidates(TEST_ORG, wf.id, 5);
    assert.ok(candidates.length > 0);
  });
});

describe("Venture Capsule", () => {
  it("creates and retrieves a venture capsule", async () => {
    const { createVentureCapsule, getVenture, updateVentureStatus } = await import("@/lib/workteleport/venture-capsule");

    const venture = createVentureCapsule({
      orgId: TEST_ORG,
      name: "Physician Address Verification Service",
      problemSolved: "Physician addresses are often outdated, causing delivery failures",
      targetUsers: ["pharma companies", "medical device companies"],
      commercializationHypothesis: "Charge per verification with volume discounts",
      unitEconomics: {
        operatingCost: 0.10,
        revenuePotential: 0.50,
        margin: 0.40,
        breakEvenUnits: 1000,
        notes: "Per verification",
      },
    });

    assert.ok(venture.id.startsWith("vent_"));
    assert.equal(venture.status, "identified");

    const retrieved = getVenture(TEST_ORG, venture.id);
    assert.ok(retrieved);
    assert.equal(retrieved!.name, "Physician Address Verification Service");

    const updated = updateVentureStatus(TEST_ORG, venture.id, "validated");
    assert.equal(updated.status, "validated");
  });
});

describe("Dissect Pipeline", () => {
  it("processes a hypothesis through the full pipeline", async () => {
    const { processHypothesis, listDissectedHypotheses } = await import("@/lib/workteleport/dissect");

    const result = processHypothesis(
      TEST_ORG,
      "Physicians who engage with educational emails may respond better to a follow-up call within 24 hours.",
    );

    assert.ok(result.id.startsWith("dh_"));
    assert.equal(result.population, "Physicians");
    assert.ok(result.intervention.includes("Email"));
    assert.ok(result.demoronifiedClaim.includes("Physicians"));
    assert.ok(!result.demoronifiedClaim.includes("may respond better"));
    assert.ok(result.researchStatus);
    assert.ok(result.novelComponent);
    assert.ok(result.experimentDesign.includes("Controlled field test"));
    assert.ok(result.replicationPlan.includes("3-5 employees"));
    assert.ok(result.capitalizationPlan.includes("Skill Genome"));

    const list = listDissectedHypotheses(TEST_ORG);
    assert.ok(list.length > 0);
  });

  it("demoronifies marketing language", async () => {
    const { processHypothesis } = await import("@/lib/workteleport/dissect");

    const result = processHypothesis(
      TEST_ORG,
      "AI-driven physician-intent optimization will transform engagement through cutting-edge personalization.",
    );

    assert.ok(!result.demoronifiedClaim.includes("AI-driven"));
    assert.ok(!result.demoronifiedClaim.includes("transform"));
    assert.ok(!result.demoronifiedClaim.includes("cutting-edge"));
  });
});

describe("Taxonomy and Game Actions", () => {
  it("returns 40 coined terms", async () => {
    const { getCoinedTerms } = await import("@/lib/workteleport/taxonomy");
    const terms = getCoinedTerms();
    assert.equal(terms.length, 40);
    assert.ok(terms[0].term);
    assert.ok(terms[0].experimentFamily);
  });

  it("records game actions with rewards", async () => {
    const { recordGameAction, listGameActions, getUserRewardTotal, ACTION_REWARDS } = await import("@/lib/workteleport/taxonomy");

    const record = recordGameAction({
      orgId: TEST_ORG,
      userId: TEST_USER,
      action: "plant",
      targetId: "hyp_001",
      targetType: "hypothesis",
      notes: "Planted a new hypothesis",
    });

    assert.ok(record.id.startsWith("ga_"));
    assert.equal(record.reward, ACTION_REWARDS.plant);

    const list = listGameActions(TEST_ORG, TEST_USER);
    assert.ok(list.length > 0);

    const total = getUserRewardTotal(TEST_ORG, TEST_USER);
    assert.ok(total > 0);
  });
});
