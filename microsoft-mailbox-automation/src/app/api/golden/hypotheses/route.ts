import { NextResponse } from "next/server";
import { loadHypotheses } from "@/lib/config";
import { ensureGoldenSeeded } from "@/lib/golden/seed";

export const dynamic = "force-dynamic";

/** GET /api/golden/hypotheses — list all researched hypotheses. */
export async function GET() {
  try {
    ensureGoldenSeeded();
    const hypotheses = loadHypotheses();
    return NextResponse.json({ hypotheses, count: hypotheses.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
