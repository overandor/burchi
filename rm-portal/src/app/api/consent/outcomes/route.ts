import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit } from "@/lib/consent-helpers"
import type { OutcomeType } from "@/lib/consent"

const VALID_TYPES: OutcomeType[] = [
  "response", "helpfulness", "csat", "booking_completion",
  "retention", "support_time", "response_rate",
]

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200)

  return withDb(async () => {
    const result = await query(
      `SELECT o.*, c.email AS contact_email, m.subject AS message_subject
       FROM outcomes o
       JOIN contacts c ON o.contact_id = c.id
       LEFT JOIN messages m ON o.message_id = m.id
       ORDER BY o.recorded_at DESC LIMIT $1`,
      [limit]
    )
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const contactId = body.contact_id as string
    const outcomeType = body.outcome_type as OutcomeType
    const value = Number(body.value)
    const messageId = (body.message_id as string) || null
    const metadata = (body.metadata as Record<string, unknown>) || {}

    if (!contactId) return badRequest("contact_id is required")
    if (!outcomeType || !VALID_TYPES.includes(outcomeType)) {
      return badRequest(`outcome_type must be one of: ${VALID_TYPES.join(", ")}`)
    }
    if (isNaN(value)) return badRequest("value must be a number")

    const result = await query(
      `INSERT INTO outcomes (contact_id, message_id, outcome_type, value, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [contactId, messageId, outcomeType, value, JSON.stringify(metadata)]
    )

    // If this outcome is associated with an experiment variant, update the variant stats
    if (messageId) {
      const msgRes = await query("SELECT experiment_id, variant_id FROM messages WHERE id = $1", [messageId])
      if ((msgRes.rowCount ?? 0) > 0 && msgRes.rows[0].experiment_id && msgRes.rows[0].variant_id) {
        await query(
          `UPDATE experiment_variants
           SET responses = responses + 1, reward_sum = reward_sum + $2
           WHERE id = $1`,
          [msgRes.rows[0].variant_id, value]
        )
      }
    }

    await audit("outcome_recorded", "outcome", result.rows[0].id as string, "api", {
      contact_id: contactId, outcome_type: outcomeType, value,
    })
    return Response.json(result.rows[0], { status: 201 })
  })
}
