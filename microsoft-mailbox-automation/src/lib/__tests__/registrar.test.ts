/**
 * Registrar tests — principal success and failure paths.
 *
 * These tests avoid network and real browsers:
 *   - Vault encryption round-trip + non-exposure of plaintext on disk.
 *   - Password strength + uniqueness.
 *   - Username determinism + uniqueness across sites.
 *   - Suggester tag matching + skip-already-registered.
 *   - ToS acceptance policy per risk tier.
 *   - Audit log append + plain-text rendering.
 *   - Signup runner CAPTCHA-block path with a mock browser (no bypass).
 *   - Signup runner success path with a mock browser + no verification.
 */

import { test, before, after } from "node:test";
import assert from "node:assert";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const KEY_FILE = join(DATA_DIR, ".registrar.key");

before(async () => {
  // Use a fixed passphrase so the vault key is deterministic in tests.
  process.env.REGISTRAR_VAULT_PASSPHRASE = "test-passphrase-registrar";
  // Clear KV state instead of deleting the DB file (the DB connection is a
  // singleton and won't reset from file deletion).
  try {
    const { kvSave, DEFAULT_ORG_ID, ensureDefaultOrg } = await import("../db");
    ensureDefaultOrg();
    for (const key of ["registrar.vault", "registrar.credentials", "registrar.audit", "registrar.apikeys", "registrar.sessions"]) {
      kvSave(DEFAULT_ORG_ID, key, []);
    }
  } catch {
    /* ignore */
  }
});

after(() => {
  delete process.env.REGISTRAR_VAULT_PASSPHRASE;
});

test("vault: identity round-trips through encryption and never stores plaintext", async () => {
  const { saveIdentity, loadIdentity } = await import("../registrar/vault");
  const profile = {
    email: "tester@example.com",
    firstName: "Test",
    lastName: "User",
    usernameStem: "tester",
    needs: ["email", "code"],
  };
  saveIdentity(profile);
  const loaded = loadIdentity();
  assert.ok(loaded, "identity should load");
  assert.strictEqual(loaded!.email, "tester@example.com");
  assert.strictEqual(loaded!.firstName, "Test");
  assert.deepStrictEqual(loaded!.needs, ["email", "code"]);

  // The kv_store value must not contain the plaintext email.
  const { kvLoad, DEFAULT_ORG_ID } = await import("../db");
  const rows = kvLoad<{ value: string }>(DEFAULT_ORG_ID, "registrar.vault");
  assert.ok(rows.length > 0, "vault row should exist");
  const stored = rows[0].value;
  assert.ok(!stored.includes("tester@example.com"), "plaintext email must not be stored");
  assert.ok(stored.includes(":"), "ciphertext should be in iv:tag:data format");
});

test("vault: credentials round-trip and upsert replaces by siteId", async () => {
  const { saveCredentials, loadCredentials, upsertCredential, getCredential } = await import(
    "../registrar/vault"
  );
  saveCredentials([]);
  upsertCredential({
    siteId: "site-a",
    siteName: "Site A",
    username: "ua",
    password: "secret-a",
    email: "t@example.com",
    registeredAt: new Date().toISOString(),
    status: "registered",
  });
  upsertCredential({
    siteId: "site-b",
    siteName: "Site B",
    username: "ub",
    password: "secret-b",
    email: "t@example.com",
    registeredAt: new Date().toISOString(),
    status: "pending",
  });
  assert.strictEqual(loadCredentials().length, 2);
  // Upsert same siteId replaces, not appends.
  upsertCredential({
    siteId: "site-a",
    siteName: "Site A",
    username: "ua2",
    password: "secret-a2",
    email: "t@example.com",
    registeredAt: new Date().toISOString(),
    status: "registered",
  });
  assert.strictEqual(loadCredentials().length, 2);
  const a = getCredential("site-a");
  assert.strictEqual(a?.username, "ua2");
});

