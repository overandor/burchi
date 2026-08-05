import { NextRequest, NextResponse } from "next/server";
import { forwardEmailREST } from "@/lib/gmail/rest-client";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = process.env.GMAIL_CLIENT_ID || "";
    const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
    const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

    if (!clientId || !refreshToken) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 401 });
    }

    if (!body.messageId || !body.forwardTo) {
      return NextResponse.json({ error: "messageId and forwardTo are required" }, { status: 400 });
    }

    const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;
    const result = await forwardEmailREST(
      { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
      body.messageId,
      body.forwardTo,
      body.note
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
