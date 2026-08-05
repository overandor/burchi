import { NextResponse } from "next/server";
import { goldenEngine } from "@/lib/golden/engine";
import { listCompetitions, getCompetitionsByCategory } from "@/lib/golden/ledger";

export const dynamic = "force-dynamic";

/** GET /api/golden/competition?category=...&rank=true */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const rank = searchParams.get("rank") === "true";
    if (rank) {
      return NextResponse.json({ rankings: goldenEngine.rankEmployees() });
    }
    const entries = category ? getCompetitionsByCategory(category as any) : listCompetitions();
    return NextResponse.json({ entries, count: entries.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
