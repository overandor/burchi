import { NextRequest, NextResponse } from "next/server";
import { advanceDiffusion } from "@/lib/spinor-rl/engine";
import { loadDiffusionStates } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/spinor-rl/diffusion?hypothesisId=...
 * Returns diffusion states.
 *
 * POST /api/spinor-rl/diffusion
 * Body: { hypothesisId }
 * Advances a discovery through staged diffusion.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hypothesisId = searchParams.get("hypothesisId");
    const states = loadDiffusionStates();
    if (hypothesisId) {
      const state = states.find((s) => s.hypothesisId === hypothesisId);
      return NextResponse.json({ state: state || null });
    }
    return NextResponse.json({ states, count: states.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { hypothesisId } = body;
    if (!hypothesisId) {
      return NextResponse.json({ error: "hypothesisId required" }, { status: 400 });
    }
    const state = advanceDiffusion(hypothesisId);
    return NextResponse.json({ state });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
