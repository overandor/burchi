import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/microsoft/me
 *
 * Gets the current user's profile from Microsoft Graph using the access token.
 * Tries multiple endpoints for work/school and personal accounts.
 * Falls back to decoding the id_token JWT if Graph API fails.
 *
 * Body: { access_token: string, id_token?: string }
 *
 * Returns: { displayName, email, id }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = body.access_token;
  const idToken = body.id_token;

  if (!token) {
    return NextResponse.json({ error: "access_token is required" }, { status: 400 });
  }

  // Helper: decode JWT payload without verification (we trust the token from Microsoft)
  function decodeJwtPayload(jwt: string): Record<string, any> | null {
    try {
      const parts = jwt.split(".");
      if (parts.length < 2) return null;
      const payload = Buffer.from(parts[1], "base64url").toString();
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      // Try Graph /me endpoint (works for work/school accounts)
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (res.ok) {
        const data = await res.json();
        const name = data.displayName || data.givenName || "";
        const email = data.mail || data.userPrincipalName || "";
        // Only return if we got BOTH name and email
        // Otherwise fall through to other methods
        if (name && email) {
          return NextResponse.json({
            id: data.id,
            displayName: name,
            email,
            jobTitle: data.jobTitle || "",
            officeLocation: data.officeLocation || "",
          });
        }
      }

      // Graph /me failed or returned empty — try the userinfo endpoint
      // (works for personal Microsoft accounts with openid/profile scopes)
      clearTimeout(timeout);
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 9000);
      try {
        const userinfoRes = await fetch(
          "https://graph.microsoft.com/oidc/userinfo",
          { headers: { Authorization: `Bearer ${token}` }, signal: controller2.signal }
        );
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          const name = userinfo.name || userinfo.given_name || userinfo.family_name || "";
          const email = userinfo.email || userinfo.preferred_username || userinfo.upn || "";
          if (name || email) {
            return NextResponse.json({
              id: userinfo.sub || "",
              displayName: name || "Microsoft User",
              email,
              jobTitle: "",
              officeLocation: "",
            });
          }
        }
      } finally {
        clearTimeout(timeout2);
      }

      // Both Graph endpoints failed — decode the id_token JWT as last resort
      if (idToken) {
        const claims = decodeJwtPayload(idToken);
        if (claims) {
          const name = claims.name || claims.given_name || claims.family_name ||
                       claims.preferred_username || claims.preferredUsername || "";
          const email = claims.email || claims.preferred_username ||
                        claims.preferredUsername || claims.upn ||
                        claims.unique_name || "";
          if (name || email) {
            return NextResponse.json({
              id: claims.sub || claims.oid || "",
              displayName: name || "Microsoft User",
              email,
              jobTitle: "",
              officeLocation: "",
            });
          }
        }
      }

      // All methods failed — return minimal profile
      // The token still works for email sync, we just don't have the display name
      return NextResponse.json({
        id: "",
        displayName: "Microsoft User",
        email: "",
        jobTitle: "",
        officeLocation: "",
        warning: "Profile fetch failed — token is still valid for email sync",
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    // If we have an id_token, try to decode it even on network error
    if (idToken) {
      const claims = decodeJwtPayload(idToken);
      if (claims) {
        return NextResponse.json({
          id: claims.sub || claims.oid || "",
          displayName: claims.name || claims.given_name || "Microsoft User",
          email: claims.email || claims.preferred_username || claims.upn || "",
          jobTitle: "",
          officeLocation: "",
        });
      }
    }
    return NextResponse.json(
      { error: e.name === "AbortError" ? "Graph request timed out" : e.message },
      { status: 504 }
    );
  }
}
