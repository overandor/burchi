import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit } from "@/lib/consent-helpers"
import type { SuppressionReason } from "@/lib/consent"

export async function GET() {
  return withDb(async () => {
    const result = await query("SELECT * FROM suppression_list ORDER BY created_at DESC")
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const email = (body.email as string || "").trim().toLowerCase()
    const reason = body.reason as SuppressionReason
    const notes = body.notes as string | undefined

    if (!email || !email.includes("@")) return badRequest("Valid email is required")
    if (!reason) return badRequest("reason is required")

    const result = await query(
      `INSERT INTO suppression_list (email, reason, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (email, reason, channel) DO UPDATE SET notes = $3
       RETURNING *`,
      [email, reason, notes || null]
    )

    // If suppressing, revoke all active consent for this email
    if (reason === "unsubscribe" || reason === "complaint") {
      await query(
        `UPDATE consent_records SET revocation_status = 'revoked', revoked_at = now(), revocation_reason = $2
         WHERE contact_id IN (SELECT id FROM contacts WHERE email = $1)
         AND revocation_status = 'active'`,
        [email, `Auto-revoked: ${reason}`]
      )
    }

    await audit("suppression_added", "suppression", result.rows[0].id as string, "api", { email, reason })
    return Response.json(result.rows[0], { status: 201 })
  })
}
