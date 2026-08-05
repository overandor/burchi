import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Server-side OAuth token exchange.
 * Reads credentials from env vars (or config file) so the client secret
 * never reaches the browser. Returns the refresh + access tokens for the
 * client to store in localStorage (per-user authorization).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = body.code;
  const redirectUri = body.redirectUri;

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }
  if (!redirectUri) {
    return NextResponse.json({ error: "Missing redirect_uri" }, { status: 400 });
  }

  const config = loadConfig();
  const clientId =
    process.env.GMAIL_CLIENT_ID ||
    config.graph?.clientId ||
    "";
  const clientSecret =
    process.env.GMAIL_CLIENT_SECRET ||
    config.graph?.clientSecret ||
    "";

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Gmail OAuth credentials not configured on the server. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars." },
      { status: 500 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: controller.signal,
    });

    const tokenText = await tokenRes.text();
    const tokenData = tokenText ? JSON.parse(tokenText) : {};

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: tokenData.error_description || tokenData.error || "Token exchange failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      refreshToken: tokenData.refresh_token || "",
      accessToken: tokenData.access_token || "",
      expiresIn: tokenData.expires_in || 3600,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.name === "AbortError" ? "Token exchange timed out" : e.message },
      { status: 504 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
