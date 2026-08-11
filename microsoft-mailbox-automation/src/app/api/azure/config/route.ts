import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import {
  resolveMicrosoftClientId,
  resolveMicrosoftTenantId,
  BUILTIN_MICROSOFT_CLIENT_ID,
} from "@/lib/auth/microsoft-public-client";

export const dynamic = "force-dynamic";

/**
 * Returns whether Azure AD / Microsoft Graph OAuth is configured server-side.
 * Always returns configured=true because a built-in Microsoft Graph Command
 * Line Tools public client ID is used as a default, allowing users to sign
 * in without registering their own Azure AD application.
 */
export async function GET() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error("[azure/config] loadConfig error:", e);
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

  const clientSecret =
    process.env.AZURE_AD_CLIENT_SECRET ||
    process.env.AZURE_CLIENT_SECRET ||
    process.env.MICROSOFT_CLIENT_SECRET ||
    config.graph?.clientSecret ||
    "";
  const mailbox =
    process.env.MAILBOX_EMAIL ||
    config.graph?.mailbox ||
    "";

  const clientId = resolveMicrosoftClientId(configuredClientId);
  const tenantId = resolveMicrosoftTenantId(configuredTenant);
  const usingBuiltinClient = clientId === BUILTIN_MICROSOFT_CLIENT_ID;

  return NextResponse.json({
    configured: true,
    clientId,
    tenantId,
    hasSecret: !!clientSecret,
    mailbox,
    usingBuiltinClient,
  });
}
