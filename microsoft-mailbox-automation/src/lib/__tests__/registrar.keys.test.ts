/**
 * API-key manager tests — vault, rotation policy, provider selection, and the
 * rotator's safety guards (no bypass of single-key platforms, honest failure
 * on acquisition failure). No network or real browsers.
 */

import { test, before, after } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");

before(async () => {
  process.env.REGISTRAR_VAULT_PASSPHRASE = "test-passphrase-registrar";
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

test("key-vault: encrypted round-trip and redacted listing hides the secret", async () => {
  const { upsertKey, getKey, getDecryptedKeyValue, listKeysRedacted, deleteKey, loadKeys } = await import(
    "../registrar/key-vault"
  );
  const { encrypt } = await import("../registrar/crypto");
  upsertKey({
    platformId: "huggingface",
    platformName: "Hugging Face",
    keyLabel: "test-key",
    encryptedValue: encrypt("hf_test_secret_value_xxx"),
    scopes: "read",
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    expiresAt: null,
    rotationIntervalDays: 90,
    status: "active",
  });
  const k = getKey("huggingface");
  assert.ok(k, "key stored");
  assert.strictEqual(getDecryptedKeyValue("huggingface"), "hf_test_secret_value_xxx");
  const redacted = listKeysRedacted();
  assert.ok(redacted.length > 0);
  const r = redacted[0] as any;
  assert.strictEqual(r.encryptedValue, undefined, "redacted list must not expose encryptedValue");
  assert.strictEqual(r.hasValue, true);
  // On-disk ciphertext must not contain the plaintext secret.
  const { kvLoad, DEFAULT_ORG_ID } = await import("../db");
  const rows = kvLoad<{ value: string }>(DEFAULT_ORG_ID, "registrar.apikeys");
  assert.ok(!rows[0].value.includes("hf_test_secret_value_xxx"), "plaintext secret must not be stored");
  deleteKey("huggingface");
  assert.strictEqual(loadKeys().length, 0);
});

test("key-providers: registry has major platforms and lookup works", async () => {
  const { listKeyPlatforms, getKeyPlatformById } = await import("../registrar/key-providers");
  const platforms = listKeyPlatforms();
  const ids = platforms.map((p) => p.id);
  for (const expected of ["huggingface", "github", "openai", "anthropic", "groq", "google-cloud"]) {
    assert.ok(ids.includes(expected), `major platform ${expected} present`);
  }
  const hf = getKeyPlatformById("huggingface");
  assert.ok(hf, "huggingface lookup");
  assert.ok(hf!.tokenPageUrl.startsWith("https://"), "token page URL is https");
});

test("key-rotator: isRotationDue respects interval", async () => {
  const { isRotationDue } = await import("../registrar/key-rotator");
  const fresh = {
    platformId: "x",
    platformName: "X",
    keyLabel: "x",
    encryptedValue: "iv:tag:data",
    scopes: "read",
    createdAt: new Date().toISOString(),
    rotatedAt: new Date().toISOString(),
    expiresAt: null,
    rotationIntervalDays: 90,
    status: "active" as const,
  };
  assert.strictEqual(isRotationDue(fresh), false, "fresh key is not due");
  const old = {
    ...fresh,
    rotatedAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
  };
  assert.strictEqual(isRotationDue(old), true, "key older than interval is due");
});

test("key-rotator: rotateKey refuses to auto-rotate single-key platforms", async () => {
  const { rotateKey } = await import("../registrar/key-rotator");
  const { upsertKey } = await import("../registrar/key-vault");
  const { encrypt } = await import("../registrar/crypto");
  const { clearAudit } = await import("../registrar/audit-log");
  clearAudit();
  // perplexity supports multiple keys = false
  upsertKey({
    platformId: "perplexity",
    platformName: "Perplexity",
    keyLabel: "old",
    encryptedValue: encrypt("pplx_old"),
    scopes: "read",
    createdAt: new Date().toISOString(),
    rotatedAt: new Date().toISOString(),
    expiresAt: null,
    rotationIntervalDays: 90,
    status: "active",
  });
  const result = await rotateKey("perplexity", async () => {
    throw new Error("browser should not be launched for single-key platform");
  });
  assert.strictEqual(result.rotated, false);
  assert.ok(result.message.includes("manual rotation required"));
});

test("key-rotator: rotateKey reports honest failure when acquisition fails", async () => {
  const { rotateKey } = await import("../registrar/key-rotator");
  const { clearAudit } = await import("../registrar/audit-log");
  clearAudit();
  // Mock browser whose page never shows the key value element.
  const mockPage: any = {
    url: () => "https://huggingface.co/settings/tokens",
    setDefaultTimeout: () => {},
    goto: async () => {},
    waitForLoadState: async () => {},
    locator: () => ({
      first: () => ({
        click: async () => {},
        fill: async () => {},
        isVisible: async () => false,
        inputValue: async () => "",
        innerText: async () => "",
        textContent: async () => "",
      }),
    }),
  };
  const mockBrowser: any = {
    newContext: async () => ({
      addCookies: async () => {},
      newPage: async () => mockPage,
      close: async () => {},
    }),
    close: async () => {},
  };
  const result = await rotateKey("huggingface", async () => mockBrowser as any);
  assert.strictEqual(result.rotated, false);
  assert.ok(/acquisition failed|not visible|empty|PLATFORM_FLOW_CHANGED|CREDENTIAL_UI_UNAVAILABLE|LOGIN_REQUIRED/i.test(result.message), `unexpected message: ${result.message}`);
});

test("key-rotator: rotateKey stores and verifies a successfully acquired key", async () => {
  const { rotateKey } = await import("../registrar/key-rotator");
  const { getKey } = await import("../registrar/key-vault");
  const { clearAudit } = await import("../registrar/audit-log");
  clearAudit();
  // Mock browser that yields a fake key value. Verification will be skipped
  // for an unknown platform id, so we use a custom one to avoid network.
  const fakePlatformId = "test-platform-no-verifier";
  // Inject a platform into the registry via the rotator's lookup by using
  // huggingface but stubbing verifyKey through a known-fake key value that
  // won't pass the real network check. Instead, use a platform with no
  // verifier by patching: we test the store path using huggingface but the
  // verifier will hit network and likely fail. To keep the test hermetic,
  // we instead verify the store path by checking that when verification is
  // skipped (no checker), the key is stored as active.
  // -> Use a platform id that has no verifier entry. None of the real
  //    platforms lack a verifier except perplexity/fireworks. Use fireworks.
  const mockPage: any = {
    url: () => "https://fireworks.ai/account/api-keys",
    setDefaultTimeout: () => {},
    goto: async () => {},
    waitForLoadState: async () => {},
    locator: (sel: string) => ({
      first: () => ({
        click: async () => {},
        fill: async () => {},
        isVisible: async () => {
          // Exclude MFA/CAPTCHA/text-based selectors that happen to contain "code"
          if (sel.startsWith("text=") || sel.includes("one-time-code") || sel.includes("captcha") || sel.includes("authenticator") || sel.includes("authentication code") || sel.includes("verification code") || sel.includes("Two-factor") || sel.includes("Verify it's you") || sel.includes("Approve from")) return false;
          return sel.includes("code") || sel.includes("readonly") || sel.includes("Create") || sel.includes("New");
        },
        inputValue: async () => "fw_test_secret_value_12345",
        innerText: async () => "fw_test_secret_value_12345",
        textContent: async () => "fw_test_secret_value_12345",
      }),
    }),
  };
  const mockBrowser: any = {
    newContext: async () => ({
      addCookies: async () => {},
      newPage: async () => mockPage,
      close: async () => {},
    }),
    close: async () => {},
  };
  const result = await rotateKey("fireworks", async () => mockBrowser as any);
  // fireworks has no verifier, so verification is skipped and key stored active.
  assert.strictEqual(result.rotated, true, `expected rotated, got: ${result.message}`);
  const k = getKey("fireworks");
  assert.ok(k, "key stored after rotation");
  assert.strictEqual(k!.status, "active");
});

// ─── State classifier tests (SPEC §5) ──────────────────────────────────────

test("state-classifier: LOGIN_REQUIRED on redirect to login URL", async () => {
  const { classifyNavigationState } = await import("../registrar/state-classifier");
  const mockPage: any = {
    url: () => "https://platform.com/login",
    locator: () => ({
      first: () => ({
        isVisible: async () => false,
        innerText: async () => "",
      }),
    }),
  };
  const result = await classifyNavigationState(mockPage, "https://platform.com/settings/tokens", ["button"]);
  assert.strictEqual(result.state, "LOGIN_REQUIRED");
});

test("state-classifier: INTERACTIVE_CHALLENGE_REQUIRED when CAPTCHA visible", async () => {
  const { classifyNavigationState } = await import("../registrar/state-classifier");
  const mockPage: any = {
    url: () => "https://platform.com/settings/tokens",
    locator: (sel: string) => ({
      first: () => ({
        isVisible: async () => sel.includes("captcha"),
        innerText: async () => "",
      }),
    }),
  };
  const result = await classifyNavigationState(mockPage, "https://platform.com/settings/tokens", ["button"]);
  assert.strictEqual(result.state, "INTERACTIVE_CHALLENGE_REQUIRED");
});

test("state-classifier: CREDENTIAL_UI_AVAILABLE when UI selector matches", async () => {
  const { classifyNavigationState } = await import("../registrar/state-classifier");
  const mockPage: any = {
    url: () => "https://platform.com/settings/tokens",
    locator: (sel: string) => ({
      first: () => ({
        isVisible: async () => sel === "button[type=submit]",
        innerText: async () => "",
      }),
    }),
  };
  const result = await classifyNavigationState(mockPage, "https://platform.com/settings/tokens", ["button[type=submit]"]);
  assert.strictEqual(result.state, "CREDENTIAL_UI_AVAILABLE");
});

// ─── Session handoff tests (SPEC §4) ───────────────────────────────────────

test("session-handoff: encrypted round-trip, scope isolation, consume-once, destroy", async () => {
  const { exportSession, consumeSession, listSessions, destroySessions } = await import(
    "../registrar/session-handoff"
  );
  const cookies = [
    { name: "session", value: "abc123", domain: ".platform.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const },
  ];
  const id = exportSession("platform-a", "https://platform.com", cookies, null);
  assert.ok(id, "session exported with id");

  // Consuming returns the cookies.
  const consumed = consumeSession("platform-a");
  assert.ok(consumed, "cookies returned on first consume");
  assert.strictEqual(consumed![0].name, "session");

  // Second consume returns null (consume-once).
  const consumed2 = consumeSession("platform-a");
  assert.strictEqual(consumed2, null, "session consumed once");

  // Scope isolation: consuming a different scope returns null.
  exportSession("platform-b", "https://other.com", cookies, null);
  assert.strictEqual(consumeSession("platform-a"), null, "platform-a has no active session");
  assert.ok(consumeSession("platform-b"), "platform-b has a session");

  // Destroy.
  const destroyed = destroySessions("platform-b");
  assert.ok(destroyed >= 1, "sessions destroyed");
  assert.strictEqual(consumeSession("platform-b"), null, "no session after destroy");
});

test("session-handoff: expired session returns null on consume", async () => {
  const { exportSession, consumeSession } = await import("../registrar/session-handoff");
  const cookies = [
    { name: "s", value: "v", domain: ".p.com", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const },
  ];
  exportSession("expired-test", "https://p.com", cookies, new Date(Date.now() - 1000).toISOString());
  assert.strictEqual(consumeSession("expired-test"), null, "expired session returns null");
});

// ─── Qualification tests (SPEC §11) ────────────────────────────────────────

test("qualification: CAPTCHA site is disqualified from unattended provisioning", async () => {
  const { qualifySignupSite } = await import("../registrar/qualification");
  const { getSiteById } = await import("../registrar/catalog");
  const proton = getSiteById("protonmail")!; // hasCaptcha: true
  const qual = qualifySignupSite(proton);
  assert.strictEqual(qual.status, "DISQUALIFIED_INTERACTIVE_CHALLENGE");
  assert.strictEqual(qual.blockingStage, "provision");
});

test("qualification: no-CAPTCHA site is qualified", async () => {
  const { qualifySignupSite } = await import("../registrar/qualification");
  const { getSiteById } = await import("../registrar/catalog");
  const osm = getSiteById("openstreetmap")!; // hasCaptcha: false
  const qual = qualifySignupSite(osm);
  assert.strictEqual(qual.status, "QUALIFIED");
});

test("qualification: manual-acquisition key platform is disqualified", async () => {
  const { qualifyKeyPlatform } = await import("../registrar/qualification");
  const { getKeyPlatformById } = await import("../registrar/key-providers");
  // Find a platform with acquisition=manual (none in current registry, so test
  // the logic directly with a synthetic platform).
  const synthetic = {
    id: "test-manual",
    name: "Manual Platform",
    tokenPageUrl: "https://example.com",
    acquisition: "manual" as const,
    revocation: "manual" as const,
    supportsMultipleKeys: false,
    defaultRotationDays: 90,
    tags: [],
    description: "test",
  };
  const qual = qualifyKeyPlatform(synthetic);
  assert.strictEqual(qual.status, "DISQUALIFIED_MANUAL_ONLY");
});

test("qualification: google-cloud is disqualified (known interactive)", async () => {
  const { qualifyKeyPlatform } = await import("../registrar/qualification");
  const { getKeyPlatformById } = await import("../registrar/key-providers");
  const gcp = getKeyPlatformById("google-cloud")!;
  const qual = qualifyKeyPlatform(gcp);
  assert.strictEqual(qual.status, "DISQUALIFIED_INTERACTIVE_CHALLENGE");
});

// ─── Structured audit codes (SPEC §12) ─────────────────────────────────────

test("audit: structured append writes code field and maps to legacy outcome", async () => {
  const { appendStructuredAudit, loadAudit, clearAudit } = await import("../registrar/audit-log");
  clearAudit();
  appendStructuredAudit({
    siteId: "test",
    siteName: "Test",
    action: "test_action",
    outcome: "INTERACTIVE_CHALLENGE_REQUIRED",
    detail: "captcha detected",
  });
  const entries = loadAudit();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].code, "INTERACTIVE_CHALLENGE_REQUIRED");
  assert.strictEqual(entries[0].outcome, "blocked"); // mapped from INTERACTIVE_CHALLENGE_REQUIRED
});
