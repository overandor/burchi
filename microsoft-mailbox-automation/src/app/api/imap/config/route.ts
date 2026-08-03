import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/imap/config — returns whether IMAP credentials are configured server-side.
 * PUT /api/imap/config — saves IMAP credentials (email + app password).
 */
export async function GET() {
  const email = process.env.IMAP_EMAIL || process.env.OUTLOOK_EMAIL || "";
  const password = process.env.IMAP_PASSWORD || process.env.OUTLOOK_PASSWORD || "";
  const host = process.env.IMAP_HOST || "outlook.office365.com";
  const port = parseInt(process.env.IMAP_PORT || "993");

  return NextResponse.json({
    configured: !!(email && password),
    email,
    host,
    port,
    hasPassword: !!password,
  });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    // Store in env-like fashion — on Netlify serverless, we can't persist env vars
    // at runtime, so we store in the config file
    const { loadConfig, saveConfig } = await import("@/lib/config");
    const config = loadConfig();

    // Save IMAP creds in the graph section (reusing the mailbox field)
    const updated = {
      ...config,
      graph: {
        ...config.graph,
        mailbox: body.email || config.graph.mailbox,
        clientSecret: body.password || config.graph.clientSecret,
      },
    };
    saveConfig(updated);

    return NextResponse.json({
      configured: !!(body.email && body.password),
      email: body.email || "",
      host: body.host || "outlook.office365.com",
      port: body.port || 993,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
