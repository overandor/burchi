import { NextRequest, NextResponse } from "next/server";
import { searchEmailsREST } from "@/lib/gmail/rest-client";
import { generateFollowUps } from "@/lib/telemetry/triage";
import { normalizeOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Follow-ups endpoint — finds unreplied high-value emails that need follow-up.
 *
 * POST /api/gmail/followups
 * Body: { refreshToken?, maxResults?, daysThreshold? }
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

    // Fetch sent emails to know which threads we've replied to,
    // and inbox emails to find unreplied ones.
    // Strategy: get inbox emails, then check if there's a sent email in the same thread.
    const maxResults = body.maxResults || 100;
    const inboxEmails = await searchEmailsREST(config, "in:inbox is:unread", maxResults);

    // Get sent emails to identify threads we've already replied to
    const sentEmails = await searchEmailsREST(config, "in:sent", maxResults);
    const repliedThreadIds = new Set(sentEmails.map((e) => e.threadId).filter(Boolean));

    // Filter out emails whose thread we've already replied to
    const unreplied = inboxEmails.filter((e) => !repliedThreadIds.has(e.threadId || ""));

    const followUps = generateFollowUps(unreplied);

    return NextResponse.json({
      followUps,
      count: followUps.length,
      overdue: followUps.filter((f) => f.urgency === "overdue").length,
      soon: followUps.filter((f) => f.urgency === "soon").length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
