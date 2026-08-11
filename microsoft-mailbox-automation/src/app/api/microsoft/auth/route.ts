import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import {
  resolveMicrosoftClientId,
  resolveMicrosoftTenantId,
  MICROSOFT_GRAPH_SCOPES,
} from "@/lib/auth/microsoft-public-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/microsoft/auth
 *
 * Returns the Microsoft OAuth authorization URL for the redirect-based
 * authorization code flow. The user's browser is redirected to Microsoft's
 * login page, and after consent, Microsoft redirects back to
 * /api/microsoft/callback with an authorization code.
 *
 * This is a "normal login" — no device code to copy/paste.
 *
 * Query params:
 *   returnTo — optional path to redirect to after successful auth (default: /settings)
 */
export async function GET(request: NextRequest) {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
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

  const clientId = resolveMicrosoftClientId(configuredClientId);
  const tenantId = resolveMicrosoftTenantId(configuredTenant);

  if (!clientId) {
    return NextResponse.json(
      { error: "Microsoft OAuth is not configured. Set AZURE_AD_CLIENT_ID or use the device code flow." },
      { status: 500 }
    );
  }

  const origin = normalizeOrigin(getRequestOrigin(request));
  const redirectUri = `${origin}/api/microsoft/callback`;
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/settings";

  // Generate a state parameter for CSRF protection
  const state = Buffer.from(JSON.stringify({ returnTo, ts: Date.now() })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_GRAPH_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;

  return NextResponse.json({
    authUrl,
    redirectUri,
    clientId,
    tenantId,
    scopes: MICROSOFT_GRAPH_SCOPES,
  });
}
