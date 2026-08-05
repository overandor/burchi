import { NextRequest, NextResponse } from "next/server";
import { sproutDerivative, getSproutTree } from "@/lib/spinor-rl/engine";
import { loadSproutTree } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/sprout?hypothesisId=...
 * Returns sprout tree for a hypothesis.
 *
 * POST /api/spinor-rl/sprout
 * Body: { hypothesisId, employeeId, modifiedDimension, parentSproutId? }
 * Sprouts a derivative from a parent hypothesis.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hypothesisId = searchParams.get("hypothesisId");
    if (hypothesisId) {
      const tree = getSproutTree(hypothesisId);
      return NextResponse.json({ sprouts: tree, count: tree.length });
    }
    return NextResponse.json({ sprouts: loadSproutTree(), count: loadSproutTree().length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { hypothesisId, employeeId, modifiedDimension, parentSproutId } = body;
    if (!hypothesisId || !employeeId || !modifiedDimension) {
      return NextResponse.json({ error: "hypothesisId, employeeId, modifiedDimension required" }, { status: 400 });
    }
    const result = await sproutDerivative(hypothesisId, employeeId, modifiedDimension, parentSproutId);
    return NextResponse.json({
      sprout: result.sprout,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
