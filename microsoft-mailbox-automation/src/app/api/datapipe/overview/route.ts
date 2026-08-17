import { NextRequest, NextResponse } from "next/server";
import { getDatasetOverview, getIngestionHistory, getAttributes, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    const overview = getDatasetOverview(orgId);
    const ingestions = getIngestionHistory(orgId, 10);
    const attributes = getAttributes(orgId);

    return NextResponse.json({ overview, ingestions, attributes });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
