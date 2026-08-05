import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/sync
 *
 * Fetches emails from Microsoft Graph using the access token.
 * Body: { token: string, maxEmails?: number }
 *
 * Returns: { messages: [...] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = body.token;
  const maxEmails = body.maxEmails || 50;

  if (!token) {
    return NextResponse.json({ error: "Access token is required" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      // Fetch emails from Microsoft Graph
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?$top=${maxEmails}&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,categories&$orderby=receivedDateTime desc`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: `Graph API error: ${err}` }, { status: res.status });
      }

      const data = await res.json();
      const messages = (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || "(no subject)",
        from: msg.from?.emailAddress
          ? `${msg.from.emailAddress.name || ""} <${msg.from.emailAddress.address || ""}>`.trim()
          : "unknown",
        fromAddress: msg.from?.emailAddress?.address || "",
        receivedDateTime: msg.receivedDateTime || "",
        bodyPreview: msg.bodyPreview || "",
        hasAttachments: msg.hasAttachments || false,
        importance: msg.importance || "normal",
        categories: msg.categories || [],
      }));

      return NextResponse.json({
        success: true,
        count: messages.length,
        messages,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.name === "AbortError" ? "Graph request timed out" : e.message }, { status: 504 });
  }
}
