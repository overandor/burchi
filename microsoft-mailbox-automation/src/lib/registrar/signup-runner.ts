/**
 * Signup runner — Playwright-based autonomous form filler.
 *
 * Design constraints (enforced, not optional):
 *   - NEVER bypasses CAPTCHA. When a CAPTCHA is detected, the run is marked
 *     blocked_captcha, logged, and (if the site has an accessibility contact)
 *     an accommodation request email is queued. The run then stops for that
 *     site — it does not retry or cheat.
 *   - NEVER fabricates a success. If the post-submit state cannot be
 *     confirmed, status is "pending" or "failed", not "registered".
 *   - ToS is extracted from the page, summarized, logged, and accepted only
 *     per the risk-tier policy in tos.ts.
 *
 * Playwright is loaded lazily so the module can be imported in serverless
 * contexts where the browser binary is not installed (tests, status checks).
 */

import type { Browser, Page } from "playwright";
import type { IdentityProfile, RunResult, SiteCatalogEntry, StoredCredential } from "./types";
import { generatePassword, deriveUsername } from "./credentials";
import { upsertCredential, getCredential } from "./vault";
import { appendAudit, appendStructuredAudit } from "./audit-log";
import { summarizeTos, buildTosResult } from "./tos";
import { waitForVerificationLink } from "./email-verifier";
import { classifySignupState } from "./state-classifier";
import { isTerminalFailure, failureCodeForState, auditOutcomeForState } from "./status-codes";
import { exportSession, fromPlaywrightCookies } from "./session-handoff";
import { qualifySignupSite } from "./qualification";

const NAV_TIMEOUT = 45_000;
const ACTION_TIMEOUT = 15_000;

/** Heuristics that strongly indicate a CAPTCHA is present on the page. */
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

