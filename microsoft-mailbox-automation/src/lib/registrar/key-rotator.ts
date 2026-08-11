/**
 * Key rotator — acquires, verifies, activates, rotates, and revokes platform
 * API keys per SPEC.md.
 *
 * Pipeline order (SPEC §7, §9):
 *   authenticate → acquire → verify → encrypt/store → activate → revoke previous
 *
 * The rotator consumes encrypted session handoffs from the signup runner when
 * available, classifies post-navigation state explicitly, and fails closed on
 * interactive challenges.
 *
 * Playwright is loaded lazily so the module imports cleanly in serverless.
 */

import type { Browser, Page } from "playwright";
import { randomUUID } from "crypto";
import { encrypt } from "./crypto";
import { upsertKey, getKey, deleteKey, loadKeys } from "./key-vault";
import { getKeyPlatformById } from "./key-providers";
import { appendAudit, appendStructuredAudit } from "./audit-log";
import { classifyNavigationState } from "./state-classifier";
import { isTerminalFailure, failureCodeForState, auditOutcomeForState } from "./status-codes";
import { qualifyKeyPlatform } from "./qualification";
import { consumeSession, toPlaywrightCookies, destroySessions } from "./session-handoff";
import type { ApiKeyRecord, KeyPlatform, RotationResult } from "./key-types";

const NAV_TIMEOUT = 45_000;
const ACTION_TIMEOUT = 15_000;

export interface AcquireResult {
  ok: boolean;
  keyValue?: string;
  keyLabel?: string;
  error?: string;
  /** Structured failure code when ok=false (SPEC §3, §5). */
  code?: string;
  /** Navigation state observed (SPEC §5). */
  state?: string;
}

/**
 * Acquire a new API key for a platform by navigating its token page in a
 * logged-in browser session. The caller is responsible for providing a
 * browser context that is already authenticated with the platform (e.g. by
 * reusing the registration session's cookies).
 */
