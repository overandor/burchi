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

    if (!body.email || typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json({ error: "email is required and must be a valid email address" }, { status: 400 });
    }
    if (!body.host || typeof body.host !== "string" || body.host.trim() === "") {
      return NextResponse.json({ error: "host is required" }, { status: 400 });
    }

    const { loadConfig, saveConfig } = await import("@/lib/config");
    const config = loadConfig();

    const passwordProvided = !!(body.password && typeof body.password === "string" && body.password.trim() !== "");

    const updated = {
      ...config,
      graph: {
        ...config.graph,
        mailbox: body.email || config.graph.mailbox,
        imap: {
          ...(config.graph as any).imap,
          host: body.host,
          port: body.port || 993,
          passwordConfigured: passwordProvided || (config.graph as any).imap?.passwordConfigured || false,
        },
      },
    };
    saveConfig(updated);

    return NextResponse.json({
      configured: !!(body.email && (passwordProvided || (config.graph as any).imap?.passwordConfigured)),
      email: body.email || "",
      host: body.host || "outlook.office365.com",
      port: body.port || 993,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
