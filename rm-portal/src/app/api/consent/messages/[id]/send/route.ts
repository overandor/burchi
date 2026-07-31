import { query } from "@/lib/db"
import { withDb, notFound, audit, checkConsent, checkSuppression, recordEligibility } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

/**
 * Send an approved message.
 *
 * CRITICAL: This endpoint re-checks consent and suppression at the send
 * boundary, even if the message was previously approved. This is the
 * final policy gate — no message leaves without verified eligibility.
 *
 * CONSENTED INPUT → ELIGIBILITY CHECK → MESSAGE GENERATION
 * → APPROVAL/POLICY CHECK → [SEND] → MEASURE → AUDIT
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    // Load message with contact info
    const msgRes = await query(
      `SELECT m.*, c.email AS contact_email, c.name AS contact_name
       FROM messages m JOIN contacts c ON m.contact_id = c.id
       WHERE m.id = $1`,
      [id]
    )
    if (msgRes.rowCount === 0) return notFound("Message not found")
    const message = msgRes.rows[0] as {
      id: string; contact_id: string; contact_email: string; contact_name: string | null;
      subject: string | null; body: string; message_type: string; status: string;
    }

    // Must be approved
    if (message.status !== "approved") {
      return Response.json({
        error: `Message must be in 'approved' status to send. Current status: ${message.status}`,
      }, { status: 400 })
    }

    // ─── FINAL ELIGIBILITY RE-CHECK AT SEND BOUNDARY ────────────────────
    const scopeMap: Record<string, string> = {
      reply: "support", follow_up: "follow_up", reminder: "reminders",
      support: "support", newsletter: "marketing", transactional: "transactional",
    }
    const requiredScope = scopeMap[message.message_type] || "marketing"

    const consentRecord = await checkConsent(message.contact_id, requiredScope)
    const isSuppressed = await checkSuppression(message.contact_email)

    if (!consentRecord) {
      await query("UPDATE messages SET status = 'suppressed', updated_at = now() WHERE id = $1", [id])
      await recordEligibility(message.contact_id, id, false, null, isSuppressed, `Send-time check failed: no active consent for '${requiredScope}'`)
      await audit("message_send_blocked", "message", id, "system", { reason: "No active consent at send time" })
      return Response.json({ ok: false, error: "Send blocked: no active consent at send time" }, { status: 403 })
    }

    if (isSuppressed) {
      await query("UPDATE messages SET status = 'suppressed', updated_at = now() WHERE id = $1", [id])
      await recordEligibility(message.contact_id, id, false, consentRecord.id, true, "Send-time check failed: on suppression list")
      await audit("message_send_blocked", "message", id, "system", { reason: "On suppression list at send time" })
      return Response.json({ ok: false, error: "Send blocked: recipient is on suppression list" }, { status: 403 })
    }

    // ─── SEND VIA RESEND ────────────────────────────────────────────────
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@example.com"

    if (!RESEND_API_KEY) {
      return Response.json({
        error: "RESEND_API_KEY not configured. Set it in your environment to enable sending.",
      }, { status: 503 })
    }

    try {
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: message.contact_email,
          subject: message.subject || "(no subject)",
          text: message.body,
          // Include unsubscribe header for compliance
          headers: {
            "List-Unsubscribe": `<${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/unsubscribe?email=${encodeURIComponent(message.contact_email)}>`,
          },
        }),
      })

      const sendData = await sendRes.json()

      if (!sendRes.ok) {
        await query("UPDATE messages SET status = 'failed', updated_at = now() WHERE id = $1", [id])
        await audit("message_send_failed", "message", id, "system", { error: sendData.message || "Resend API error" })
        return Response.json({ ok: false, error: sendData.message || "Send failed" }, { status: 502 })
      }

      // Mark as sent
      await query(
        "UPDATE messages SET status = 'sent', sent_at = now(), provider_id = $2, updated_at = now() WHERE id = $1",
        [id, sendData.id]
      )

      await audit("message_sent", "message", id, "system", {
        contact_id: message.contact_id,
        provider: "resend",
        provider_id: sendData.id,
      })

      return Response.json({ ok: true, provider_id: sendData.id })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown send error"
      await query("UPDATE messages SET status = 'failed', updated_at = now() WHERE id = $1", [id])
      await audit("message_send_failed", "message", id, "system", { error: errMsg })
      return Response.json({ ok: false, error: errMsg }, { status: 502 })
    }
  })
}
