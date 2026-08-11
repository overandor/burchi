import { NextRequest, NextResponse } from "next/server";
import { addAttribution, getAttribution } from "@/lib/runtime/engine";
import type { AttributionNode } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/attribution?experimentId=xxx — get attribution lineage for an experiment
 * POST /api/runtime/attribution — add an attribution node
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const experimentId = searchParams.get("experimentId");
  if (!experimentId) {
    return NextResponse.json({ error: "experimentId is required" }, { status: 400 });
  }
  return NextResponse.json({ attribution: getAttribution(experimentId) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { experimentId, role, actor, contributionWeight, evidence } = body;

    if (!experimentId || !role || !actor) {
      return NextResponse.json({ error: "experimentId, role, and actor are required" }, { status: 400 });
    }

    const validRoles: AttributionNode["role"][] = ["originator", "contributor", "data_contributor", "improver", "replicator"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    const node = addAttribution(experimentId, role, actor, contributionWeight || 0.5, evidence || "");
    return NextResponse.json({ node, message: "Attribution added" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
