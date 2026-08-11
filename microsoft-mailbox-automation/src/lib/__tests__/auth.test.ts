/**
 * Tests for the real password-based auth system.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  hashPassword,
  verifyPassword,
  registerUser,
  loginWithEmail,
  setUserPassword,
} from "@/lib/auth/session";
import { getOrganizationBySlug, getUserByEmail } from "@/lib/db";

// A predictable setup token lets tests create additional accounts
// even when the database already contains users.
process.env.FOUNDRY_SETUP_TOKEN = "test-setup-token";

describe("password hashing", () => {
  it("hashPassword produces different hashes for the same password", () => {
    const h1 = hashPassword("Foundry2026!");
    const h2 = hashPassword("Foundry2026!");
    assert.notStrictEqual(h1, h2);
    assert.ok(verifyPassword("Foundry2026!", h1));
    assert.ok(verifyPassword("Foundry2026!", h2));
  });

  it("verifyPassword rejects wrong password", () => {
    const h = hashPassword("correct-horse-battery-staple");
    assert.ok(verifyPassword("correct-horse-battery-staple", h));
    assert.strictEqual(verifyPassword("wrong-password", h), false);
  });

  it("verifyPassword rejects malformed hashes", () => {
    assert.strictEqual(verifyPassword("any", "not-a-hash"), false);
    assert.strictEqual(verifyPassword("any", ""), false);
  });
});

describe("registration and login", () => {
  it("registers and logs in a new user", () => {
    const slug = `foundry-auth-${Date.now()}`;
    const email = `${slug}@foundry.ai`;

    const reg = registerUser({
      orgSlug: slug,
      orgName: "Auth Test Org",
      email,
      password: "TestPass123!",
      name: "Auth Tester",
      role: "field_rep",
      setupToken: process.env.FOUNDRY_SETUP_TOKEN,
    });

    assert.ok(reg.success, reg.error);
    assert.ok(reg.user);

    const org = getOrganizationBySlug(slug);
    assert.ok(org);

    const login = loginWithEmail(slug, email, "TestPass123!");
    assert.ok(login.success, login.error);
    assert.ok(login.token);

    const badLogin = loginWithEmail(slug, email, "WrongPass");
    assert.strictEqual(badLogin.success, false);

    const unknownOrg = loginWithEmail("no-such-org", email, "TestPass123!");
    assert.strictEqual(unknownOrg.success, false);
  });

  it("setUserPassword allows resetting a known user's password", () => {
    const slug = `foundry-reset-${Date.now()}`;
    const email = `${slug}@foundry.ai`;

    registerUser({
      orgSlug: slug,
      email,
      password: "OldPass123!",
      name: "Reset User",
      setupToken: process.env.FOUNDRY_SETUP_TOKEN,
    });

    const user = getUserByEmail(slug, email);
    assert.ok(user);

    setUserPassword(user!.id, "NewPass456!");

    const oldLogin = loginWithEmail(slug, email, "OldPass123!");
    assert.strictEqual(oldLogin.success, false);

    const newLogin = loginWithEmail(slug, email, "NewPass456!");
    assert.ok(newLogin.success, newLogin.error);
  });
});
