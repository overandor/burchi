import { query } from "@/lib/db"
import { withDb, notFound, audit } from "@/lib/consent-helpers"
import type { NextRequest } from "next/server"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const contact = await query("SELECT * FROM contacts WHERE id = $1", [id])
    if (contact.rowCount === 0) return notFound("Contact not found")
    const consent = await query("SELECT * FROM consent_records WHERE contact_id = $1 ORDER BY created_at DESC", [id])
    return Response.json({ ...contact.rows[0], consent: consent.rows })
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withDb(async () => {
    const result = await query("DELETE FROM contacts WHERE id = $1 RETURNING id", [id])
    if (result.rowCount === 0) return notFound("Contact not found")
    await audit("contact_deleted", "contact", id, "api")
    return Response.json({ ok: true })
  })
}
