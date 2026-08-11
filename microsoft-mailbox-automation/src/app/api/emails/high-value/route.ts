import { NextRequest, NextResponse } from "next/server";
import { getHighValueEmails, isNoSqlConnected } from "@/lib/nosql/email-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/emails/high-value
 * Returns emails with valueScore >= 70
 */
export async function GET() {
  let orgId = "default";
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
  } catch { /* demo mode */ }

  const emails = await getHighValueEmails(orgId, 20);
  return NextResponse.json({ emails, total: emails.length, nosqlConnected: isNoSqlConnected() });
}
