import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createEvidenceEnvelope, getEvidenceEnvelope, listEvidenceEnvelopes, verifyIntegrity, attachInterpretation } from "@/lib/workteleport/evidence";
import { getDb, ensureDefaultOrg, DEFAULT_ORG_ID, createUser, getUser } from "@/lib/db";

const TEST_ORG = DEFAULT_ORG_ID;
const TEST_USER = "test-wt-user-001";

beforeEach(() => {
  ensureDefaultOrg();
  // Ensure test user exists for FK constraint
  if (!getUser(TEST_USER)) {
    createUser(TEST_USER, TEST_ORG, "test-wt@company.com", "Test WT User", "field_rep", null);
  }
  const db = getDb();
  db.prepare(`DELETE FROM evidence_envelopes WHERE org_id = ? AND user_id = ?`).run(TEST_ORG, TEST_USER);
});

describe("Evidence Envelope", () => {
  it("creates an evidence envelope with content hash", () => {
    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "msg_001",
      sender: "manager@company.com",
      recipient: TEST_USER,
      originalContent: "Please reconcile the attached travel expenses before Friday.",
      requestedWork: "reconcile expenses",
      deadlines: [new Date(Date.now() + 86400000).toISOString()],
    });

    assert.ok(envelope.id.startsWith("ev_"));
    assert.equal(envelope.contentHash.length, 64);
    assert.equal(envelope.source, "email");
    assert.equal(envelope.requestedWork, "reconcile expenses");
    assert.equal(envelope.deadlines.length, 1);
  });

  it("retrieves an evidence envelope by id", () => {
    const created = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "csv",
      sourceIdentifier: "file_001",
      sender: "analyst@company.com",
      recipient: TEST_USER,
      originalContent: "physician_id,name,specialty\n1,Dr. Smith,Cardiology",
    });

    const retrieved = getEvidenceEnvelope(TEST_ORG, created.id);
    assert.ok(retrieved);
    assert.equal(retrieved!.id, created.id);
    assert.ok(retrieved!.originalContent.includes("Dr. Smith"));
  });

  it("verifies content integrity", () => {
    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "msg_002",
      sender: "test@company.com",
      recipient: TEST_USER,
      originalContent: "Original content for integrity test",
    });

    const integrity = verifyIntegrity(TEST_ORG, envelope.id);
    assert.ok(integrity.valid);
    assert.equal(integrity.expectedHash, integrity.actualHash);
  });

  it("attaches LLM interpretation without modifying original content", () => {
    const envelope = createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "msg_003",
      sender: "client@external.com",
      recipient: TEST_USER,
      originalContent: "I need a report on Q3 performance.",
    });

    const originalContent = envelope.originalContent;

    attachInterpretation(TEST_ORG, envelope.id, {
      interpretedAt: new Date().toISOString(),
      modelId: "test-model",
      summary: "Client requests Q3 performance report",
      intentClassification: ["request"],
      proposedTasks: ["research"],
      confidence: 0.9,
    });

    const retrieved = getEvidenceEnvelope(TEST_ORG, envelope.id);
    assert.equal(retrieved!.originalContent, originalContent);
    assert.ok(retrieved!.llmInterpretation);
    assert.ok(retrieved!.llmInterpretation!.summary.includes("Q3 performance report"));
  });

  it("lists evidence envelopes for a user", () => {
    createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "msg_004",
      sender: "a@company.com",
      recipient: TEST_USER,
      originalContent: "Test message 1",
    });
    createEvidenceEnvelope({
      orgId: TEST_ORG,
      userId: TEST_USER,
      source: "email",
      sourceIdentifier: "msg_005",
      sender: "b@company.com",
      recipient: TEST_USER,
      originalContent: "Test message 2",
    });

    const list = listEvidenceEnvelopes(TEST_ORG, TEST_USER);
    assert.ok(list.length >= 2);
  });
});
