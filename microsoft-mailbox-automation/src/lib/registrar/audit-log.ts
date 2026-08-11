/**
 * Append-only audit log for the registrar.
 *
 * Every registration action is recorded here. The log is also rendered as
 * plain, linear, screen-reader/Braille-friendly text so a blind+deaf user
 * can review what was done asynchronously.
 *
 * Storage: SQLite kv_store (encrypted credentials live in the vault; the
 * audit log itself is intentionally plaintext so it can be reviewed without
 * the vault key — it contains no passwords).
 */

import { kvLoad, kvSave, DEFAULT_ORG_ID, ensureDefaultOrg } from "@/lib/db";
import { randomUUID } from "crypto";
import type { AuditEntry } from "./types";
import type { AuditOutcome } from "./status-codes";

const AUDIT_KV = "registrar.audit";

export function loadAudit(): AuditEntry[] {
  try {
    ensureDefaultOrg();
    return kvLoad<AuditEntry>(DEFAULT_ORG_ID, AUDIT_KV);
  } catch (e) {
    console.error("[registrar/audit] load error:", e);
    return [];
  }
}

export function appendAudit(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
  const full: AuditEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...entry,
  };
  const all = loadAudit();
  all.push(full);
  ensureDefaultOrg();
  kvSave(DEFAULT_ORG_ID, AUDIT_KV, all);
  // Also emit to stdout for live monitoring / log aggregation. Never includes secrets.
  const codeTag = full.code ? ` [${full.code}]` : "";
  console.info(`[registrar/audit] ${full.ts} ${full.outcome.toUpperCase()}${codeTag} ${full.siteId}: ${full.detail}`);
  return full;
}

/**
 * Structured audit append (SPEC §12). Accepts the structured AuditOutcome and
 * writes it into both the legacy `outcome` field (mapped) and the `code` field.
 */
const OUTCOME_TO_LEGACY: Record<AuditOutcome, AuditEntry["outcome"]> = {
  SUCCESS: "success",
  AUTHENTICATION_REQUIRED: "blocked",
  INTERACTIVE_CHALLENGE_REQUIRED: "blocked",
  ACQUISITION_FAILED: "failed",
  VERIFICATION_FAILED: "failed",
  STORAGE_FAILED: "failed",
  ROTATION_BLOCKED: "blocked",
  REVOCATION_FAILED: "blocked",
  PLATFORM_FLOW_CHANGED: "blocked",
  INFO: "info",
};

export function appendStructuredAudit(
  entry: Omit<AuditEntry, "id" | "ts" | "outcome"> & { outcome: AuditOutcome },
): AuditEntry {
  return appendAudit({
    ...entry,
    outcome: OUTCOME_TO_LEGACY[entry.outcome] ?? "info",
    code: entry.outcome,
  });
}

export function clearAudit(): void {
  ensureDefaultOrg();
  kvSave(DEFAULT_ORG_ID, AUDIT_KV, []);
}

/**
 * Render the audit log as plain, linear text optimized for Braille displays
 * and screen readers. One event per line, chronological, no decoration that
 * would waste cells or break linear reading.
 */
export function renderAuditText(entries: AuditEntry[] = loadAudit()): string {
  const lines: string[] = [];
  lines.push(`Registrar audit log. ${entries.length} events.`);
  lines.push("");
  for (const e of entries) {
    const time = e.ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
    const codeTag = e.code ? ` [${e.code}]` : "";
    let line = `${time} ${e.outcome.toUpperCase()}${codeTag} ${e.siteName} (${e.siteId}) — ${e.action}: ${e.detail}`;
    if (e.tosAccepted !== undefined) {
      line += ` | terms accepted: ${e.tosAccepted ? "yes" : "no"}`;
    }
    if (e.tosSummary) {
      line += ` | terms summary: ${e.tosSummary}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
