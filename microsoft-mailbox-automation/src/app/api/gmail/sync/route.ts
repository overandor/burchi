import { NextRequest, NextResponse } from "next/server";
import { syncAndProcessGmail } from "@/lib/gmail/pipeline";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import { generateTelemetry } from "@/lib/telemetry/engine";
import { detectCommitments } from "@/lib/commitment/detector";
import { upsertCommitmentByEmailId } from "@/lib/commitment/store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const body = await request.json().catch(() => ({}));

    const clientId = body.clientId || process.env.GMAIL_CLIENT_ID || config.graph?.clientId || "";
    const clientSecret = body.clientSecret || process.env.GMAIL_CLIENT_SECRET || config.graph?.clientSecret || "";

    // Get refresh token from body (stored in localStorage by client), cookie, or server credential store.
    let refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

    if (!refreshToken) {
      try {
        const ctx = await getAuthContext();
        const { getCredentialsForUser } = await import("@/lib/auth/credential-store");
        const creds = getCredentialsForUser(ctx.orgId, ctx.user.id).filter((c: any) => c.provider === "gmail");
        if (creds.length > 0) {
          refreshToken = creds[0].refreshToken || creds[0].accessToken || "";
        }
      } catch (e) {
        console.error("[gmail/sync] credential lookup error:", e);
      }
    }

    if (!clientId || !refreshToken) {
      return NextResponse.json({
        error: "Gmail not connected. Go to Settings → Gmail Configuration and click Connect Gmail.",
      }, { status: 401 });
    }

    const maxEmails = body.maxEmails || 100;
    const redirectUri = `${normalizeOrigin(getRequestOrigin(request))}/api/gmail/callback`;

    const result = await syncAndProcessGmail(
      { clientId, clientSecret, redirectUri, refreshToken, emailAddress: "" },
      maxEmails
    );

    // Auto-generate telemetry report from synced records
    let telemetry = null;
    try {
      telemetry = generateTelemetry(result.records);
    } catch (e: any) {
      console.error("Telemetry generation failed:", e.message);
    }

    let commitments = [] as any[];
    try {
      commitments = detectCommitments(result.records || []);
      for (const c of commitments) {
        try {
          upsertCommitmentByEmailId(c);
        } catch (e: any) {
          console.error("[gmail/sync] commitment upsert error:", e.message);
        }
      }
    } catch (e: any) {
      console.error("[gmail/sync] commitment detection error:", e.message);
    }

    return NextResponse.json({ ...result, telemetry, commitments });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
