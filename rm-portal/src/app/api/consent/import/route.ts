import { query } from "@/lib/db"
import { withDb, getJsonBody, audit } from "@/lib/consent-helpers"
import type { ConsentSource, ConsentScope, ImportResult, ImportBatch } from "@/lib/consent"

interface ImportRow {
  email: string
  name?: string
  consent_source: string
  consent_scope: string
  consented_at?: string
  evidence?: Record<string, unknown>
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] || "" })
    return row
  })
}

const VALID_SOURCES: ConsentSource[] = ["csv_import", "crm_sync", "signup_webhook", "double_opt_in", "manual_import"]
const VALID_SCOPES: ConsentScope[] = ["marketing", "support", "transactional", "follow_up", "reminders", "all"]

export async function GET() {
  return withDb(async () => {
    const result = await query("SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 20")
    return Response.json(result.rows)
  })
}

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await getJsonBody(request)
    const source = body.source as "csv" | "json"
    const data = body.data as string
    const filename = body.filename as string | undefined

    if (!data) return Response.json({ error: "data is required" }, { status: 400 })

    // Parse rows
    let rows: ImportRow[]
    if (source === "csv") {
      const parsed = parseCSV(data)
      rows = parsed.map(r => ({
        email: r.email || "",
        name: r.name || undefined,
        consent_source: r.consent_source || "csv_import",
        consent_scope: r.consent_scope || "marketing",
        consented_at: r.consented_at || new Date().toISOString(),
        evidence: { source_file: filename, raw_row: r },
      }))
    } else {
      const parsed = JSON.parse(data) as ImportRow[]
      rows = parsed.map(r => ({
        ...r,
        consent_source: r.consent_source || "manual_import",
        consent_scope: r.consent_scope || "marketing",
        consented_at: r.consented_at || new Date().toISOString(),
        evidence: r.evidence || { source: "json_import" },
      }))
    }

    const rejections: Array<{ row: number; email: string; reason: string }> = []
    let accepted = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const email = (row.email || "").trim().toLowerCase()

      if (!email || !email.includes("@")) {
        rejections.push({ row: i + 1, email: email || "(empty)", reason: "Invalid or missing email" })
        continue
      }
      if (!VALID_SOURCES.includes(row.consent_source as ConsentSource)) {
        rejections.push({ row: i + 1, email, reason: `Invalid consent_source: ${row.consent_source}` })
        continue
      }
      if (!VALID_SCOPES.includes(row.consent_scope as ConsentScope)) {
        rejections.push({ row: i + 1, email, reason: `Invalid consent_scope: ${row.consent_scope}` })
        continue
      }

      // Check suppression — don't import suppressed emails
      const suppCheck = await query("SELECT 1 FROM suppression_list WHERE email = $1 LIMIT 1", [email])
      if ((suppCheck.rowCount ?? 0) > 0) {
        rejections.push({ row: i + 1, email, reason: "Email is on suppression list" })
        continue
      }

      // Upsert contact
      const contactRes = await query(
        `INSERT INTO contacts (email, name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [email, row.name || null]
      )
      const contactId = contactRes.rows[0].id

      // Record consent
      await query(
        `INSERT INTO consent_records (contact_id, consent_source, consented_at, consent_scope, evidence)
         VALUES ($1, $2, $3, $4, $5)`,
        [contactId, row.consent_source, row.consented_at, row.consent_scope, JSON.stringify(row.evidence || {})]
      )

      accepted++
    }

    // Record import batch
    const batchRes = await query(
      `INSERT INTO import_batches (source, filename, total_rows, accepted_rows, rejected_rows, rejection_log)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [source, filename || null, rows.length, accepted, rejections.length, JSON.stringify(rejections)]
    )

    await audit("contacts_imported", "import_batch", batchRes.rows[0].id as string, "api", {
      source, filename, total: rows.length, accepted, rejected: rejections.length,
    })

    const result: ImportResult = {
      batch: batchRes.rows[0] as unknown as ImportBatch,
      accepted,
      rejected: rejections.length,
      rejections,
    }
    return Response.json(result, { status: 201 })
  })
}
