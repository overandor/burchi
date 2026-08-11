import { NextResponse } from "next/server";
import { loadHypotheses } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/golden/hypotheses — list all real persisted hypotheses. */
export async function GET() {
  try {
    const hypotheses = loadHypotheses();
    return NextResponse.json({ hypotheses, count: hypotheses.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