test("credentials: password is strong and unique", async () => {
  const { generatePassword } = await import("../registrar/credentials");
  const pw = generatePassword(20);
  assert.strictEqual(pw.length, 20);
  assert.ok(/[a-z]/.test(pw), "lowercase present");
  assert.ok(/[A-Z]/.test(pw), "uppercase present");
  assert.ok(/[0-9]/.test(pw), "digit present");
  assert.ok(/[!@#$%^&*\-_=+]/.test(pw), "symbol present");
  const pw2 = generatePassword(20);
  assert.notStrictEqual(pw, pw2, "passwords must be unique");
});

test("credentials: username is deterministic per site and unique across sites", async () => {
  const { deriveUsername } = await import("../registrar/credentials");
  const profile = {
    email: "tester@example.com",
    firstName: "Test",
    lastName: "User",
    usernameStem: "tester",
    needs: [],
  };
  const { getSiteById } = await import("../registrar/catalog");
  const a = getSiteById("github")!;
  const b = getSiteById("gitlab")!;
  const u1 = deriveUsername(profile, a);
  const u2 = deriveUsername(profile, b);
  const u1b = deriveUsername(profile, a);
  assert.strictEqual(u1, u1b, "username is deterministic for the same site");
  assert.notStrictEqual(u1, u2, "usernames differ across sites");
  assert.ok(u1.startsWith("tester"), "username starts with stem");
});

test("suggester: matches needs tags and skips already-registered sites", async () => {
  const { saveIdentity } = await import("../registrar/vault");
  const { upsertCredential } = await import("../registrar/vault");
  const { suggestServices } = await import("../registrar/suggester");
  saveIdentity({
    email: "t@example.com",
    firstName: "T",
    lastName: "U",
    usernameStem: "t",
    needs: ["email", "code"],
  });
  // Mark github as already registered.
  upsertCredential({
    siteId: "github",
    siteName: "GitHub",
    username: "t",
    password: "x",
    email: "t@example.com",
    registeredAt: new Date().toISOString(),
    status: "registered",
  });
  const sugg = suggestServices(
    { email: "t@example.com", firstName: "T", lastName: "U", usernameStem: "t", needs: ["email", "code"] },
    20,
  );
  const ids = sugg.map((s) => s.site.id);
  assert.ok(!ids.includes("github"), "already-registered site is skipped");
  assert.ok(ids.includes("gitlab"), "code-tagged site is suggested");
  assert.ok(ids.includes("protonmail") || ids.includes("tutanota"), "email-tagged site is suggested");
});

test("tos: acceptance policy per risk tier", async () => {
  const { decideAcceptance } = await import("../registrar/tos");
  assert.strictEqual(decideAcceptance("low").accepted, true);
  assert.strictEqual(decideAcceptance("medium").accepted, true);
  assert.strictEqual(decideAcceptance("high").accepted, false);
  assert.ok(decideAcceptance("high").reason.includes("review"));
});

test("tos: summarizeTos returns deterministic fallback when LLM unavailable", async () => {
  const { summarizeTos } = await import("../registrar/tos");
  // No OPENAI_API_KEY set in tests; fallback chain may still hit free providers,
  // but the function must always return a non-empty string.
  const summary = await summarizeTos("Some terms text here about data and arbitration.", "TestSite");
  assert.ok(summary.length > 10, "summary is non-empty");
});

test("audit: append and render plain text", async () => {
  const { appendAudit, loadAudit, renderAuditText, clearAudit } = await import("../registrar/audit-log");
  clearAudit();
  appendAudit({
    siteId: "test-site",
    siteName: "Test Site",
    action: "signup_start",
    outcome: "info",
    detail: "navigating to signup",
  });
  appendAudit({
    siteId: "test-site",
    siteName: "Test Site",
    action: "tos_extracted",
    outcome: "info",
    detail: "low-risk auto-accepted",
    tosSummary: "No data selling.",
    tosAccepted: true,
  });
  const entries = loadAudit();
  assert.strictEqual(entries.length, 2);
  const text = renderAuditText(entries);
  assert.ok(text.includes("Registrar audit log. 2 events."));
  assert.ok(text.includes("Test Site"));
  assert.ok(text.includes("terms accepted: yes"));
  assert.ok(text.includes("terms summary: No data selling."));
});

// ─── Mock browser for signup-runner tests ─────────────────────────────────

function mockLocator(opts: { visible?: boolean; checked?: boolean; innerText?: string; href?: string; count?: number }) {
  const self: any = {
    first: () => self,
    nth: () => self,
    isVisible: async () => opts.visible ?? false,
    isCheckable: async () => true,
    isChecked: async () => opts.checked ?? false,
    check: async () => {},
    fill: async () => {},
    click: async () => {},
    innerText: async () => opts.innerText ?? "",
    getAttribute: async (name: string) => (name === "for" ? "f1" : name === "href" ? opts.href : null),
    count: async () => opts.count ?? 0,
  };
  return self;
}

function mockPage(opts: { captchaVisible?: boolean; bodyText?: string; termsLinks?: string[] }) {
  const captchaSel = opts.captchaVisible ? "iframe[src*='captcha']" : null;
  const page: any = {
    url: () => "https://example.com/signup",
    setDefaultTimeout: () => {},
    goto: async () => {},
    waitForLoadState: async () => {},
    keyboard: { press: async () => {} },
    locator: (sel: string) => {
      if (captchaSel && sel.includes("captcha")) return mockLocator({ visible: true });
      // State classifier UI selectors: submit button, form
      if (sel === "button[type=submit]" || sel === "input[type=submit]" || sel === "form") {
        return mockLocator({ visible: !opts.captchaVisible });
      }
      if (sel.startsWith("label:has-text")) return mockLocator({ visible: true, innerText: "label" });
      if (sel.startsWith("a:has-text")) {
        return mockLocator({ count: opts.termsLinks?.length ?? 0, href: opts.termsLinks?.[0], innerText: "Terms" });
      }
      if (sel === "input[type=checkbox]") return mockLocator({ count: 1, checked: false });
      if (sel === "body") return mockLocator({ innerText: opts.bodyText ?? "" });
      return mockLocator({ visible: false });
    },
    context: () => ({
      request: { get: async () => ({ ok: false, text: async () => "" }) },
      cookies: async () => [], // no cookies for session export in tests
    }),
  };
  return page;
}

function mockBrowser(page: any) {
  const context: any = {
    newPage: async () => page,
    close: async () => {},
    cookies: async () => [],
  };
  return {
    newContext: async () => context,
    close: async () => {},
  };
}

test("signup runner: CAPTCHA block is not bypassed and queues accommodation", async () => {
  const { registerOnSite } = await import("../registrar/signup-runner");
  const { getSiteById } = await import("../registrar/catalog");
  const { loadAudit } = await import("../registrar/audit-log");
  const { clearAudit } = await import("../registrar/audit-log");
  clearAudit();

  const site = getSiteById("openstreetmap")!; // hasCaptcha=false but we force via mock
  const profile = {
    email: "t@example.com",
    firstName: "T",
    lastName: "U",
    usernameStem: "t",
    needs: [],
  };
  const page = mockPage({ captchaVisible: true, bodyText: "" });
  const browser: any = mockBrowser(page);

  const result = await registerOnSite(site, profile, browser, { skipExisting: false });
  assert.strictEqual(result.status, "blocked_captcha");
  assert.ok(result.message.includes("not bypassed") || result.message.includes("INTERACTIVE_CHALLENGE_REQUIRED") || result.code === "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE");

  const audit = loadAudit();
  const accom = audit.find((a) => a.action === "accommodation_request_queued");
  assert.ok(accom, "accommodation request should be queued");
});

test("signup runner: email_only success path records registered credential", async () => {
  const { registerOnSite } = await import("../registrar/signup-runner");
  const { getSiteById } = await import("../registrar/catalog");
  const { loadAudit, clearAudit } = await import("../registrar/audit-log");
  const { loadCredentials, saveCredentials } = await import("../registrar/vault");
  clearAudit();
  saveCredentials([]);

  const site = getSiteById("openstreetmap")!; // strategy email_only, hasCaptcha false
  const profile = {
    email: "t@example.com",
    firstName: "T",
    lastName: "U",
    usernameStem: "t",
    needs: [],
  };
  const page = mockPage({
    captchaVisible: false,
    bodyText: "Welcome. By signing up you agree to our terms of service. We do not sell your data.",
    termsLinks: ["https://example.com/terms"],
  });
  const browser: any = mockBrowser(page);

  const result = await registerOnSite(site, profile, browser, { skipExisting: false });
  assert.strictEqual(result.status, "registered", `expected registered, got ${result.status}: ${result.message}`);
  const creds = loadCredentials();
  const c = creds.find((x) => x.siteId === site.id);
  assert.ok(c, "credential stored");
  assert.strictEqual(c!.status, "registered");
  assert.ok(c!.password.length >= 20, "strong password stored");
  const audit = loadAudit();
  const complete = audit.find((a) => a.action === "signup_complete");
  assert.ok(complete, "signup_complete audit entry exists");
  assert.strictEqual(complete!.outcome, "success");
});
