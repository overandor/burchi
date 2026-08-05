import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/imap/connect — test IMAP connection with provided credentials.
 * Body: { email, password, host?, port? }
 * Returns success if connection works, with mailbox info.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  const email = body.email;
  const password = body.password;
  const host = body.host || "outlook.office365.com";
  const port = parseInt(body.port?.toString() || "993");

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
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
    const mailbox = await client.mailboxOpen("INBOX");
    const info = {
      success: true,
      email,
      host,
      port,
      mailbox: "INBOX",
      totalMessages: mailbox.exists || 0,
    };
    return NextResponse.json(info);
  } catch (e: any) {
    let errorMsg = e.message || "Connection failed";
    if (errorMsg.includes("Authentication failed") || errorMsg.includes("INVALID")) {
      errorMsg =
        "Authentication failed. For Outlook.com/Microsoft 365, you need an App Password " +
        "(not your regular password). Enable 2FA at https://account.microsoft.com/security, " +
        "then create an app password at https://account.live.com/proofs/AppPassword.";
    } else if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOTFOUND")) {
      errorMsg = `Cannot connect to ${host}:${port}. Check the IMAP host.`;
    }
    return NextResponse.json({ error: errorMsg, success: false }, { status: 500 });
  } finally {
    try {
      await client.logout();
    } catch (e) {
      console.error("[imap/connect] logout error:", e);
    }
  }
}
