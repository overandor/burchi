import { query } from "@/lib/db"
import { withDb, getJsonBody, badRequest, audit } from "@/lib/consent-helpers"
import type { ConsentScope } from "@/lib/consent"

/**
 * First-party signup webhook.
 * Called by your own landing page / signup form when someone explicitly opts in.
 * This is the only entry point that creates contacts from a live user action.
 */
export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const email = (body.email as string || "").trim().toLowerCase()
    const name = (body.name as string || "").trim() || null
    const consentScope = (body.consent_scope as ConsentScope) || "marketing"
    const evidence = (body.evidence as Record<string, unknown>) || {}

    if (!email || !email.includes("@")) return badRequest("Valid email is required")

    // Enrich evidence with request metadata
    const fullEvidence = {
      ...evidence,
      source: "signup_webhook",
      signup_url: evidence.signup_url || request.headers.get("origin") || "unknown",
      ip: evidence.ip || request.headers.get("x-forwarded-for") || "unknown",
      user_agent: evidence.user_agent || request.headers.get("user-agent") || "unknown",
      timestamp: new Date().toISOString(),
    }

    // Check suppression — if they previously unsubscribed, don't re-add
    const suppCheck = await query("SELECT 1 FROM suppression_list WHERE email = $1 AND reason IN ('unsubscribe','complaint') LIMIT 1", [email])
    if ((suppCheck.rowCount ?? 0) > 0) {
      return Response.json({
        ok: false,
        error: "Email is on suppression list (previously unsubscribed). Cannot re-subscribe without explicit verification.",
      }, { status: 409 })
    }

    // Upsert contact
    const contactRes = await query(
      `INSERT INTO contacts (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE($2, contacts.name), updated_at = now()
       RETURNING id`,
      [email, name]
    )
    const contactId = contactRes.rows[0].id as string

    // Record consent
    const consentRes = await query(
      `INSERT INTO consent_records (contact_id, consent_source, consented_at, consent_scope, evidence)
       VALUES ($1, 'signup_webhook', now(), $2, $3) RETURNING id`,
      [contactId, consentScope, JSON.stringify(fullEvidence)]
    )

    await audit("signup_webhook", "contact", contactId, "webhook", { email, consent_scope: consentScope })
    await audit("consent_recorded", "consent_record", consentRes.rows[0].id as string, "webhook", { contact_id: contactId, source: "signup_webhook", scope: consentScope })

    return Response.json({ ok: true, contact_id: contactId }, { status: 201 })
  })
}
