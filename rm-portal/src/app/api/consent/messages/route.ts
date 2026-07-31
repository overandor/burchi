import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit, checkConsent, checkSuppression, recordEligibility } from "@/lib/consent-helpers"
import type { MessageType } from "@/lib/consent"

const VALID_TYPES: MessageType[] = ["reply", "follow_up", "reminder", "support", "newsletter", "transactional"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  const status = url.searchParams.get("status")

  return withDb(async () => {
    if (status) {
      const result = await query(
        `SELECT m.*, c.email AS contact_email, c.name AS contact_name
         FROM messages m JOIN contacts c ON m.contact_id = c.id
         WHERE m.status = $1 ORDER BY m.created_at DESC LIMIT 100`,
        [status]
      )
      return Response.json(result.rows)
    }
    const result = await query(
      `SELECT m.*, c.email AS contact_email, c.name AS contact_name
       FROM messages m JOIN contacts c ON m.contact_id = c.id
       ORDER BY m.created_at DESC LIMIT 100`
    )
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const contactId = body.contact_id as string
    const messageType = body.message_type as MessageType
    const subject = (body.subject as string) || null
    const bodyText = body.body as string
    const experimentId = (body.experiment_id as string) || null
    const variantId = (body.variant_id as string) || null

    if (!contactId) return badRequest("contact_id is required")
    if (!bodyText) return badRequest("body is required")
    if (!messageType || !VALID_TYPES.includes(messageType)) return badRequest(`message_type must be one of: ${VALID_TYPES.join(", ")}`)

    // Verify contact exists and get email
    const contactRes = await query("SELECT id, email FROM contacts WHERE id = $1", [contactId])
    if (contactRes.rowCount === 0) return badRequest("Contact not found")
    const contactEmail = contactRes.rows[0].email as string

    // Map message type to consent scope
    const scopeMap: Record<MessageType, string> = {
      reply: "support",
      follow_up: "follow_up",
      reminder: "reminders",
      support: "support",
      newsletter: "marketing",
      transactional: "transactional",
    }
    const requiredScope = scopeMap[messageType]

    // ─── ELIGIBILITY CHECK ──────────────────────────────────────────────
    // 1. Check consent
    const consentRecord = await checkConsent(contactId, requiredScope)
    // 2. Check suppression
    const isSuppressed = await checkSuppression(contactEmail)

    let eligible = true
    let reason = "Eligible: active consent and not suppressed"

    if (!consentRecord) {
      eligible = false
      reason = `No active consent for scope '${requiredScope}'`
    } else if (isSuppressed) {
      eligible = false
      reason = "Contact is on suppression list"
    }

    // Create the message as draft
    const msgRes = await query(
      `INSERT INTO messages (contact_id, subject, body, message_type, status, experiment_id, variant_id)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING *`,
      [contactId, subject, bodyText, messageType, experimentId, variantId]
    )
    const message = msgRes.rows[0] as any

    // Record eligibility decision
    await recordEligibility(
      contactId,
      message.id,
      eligible,
      consentRecord?.id ?? null,
      isSuppressed,
      reason
    )

    await audit("message_created", "message", message.id, "api", {
      contact_id: contactId, message_type: messageType, eligible, reason,
    })

    // If not eligible, mark as suppressed
    if (!eligible) {
      await query("UPDATE messages SET status = 'suppressed' WHERE id = $1", [message.id])
      await audit("message_suppressed", "message", message.id, "api", { reason })
      return Response.json({
        ...message,
        status: "suppressed",
        eligibility_reason: reason,
      }, { status: 201 })
    }

    return Response.json(message, { status: 201 })
  })
}
