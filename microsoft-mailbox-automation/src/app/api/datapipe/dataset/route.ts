import { NextRequest, NextResponse } from "next/server";
import { getDataset, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
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
    const entityType = searchParams.get("entityType") || undefined;
    const period = searchParams.get("period") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const search = searchParams.get("search") || undefined;

    const result = getDataset(orgId, { entityType, period, limit, offset, search });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
