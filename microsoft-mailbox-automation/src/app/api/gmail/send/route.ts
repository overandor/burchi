import { NextRequest, NextResponse } from "next/server";
import { sendEmailREST } from "@/lib/gmail/rest-client";
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

    if (!body.to || !body.subject || !body.body) {
      return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
    }

    const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;
    const result = await sendEmailREST(
      { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
      {
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        body: body.body,
        isHtml: body.isHtml,
        inReplyTo: body.inReplyTo,
        threadId: body.threadId,
      }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
