import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CRED_KEY = "a".repeat(64);

import {
  enqueueSync,
  getSyncQueue,
  getSyncEntry,
  executeSync,
  getAvailableCRMs,
  getCRMConfig,
  type CRMProvider,
  type SyncEntityType,
} from "@/lib/crm/sync";
import { ensureDefaultOrg, DEFAULT_ORG_ID, createUser, getUser } from "@/lib/db";

describe("crm-sync", () => {
  const orgId = DEFAULT_ORG_ID;
  const userId = "test-user-crm-001";

  beforeEach(() => {
    ensureDefaultOrg();
    if (!getUser(userId)) {
      createUser(userId, orgId, `${userId}@test.local`, `Test ${userId}`, "field_rep", null);
    }
  });

  it("enqueues a sync entry", () => {
    const entry = enqueueSync(orgId, userId, "veeva", "experiment", "exp_001", {
      subjectLine: "Test subject",
      variation: "Test variation",
      status: "approved",
    });
    assert.ok(entry.id);
    assert.equal(entry.provider, "veeva");
    assert.equal(entry.entityType, "experiment");
    assert.equal(entry.entityId, "exp_001");
    assert.equal(entry.status, "pending");
    assert.equal(entry.attempts, 0);
    assert.equal(entry.payload.subjectLine, "Test subject");
  });

  it("retrieves sync queue entries", () => {
    enqueueSync(orgId, userId, "salesforce", "outcome", "out_001", {
      experimentId: "exp_001",
      outcome: "qualified_response",
    });

    const queue = getSyncQueue(orgId);
    assert.ok(queue.some((e) => e.entityId === "out_001"));
  });

  it("updates existing entry on re-enqueue (upsert)", () => {
    enqueueSync(orgId, userId, "veeva", "experiment", "exp_002", {
      subjectLine: "Original",
    });

    enqueueSync(orgId, userId, "veeva", "experiment", "exp_002", {
      subjectLine: "Updated",
    });

    const queue = getSyncQueue(orgId).filter((e) => e.entityId === "exp_002");
    assert.equal(queue.length, 1);
    assert.equal(queue[0].payload.subjectLine, "Updated");
  });

  it("filters queue by status", () => {
    enqueueSync(orgId, userId, "veeva", "experiment", "exp_003", {});
    const pending = getSyncQueue(orgId, { status: "pending" });
    assert.ok(pending.every((e) => e.status === "pending"));
  });

  it("filters queue by provider", () => {
    enqueueSync(orgId, userId, "veeva", "experiment", "exp_004", {});
    enqueueSync(orgId, userId, "salesforce", "experiment", "exp_005", {});

    const veeva = getSyncQueue(orgId, { provider: "veeva" });
    assert.ok(veeva.every((e) => e.provider === "veeva"));
  });

  it("returns null config when no env vars are set", () => {
    const config = getCRMConfig("veeva");
    // In test env, VEEVA_CLIENT_ID is not set
    if (!process.env.VEEVA_CLIENT_ID) {
      assert.equal(config, null);
    }
  });

  it("returns empty available CRMs when not configured", () => {
    if (!process.env.VEEVA_CLIENT_ID && !process.env.SALESFORCE_CLIENT_ID) {
      const providers = getAvailableCRMs();
      assert.equal(providers.length, 0);
    }
  });

  it("executeSync marks as skipped when CRM not configured", async () => {
    if (process.env.VEEVA_CLIENT_ID) return; // skip if configured

    const entry = enqueueSync(orgId, userId, "veeva", "experiment", "exp_006", {
      subjectLine: "Test",
    });

    const result = await executeSync(orgId, entry.id);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not configured"));

    const updated = getSyncEntry(orgId, userId, entry.id);
    assert.equal(updated!.status, "skipped");
  });

  it("handles different entity types", () => {
    const types: SyncEntityType[] = ["experiment", "outcome", "territory_account", "phone_call", "field_route"];
    for (const t of types) {
      const entry = enqueueSync(orgId, userId, "salesforce", t, `test_${t}`, { test: true });
      assert.equal(entry.entityType, t);
      assert.equal(entry.status, "pending");
    }
  });
});
