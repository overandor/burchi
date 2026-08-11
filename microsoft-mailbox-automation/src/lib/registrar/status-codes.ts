/**
 * Structured status codes for the credential pipeline.
 *
 * Single source of truth. Every module returns/audits these codes instead of
 * free-form strings, so the pipeline's behavior is machine-checkable and the
 * spec (SPEC.md §5, §12) is enforced by the type system.
 */

/** Post-navigation browser state (SPEC §5). */
export type NavigationState =
  | "AUTHENTICATED"
  | "LOGIN_REQUIRED"
  | "INTERACTIVE_CHALLENGE_REQUIRED"
  | "CREDENTIAL_UI_AVAILABLE"
  | "CREDENTIAL_UI_UNAVAILABLE"
  | "PLATFORM_FLOW_CHANGED";

/** Structured audit outcome (SPEC §12). */
export type AuditOutcome =
  | "SUCCESS"
  | "AUTHENTICATION_REQUIRED"
  | "INTERACTIVE_CHALLENGE_REQUIRED"
  | "ACQUISITION_FAILED"
  | "VERIFICATION_FAILED"
  | "STORAGE_FAILED"
  | "ROTATION_BLOCKED"
  | "REVOCATION_FAILED"
  | "PLATFORM_FLOW_CHANGED"
  | "INFO";

/** Structured failure code for a terminated platform operation. */
export type FailureCode =
  | "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE"
  | "AUTHENTICATION_REQUIRED"
  | "ACQUISITION_FAILED"
  | "VERIFICATION_FAILED"
  | "STORAGE_FAILED"
  | "ROTATION_BLOCKED"
  | "REVOCATION_FAILED"
  | "PLATFORM_FLOW_CHANGED";

/** Map a navigation state to the failure code that terminates the operation. */
export function failureCodeForState(state: NavigationState): FailureCode | null {
  switch (state) {
    case "INTERACTIVE_CHALLENGE_REQUIRED":
      return "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE";
    case "LOGIN_REQUIRED":
      return "AUTHENTICATION_REQUIRED";
    case "PLATFORM_FLOW_CHANGED":
      return "PLATFORM_FLOW_CHANGED";
    case "CREDENTIAL_UI_UNAVAILABLE":
      return "ACQUISITION_FAILED";
    default:
      return null;
  }
}

/** Map a navigation state to the audit outcome it produces. */
export function auditOutcomeForState(state: NavigationState): AuditOutcome {
  switch (state) {
    case "INTERACTIVE_CHALLENGE_REQUIRED":
      return "INTERACTIVE_CHALLENGE_REQUIRED";
    case "LOGIN_REQUIRED":
      return "AUTHENTICATION_REQUIRED";
    case "PLATFORM_FLOW_CHANGED":
      return "PLATFORM_FLOW_CHANGED";
    case "CREDENTIAL_UI_UNAVAILABLE":
      return "ACQUISITION_FAILED";
    default:
      return "INFO";
  }
}

/** True when a navigation state is a hard terminal failure (SPEC §3, §11). */
export function isTerminalFailure(state: NavigationState): boolean {
  return (
    state === "LOGIN_REQUIRED" ||
    state === "INTERACTIVE_CHALLENGE_REQUIRED" ||
    state === "PLATFORM_FLOW_CHANGED" ||
    state === "CREDENTIAL_UI_UNAVAILABLE"
  );
}

/** True when the state indicates the credential UI is operable. */
export function isCredentialUiReady(state: NavigationState): boolean {
  return state === "AUTHENTICATED" || state === "CREDENTIAL_UI_AVAILABLE";
}

/**
 * Qualification of a platform for the zero-human pipeline (SPEC §11).
 * A platform qualifies only when EVERY stage can run non-interactively.
 */
export type QualificationStatus = "QUALIFIED" | "DISQUALIFIED_INTERACTIVE_CHALLENGE" | "DISQUALIFIED_MANUAL_ONLY";

export const QUALIFICATION_REASONS = {
  QUALIFIED: "all stages executable via supported non-interactive mechanisms",
  DISQUALIFIED_INTERACTIVE_CHALLENGE: "platform introduces an unavoidable interactive challenge (CAPTCHA/MFA/consent)",
  DISQUALIFIED_MANUAL_ONLY: "acquisition method is manual; no automation path exists",
} as const;
