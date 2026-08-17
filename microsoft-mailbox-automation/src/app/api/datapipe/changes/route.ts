import { NextRequest, NextResponse } from "next/server";
import { getRecentChanges, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const ingestionId = searchParams.get("ingestionId") || undefined;
    const changeType = searchParams.get("changeType") || undefined;

    const changes = getRecentChanges(orgId, { limit, ingestionId, changeType });

    return NextResponse.json({ changes, count: changes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
