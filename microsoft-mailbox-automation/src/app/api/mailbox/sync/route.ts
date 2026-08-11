import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { syncAndProcess } from "@/lib/pipeline";
import { validateConfig } from "@/lib/graph/client";
import { generateTelemetry } from "@/lib/telemetry/engine";
import { detectCommitments } from "@/lib/commitment/detector";
import { upsertCommitmentByEmailId } from "@/lib/commitment/store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1. Resolve the user access token. Priority:
    //    - Authorization header
    //    - request body (e.g. client localStorage fallback)
    let userToken =
      request.headers.get("Authorization")?.replace("Bearer ", "") ||
      body.accessToken ||
      "";

    // 2. Resolve the target mailbox.
    let mailbox = body.mailbox || "";

    // 3. If no client token supplied, try server-side credential store.
    //    On serverless platforms where SQLite is not persistent, this may be
    //    empty, and the client must pass the token instead.
    if (!userToken) {
      try {
        const ctx = await getAuthContext();
        const { getCredentialsForUser } = await import("@/lib/auth/credential-store");
        const creds = getCredentialsForUser(ctx.orgId, ctx.user.id).filter(
          (c: any) => c.provider === (body.provider || "microsoft")
        );
        if (creds.length > 0) {
          const cred = creds[0];
          userToken = cred.accessToken || cred.refreshToken || "";
          mailbox = mailbox || cred.email || "";
        }
      } catch (e) {
        console.error("[mailbox/sync] credential lookup error:", e);
      }
    }

    if (!userToken || !mailbox) {
      return NextResponse.json(
        { error: "Microsoft 365 not connected. Connect in Settings or provide accessToken and mailbox." },
        { status: 401 }
      );
    }

    const config = loadConfig();
    const errors = validateConfig(config);

    // 4. If we have a user token, the Graph client ID/secret are not required.
    //    We still warn about missing config but do not block the sync.
    const missingGraph = !config.graph.clientId || !config.graph.tenantId;
    if (!userToken && (errors.length > 0 || missingGraph)) {
      return NextResponse.json(
        { error: "Configuration incomplete", details: errors },
        { status: 400 }
      );
    }
    if (missingGraph) {
      console.warn("[mailbox/sync] Graph client/tenant not configured; using user token only.");
    }

    const result = await syncAndProcess(config, {
      processAll: body.processAll || false,
      maxEmails: body.maxEmails,
      userToken,
      mailbox,
    });

    // Auto-generate telemetry report from synced records
    let telemetry = null;
    try {
      telemetry = generateTelemetry(result.records || []);
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
          console.error("[mailbox/sync] commitment upsert error:", e.message);
        }
      }
    } catch (e: any) {
      console.error("[mailbox/sync] commitment detection error:", e.message);
    }

    return NextResponse.json({ ...result, telemetry, commitments });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
