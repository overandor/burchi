import { NextRequest, NextResponse } from "next/server";
import { listContributorBranches, getOrCreateContributorBranch, addExperimentToBranch } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/branches — list all contributor branches (snowflake model)
 * POST /api/runtime/branches — add experiment to contributor branch
 */
export async function GET() {
  try {
    const branches = listContributorBranches();
    return NextResponse.json({ branches });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contributor, experimentId } = body;
    if (!contributor || !experimentId) {
      return NextResponse.json({ error: "contributor and experimentId are required" }, { status: 400 });
    }
    getOrCreateContributorBranch(contributor);
    addExperimentToBranch(contributor, experimentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
