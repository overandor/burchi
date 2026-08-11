/**
 * Registrar — autonomous account-registration agent.
 *
 * Registers ONE real user across many free services, hands-off, with an
 * append-only audit log readable asynchronously (e.g. via a Braille display).
 *
 * Hard limits (enforced by design):
 *   - No CAPTCHA bypass. Blocked sites are logged and skipped, or an
 *     accessibility-accommodation email is auto-sent to the site's contact.
 *   - ToS text is extracted, summarized, logged, and auto-accepted only for
 *     low-risk free services. A full record is retained for later review.
 */

export type SignupStrategy =
  | "email_only" // email + password only, no CAPTCHA
  | "email_verify" // email + password + click verification link
  | "oauth_google" // "Sign in with Google"
  | "oauth_microsoft" // "Sign in with Microsoft"
  | "oauth_apple" // "Sign in with Apple"
  | "manual_accommodation"; // requires human/accommodation path — logged, not auto-run

export type RiskTier = "low" | "medium" | "high";

export interface SiteSignupField {
  /** DOM selector or heuristic label fragment. */
  selector?: string;
  /** Field label text to match if no selector. */
  label?: string;
  /** Type of value to fill from the identity vault. */
  fill: "email" | "password" | "firstName" | "lastName" | "username" | "fullName" | "phone" | "birthdate" | "custom";
  customValue?: string;
  /** Whether the field is required. */
  required?: boolean;
}

export interface SiteCatalogEntry {
  id: string; // stable slug, e.g. "protonmail"
  name: string;
  url: string; // homepage
  signupUrl: string; // direct signup page
  category: string; // e.g. "email", "storage", "code"
  description: string;
  strategy: SignupStrategy;
  risk: RiskTier;
  free: boolean;
  /** Expected form fields in submission order. */
  fields: SiteSignupField[];
  /** Selector for the submit button. */
  submitSelector?: string;
  /** Whether a CAPTCHA is known to appear on this signup. */
  hasCaptcha: boolean;
  /** Accessibility contact email, if known, for accommodation requests. */
  accessibilityContact?: string;
  /** Verification email sender substring to match in the mailbox. */
  verificationSenderContains?: string;
  /** Whether the service is known to require phone verification. */
  requiresPhone?: boolean;
  /** Tags used by the suggester to match a needs profile. */
  tags: string[];
}

export interface IdentityProfile {
  email: string;
  firstName: string;
  lastName: string;
  /** Preferred username stem; per-site username derived from this. */
  usernameStem: string;
  phone?: string;
  birthdate?: string; // ISO
  /** Needs-profile tags the suggester matches against site tags. */
  needs: string[];
}

export interface StoredCredential {
  siteId: string;
  siteName: string;
  username: string;
  password: string;
  email: string;
  registeredAt: string;
  status: "registered" | "blocked_captcha" | "blocked_phone" | "failed" | "pending";
  notes?: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  siteId: string;
  siteName: string;
  action: string;
  outcome: "success" | "blocked" | "failed" | "info";
  /** Structured outcome code (SPEC §12). Populated by the refactored pipeline. */
  code?: string;
  detail: string;
  tosSummary?: string;
  tosAccepted?: boolean;
}

export interface Suggestion {
  site: SiteCatalogEntry;
  reason: string;
  matchScore: number;
}

export interface RunResult {
  siteId: string;
  siteName: string;
  status: StoredCredential["status"];
  message: string;
  durationMs: number;
  /** Structured failure code (SPEC §3) when the run terminated on a challenge. */
  code?: string;
  /** Session handoff id, when a reusable session was exported. */
  sessionId?: string;
}
