import { NextRequest, NextResponse } from "next/server";
import { computeAllScores, getScores, getScoreSummary, DEFAULT_ORG_ID } from "@/lib/datapipe-scores";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    const { searchParams } = new URL(request.url);
    const scoreType = searchParams.get("scoreType") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const summary = searchParams.get("summary") === "true";

    if (summary) {
      const result = getScoreSummary(orgId);
      return NextResponse.json(result);
    }

    const result = getScores(orgId, { scoreType, limit, offset });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    const result = await computeAllScores(orgId);
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
