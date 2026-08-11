import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/microsoft/sync
 *
 * Fetches emails from Microsoft Graph using the access token.
 * Body: { token: string, maxEmails?: number (default 1000) }
 *
 * Uses pagination (@odata.nextLink) to fetch up to maxEmails messages.
 * Each page returns up to 100 messages (Graph API max page size).
 *
 * Returns: { messages: [...], count, totalFetched, hadMore }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = body.token;
  const maxEmails = Math.min(body.maxEmails || 1000, 1000); // cap at 1000

  if (!token) {
    return NextResponse.json({ error: "Access token is required" }, { status: 400 });
  }

  const allMessages: any[] = [];
  let nextLink: string | null = null;
  let page = 0;
  const maxPages = Math.ceil(maxEmails / 100) + 1; // safety limit

  try {
    do {
      page++;
      // Build the URL for this page
      const url: string =
        nextLink ||
        `https://graph.microsoft.com/v1.0/me/messages?$top=100&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,categories,isRead&$orderby=receivedDateTime desc`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.text();
          // If the first page fails, return the error
          if (page === 1) {
            return NextResponse.json({ error: `Graph API error: ${err}` }, { status: res.status });
          }
          // On later pages, stop and return what we have
          break;
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
          isRead: msg.isRead ?? true,
        }));

        allMessages.push(...messages);
        nextLink = data["@odata.nextLink"] || null;

        // Stop if we've reached the max
        if (allMessages.length >= maxEmails) {
          allMessages.length = maxEmails;
          break;
        }
      } finally {
        clearTimeout(timeout);
      }
    } while (nextLink && page < maxPages);

    return NextResponse.json({
      success: true,
      count: allMessages.length,
      totalFetched: allMessages.length,
      pages: page,
      hadMore: !!nextLink,
      messages: allMessages,
    });
  } catch (e: any) {
    // Return what we have even on error
    if (allMessages.length > 0) {
      return NextResponse.json({
        success: true,
        count: allMessages.length,
        totalFetched: allMessages.length,
        pages: page,
        hadMore: false,
        messages: allMessages,
        warning: `Stopped early: ${e.message}`,
      });
    }
    return NextResponse.json(
      { error: e.name === "AbortError" ? "Graph request timed out" : e.message },
      { status: 504 }
    );
  }
}
