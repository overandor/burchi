import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/me
 *
 * Gets the current user's profile from Microsoft Graph using the access token.
 * Body: { access_token: string }
 *
 * Returns: { displayName, email, id }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = body.access_token;

  if (!token) {
    return NextResponse.json({ error: "access_token is required" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: `Graph API error: ${err}` }, { status: res.status });
      }

      const data = await res.json();
      return NextResponse.json({
        id: data.id,
        displayName: data.displayName || data.givenName || "User",
        email: data.mail || data.userPrincipalName || "",
        jobTitle: data.jobTitle || "",
        officeLocation: data.officeLocation || "",
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.name === "AbortError" ? "Graph request timed out" : e.message }, { status: 504 });
  }
}
