import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Returns whether Gmail OAuth is configured server-side (env vars or config file).
 * Exposes the clientId (not secret) so the client can build auth URLs without
 * requiring the user to enter credentials manually.
 */
export async function GET() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error("[gmail/config] loadConfig error:", e);
    config = { graph: {} };
  }

  const clientId =
    process.env.GMAIL_CLIENT_ID ||
    config.graph?.clientId ||
    "";
  const clientSecret =
    process.env.GMAIL_CLIENT_SECRET ||
    config.graph?.clientSecret ||
    "";

  return NextResponse.json({
    configured: !!(clientId && clientSecret),
    clientId, // not secret — needed to build auth URL client-side
    hasSecret: !!clientSecret,
  });
}
