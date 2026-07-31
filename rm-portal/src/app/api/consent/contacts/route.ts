import { query } from "@/lib/db"
import { withDb, getJsonBody, audit, badRequest, validateConsentSource } from "@/lib/consent-helpers"
import type { ConsentSource, ConsentScope } from "@/lib/consent"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200)
  const offset = parseInt(url.searchParams.get("offset") || "0")

  return withDb(async () => {
    const result = await query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM consent_records cr WHERE cr.contact_id = c.id AND cr.revocation_status = 'active') AS active_consent_count,
        (SELECT COUNT(*) FROM messages m WHERE m.contact_id = c.id AND m.status = 'sent') AS sent_count
       FROM contacts c
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const email = (body.email as string || "").trim().toLowerCase()
    const name = (body.name as string || "").trim() || null
    const consentSource = body.consent_source as ConsentSource
    const consentScope = body.consent_scope as ConsentScope
    const consentedAt = body.consented_at as string || new Date().toISOString()
    const evidence = (body.evidence as Record<string, unknown>) || {}

    if (!email || !email.includes("@")) return badRequest("Valid email is required")
    if (!consentSource) return badRequest("consent_source is required — contacts cannot be created without explicit consent (constraint 1)")
    if (!consentScope) return badRequest("consent_scope is required")

    // Validate consent source — reject implicit/inferred/scraped bases
    const sourceCheck = validateConsentSource(consentSource)
    if (!sourceCheck.valid) return badRequest(sourceCheck.reason!)

    // Upsert contact
    const contactResult = await query(
      `INSERT INTO contacts (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE($2, contacts.name), updated_at = now()
       RETURNING id, email, name, metadata, created_at, updated_at`,
      [email, name]
    )
    const contact = contactResult.rows[0] as any

    // Record consent
    const consentResult = await query(
      `INSERT INTO consent_records (contact_id, consent_source, consented_at, consent_scope, evidence)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [contact.id, consentSource, consentedAt, consentScope, JSON.stringify(evidence)]
    )

    await audit("contact_created", "contact", contact.id, "api", { email, consent_source: consentSource })
    await audit("consent_recorded", "consent_record", consentResult.rows[0].id as string, "api", { contact_id: contact.id, source: consentSource, scope: consentScope })

    return Response.json({ ...contact, consent: [consentResult.rows[0]] }, { status: 201 })
  })
}
