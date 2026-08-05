import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Returns whether Azure AD / Microsoft Graph OAuth is configured server-side.
 * Exposes the clientId (not secret) so the client knows it can initiate auth.
 */
export async function GET() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error("[azure/config] loadConfig error:", e);
    config = { graph: {} };
  }

  const clientId =
    process.env.AZURE_AD_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID ||
    process.env.MICROSOFT_CLIENT_ID ||
    config.graph?.clientId ||
    "";
  const tenantId =
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

  return NextResponse.json({
    configured: !!(clientId && tenantId && clientSecret),
    clientId,
    tenantId,
    hasSecret: !!clientSecret,
    mailbox,
  });
}
