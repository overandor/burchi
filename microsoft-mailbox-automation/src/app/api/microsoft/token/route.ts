import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/token
 *
 * Polls for the token after the user completes the device code flow.
 * Body: { device_code: string, client_id?: string, scopes?: string[] }
 *
 * Returns:
 *   access_token, refresh_token, id_token — on success
 *   { error: "authorization_pending" } — user hasn't logged in yet (keep polling)
 *   { error: "authorization_declined" } — user declined
 *   { error: "expired_token" } — code expired
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const deviceCode = body.device_code;
  const clientId = body.client_id || "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
  const scopes = body.scopes || [
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Files.Read",
    "https://graph.microsoft.com/Files.Read.All",
    "offline_access",
    "openid",
    "profile",
  ];

  if (!deviceCode) {
    return NextResponse.json({ error: "device_code is required" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: clientId,
            device_code: deviceCode,
            scope: scopes.join(" "),
          }),
          signal: controller.signal,
        }
      );

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (!res.ok) {
        // Return the specific error so the client can handle polling
        return NextResponse.json({
          error: data.error || "token_request_failed",
          error_description: data.error_description || "",
          interval: data.interval || 5,
        }, { status: 400 });
      }

      return NextResponse.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        id_token: data.id_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        scope: data.scope,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.name === "AbortError" ? "Token request timed out" : e.message }, { status: 504 });
  }
}