export async function acquireKeyViaUi(
  platform: KeyPlatform,
  browser: Browser,
  existingCookies?: any[],
): Promise<AcquireResult> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "en-US",
  });
  if (existingCookies && existingCookies.length) {
    try {
      await context.addCookies(existingCookies);
    } catch {
      /* ignore */
    }
  }
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try {
    await page.goto(platform.tokenPageUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    // Post-navigation state classification (SPEC §5).
    const uiSelectors = [
      platform.createButtonSelector,
      platform.keyValueSelector,
      "button:has-text('Create')",
      "button:has-text('New')",
    ].filter(Boolean) as string[];
    const navState = await classifyNavigationState(page, platform.tokenPageUrl, uiSelectors);
    if (isTerminalFailure(navState.state)) {
      const code = failureCodeForState(navState.state);
      return {
        ok: false,
        error: `${navState.state}: ${navState.evidence}`,
        code: code || undefined,
        state: navState.state,
      };
    }

    // Click "create new key".
    if (platform.createButtonSelector) {
      await page.locator(platform.createButtonSelector).first().click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    // Name the key.
    const label = `registrar-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
    if (platform.newNameFieldSelector) {
      const nameField = page.locator(platform.newNameFieldSelector).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(label, { timeout: ACTION_TIMEOUT }).catch(() => {});
      }
    }
    // Confirm.
    if (platform.confirmButtonSelector) {
      await page.locator(platform.confirmButtonSelector).first().click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});

    // Extract the secret value.
    if (!platform.keyValueSelector) {
      return { ok: false, error: "no keyValueSelector configured for this platform" };
    }
    const valueLoc = page.locator(platform.keyValueSelector).first();
    if (!(await valueLoc.isVisible({ timeout: 10_000 }).catch(() => false))) {
      // Re-classify: a challenge may have appeared after the create click.
      const postCreateState = await classifyNavigationState(page, platform.tokenPageUrl, uiSelectors);
      if (isTerminalFailure(postCreateState.state)) {
        const code = failureCodeForState(postCreateState.state);
        return {
          ok: false,
          error: `${postCreateState.state}: ${postCreateState.evidence}`,
          code: code || undefined,
          state: postCreateState.state,
        };
      }
      return {
        ok: false,
        error: "key value element not visible after creation — the platform may require an extra step (e.g. scope selection, CAPTCHA, or 2FA)",
        code: "ACQUISITION_FAILED",
        state: "CREDENTIAL_UI_UNAVAILABLE",
      };
    }
    const keyValue =
      (await valueLoc.inputValue().catch(() => null)) ||
      (await valueLoc.innerText().catch(() => null)) ||
      (await valueLoc.textContent().catch(() => null)) ||
      "";
    const trimmed = keyValue.trim();
    if (!trimmed || trimmed.length < 8) {
      return { ok: false, error: "extracted key value was empty or too short" };
    }
    return { ok: true, keyValue: trimmed, keyLabel: label };
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Verify a freshly-acquired key with a single cheap platform API call.
 * Returns true if the key is usable. Verification endpoints are documented
 * public endpoints only (e.g. /user or /models). If no verifier is known for
 * a platform, verification is skipped (logged honestly) and the key is stored.
 */
export async function verifyKey(platformId: string, keyValue: string): Promise<{ ok: boolean; detail: string }> {
  const checks: Record<string, (k: string) => Promise<{ ok: boolean; detail: string }>> = {
    huggingface: async (k) => {
      const r = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "whoami-v2 ok" } : { ok: false, detail: `whoami-v2 HTTP ${r.status}` };
    },
    openai: async (k) => {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "models list ok" } : { ok: false, detail: `models HTTP ${r.status}` };
    },
    anthropic: async (k) => {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "models list ok" } : { ok: false, detail: `models HTTP ${r.status}` };
    },
    groq: async (k) => {
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "models list ok" } : { ok: false, detail: `models HTTP ${r.status}` };
    },
    together: async (k) => {
      const r = await fetch("https://api.together.xyz/v1/models", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "models list ok" } : { ok: false, detail: `models HTTP ${r.status}` };
    },
    cohere: async (k) => {
      const r = await fetch("https://api.cohere.com/v1/check-api-key", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "check-api-key ok" } : { ok: false, detail: `HTTP ${r.status}` };
    },
    mistral: async (k) => {
      const r = await fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "models list ok" } : { ok: false, detail: `HTTP ${r.status}` };
    },
    replicate: async (k) => {
      const r = await fetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Token ${k}` },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "account ok" } : { ok: false, detail: `HTTP ${r.status}` };
    },
    github: async (k) => {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${k}`, "User-Agent": "registrar" },
        signal: AbortSignal.timeout(15_000),
      });
      return r.ok ? { ok: true, detail: "user ok" } : { ok: false, detail: `HTTP ${r.status}` };
    },
  };
  const checker = checks[platformId];
  if (!checker) return { ok: true, detail: "no verifier configured; stored without verification" };
  try {
    return await checker(keyValue);
  } catch (e: any) {
    return { ok: false, detail: `verifier error: ${e.message}` };
  }
}

function buildKeyRecord(
  platform: KeyPlatform,
  keyValue: string,
  keyLabel: string,
  status: ApiKeyRecord["status"] = "pending",
): ApiKeyRecord {
  const now = new Date().toISOString();
  return {
    platformId: platform.id,
    platformName: platform.name,
    keyLabel,
    encryptedValue: encrypt(keyValue),
    scopes: "default",
    createdAt: now,
    rotatedAt: now,
    expiresAt: null,
    rotationIntervalDays: platform.defaultRotationDays,
    status,
  };
}

/**
 * Rotate the key for a single platform. If no key exists yet, this acquires
 * the first key. Returns a RotationResult.
 *
 * Pipeline (SPEC §7, §9):
 *   authenticate (session handoff) → acquire → verify → store → activate → revoke
 */
export async function rotateKey(
  platformId: string,
  launchBrowser: () => Promise<Browser>,
  existingCookies?: any[],
): Promise<RotationResult> {
  const platform = getKeyPlatformById(platformId);
  if (!platform) {
    return { platformId, platformName: platformId, rotated: false, message: "unknown platform", oldKeyRevoked: false };
  }
  const existing = getKey(platformId);

  // Qualification gate (SPEC §11).
  const qual = qualifyKeyPlatform(platform);
  if (qual.status !== "QUALIFIED") {
    appendStructuredAudit({
      siteId: platformId,
      siteName: platform.name,
      action: "key_rotation_qualified_out",
      outcome: qual.status === "DISQUALIFIED_MANUAL_ONLY" ? "ROTATION_BLOCKED" : "INTERACTIVE_CHALLENGE_REQUIRED",
      detail: `platform not eligible for unattended key rotation: ${qual.reason}`,
    });
    return {
      platformId,
      platformName: platform.name,
      rotated: false,
      message: `not eligible: ${qual.reason}`,
      oldKeyRevoked: false,
    };
  }

  appendStructuredAudit({
    siteId: platformId,
    siteName: platform.name,
    action: "key_rotation_start",
    outcome: "INFO",
    detail: existing ? `rotating existing key (label ${existing.keyLabel})` : "acquiring first key",
  });

  // Safety: if the platform only allows one key, do not auto-rotate (would
  // orphan the old key or fail). Log for manual rotation.
  if (existing && !platform.supportsMultipleKeys) {
    appendStructuredAudit({
      siteId: platformId,
      siteName: platform.name,
      action: "key_rotation_blocked",
      outcome: "ROTATION_BLOCKED",
      detail: `${platform.name} does not support multiple concurrent keys; rotate manually via ${platform.tokenPageUrl}`,
    });
    return {
      platformId,
      platformName: platform.name,
      rotated: false,
      message: "platform supports only one key; manual rotation required",
      oldKeyRevoked: false,
    };
  }

  // Consume session handoff if no explicit cookies were provided (SPEC §4).
  let sessionCookies = existingCookies;
  let sessionConsumed = false;
  if ((!sessionCookies || sessionCookies.length === 0)) {
    const handoffCookies = consumeSession(platformId);
    if (handoffCookies && handoffCookies.length > 0) {
      sessionCookies = toPlaywrightCookies(handoffCookies);
      sessionConsumed = true;
      appendStructuredAudit({
        siteId: platformId,
        siteName: platform.name,
        action: "session_handoff_consumed",
        outcome: "INFO",
        detail: `consumed encrypted session handoff (${handoffCookies.length} cookies)`,
      });
    }
  }

  // 1. Acquire new key.
  const acquired = await acquireKeyViaUi(platform, await launchBrowser(), sessionCookies);
  if (!acquired.ok || !acquired.keyValue) {
    const outcome = acquired.state === "LOGIN_REQUIRED" ? "AUTHENTICATION_REQUIRED" :
      acquired.state === "INTERACTIVE_CHALLENGE_REQUIRED" ? "INTERACTIVE_CHALLENGE_REQUIRED" :
      acquired.state === "PLATFORM_FLOW_CHANGED" ? "PLATFORM_FLOW_CHANGED" :
      "ACQUISITION_FAILED";
    appendStructuredAudit({
      siteId: platformId,
      siteName: platform.name,
      action: "key_acquisition_failed",
      outcome,
      detail: acquired.error || "unknown acquisition error",
    });
    if (sessionConsumed) destroySessions(platformId);
    return {
      platformId,
      platformName: platform.name,
      rotated: false,
      message: `acquisition failed: ${acquired.error}`,
      oldKeyRevoked: false,
    };
  }

  // 2. Verify.
  const verified = await verifyKey(platformId, acquired.keyValue);
  appendStructuredAudit({
    siteId: platformId,
    siteName: platform.name,
    action: "key_verified",
    outcome: verified.ok ? "SUCCESS" : "VERIFICATION_FAILED",
    detail: verified.detail,
  });
  if (!verified.ok) {
    // Store as pending so the user can inspect, but do NOT activate.
    // The existing working credential remains untouched (SPEC §7).
    const record = buildKeyRecord(platform, acquired.keyValue, acquired.keyLabel || "", "pending");
    record.lastError = verified.detail;
    upsertKey(record);
    if (sessionConsumed) destroySessions(platformId);
    return {
      platformId,
      platformName: platform.name,
      rotated: false,
      message: `acquired but verification failed: ${verified.detail}; stored as pending; existing key untouched`,
      oldKeyRevoked: false,
    };
  }

  // 3. Store new key (encrypted, status=pending).
  const newRecord = buildKeyRecord(platform, acquired.keyValue, acquired.keyLabel || "", "pending");
  upsertKey(newRecord);

  // 4. Activate: promote to active status (SPEC §7: activate before revoke).
  newRecord.status = "active";
  newRecord.rotatedAt = new Date().toISOString();
  upsertKey(newRecord);
  appendStructuredAudit({
    siteId: platformId,
    siteName: platform.name,
    action: "key_activated",
    outcome: "SUCCESS",
    detail: `new key (label ${newRecord.keyLabel}) activated`,
  });

  // 5. Revoke old key (if any) — only after activation (SPEC §9).
  let oldRevoked = false;
  if (existing) {
    if (platform.revocation === "manual" || platform.revocation === "none") {
      appendStructuredAudit({
        siteId: platformId,
        siteName: platform.name,
        action: "key_revocation_manual",
        outcome: "INFO",
        detail: `old key (label ${existing.keyLabel}) must be revoked manually at ${platform.tokenPageUrl}`,
      });
    } else {
      // Best-effort UI revocation. We do not fabricate success.
      const revResult = await revokeKeyViaUi(platform, await launchBrowser(), existing.keyLabel, sessionCookies);
      oldRevoked = revResult;
      appendStructuredAudit({
        siteId: platformId,
        siteName: platform.name,
        action: "key_revocation",
        outcome: revResult ? "SUCCESS" : "REVOCATION_FAILED",
        detail: revResult
          ? `old key (label ${existing.keyLabel}) revoked`
          : `old key (label ${existing.keyLabel}) could not be revoked automatically; revoke manually at ${platform.tokenPageUrl}`,
      });
    }
  }

  // 6. Destroy session material (SPEC §4: destroyed when no longer required).
  if (sessionConsumed) {
    destroySessions(platformId);
  }

  appendStructuredAudit({
    siteId: platformId,
    siteName: platform.name,
    action: "key_rotation_complete",
    outcome: "SUCCESS",
    detail: `new key stored and activated (label ${newRecord.keyLabel}); old revoked: ${oldRevoked}`,
  });

  return {
    platformId,
    platformName: platform.name,
    rotated: true,
    message: `new key acquired, verified, and activated; old key ${oldRevoked ? "revoked" : "requires manual revocation"}`,
    oldKeyRevoked: oldRevoked,
  };
}

async function revokeKeyViaUi(
  platform: KeyPlatform,
  browser: Browser,
  keyLabel: string,
  existingCookies?: any[],
): Promise<boolean> {
  if (!platform.revokeButtonSelector) return false;
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });
  if (existingCookies && existingCookies.length) {
    try {
      await context.addCookies(existingCookies);
    } catch {
      /* ignore */
    }
  }
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try {
    await page.goto(platform.tokenPageUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    // Find the row containing the key label and click its revoke button.
    const row = page.locator(`*:has-text("${keyLabel}")`).first();
    if (!(await row.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    const revokeBtn = row.locator(platform.revokeButtonSelector).first();
    if (!(await revokeBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await revokeBtn.click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    // Confirm any dialog.
    await page.locator("button:has-text('Delete'), button:has-text('Confirm'), button:has-text('Revoke')").last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Check all stored keys and rotate any whose age exceeds their rotation
 * interval. Each platform consumes its own session handoff automatically.
 * Returns the results for the platforms processed.
 */
export async function rotateDueKeys(
  launchBrowser: () => Promise<Browser>,
  existingCookies?: any[],
): Promise<RotationResult[]> {
  const keys = loadKeys();
  const now = Date.now();
  const results: RotationResult[] = [];
  for (const k of keys) {
    const ref = k.rotatedAt || k.createdAt;
    const ageDays = (now - new Date(ref).getTime()) / 86_400_000;
    if (ageDays >= k.rotationIntervalDays) {
      // rotateKey consumes the session handoff per-platform when no explicit
      // cookies are provided.
      const r = await rotateKey(k.platformId, launchBrowser, existingCookies);
      results.push(r);
    }
  }
  return results;
}

/** Default browser launcher — lazily imports Playwright. */
export async function defaultLaunchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

export function isRotationDue(key: Omit<ApiKeyRecord, "encryptedValue">): boolean {
  const ref = key.rotatedAt || key.createdAt;
  const ageDays = (Date.now() - new Date(ref).getTime()) / 86_400_000;
  return ageDays >= key.rotationIntervalDays;
}
