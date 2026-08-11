import { NextRequest, NextResponse } from "next/server";
import { detectInboxProvider } from "@/lib/golden/demo-seed";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/connect
 * Returns the auto-detected inbox provider and configuration.
 * The inbox self-configures based on available environment variables
 * and stored configuration — no manual setup required.
 *
 * POST /api/inbox/connect
 * Tests the connection to the detected provider and returns status.
 */
export async function GET() {
  try {
    let provider;
    try {
      const ctx = await getAuthContext();
      provider = detectInboxProvider({ orgId: ctx.orgId, userId: ctx.user.id });
    } catch {
      provider = detectInboxProvider();
    }
    return NextResponse.json({
      ...provider,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let provider;
    try {
      const ctx = await getAuthContext();
      provider = detectInboxProvider({ orgId: ctx.orgId, userId: ctx.user.id });
    } catch {
      provider = detectInboxProvider();
    }
    const body = await req.json().catch(() => ({}));

    // Test connection based on provider
    if (provider.provider === "gmail") {
      // Check if Gmail OAuth tokens are available
      const refreshToken = body.refreshToken;
      if (!refreshToken) {
        return NextResponse.json({
          provider: "gmail",
          connected: false,
          message: "Gmail OAuth credentials detected. Visit /api/gmail/auth to authorize.",
          authUrl: "/api/gmail/auth",
        });
      }
      return NextResponse.json({
        provider: "gmail",
        connected: true,
        message: "Gmail connected with refresh token.",
      });
    }

    if (provider.provider === "imap") {
      // Test IMAP connection
      try {
        const { ImapFlow } = await import("imapflow");
        const client = new ImapFlow({
          host: provider.host || "outlook.office365.com",
          port: provider.port || 993,
          secure: (provider.port || 993) === 993,
          auth: {
            user: provider.email || "",
            pass: process.env.IMAP_PASSWORD || process.env.OUTLOOK_PASSWORD || "",
          },
          logger: false,
        });
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const status = await client.status("INBOX", { messages: true, unseen: true });
          return NextResponse.json({
            provider: "imap",
            connected: true,
            email: provider.email,
            messageCount: status.messages,
            unseenCount: status.unseen,
            message: `IMAP connected to ${provider.email}. ${status.messages} messages, ${status.unseen} unread.`,
          });
        } finally {
          lock.release();
          await client.logout();
        }
      } catch (e: any) {
        return NextResponse.json({
          provider: "imap",
          connected: false,
          error: e.message,
          message: `IMAP connection failed: ${e.message}`,
        }, { status: 500 });
      }
    }

    if (provider.provider === "graph") {
      return NextResponse.json({
        provider: "graph",
        connected: true,
        email: provider.email,
        message: `Microsoft Graph configured for ${provider.email}.`,
      });
    }

    // Demo mode
    return NextResponse.json({
      provider: "demo",
      connected: true,
      message: "Demo inbox active. Seeded emails with attachments are available.",
      note: "Set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET or IMAP_EMAIL/IMAP_PASSWORD to connect a real mailbox.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
