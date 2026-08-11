import { getAuthContext } from "@/lib/auth/session";
import { NextRequest, NextResponse } from "next/server";
import {
  getHypothesisEvolution,
  getOpportunityNormalizedScore,
  getPersonalTrajectory,
  identifyExplorationCandidates,
  selectEmployeeForHighUpsideHypothesis,
} from "@/lib/spinor-rl/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/spinor-rl/trajectory?employeeId=emp-001
 * Returns the personal trajectory view for the competition engine (§12).
 *
 * GET /api/spinor-rl/trajectory?action=evolution&hypothesisId=...
 * Returns the hypothesis evolution level (§8).
 *
 * GET /api/spinor-rl/trajectory?action=opportunity&employeeId=...
 * Returns opportunity-normalized score (§6).
 *
 * GET /api/spinor-rl/trajectory?action=exploration_candidates
 * Returns employees who should receive high-upside hypotheses (§5).
 *
 * GET /api/spinor-rl/trajectory?action=select_high_upside
 * Returns the selected employee for a high-upside hypothesis (§6).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "trajectory";
    const ctx = await getAuthContext();
    const employeeId = searchParams.get("employeeId") || ctx.user.id;
    const hypothesisId = searchParams.get("hypothesisId");

    switch (action) {
      case "trajectory": {
        const trajectory = getPersonalTrajectory(employeeId);
        return NextResponse.json({ trajectory });
      }
      case "evolution": {
        if (!hypothesisId) return NextResponse.json({ error: "hypothesisId required" }, { status: 400 });
        const evolution = getHypothesisEvolution(hypothesisId);
        return NextResponse.json({ evolution });
      }
      case "opportunity": {
        const score = getOpportunityNormalizedScore(employeeId);
        return NextResponse.json({ score });
      }
      case "exploration_candidates": {
        const candidates = identifyExplorationCandidates();
        return NextResponse.json({ candidates, count: candidates.length });
      }
      case "select_high_upside": {
        const selection = selectEmployeeForHighUpsideHypothesis();
        return NextResponse.json({ selection });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
