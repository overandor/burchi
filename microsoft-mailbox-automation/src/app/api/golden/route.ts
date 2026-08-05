import { NextRequest, NextResponse } from "next/server";
import { goldenEngine } from "@/lib/golden/engine";

export const dynamic = "force-dynamic";

/** GET /api/golden — full engine state snapshot. */
export async function GET() {
  try {
    goldenEngine.initialize();
    const state = goldenEngine.snapshot();
    return NextResponse.json({ state });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** POST /api/golden — initialize/seed the golden store and allocate for all employees. */
export async function POST(_req: NextRequest) {
  try {
    const hypotheses = goldenEngine.initialize();
    const assignments = goldenEngine.allocateForAll();
    return NextResponse.json({ hypotheses: hypotheses.length, assignments: assignments.length, seeded: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
