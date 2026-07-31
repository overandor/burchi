/**
 * Shared helpers for consent API route handlers.
 */

import { query, dbAvailable, ensureSchema } from "./db"
import type { AuditEntry } from "./consent"

export function dbError() {
  return Response.json(
    { error: "Database not configured. Set DATABASE_URL environment variable." },
    { status: 503 }
  )
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

export function notFound(message = "Not found") {
  return Response.json({ error: message }, { status: 404 })
}

export async function withDb<T>(
  handler: () => Promise<T>
): Promise<T | Response> {
  if (!dbAvailable()) return dbError()
  try {
    return await handler()
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    if (message.includes("relation") || message.includes("does not exist")) {
      // Schema not migrated yet — try once
      try {
        await ensureSchema()
        return await handler()
      } catch {
        return Response.json({ error: "Schema migration failed", detail: message }, { status: 500 })
      }
    }
    console.error("[consent] db error:", message)
    return Response.json({ error: "Database error", detail: message }, { status: 500 })
  }
}

export async function audit(
  action: string,
  entityType: string,
  entityId: string | null | undefined,
  actor: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await query(
    `INSERT INTO audit_trail (action, entity_type, entity_id, actor, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [action, entityType, entityId ?? null, actor, JSON.stringify(details)]
  )
}

export async function getJsonBody(request: Request): Promise<any> {
  const text = await request.text()
  return JSON.parse(text)
}

/**
 * Check if a contact has active consent for a given scope.
 * Returns the consent record if eligible, null otherwise.
 */
export async function checkConsent(
  contactId: string,
  scope: string
): Promise<{ id: string } | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM consent_records
     WHERE contact_id = $1
       AND revocation_status = 'active'
       AND (consent_scope = $2 OR consent_scope = 'all')
     ORDER BY consented_at DESC
     LIMIT 1`,
    [contactId, scope]
  )
  return result.rows[0] ?? null
}

/**
 * Check if an email is on the suppression list.
 */
export async function checkSuppression(
  email: string
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM suppression_list WHERE email = $1 LIMIT 1`,
    [email]
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Record an eligibility decision.
 */
export async function recordEligibility(
  contactId: string,
  messageId: string | null,
  eligible: boolean,
  consentRecordId: string | null,
  suppressionMatch: boolean,
  reason: string
): Promise<void> {
  await query(
    `INSERT INTO eligibility_decisions
       (contact_id, message_id, eligible, consent_record_id, suppression_checked, suppression_match, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [contactId, messageId, eligible, consentRecordId, true, suppressionMatch, reason]
  )
}
