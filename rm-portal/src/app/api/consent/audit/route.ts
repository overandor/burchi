import { query } from "@/lib/db"
import { withDb } from "@/lib/consent-helpers"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200)
  const entityType = url.searchParams.get("entity_type")
  const entityId = url.searchParams.get("entity_id")

  return withDb(async () => {
    let sql = "SELECT * FROM audit_trail"
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (entityType) {
      conditions.push(`entity_type = $${paramIdx++}`)
      params.push(entityType)
    }
    if (entityId) {
      conditions.push(`entity_id = $${paramIdx++}`)
      params.push(entityId)
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ")
    }
    sql += ` ORDER BY created_at DESC LIMIT $${paramIdx++}`
    params.push(limit)

    const result = await query(sql, params)
    return Response.json(result.rows)
  })
}
