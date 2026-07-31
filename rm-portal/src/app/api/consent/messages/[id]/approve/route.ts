import { query } from "@/lib/db"
import { withDb, getJsonBody, notFound, badRequest, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

/**
 * Approve a message for sending.
 * Messages must be in 'pending_approval' or 'draft' status.
 * After approval, the message can be sent via the /send endpoint.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const body = await getJsonBody(request)
    const approvedBy = (body.approved_by as string || "").trim()

    if (!approvedBy) return badRequest("approved_by is required (who is approving this message)")

    const msgRes = await query("SELECT id, status FROM messages WHERE id = $1", [id])
    if (msgRes.rowCount === 0) return notFound("Message not found")

    const status = msgRes.rows[0].status
    if (status === "sent") return badRequest("Message already sent")
    if (status === "suppressed") return badRequest("Cannot approve a suppressed message — recipient is not eligible")
    if (status === "rejected") return badRequest("Message was already rejected")

    const result = await query(
      `UPDATE messages SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, approvedBy]
    )

    await audit("message_approved", "message", id, approvedBy)
    return Response.json({ ok: true, message: result.rows[0] })
  })
}
