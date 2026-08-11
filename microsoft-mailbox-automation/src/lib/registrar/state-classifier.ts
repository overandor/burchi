/**
 * Post-navigation state classifier (SPEC §5).
 *
 * After navigating to a platform page, classify the resulting browser state
 * as exactly one of the NavigationState values. This replaces the previous
 * "rely on missing selectors" approach with explicit detection of login
 * redirects, interactive challenges, and flow drift.
 *
 * Detection is heuristic and conservative: when in doubt, classify as a
 * terminal failure rather than as AUTHENTICATED, so the pipeline fails closed.
 */

import type { Page } from "playwright";
import type { NavigationState } from "./status-codes";

/** URL substrings that strongly indicate a login/auth redirect. */
const LOGIN_URL_HINTS = [
  "/login",
  "/signin",
  "/sign-in",
  "/sign_in",
  "/auth",
  "/account/login",
  "/session/new",
  "/oauth/authorize",
  "/sso",
  "/challenge",
];

/** Heuristics that indicate an interactive challenge (CAPTCHA/MFA/etc.). */
const CAPTCHA_HINTS = [
  "iframe[src*='captcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='recaptcha']",
  "iframe[src*='turnstile']",
  "iframe[title*='captcha' i]",
  "div[class*='captcha' i]",
  "#captcha",
  "img[alt*='captcha' i]",
];

const MFA_HINTS = [
  "input[name*='code' i][autocomplete*='one-time-code' i]",
  "input[placeholder*='authentication code' i]",
  "input[placeholder*='verification code' i]",
  "text=Enter the code from your authenticator",
  "text=Two-factor authentication",
  "text=Verify it's you",
  "text=Approve from your device",
];

export interface ClassificationResult {
  state: NavigationState;
  /** Human-readable evidence for the classification (no secrets). */
  evidence: string;
}

async function anyVisible(page: Page, selectors: string[], timeoutMs = 1500): Promise<string | null> {
  for (const sel of selectors) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: timeoutMs }).catch(() => false)) {
        return sel;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Classify the browser state after navigating to `targetUrl`.
 *
 * @param page         the Playwright page (already navigated)
 * @param targetUrl    the URL we intended to reach
 * @param uiSelectors  selectors that indicate the credential UI is present
 */
export async function classifyNavigationState(
  page: Page,
  targetUrl: string,
  uiSelectors: string[],
): Promise<ClassificationResult> {
  const currentUrl = page.url();

  // 1. Login redirect detection.
  const lowered = currentUrl.toLowerCase();
  const loginHit = LOGIN_URL_HINTS.find((h) => lowered.includes(h));
  if (loginHit && !currentUrlSamePath(currentUrl, targetUrl)) {
    return {
      state: "LOGIN_REQUIRED",
      evidence: `redirected to ${currentUrl} (matched "${loginHit}")`,
    };
  }

  // 2. Interactive challenge detection (CAPTCHA).
  const captchaSel = await anyVisible(page, CAPTCHA_HINTS);
  if (captchaSel) {
    return {
      state: "INTERACTIVE_CHALLENGE_REQUIRED",
      evidence: `captcha element visible: ${captchaSel}`,
    };
  }

  // 3. MFA / 2FA detection.
  const mfaSel = await anyVisible(page, MFA_HINTS);
  if (mfaSel) {
    return {
      state: "INTERACTIVE_CHALLENGE_REQUIRED",
      evidence: `mfa element visible: ${mfaSel}`,
    };
  }

  // 4. Credential UI presence.
  if (uiSelectors.length === 0) {
    // No selectors configured — can't confirm UI; fail closed.
    return {
      state: "CREDENTIAL_UI_UNAVAILABLE",
      evidence: "no UI selectors configured for this platform",
    };
  }
  const uiHit = await anyVisible(page, uiSelectors, 3000);
  if (uiHit) {
    return {
      state: "CREDENTIAL_UI_AVAILABLE",
      evidence: `credential UI element visible: ${uiHit}`,
    };
  }

  // 5. Page loaded but expected UI missing — flow drift or unavailable.
  // Distinguish: if the page body contains generic login-ish text, treat as
  // login required; otherwise flow changed.
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/sign\s*in|log\s*in|sign\s*up|create account/i.test(bodyText.slice(0, 500)) && /password/i.test(bodyText)) {
    return {
      state: "LOGIN_REQUIRED",
      evidence: "login form detected in page body (no explicit redirect)",
    };
  }
  return {
    state: "PLATFORM_FLOW_CHANGED",
    evidence: `page loaded at ${currentUrl} but none of ${uiSelectors.length} configured UI selectors matched`,
  };
}

function currentUrlSamePath(current: string, target: string): boolean {
  try {
    return new URL(current).pathname === new URL(target).pathname;
  } catch {
    return current === target;
  }
}

/**
 * For the signup runner: classify the signup page state. Reuses the same
 * classifier but with signup-specific UI selectors (submit button + form fields).
 */
export async function classifySignupState(
  page: Page,
  signupUrl: string,
  submitSelector?: string,
): Promise<ClassificationResult> {
  const uiSelectors = submitSelector
    ? [submitSelector, "button[type=submit]", "input[type=submit]", "form"]
    : ["button[type=submit]", "input[type=submit]", "form"];
  return classifyNavigationState(page, signupUrl, uiSelectors);
}
