import { query } from "@/lib/db"
import { withDb, getJsonBody, notFound, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const body = await getJsonBody(request)
    const reason = (body.reason as string || "").trim() || "Rejected by reviewer"

    const msgRes = await query("SELECT id, status FROM messages WHERE id = $1", [id])
    if (msgRes.rowCount === 0) return notFound("Message not found")
    if (msgRes.rows[0].status === "sent") return Response.json({ error: "Message already sent" }, { status: 400 })

    await query(
      `UPDATE messages SET status = 'rejected', rejected_reason = $2, updated_at = now()
       WHERE id = $1`,
      [id, reason]
    )

    await audit("message_rejected", "message", id, "api", { reason })
    return Response.json({ ok: true })
  })
}
