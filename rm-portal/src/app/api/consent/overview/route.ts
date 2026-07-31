import { query } from "@/lib/db"
import { withDb } from "@/lib/consent-helpers"

export async function GET() {
  return withDb(async () => {
    const [
      contacts, activeConsent, revokedConsent, suppressed,
      pendingApproval, sentMessages, activeExperiments, recentOutcomes
    ] = await Promise.all([
      query("SELECT COUNT(*)::int AS c FROM contacts"),
      query("SELECT COUNT(*)::int AS c FROM consent_records WHERE revocation_status = 'active'"),
      query("SELECT COUNT(*)::int AS c FROM consent_records WHERE revocation_status = 'revoked'"),
      query("SELECT COUNT(*)::int AS c FROM suppression_list"),
      query("SELECT COUNT(*)::int AS c FROM messages WHERE status = 'pending_approval'"),
      query("SELECT COUNT(*)::int AS c FROM messages WHERE status = 'sent'"),
      query("SELECT COUNT(*)::int AS c FROM experiments WHERE status = 'running'"),
      query("SELECT COUNT(*)::int AS c FROM outcomes WHERE recorded_at > now() - interval '30 days'"),
    ])

    return Response.json({
      total_contacts: contacts.rows[0].c,
      active_consent: activeConsent.rows[0].c,
      revoked_consent: revokedConsent.rows[0].c,
      suppressed: suppressed.rows[0].c,
      pending_approval: pendingApproval.rows[0].c,
      sent_messages: sentMessages.rows[0].c,
      active_experiments: activeExperiments.rows[0].c,
      recent_outcomes: recentOutcomes.rows[0].c,
    })
  })
}
