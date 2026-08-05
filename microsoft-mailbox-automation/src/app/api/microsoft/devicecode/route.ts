import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/devicecode
 *
 * Initiates the OAuth device code flow for Microsoft 365 / Outlook.
 * Uses the Azure CLI's public client ID — no app registration needed.
 *
 * Returns:
 *   device_code: string — internal code for polling
 *   user_code: string — code the user enters at the verification URI
 *   verification_uri: string — URL the user visits to login
 *   expires_in: number — seconds until the code expires
 *   interval: number — polling interval in seconds
 *   message: string — human-readable instructions
 */
export async function POST() {
  // Azure CLI public client ID — works for any Microsoft account (personal + work)
  const CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
  const TENANT = "common";
  const SCOPES = [
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Files.Read",
    "https://graph.microsoft.com/Files.Read.All",
    "offline_access",
    "openid",
    "profile",
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(
        `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            scope: SCOPES.join(" "),
          }),
          signal: controller.signal,
        }
      );

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (!res.ok) {
        return NextResponse.json(
          { error: data.error_description || data.error || "Failed to start device code flow" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval || 5,
        message: data.message || `Go to ${data.verification_uri} and enter code ${data.user_code}`,
        client_id: CLIENT_ID,
        scopes: SCOPES,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.name === "AbortError" ? "Device code request timed out" : e.message }, { status: 504 });
  }
}
