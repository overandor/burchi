import { query } from "@/lib/db"
import { withDb, getJsonBody, notFound, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const body = await getJsonBody(request)
    const status = body.revocation_status as string
    const reason = body.revocation_reason as string

    if (status !== "revoked") return Response.json({ error: "Only revocation is supported via PATCH" }, { status: 400 })

    const result = await query(
      `UPDATE consent_records
       SET revocation_status = 'revoked', revoked_at = now(), revocation_reason = $2
       WHERE id = $1 AND revocation_status = 'active'
       RETURNING *`,
      [id, reason || null]
    )

    if (result.rowCount === 0) return notFound("Consent record not found or already revoked")

    await audit("consent_revoked", "consent_record", id, "api", { reason })
    return Response.json(result.rows[0])
  })
}
