import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import {
  resolveMicrosoftClientId,
  resolveMicrosoftTenantId,
  MICROSOFT_GRAPH_SCOPES,
} from "@/lib/auth/microsoft-public-client";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * GET /api/microsoft/callback
 *
 * Handles the OAuth redirect callback from Microsoft.
 * Exchanges the authorization code for access + refresh tokens,
 * then redirects to the frontend with the tokens in a cookie-friendly format.
 *
 * Query params (from Microsoft):
 *   code — the authorization code
 *   state — base64url-encoded state with returnTo path
 *   error — if the user declined or an error occurred
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const stateParam = searchParams.get("state");

  // Parse state to get returnTo
  let returnTo = "/settings";
  try {
    if (stateParam) {
      const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
      returnTo = state.returnTo || "/settings";
    }
  } catch {
    // Invalid state — use default
  }

  // Handle error from Microsoft
  if (error) {
    const errMsg = errorDescription || error;
    const redirectUrl = new URL(returnTo, request.nextUrl.origin);
    redirectUrl.searchParams.set("ms_error", errMsg);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    const redirectUrl = new URL(returnTo, request.nextUrl.origin);
    redirectUrl.searchParams.set("ms_error", "No authorization code received");
    return NextResponse.redirect(redirectUrl);
  }

  // Load config for client ID
  let config;
  try {
    config = loadConfig();
  } catch {
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
  const origin = normalizeOrigin(getRequestOrigin(request));
  const redirectUri = `${origin}/api/microsoft/callback`;

  try {
    // Exchange the authorization code for tokens
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            redirect_uri: redirectUri,
            scope: MICROSOFT_GRAPH_SCOPES.join(" "),
          }),
          signal: controller.signal,
        }
      );

      const tokenText = await tokenRes.text();
      const tokenData = tokenText ? JSON.parse(tokenText) : {};

      if (!tokenRes.ok) {
        const errMsg = tokenData.error_description || tokenData.error || "Token exchange failed";
        const redirectUrl = new URL(returnTo, request.nextUrl.origin);
        redirectUrl.searchParams.set("ms_error", errMsg);
        return NextResponse.redirect(redirectUrl);
      }

      // Fetch user profile from Microsoft Graph
      let userProfile = { displayName: "User", email: "" };
      try {
        const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          userProfile = {
            displayName: me.displayName || me.userPrincipalName || "User",
            email: me.mail || me.userPrincipalName || "",
          };
        }
      } catch {
        // Non-fatal — we still have the tokens
      }

      // Redirect to the frontend with tokens encoded in the URL fragment
      // (fragment is not sent to the server, keeping tokens client-side)
      const redirectUrl = new URL(returnTo, request.nextUrl.origin);
      const tokenBundle = Buffer.from(JSON.stringify({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || "",
        idToken: tokenData.id_token || "",
        expiresInSeconds: tokenData.expires_in || 3600,
        tokenType: tokenData.token_type || "Bearer",
        scope: tokenData.scope || "",
        name: userProfile.displayName,
        email: userProfile.email,
        obtainedAt: Date.now(),
      })).toString("base64url");
      redirectUrl.searchParams.set("ms_auth", tokenBundle);

      return NextResponse.redirect(redirectUrl);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    const redirectUrl = new URL(returnTo, request.nextUrl.origin);
    redirectUrl.searchParams.set("ms_error", e.name === "AbortError" ? "Token exchange timed out" : e.message);
    return NextResponse.redirect(redirectUrl);
  }
}
