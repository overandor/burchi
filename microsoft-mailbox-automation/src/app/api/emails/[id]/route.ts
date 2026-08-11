import { NextRequest, NextResponse } from "next/server";
import { getEmail, markRead, deleteEmail } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/emails/[id] — get single email
 * PATCH /api/emails/[id] — update (markRead)
 * DELETE /api/emails/[id] — delete email
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const doc = await getEmail(orgId, params.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const body = await request.json().catch(() => ({}));
  if (body.isRead !== undefined) {
    await markRead(orgId, params.id, body.isRead);
    return NextResponse.json({ success: true, id: params.id, isRead: body.isRead });
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  await deleteEmail(orgId, params.id);
  return NextResponse.json({ success: true, id: params.id });
}
