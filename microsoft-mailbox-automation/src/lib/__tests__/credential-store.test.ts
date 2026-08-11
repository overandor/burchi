import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Set a fixed encryption key before importing the credential store
process.env.EMAIL_CRED_KEY = "a".repeat(64); // 32-byte hex key for tests

import { saveCredential, getCredential, getCredentialsForUser, deleteCredential, toSafeView } from "@/lib/auth/credential-store";
import { ensureDefaultOrg, DEFAULT_ORG_ID, createUser, getUser, _getDb } from "@/lib/db";

describe("credential-store", () => {
  const orgId = DEFAULT_ORG_ID;
  const userId = "test-user-cred-001";
  const otherUserId = "other-user-002";

  beforeEach(() => {
    ensureDefaultOrg();
    // Ensure test users exist (foreign key constraint on email_credentials)
    for (const uid of [userId, otherUserId]) {
      if (!getUser(uid)) {
        createUser(uid, orgId, `${uid}@test.local`, `Test ${uid}`, "field_rep", null);
      }
    }
  });

  it("saves and retrieves a Gmail credential", () => {
    const saved = saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "test@gmail.com",
      refreshToken: "refresh-token-abc-123",
      accessToken: "access-token-xyz",
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      metadata: { clientId: "client-123" },
    });

    assert.ok(saved.id);
    assert.equal(saved.email, "test@gmail.com");
    assert.equal(saved.refreshToken, "refresh-token-abc-123");
    assert.equal(saved.accessToken, "access-token-xyz");

    const fetched = getCredential(orgId, userId, "gmail", "test@gmail.com");
    assert.ok(fetched);
    assert.equal(fetched!.refreshToken, "refresh-token-abc-123");
    assert.equal(fetched!.accessToken, "access-token-xyz");
    assert.equal(fetched!.metadata.clientId, "client-123");
  });

  it("saves and retrieves a Microsoft credential", () => {
    const saved = saveCredential({
      orgId,
      userId,
      provider: "microsoft",
      email: "user@outlook.com",
      refreshToken: "ms-refresh-456",
      accessToken: "ms-access-789",
      metadata: { name: "Test User" },
    });

    assert.equal(saved.provider, "microsoft");
    const fetched = getCredential(orgId, userId, "microsoft", "user@outlook.com");
    assert.ok(fetched);
    assert.equal(fetched!.refreshToken, "ms-refresh-456");
  });

  it("lists all credentials for a user", () => {
    saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "list1@gmail.com",
      refreshToken: "r1",
    });
    saveCredential({
      orgId,
      userId,
      provider: "microsoft",
      email: "list2@outlook.com",
      refreshToken: "r2",
    });

    const all = getCredentialsForUser(orgId, userId);
    assert.ok(all.length >= 2);
    const emails = all.map((c) => c.email);
    assert.ok(emails.includes("list1@gmail.com"));
    assert.ok(emails.includes("list2@outlook.com"));
  });

  it("updates existing credential on re-save (upsert)", () => {
    saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "upsert@gmail.com",
      refreshToken: "old-token",
    });

    saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "upsert@gmail.com",
      refreshToken: "new-token",
    });

    const fetched = getCredential(orgId, userId, "gmail", "upsert@gmail.com");
    assert.ok(fetched);
    assert.equal(fetched!.refreshToken, "new-token");
  });

  it("deletes a credential", () => {
    const saved = saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "delete-me@gmail.com",
      refreshToken: "to-be-deleted",
    });

    const ok = deleteCredential(orgId, userId, saved.id);
    assert.equal(ok, true);

    const fetched = getCredential(orgId, userId, "gmail", "delete-me@gmail.com");
    assert.equal(fetched, null);
  });

  it("safe view does not expose tokens", () => {
    const saved = saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "safe-view@gmail.com",
      refreshToken: "secret-refresh",
      accessToken: "secret-access",
    });

    const safe = toSafeView(saved);
    assert.equal(safe.email, "safe-view@gmail.com");
    assert.equal(safe.hasRefreshToken, true);
    assert.equal(safe.hasAccessToken, true);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("secret-refresh"));
    assert.ok(!json.includes("secret-access"));
  });

  it("isolates credentials by user", () => {
    saveCredential({
      orgId,
      userId,
      provider: "gmail",
      email: "user-a@gmail.com",
      refreshToken: "user-a-token",
    });

    saveCredential({
      orgId,
      userId: "other-user-002",
      provider: "gmail",
      email: "user-b@gmail.com",
      refreshToken: "user-b-token",
    });

    const userA = getCredentialsForUser(orgId, userId);
    const userB = getCredentialsForUser(orgId, "other-user-002");

    assert.ok(userA.find((c) => c.email === "user-a@gmail.com"));
    assert.equal(userA.find((c) => c.email === "user-b@gmail.com"), undefined);
    assert.ok(userB.find((c) => c.email === "user-b@gmail.com"));
    assert.equal(userB.find((c) => c.email === "user-a@gmail.com"), undefined);
  });
});
