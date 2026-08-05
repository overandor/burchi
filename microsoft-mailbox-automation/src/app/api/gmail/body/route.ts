import { NextRequest, NextResponse } from "next/server";
import { fetchEmailBodyREST } from "@/lib/gmail/rest-client";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/gmail/body
 * Fetches the full body of a single email on demand.
 * Body: { messageId, refreshToken? }
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

    if (!body.messageId) {
      return NextResponse.json({ error: "messageId required" }, { status: 400 });
    }

    const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;
    const rawBody = await fetchEmailBodyREST(
      { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
      body.messageId
    );

    // Strip HTML tags if the body is HTML
    const cleanBody = rawBody.includes("<") && rawBody.includes(">")
      ? rawBody
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : rawBody;

    return NextResponse.json({ body: cleanBody || "(no body)" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
