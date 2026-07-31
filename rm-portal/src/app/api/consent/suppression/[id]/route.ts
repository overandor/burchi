import { query } from "@/lib/db"
import { withDb, notFound, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const result = await query("DELETE FROM suppression_list WHERE id = $1 RETURNING id, email", [id])
    if (result.rowCount === 0) return notFound("Suppression entry not found")
    await audit("suppression_removed", "suppression", id, "api", { email: result.rows[0].email })
    return Response.json({ ok: true })
  })
}
