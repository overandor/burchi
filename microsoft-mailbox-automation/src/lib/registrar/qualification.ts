/**
 * Platform qualification for the zero-human pipeline (SPEC §11).
 *
 * A platform qualifies only when EVERY required stage can execute through
 * supported non-interactive mechanisms. This module computes qualification
 * from the platform's declared properties — it does not guess.
 */

import type { KeyPlatform } from "./key-types";
import type { SiteCatalogEntry } from "./types";
import type { QualificationStatus } from "./status-codes";
import { QUALIFICATION_REASONS } from "./status-codes";

export interface QualificationResult {
  status: QualificationStatus;
  reason: string;
  /** The specific stage that disqualifies the platform, if any. */
  blockingStage?: string;
}

/**
 * Qualify a KEY PLATFORM for the zero-human credential lifecycle.
 *
 * Disqualifying conditions:
 *   - acquisition is `manual` (no automation path).
 *   - the platform is known to require CAPTCHA/MFA on the token page (we
 *     approximate this conservatively: any platform whose acquisition is
 *     `ui_playwright` and that is in the known-interactive set is flagged).
 */
const KNOWN_INTERACTIVE_KEY_PLATFORMS = new Set<string>([
  // Platforms whose token pages are known to sometimes present 2FA/CAPTCHA on
  // sensitive operations. Listed conservatively; removal when verified.
  "google-cloud", // frequently challenges with 2FA on credentials page
]);

export function qualifyKeyPlatform(platform: KeyPlatform): QualificationResult {
  if (platform.acquisition === "manual") {
    return {
      status: "DISQUALIFIED_MANUAL_ONLY",
      reason: QUALIFICATION_REASONS.DISQUALIFIED_MANUAL_ONLY,
      blockingStage: "acquire",
    };
  }
  if (KNOWN_INTERACTIVE_KEY_PLATFORMS.has(platform.id)) {
    return {
      status: "DISQUALIFIED_INTERACTIVE_CHALLENGE",
      reason: `${QUALIFICATION_REASONS.DISQUALIFIED_INTERACTIVE_CHALLENGE} (known interactive challenge on ${platform.name})`,
      blockingStage: "acquire",
    };
  }
  // Platforms with `api` acquisition are fully qualified. `ui_playwright`
  // platforms are qualified *conditionally* — they require an existing session
  // and may still hit an interactive challenge at runtime, which the state
  // classifier will catch. We mark them qualified but the runtime guard holds.
  return {
    status: "QUALIFIED",
    reason: QUALIFICATION_REASONS.QUALIFIED,
  };
}

/**
 * Qualify a SIGNUP SITE for the zero-human provisioning pipeline.
 *
 * Disqualifying conditions:
 *   - hasCaptcha is true (the site is known to present a CAPTCHA).
 *   - requiresPhone is true (phone verification is an interactive challenge
 *     unless a phone is owned and verified, which is out of scope here).
 *   - strategy is `manual_accommodation`.
 */
export function qualifySignupSite(site: SiteCatalogEntry): QualificationResult {
  if (site.strategy === "manual_accommodation") {
    return {
      status: "DISQUALIFIED_MANUAL_ONLY",
      reason: QUALIFICATION_REASONS.DISQUALIFIED_MANUAL_ONLY,
      blockingStage: "provision",
    };
  }
  if (site.hasCaptcha) {
    return {
      status: "DISQUALIFIED_INTERACTIVE_CHALLENGE",
      reason: `${QUALIFICATION_REASONS.DISQUALIFIED_INTERACTIVE_CHALLENGE} (site declares hasCaptcha=true)`,
      blockingStage: "provision",
    };
  }
  if (site.requiresPhone) {
    return {
      status: "DISQUALIFIED_INTERACTIVE_CHALLENGE",
      reason: `${QUALIFICATION_REASONS.DISQUALIFIED_INTERACTIVE_CHALLENGE} (phone verification required)`,
      blockingStage: "verify",
    };
  }
  return {
    status: "QUALIFIED",
    reason: QUALIFICATION_REASONS.QUALIFIED,
  };
}

/** Convenience: filter a list of signup sites to only qualified ones. */
export function filterQualifiedSignupSites(sites: SiteCatalogEntry[]): SiteCatalogEntry[] {
  return sites.filter((s) => qualifySignupSite(s).status === "QUALIFIED");
}

/** Convenience: filter a list of key platforms to only qualified ones. */
export function filterQualifiedKeyPlatforms(platforms: KeyPlatform[]): KeyPlatform[] {
  return platforms.filter((p) => qualifyKeyPlatform(p).status === "QUALIFIED");
}
