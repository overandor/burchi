import { NextRequest, NextResponse } from "next/server";
import { searchEmailsREST } from "@/lib/gmail/rest-client";
import { triageEmails } from "@/lib/telemetry/triage";
import { normalizeOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Triage endpoint — fetches emails and returns them organized into
 * Split Inbox columns with revenue-weighted priority.
 *
 * POST /api/gmail/triage
 * Body: { refreshToken?, maxResults?, query? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = process.env.GMAIL_CLIENT_ID || "";
    const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
    const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

    if (!clientId || !refreshToken) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 401 });
    }

    const redirectUri = `${normalizeOrigin(request.nextUrl.origin)}/api/gmail/callback`;
    const config = { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" };

    // Fetch recent emails — default to inbox, optionally with a custom query
    const query = body.query || "in:inbox";
    const maxResults = body.maxResults || 100;

    const emails = await searchEmailsREST(config, query, maxResults);
    const columns = triageEmails(emails);

    // Summary stats
    const totalEmails = emails.length;
    const totalUnread = emails.filter((e) => !e.isRead).length;
    const totalValue = columns.reduce((s, c) => s + c.totalValue, 0);

    return NextResponse.json({
      columns,
      summary: {
        totalEmails,
        totalUnread,
        totalEstimatedValue: totalValue,
        columnCount: columns.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
