/**
 * Shared types for the registrar cockpit UI.
 * Mirrors the API response shapes from /api/registrar/*.
 */

export interface PlatformHealth {
  id: string;
  name: string;
  health: "healthy" | "degraded" | "critical";
  qualified: boolean;
  qualificationStatus: string;
  hasKey: boolean;
  keyStatus?: string;
  rotationDue: boolean;
  acquisition: string;
  revocation: string;
  supportsMultipleKeys: boolean;
  automationScore: number;
}

export interface AttentionItem {
  platform: string;
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface UpcomingRotation {
  platformId: string;
  platformName: string;
  keyLabel: string;
  due: boolean;
  rotatedAt: string;
  rotationIntervalDays: number;
  daysUntilRotation: number;
}

export interface StatusResponse {
  systemHealth: "healthy" | "degraded" | "critical" | "paused";
  criticalCount: number;
  degradedCount: number;
  platformCount: number;
  activeCredentials: number;
  activeKeys: number;
  activeAccounts: number;
  rotationsRunning: number;
  lastEventSecondsAgo: number | null;
  platformHealth: PlatformHealth[];
  attention: AttentionItem[];
  upcoming: UpcomingRotation[];
  security: {
    secretsExposed: number;
    encryptedPercent: number;
    unsafeRotations: number;
    unverifiedCount: number;
  };
  auditCount: number;
  sessionCount: number;
}

export interface ApiKey {
  platformId: string;
  platformName: string;
  keyLabel: string;
  scopes: string;
  createdAt: string;
  rotatedAt: string | null;
  rotationIntervalDays: number;
  status: string;
  lastError?: string;
  hasValue?: boolean;
}

export interface KeyPlatform {
  id: string;
  name: string;
  tokenPageUrl: string;
  acquisition: string;
  revocation: string;
  supportsMultipleKeys: boolean;
  defaultRotationDays: number;
  tags: string[];
  description: string;
}

export interface Credential {
  siteId: string;
  siteName: string;
  username: string;
  email: string;
  registeredAt: string;
  status: string;
  notes?: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  siteId: string;
  siteName: string;
  action: string;
  outcome: string;
  code?: string;
  detail: string;
  tosSummary?: string;
  tosAccepted?: boolean;
}

export interface SessionInfo {
  id: string;
  scopeId: string;
  origin: string;
  createdAt: string;
  expiresAt: string | null;
  consumed: boolean;
}

export interface Site {
  id: string;
  name: string;
  category: string;
  description: string;
  strategy: string;
  risk: string;
  free: boolean;
  hasCaptcha: boolean;
  requiresPhone: boolean;
  tags: string[];
}

export type ViewKey =
  | "overview"
  | "automation"
  | "platforms"
  | "credentials"
  | "rotations"
  | "sessions"
  | "audit"
  | "security"
  | "settings";

/** Pipeline stages in order (SPEC §7, §9). */
export const PIPELINE_STAGES = [
  "AUTHENTICATE",
  "SESSION",
  "ACQUIRE",
  "VERIFY",
  "ENCRYPT",
  "ACTIVATE",
  "REVOKE",
  "AUDIT",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Human-readable status language (SPEC §18 — Smart Status Language). */
export const STATUS_LANGUAGE: Record<string, { human: string; code: string }> = {
  LOGIN_REQUIRED: { human: "Authentication session expired before credential acquisition.", code: "SESSION_EXPIRED" },
  INTERACTIVE_CHALLENGE_REQUIRED: { human: "An interactive challenge (CAPTCHA or MFA) was detected.", code: "AUTOMATION_BLOCKED" },
  AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE: { human: "Automation blocked by interactive challenge. No bypass attempted.", code: "AUTOMATION_BLOCKED" },
  ACQUISITION_FAILED: { human: "Credential could not be acquired through the supported flow.", code: "ACQUISITION_FAILED" },
  VERIFICATION_FAILED: { human: "Credential verification returned an error.", code: "VERIFICATION_FAILED" },
  STORAGE_FAILED: { human: "Credential could not be encrypted or stored.", code: "STORAGE_FAILED" },
  ROTATION_BLOCKED: { human: "Rotation is not safe for this platform configuration.", code: "ROTATION_BLOCKED" },
  REVOCATION_FAILED: { human: "Previous credential could not be revoked automatically.", code: "REVOCATION_FAILED" },
  PLATFORM_FLOW_CHANGED: { human: "The platform's page structure has changed.", code: "FLOW_DRIFT" },
  CREDENTIAL_UI_UNAVAILABLE: { human: "Credential creation control could not be located.", code: "CREATE_CONTROL_NOT_FOUND" },
};

export function smartStatus(code?: string): { human: string; code: string } {
  if (!code) return { human: "Unknown state.", code: "UNKNOWN" };
  return STATUS_LANGUAGE[code] || { human: code.replace(/_/g, " ").toLowerCase(), code };
}

/** Format relative time. */
export function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Format seconds-ago. */
export function secondsAgo(s: number | null): string {
  if (s === null) return "never";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