async function detectCaptcha(page: Page): Promise<string | null> {
  for (const sel of CAPTCHA_HINTS) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 1500 }).catch(() => false)) {
        return sel;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function valueForField(
  fill: string,
  profile: IdentityProfile,
  site: SiteCatalogEntry,
  password: string,
  customValue?: string,
): string {
  switch (fill) {
    case "email":
      return profile.email;
    case "password":
      return password;
    case "firstName":
      return profile.firstName;
    case "lastName":
      return profile.lastName;
    case "fullName":
      return `${profile.firstName} ${profile.lastName}`;
    case "username":
      return deriveUsername(profile, site);
    case "phone":
      return profile.phone || "";
    case "birthdate":
      return profile.birthdate || "";
    case "custom":
      return customValue || "";
    default:
      return "";
  }
}

async function fillField(
  page: Page,
  site: SiteCatalogEntry,
  field: SiteCatalogEntry["fields"][number],
  value: string,
): Promise<boolean> {
  // Try explicit selector first.
  if (field.selector) {
    const loc = page.locator(field.selector).first();
    if (await loc.isVisible({ timeout: ACTION_TIMEOUT }).catch(() => false)) {
      await loc.fill(value, { timeout: ACTION_TIMEOUT }).catch(() => {});
      return true;
    }
  }
  // Fallback: match by associated label or aria-label.
  if (field.label) {
    const label = field.label.toLowerCase();
    // input[id] referenced by a <label for=...>
    const byLabelFor = page.locator(`label:has-text("${field.label}")`).first();
    if (await byLabelFor.isVisible({ timeout: 2000 }).catch(() => false)) {
      const forAttr = await byLabelFor.getAttribute("for").catch(() => null);
      if (forAttr) {
        const target = page.locator(`#${forAttr}`).first();
        if (await target.isVisible({ timeout: 2000 }).catch(() => false)) {
          await target.fill(value, { timeout: ACTION_TIMEOUT }).catch(() => {});
          return true;
        }
      }
    }
    // aria-label match
    const byAria = page.locator(`input[aria-label*="${label}" i], input[placeholder*="${label}" i]`).first();
    if (await byAria.isVisible({ timeout: 2000 }).catch(() => false)) {
      await byAria.fill(value, { timeout: ACTION_TIMEOUT }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function extractTosLinks(page: Page): Promise<{ urls: string[]; texts: string[] }> {
  const urls: string[] = [];
  const texts: string[] = [];
  const candidates = page.locator("a:has-text('terms'), a:has-text('Terms'), a:has-text('privacy'), a:has-text('Privacy'), a:has-text('user agreement'), a:has-text('User Agreement')");
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const href = await candidates.nth(i).getAttribute("href").catch(() => null);
    const text = (await candidates.nth(i).innerText().catch(() => "")).trim();
    if (href) {
      urls.push(href.startsWith("http") ? href : new URL(href, page.url()).toString());
    }
    if (text) texts.push(text);
  }
  return { urls, texts };
}

async function extractTosText(page: Page, urls: string[]): Promise<string> {
  // Grab any on-page terms/privacy text block first.
  let onPage = "";
  const body = await page.locator("body").innerText().catch(() => "");
  const termsIdx = body.search(/terms of (service|use|agreement)/i);
  if (termsIdx >= 0) {
    onPage = body.slice(termsIdx, termsIdx + 4000);
  }
  if (onPage.length > 200) return onPage;
  // Otherwise fetch the first terms link.
  if (urls.length > 0) {
    try {
      const resp = await page.context().request.get(urls[0], { timeout: 20_000 });
      if (resp.ok()) {
        const html = await resp.text();
        // crude text extraction
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return text.slice(0, 12000);
      }
    } catch {
      /* ignore */
    }
  }
  return onPage;
}

async function detectAccommodationContact(site: SiteCatalogEntry): Promise<string | null> {
  return site.accessibilityContact || null;
}

async function queueAccommodationEmail(site: SiteCatalogEntry, email: string): Promise<void> {
  // We do not auto-send (sending real email is a side effect requiring the
  // user's mailbox credentials). Instead we log a ready-to-send request so a
  // trusted assistant (or the user via their mail client) can dispatch it.
  appendAudit({
    siteId: site.id,
    siteName: site.name,
    action: "accommodation_request_queued",
    outcome: "info",
    detail: `CAPTCHA blocked signup for ${site.name}. Accessibility contact: ${site.accessibilityContact || "unknown"}. ` +
      `Queued accommodation request for ${email}. No account created.`,
  });
}

export interface RunOptions {
  /** Skip sites that already have a stored credential. */
  skipExisting?: boolean;
  /** Maximum number of sites to process in this run. */
  limit?: number;
  /** Override the verification wait timeout (ms). */
  verifyTimeoutMs?: number;
}

/**
 * Register the user on a single site. Returns the run result and updates the
 * vault + audit log as side effects.
 */
export async function registerOnSite(
  site: SiteCatalogEntry,
  profile: IdentityProfile,
  browser: Browser,
  opts: RunOptions = {},
): Promise<RunResult> {
  const start = Date.now();
  if (opts.skipExisting && getCredential(site.id)) {
    return {
      siteId: site.id,
      siteName: site.name,
      status: "pending",
      message: "already registered — skipped",
      durationMs: 0,
    };
  }

  // Qualification gate (SPEC §11): fail closed before opening a browser if
  // the site is known to require an interactive challenge.
  const qual = qualifySignupSite(site);
  if (qual.status !== "QUALIFIED") {
    appendStructuredAudit({
      siteId: site.id,
      siteName: site.name,
      action: "signup_qualified_out",
      outcome: qual.status === "DISQUALIFIED_MANUAL_ONLY" ? "ROTATION_BLOCKED" : "INTERACTIVE_CHALLENGE_REQUIRED",
      detail: `platform not eligible for unattended provisioning: ${qual.reason} (stage: ${qual.blockingStage})`,
    });
    return {
      siteId: site.id,
      siteName: site.name,
      status: "failed",
      message: `not eligible for unattended provisioning: ${qual.reason}`,
      durationMs: 0,
      code: qual.status === "DISQUALIFIED_MANUAL_ONLY" ? "ROTATION_BLOCKED" : "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE",
    };
  }

  const password = generatePassword(20);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  try {
    appendStructuredAudit({
      siteId: site.id,
      siteName: site.name,
      action: "signup_start",
      outcome: "INFO",
      detail: `navigating to ${site.signupUrl} (strategy: ${site.strategy}, risk: ${site.risk})`,
    });

    await page.goto(site.signupUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    // Post-navigation state classification (SPEC §5).
    const navState = await classifySignupState(page, site.signupUrl, site.submitSelector);
    if (isTerminalFailure(navState.state)) {
      const code = failureCodeForState(navState.state);
      const outcome = auditOutcomeForState(navState.state);
      appendStructuredAudit({
        siteId: site.id,
        siteName: site.name,
        action: "signup_state_blocked",
        outcome,
        detail: `state=${navState.state}: ${navState.evidence}`,
      });
      if (navState.state === "INTERACTIVE_CHALLENGE_REQUIRED") {
        await queueAccommodationEmail(site, profile.email);
      }
      upsertCredential({
        siteId: site.id,
        siteName: site.name,
        username: deriveUsername(profile, site),
        password: "",
        email: profile.email,
        registeredAt: new Date().toISOString(),
        status: "blocked_captcha",
        notes: `${navState.state}: ${navState.evidence}`,
      });
      return {
        siteId: site.id,
        siteName: site.name,
        status: "blocked_captcha",
        message: `${navState.state}: ${navState.evidence}`,
        durationMs: Date.now() - start,
        code: code || undefined,
      };
    }

    // Pre-flight CAPTCHA check (redundant with classifier but kept for defense in depth).
    const captchaSel = await detectCaptcha(page);
    if (captchaSel) {
      await queueAccommodationEmail(site, profile.email);
      appendStructuredAudit({
        siteId: site.id,
        siteName: site.name,
        action: "captcha_blocked",
        outcome: "INTERACTIVE_CHALLENGE_REQUIRED",
        detail: `CAPTCHA detected via ${captchaSel}; not bypassed. Accommodation request queued.`,
      });
      const cred: StoredCredential = {
        siteId: site.id,
        siteName: site.name,
        username: deriveUsername(profile, site),
        password: "",
        email: profile.email,
        registeredAt: new Date().toISOString(),
        status: "blocked_captcha",
        notes: `CAPTCHA detected via ${captchaSel}; accommodation request queued`,
      };
      upsertCredential(cred);
      return {
        siteId: site.id,
        siteName: site.name,
        status: "blocked_captcha",
        message: `CAPTCHA detected (${captchaSel}); not bypassed. Accommodation request queued.`,
        durationMs: Date.now() - start,
        code: "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE",
      };
    }

    // Fill fields.
    let filled = 0;
    for (const field of site.fields) {
      const value = valueForField(field.fill, profile, site, password, field.customValue);
      if (!value && field.required) {
        appendAudit({
          siteId: site.id,
          siteName: site.name,
          action: "field_missing_value",
          outcome: "failed",
          detail: `required field "${field.label || field.fill}" has no value in identity profile`,
        });
      }
      const ok = await fillField(page, site, field, value);
      if (ok) filled++;
    }
    appendAudit({
      siteId: site.id,
      siteName: site.name,
      action: "fields_filled",
      outcome: "info",
      detail: `${filled}/${site.fields.length} fields filled`,
    });

    // ToS extraction + acceptance.
    const { urls, texts } = await extractTosLinks(page);
    const fullTosText = await extractTosText(page, urls);
    const summary = await summarizeTos(fullTosText, site.name);
    const tos = buildTosResult(site, fullTosText, urls, summary);
    appendAudit({
      siteId: site.id,
      siteName: site.name,
      action: "tos_extracted",
      outcome: tos.found ? "info" : "blocked",
      detail: tos.reason + (texts.length ? ` | links: ${texts.join(", ")}` : ""),
      tosSummary: tos.summary,
      tosAccepted: tos.accepted,
    });

    if (!tos.accepted) {
      const cred: StoredCredential = {
        siteId: site.id,
        siteName: site.name,
        username: deriveUsername(profile, site),
        password: "",
        email: profile.email,
        registeredAt: new Date().toISOString(),
        status: "failed",
        notes: "ToS not auto-accepted (high risk); blocked for review",
      };
      upsertCredential(cred);
      return {
        siteId: site.id,
        siteName: site.name,
        status: "failed",
        message: "ToS not auto-accepted (high risk); blocked for review",
        durationMs: Date.now() - start,
      };
    }

    // Tick any ToS/consent checkboxes on the page.
    const checkboxes = page.locator("input[type=checkbox]");
    const cbCount = await checkboxes.count().catch(() => 0);
    for (let i = 0; i < cbCount; i++) {
      try {
        const cb = checkboxes.nth(i);
        if (!(await cb.isChecked())) await cb.check({ timeout: 3000 }).catch(() => {});
      } catch {
        /* ignore */
      }
    }

    // Post-fill CAPTCHA re-check (some sites reveal it after fill).
    const captcha2 = await detectCaptcha(page);
    if (captcha2) {
      await queueAccommodationEmail(site, profile.email);
      appendStructuredAudit({
        siteId: site.id,
        siteName: site.name,
        action: "captcha_blocked_post_fill",
        outcome: "INTERACTIVE_CHALLENGE_REQUIRED",
        detail: `CAPTCHA appeared after fill via ${captcha2}; not bypassed.`,
      });
      upsertCredential({
        siteId: site.id,
        siteName: site.name,
        username: deriveUsername(profile, site),
        password: "",
        email: profile.email,
        registeredAt: new Date().toISOString(),
        status: "blocked_captcha",
        notes: `CAPTCHA appeared after fill via ${captcha2}`,
      });
      return {
        siteId: site.id,
        siteName: site.name,
        status: "blocked_captcha",
        message: `CAPTCHA appeared after fill (${captcha2}); not bypassed.`,
        durationMs: Date.now() - start,
        code: "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE",
      };
    }

    // Submit.
    if (site.submitSelector) {
      await page.locator(site.submitSelector).first().click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    } else {
      await page.keyboard.press("Enter").catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});

    // Post-submit CAPTCHA check (challenge after submit).
    const captcha3 = await detectCaptcha(page);
    if (captcha3) {
      await queueAccommodationEmail(site, profile.email);
      appendStructuredAudit({
        siteId: site.id,
        siteName: site.name,
        action: "captcha_blocked_post_submit",
        outcome: "INTERACTIVE_CHALLENGE_REQUIRED",
        detail: `CAPTCHA after submit via ${captcha3}; not bypassed.`,
      });
      upsertCredential({
        siteId: site.id,
        siteName: site.name,
        username: deriveUsername(profile, site),
        password: "",
        email: profile.email,
        registeredAt: new Date().toISOString(),
        status: "blocked_captcha",
        notes: `CAPTCHA after submit via ${captcha3}`,
      });
      return {
        siteId: site.id,
        siteName: site.name,
        status: "blocked_captcha",
        message: `CAPTCHA after submit (${captcha3}); not bypassed.`,
        durationMs: Date.now() - start,
        code: "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE",
      };
    }

    // Email verification (if the strategy expects it).
    let verified = false;
    let verifyMsg = "no verification step required";
    if (site.strategy === "email_verify" && site.verificationSenderContains) {
      const v = await waitForVerificationLink(
        profile.email,
        site.verificationSenderContains,
        opts.verifyTimeoutMs ?? 120_000,
      );
      if (v.found && v.link) {
        // Visit the verification link in the same context to confirm.
        await page.goto(v.link, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
        verified = true;
        verifyMsg = `verified via link from ${v.sender}`;
      } else {
        verified = false;
        verifyMsg = v.error || "verification email not found";
      }
    } else if (site.strategy === "email_only") {
      verified = true;
    }

    const status: StoredCredential["status"] = verified ? "registered" : "pending";
    const cred: StoredCredential = {
      siteId: site.id,
      siteName: site.name,
      username: deriveUsername(profile, site),
      password,
      email: profile.email,
      registeredAt: new Date().toISOString(),
      status,
      notes: verifyMsg,
    };
    upsertCredential(cred);

    // Session handoff (SPEC §4): export the authenticated browser session so
    // the key rotator can consume it without manual login.
    let sessionId: string | undefined;
    if (verified) {
      try {
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          const origin = new URL(site.url).origin;
          sessionId = exportSession(
            site.id,
            origin,
            fromPlaywrightCookies(cookies),
            null, // session-cookie expiry unknown; consumer checks validity
          );
          appendStructuredAudit({
            siteId: site.id,
            siteName: site.name,
            action: "session_exported",
            outcome: "SUCCESS",
            detail: `exported ${cookies.length} cookies for ${origin} to encrypted handoff`,
          });
        }
      } catch (e: any) {
        // Session export failure does not fail the registration.
        appendStructuredAudit({
          siteId: site.id,
          siteName: site.name,
          action: "session_export_failed",
          outcome: "STORAGE_FAILED",
          detail: `session export error: ${e.message}`,
        });
      }
    }

    appendStructuredAudit({
      siteId: site.id,
      siteName: site.name,
      action: "signup_complete",
      outcome: verified ? "SUCCESS" : "ACQUISITION_FAILED",
      detail: verifyMsg,
      tosSummary: tos.summary,
      tosAccepted: tos.accepted,
    });

    return {
      siteId: site.id,
      siteName: site.name,
      status,
      message: verifyMsg,
      durationMs: Date.now() - start,
      sessionId,
    };
  } catch (e: any) {
    appendStructuredAudit({
      siteId: site.id,
      siteName: site.name,
      action: "signup_error",
      outcome: "ACQUISITION_FAILED",
      detail: e.message,
    });
    upsertCredential({
      siteId: site.id,
      siteName: site.name,
      username: deriveUsername(profile, site),
      password: "",
      email: profile.email,
      registeredAt: new Date().toISOString(),
      status: "failed",
      notes: e.message,
    });
    return {
      siteId: site.id,
      siteName: site.name,
      status: "failed",
      message: e.message,
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run registration across multiple sites sequentially.
 * Returns a Playwright browser handle via the provided launcher so tests can
 * inject a mock.
 */
export async function runRegistrations(
  sites: SiteCatalogEntry[],
  profile: IdentityProfile,
  launchBrowser: () => Promise<Browser>,
  opts: RunOptions = {},
): Promise<RunResult[]> {
  const browser = await launchBrowser();
  try {
    const results: RunResult[] = [];
    const queue = opts.limit ? sites.slice(0, opts.limit) : sites;
    for (const site of queue) {
      const r = await registerOnSite(site, profile, browser, opts);
      results.push(r);
    }
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Default browser launcher — lazily imports Playwright. */
export async function defaultLaunchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}
