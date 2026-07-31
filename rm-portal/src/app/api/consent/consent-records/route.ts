import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit } from "@/lib/consent-helpers"
import type { ConsentSource, ConsentScope } from "@/lib/consent"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const contactId = url.searchParams.get("contact_id")

  return withDb(async () => {
    if (contactId) {
      const result = await query("SELECT * FROM consent_records WHERE contact_id = $1 ORDER BY created_at DESC", [contactId])
      return Response.json(result.rows)
    }
    const result = await query("SELECT * FROM consent_records ORDER BY created_at DESC LIMIT 100")
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const contactId = body.contact_id as string
    const consentSource = body.consent_source as ConsentSource
    const consentScope = body.consent_scope as ConsentScope
    const consentedAt = body.consented_at as string || new Date().toISOString()
    const evidence = (body.evidence as Record<string, unknown>) || {}

    if (!contactId) return badRequest("contact_id is required")
    if (!consentSource) return badRequest("consent_source is required")
    if (!consentScope) return badRequest("consent_scope is required")

    // Verify contact exists
    const contact = await query("SELECT id FROM contacts WHERE id = $1", [contactId])
    if (contact.rowCount === 0) return badRequest("Contact not found")

    const result = await query(
      `INSERT INTO consent_records (contact_id, consent_source, consented_at, consent_scope, evidence)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [contactId, consentSource, consentedAt, consentScope, JSON.stringify(evidence)]
    )

    await audit("consent_recorded", "consent_record", result.rows[0].id as string, "api", { contact_id: contactId, source: consentSource, scope: consentScope })
    return Response.json(result.rows[0], { status: 201 })
  })
}
