import { NextRequest, NextResponse } from "next/server";
import { syncAndProcessGmail } from "@/lib/gmail/pipeline";
import { loadConfig } from "@/lib/config";
import { normalizeOrigin, getRequestOrigin } from "@/lib/utils";
import { generateTelemetry } from "@/lib/telemetry/engine";
import { detectCommitments } from "@/lib/commitment/detector";
import { upsertCommitmentByEmailId } from "@/lib/commitment/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const body = await request.json().catch(() => ({}));

    const clientId = body.clientId || process.env.GMAIL_CLIENT_ID || config.graph?.clientId || "";
    const clientSecret = body.clientSecret || process.env.GMAIL_CLIENT_SECRET || config.graph?.clientSecret || "";

    // Get refresh token from body (stored in localStorage by client)
    const refreshToken = body.refreshToken || request.cookies.get("gmail-refresh-token")?.value || "";

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
