import { NextRequest, NextResponse } from "next/server";
import { searchEmails, isNoSqlConnected } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/emails/search?q=...
 * Full-text search across all stored emails
 */
export async function GET(request: NextRequest) {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const q = request.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ emails: [], total: 0 });

  const emails = await searchEmails(orgId, q, 20);
  return NextResponse.json({ emails, total: emails.length, nosqlConnected: isNoSqlConnected() });
}
