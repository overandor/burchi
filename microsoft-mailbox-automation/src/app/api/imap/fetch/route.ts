import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/imap/fetch — fetch emails via IMAP using stored credentials.
 * Body: { maxEmails?: number, folder?: string }
 *
 * Works with Outlook.com, Office365, and any IMAP-enabled mail server.
 * No Azure AD app registration needed — just email + app password.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  // Get credentials from env vars or request body
  const email =
    process.env.IMAP_EMAIL ||
    process.env.OUTLOOK_EMAIL ||
    body.email ||
    "";
  const password =
    process.env.IMAP_PASSWORD ||
    process.env.OUTLOOK_PASSWORD ||
    body.password ||
    "";
  const host = process.env.IMAP_HOST || body.host || "outlook.office365.com";
  const port = parseInt(process.env.IMAP_PORT || body.port?.toString() || "993");
  const maxEmails = body.maxEmails || 20;
  const folder = body.folder || "INBOX";

  if (!email || !password) {
    return NextResponse.json(
      { error: "IMAP credentials not configured. Set email and app password in Settings." },
      { status: 400 }
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user: email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      // Get latest messages
      const messages = [];
      const uids = await client.search({ all: true }, { uid: true });
      const uidList = Array.isArray(uids) ? uids : [];

      // Get the most recent N messages
      const recentUids = uidList.slice(-maxEmails).reverse();

      for (const uid of recentUids) {
        const msg = await client.fetchOne(uid, {
          uid: true,
          envelope: true,
          bodyStructure: true,
          flags: true,
          internalDate: true,
        }, { uid: true });

        if (!msg) continue;

        // Get body preview (first 500 chars of text)
        let bodyPreview = "";
        try {
          const content = await client.download(uid, "1", { uid: true });
          if (content && content.content) {
            const chunks: Buffer[] = [];
            const stream = content.content as any;
            const reader = stream.getReader ? stream.getReader() : null;
            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(Buffer.from(value));
                if (Buffer.concat(chunks).length > 5000) break;
              }
            }
            const fullBody = Buffer.concat(chunks).toString("utf-8");
            bodyPreview = fullBody
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 500);
          }
        } catch {}

        messages.push({
          id: msg.uid?.toString() || "",
          subject: msg.envelope?.subject || "(no subject)",
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ""} <${msg.envelope.from[0].address || ""}>`.trim()
            : "unknown",
          fromAddress: msg.envelope?.from?.[0]?.address || "",
          receivedDateTime: msg.internalDate
            ? new Date(msg.internalDate).toISOString()
            : "",
          bodyPreview,
          hasAttachments: !!(msg.bodyStructure?.childNodes?.some(
            (c: any) => c.type === "attachment"
          )),
          isRead: msg.flags?.has("\\Seen") || false,
          importance: "normal",
          categories: [],
        });
      }

      return NextResponse.json({
        success: true,
        count: messages.length,
        messages,
        mailbox: folder,
      });
    } finally {
      lock.release();
    }
  } catch (e: any) {
    // Provide helpful error messages
    let errorMsg = e.message || "IMAP connection failed";
    if (errorMsg.includes("Authentication failed") || errorMsg.includes("INVALID")) {
      errorMsg =
        "Authentication failed. For Outlook.com/Microsoft 365, you need an App Password " +
        "(not your regular password). Enable 2FA at https://account.microsoft.com/security, " +
        "then create an app password at https://account.live.com/proofs/AppPassword.";
    } else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOTFOUND")) {
      errorMsg = `Cannot connect to ${host}:${port}. Check the IMAP host setting.`;
    }
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}
