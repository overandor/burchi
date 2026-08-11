import { NextRequest, NextResponse } from "next/server";
import { listAllGauntletRuns, loadGauntletRun, loadGauntletRunsForHypothesis, getGauntletStats } from "@/lib/spinor/gauntlet-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/spinor/gauntlet-runs
 *   ?hypothesisId=... — runs for a specific hypothesis
 *   ?runId=...        — a single run
 *   ?stats=true       — aggregate stats only
 *
 * Returns persisted gauntlet runs — the 9-stage audit trail for every
 * outcome that passed through the Research Gauntlet.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");
    const hypothesisId = searchParams.get("hypothesisId");
    const stats = searchParams.get("stats");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (stats === "true") {
      return NextResponse.json(getGauntletStats());
    }

    if (runId) {
      const run = loadGauntletRun(runId);
      if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ run });
    }

    if (hypothesisId) {
      const runs = loadGauntletRunsForHypothesis(hypothesisId);
      return NextResponse.json({ runs, count: runs.length });
    }

    const runs = listAllGauntletRuns(limit);
    const statsData = getGauntletStats();
    return NextResponse.json({ runs, count: runs.length, stats: statsData });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
