import { NextRequest, NextResponse } from "next/server";
import { syncAndProcessGmail } from "@/lib/gmail/pipeline";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const body = await request.json().catch(() => ({}));

    const clientId = body.clientId || process.env.GMAIL_CLIENT_ID || config.graph?.clientId || "";
    const clientSecret = body.clientSecret || process.env.GMAIL_CLIENT_SECRET || config.graph?.clientSecret || "";

    // Get refresh token from body (stored in localStorage by client)
    const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

    if (!clientId || !refreshToken) {
      return NextResponse.json({
        error: "Gmail not connected. Go to Settings → Gmail Configuration and click Connect Gmail.",
      }, { status: 401 });
    }

    const maxEmails = body.maxEmails || 100;
    const redirectUri = `${normalizeOrigin(request.nextUrl.origin)}/api/gmail/callback`;

    const result = await syncAndProcessGmail(
      { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
      maxEmails
    );

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
