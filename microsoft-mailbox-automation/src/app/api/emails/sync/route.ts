import { NextRequest, NextResponse } from "next/server";
import { storeEmailBatch, isNoSqlConnected } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/emails/sync
 *
 * Ingests emails from any provider into the NoSQL store.
 * Body: { emails: [...], source: "gmail"|"microsoft"|"imap" }
 *
 * Each email: { id, subject, from, fromAddress, to[], date, bodyPreview, isRead, category, hasAttachments, attachmentCount, importance }
 */
export async function POST(request: NextRequest) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const body = await request.json().catch(() => ({}));
  const emails = body.emails || [];
  const source = body.source || "manual";

  if (emails.length === 0) {
    return NextResponse.json({ error: "No emails provided" }, { status: 400 });
  }

  try {
    const docs = emails.map((e: any) => ({
      id: e.id || `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      subject: e.subject || "(no subject)",
      from: e.from || e.fromAddress || "unknown",
      fromAddress: e.fromAddress || "",
      to: e.to || [],
      date: e.date || e.receivedDateTime || new Date().toISOString(),
      bodyPreview: e.bodyPreview || (e.body || "").slice(0, 200),
      body: e.body,
      isRead: e.isRead ?? true,
      category: e.category || e.importance || "general",
      hasAttachments: e.hasAttachments ?? false,
      attachmentCount: e.attachmentCount || 0,
      importance: e.importance || "normal",
      source,
      orgId,
    }));

    const { stored, docs: savedDocs } = await storeEmailBatch(docs);

    return NextResponse.json({
      success: true,
      stored,
      nosqlConnected: isNoSqlConnected(),
      store: isNoSqlConnected() ? "upstash-redis" : "in-memory",
      sample: savedDocs.slice(0, 3).map(d => ({
        id: d.id,
        subject: d.subject,
        valueScore: d.valueScore,
        valueTags: d.valueTags,
        sentiment: d.sentiment,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
