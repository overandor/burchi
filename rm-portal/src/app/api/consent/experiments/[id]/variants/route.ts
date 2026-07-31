import { query } from "@/lib/db"
import { withDb, getJsonBody, notFound, badRequest, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const body = await getJsonBody(request)
    const label = (body.label as string || "").trim()
    const content = (body.content as string || "").trim()

    if (!label) return badRequest("label is required")
    if (!content) return badRequest("content is required")

    const expRes = await query("SELECT id FROM experiments WHERE id = $1", [id])
    if (expRes.rowCount === 0) return notFound("Experiment not found")

    const result = await query(
      `INSERT INTO experiment_variants (experiment_id, label, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [id, label, content]
    )

    await audit("variant_added", "experiment", id, "api", { variant_id: result.rows[0].id, label })
    return Response.json(result.rows[0], { status: 201 })
  })
}
