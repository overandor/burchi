import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import {
  resolveMicrosoftClientId,
  resolveMicrosoftTenantId,
  MICROSOFT_GRAPH_SCOPES,
} from "@/lib/auth/microsoft-public-client";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/devicecode
 *
 * Initiates the OAuth device code flow for Microsoft 365 / Outlook.
 * Uses a built-in Microsoft Graph Command Line Tools public client ID
 * by default, so users can sign in without registering their own Azure AD
 * application. If AZURE_AD_CLIENT_ID is set in the environment, that value
 * takes precedence.
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
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error("[microsoft/devicecode] loadConfig error:", e);
    config = { graph: {} };
  }

  const configuredClientId =
    process.env.AZURE_AD_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID ||
    process.env.MICROSOFT_CLIENT_ID ||
    config.graph?.clientId ||
    "";

  const configuredTenant =
    process.env.AZURE_AD_TENANT_ID ||
    process.env.AZURE_TENANT_ID ||
    process.env.MICROSOFT_TENANT_ID ||
    config.graph?.tenantId ||
    "";

  const CLIENT_ID = resolveMicrosoftClientId(configuredClientId);
  const TENANT = resolveMicrosoftTenantId(configuredTenant);
  const SCOPES = MICROSOFT_GRAPH_SCOPES;

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
        tenant_id: TENANT,
        scopes: SCOPES,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.name === "AbortError" ? "Device code request timed out" : e.message }, { status: 504 });
  }
}
