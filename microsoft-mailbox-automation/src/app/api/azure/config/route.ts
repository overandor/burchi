import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Returns whether Azure AD / Microsoft Graph OAuth is configured server-side.
 * Exposes the clientId (not secret) so the client knows it can initiate auth.
 */
export async function GET() {
  const config = loadConfig();

  const clientId =
    process.env.AZURE_CLIENT_ID ||
    process.env.MICROSOFT_CLIENT_ID ||
    config.graph?.clientId ||
    "";
  const tenantId =
    process.env.AZURE_TENANT_ID ||
    process.env.MICROSOFT_TENANT_ID ||
    config.graph?.tenantId ||
    "";
  const clientSecret =
    process.env.AZURE_CLIENT_SECRET ||
    process.env.MICROSOFT_CLIENT_SECRET ||
    config.graph?.clientSecret ||
    "";

  return NextResponse.json({
    configured: !!(clientId && tenantId && clientSecret),
    clientId,
    tenantId,
    hasSecret: !!clientSecret,
  });
}
