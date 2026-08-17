import { NextRequest, NextResponse } from "next/server";
import { getEntity, getEntityTimeSeries, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
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
    const entityId = searchParams.get("id");
    if (!entityId) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const attributeKey = searchParams.get("attribute") || undefined;
    const includeTimeseries = searchParams.get("timeseries") === "true";

    const entity = getEntity(orgId, entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    let timeseries = null;
    if (includeTimeseries) {
      timeseries = getEntityTimeSeries(orgId, entityId, attributeKey || undefined);
    }

    return NextResponse.json({ entity, timeseries });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
