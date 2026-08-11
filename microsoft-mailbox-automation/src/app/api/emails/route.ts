import { NextRequest, NextResponse } from "next/server";
import { getEmails, getEmailStats, isNoSqlConnected } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/emails
 *
 * Query params:
 *   limit   — max emails to return (default 50)
 *   offset  — pagination offset
 *   unread  — "true" to filter unread only
 *   category — filter by category
 *   minScore — minimum value score
 *   source  — filter by source (gmail/microsoft/imap)
 *   search  — full-text search
 *   stats   — "true" to get analytics instead of emails
 */
export async function GET(request: NextRequest) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const params = request.nextUrl.searchParams;
  const stats = params.get("stats") === "true";

  try {
    if (stats) {
      const analytics = await getEmailStats(orgId);
      return NextResponse.json({
        ...analytics,
        nosqlConnected: isNoSqlConnected(),
        store: isNoSqlConnected() ? "upstash-redis" : "in-memory",
      });
    }

    const { emails, total } = await getEmails(orgId, {
      limit: parseInt(params.get("limit") || "50"),
      offset: parseInt(params.get("offset") || "0"),
      unreadOnly: params.get("unread") === "true",
      category: params.get("category") || undefined,
      minScore: params.get("minScore") ? parseInt(params.get("minScore")!) : undefined,
      source: params.get("source") || undefined,
      search: params.get("search") || undefined,
    });

    return NextResponse.json({
      emails,
      total,
      limit: parseInt(params.get("limit") || "50"),
      offset: parseInt(params.get("offset") || "0"),
      nosqlConnected: isNoSqlConnected(),
      store: isNoSqlConnected() ? "upstash-redis" : "in-memory",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
