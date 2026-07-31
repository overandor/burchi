import { query } from "@/lib/db"
import { withDb, notFound } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const msgRes = await query(
      `SELECT m.*, c.email AS contact_email, c.name AS contact_name
       FROM messages m JOIN contacts c ON m.contact_id = c.id
       WHERE m.id = $1`,
      [id]
    )
    if (msgRes.rowCount === 0) return notFound("Message not found")

    const eligRes = await query(
      "SELECT * FROM eligibility_decisions WHERE message_id = $1 LIMIT 1",
      [id]
    )
    return Response.json({ ...msgRes.rows[0], eligibility: eligRes.rows[0] || null })
  })
}
