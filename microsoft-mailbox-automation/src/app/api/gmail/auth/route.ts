import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/gmail/client";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Returns the Google OAuth authorization URL.
 * Credentials are read exclusively from server environment variables —
 * the client never sees or handles the client secret.
 */
export async function GET(request: NextRequest) {
  const config = loadConfig();

  // Only use server-side env vars or config file — never accept credentials from query params
  const clientId =
    process.env.GMAIL_CLIENT_ID ||
    config.graph?.clientId ||
    "";
  const clientSecret =
    process.env.GMAIL_CLIENT_SECRET ||
    config.graph?.clientSecret ||
    "";

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      error: "Gmail OAuth is not configured on the server. Ask your administrator to set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.",
    }, { status: 500 });
  }

  const redirectUri = `${normalizeOrigin(request.nextUrl.origin)}/api/gmail/callback`;

  const authUrl = getAuthUrl({
    clientId,
    clientSecret,
    redirectUri,
    refreshToken: "",
    emailAddress: "",
  });

  return NextResponse.json({ authUrl });
}
