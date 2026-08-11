/**
 * Registrar — public entry point.
 *
 * Orchestrates identity, catalog, suggestion, signup, ToS handling, email
 * verification, and the append-only audit log.
 */

export * from "./types";
export * from "./vault";
export * from "./catalog";
export * from "./audit-log";
export * from "./tos";
export * from "./credentials";
export * from "./email-verifier";
export {
  registerOnSite,
  runRegistrations,
  defaultLaunchBrowser as defaultLaunchSignupBrowser,
} from "./signup-runner";
export type { RunOptions } from "./signup-runner";
export * from "./suggester";
export * from "./crypto";
export * from "./key-types";
export * from "./key-vault";
export * from "./key-providers";
export {
  acquireKeyViaUi,
  verifyKey,
  rotateKey,
  rotateDueKeys,
  defaultLaunchBrowser,
  isRotationDue,
} from "./key-rotator";
export * from "./status-codes";
export * from "./state-classifier";
export * from "./session-handoff";
export * from "./qualification";

import { loadIdentity } from "./vault";
import { suggestServices } from "./suggester";
import { SITE_CATALOG, getSiteById } from "./catalog";
import { runRegistrations, defaultLaunchBrowser, registerOnSite } from "./signup-runner";
import type { IdentityProfile, RunResult, SiteCatalogEntry } from "./types";

/** Require an identity profile to exist before any registration run. */
export function requireIdentity(): IdentityProfile {
  const id = loadIdentity();
  if (!id) {
    throw new Error(
      "No identity profile configured. POST to /api/registrar/vault with your profile first.",
    );
  }
  return id;
}

/** Register on every suggested site the user doesn't already have. */
export async function registerOnSuggested(limit?: number): Promise<RunResult[]> {
  const profile = requireIdentity();
  const suggestions = suggestServices(profile, 50);
  const sites = suggestions.map((s) => s.site);
  return runRegistrations(sites, profile, defaultLaunchBrowser, { skipExisting: true, limit });
}

/** Register on a single site by id. */
export async function registerOnSiteById(siteId: string): Promise<RunResult> {
  const profile = requireIdentity();
  const site = getSiteById(siteId);
  if (!site) throw new Error(`unknown site: ${siteId}`);
  const browser = await defaultLaunchBrowser();
  try {
    return registerOnSite(site, profile, browser, { skipExisting: false });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Register on every site in the catalog the user doesn't already have. */
export async function registerOnAll(limit?: number): Promise<RunResult[]> {
  const profile = requireIdentity();
  return runRegistrations(SITE_CATALOG, profile, defaultLaunchBrowser, {
    skipExisting: true,
    limit,
  });
}

export function listCatalog(): SiteCatalogEntry[] {
  return SITE_CATALOG;
}
