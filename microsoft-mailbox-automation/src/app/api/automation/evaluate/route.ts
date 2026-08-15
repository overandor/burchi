import { NextRequest, NextResponse } from "next/server";
import { evaluateAllCandidates, evaluatePromotion } from "@/lib/automation/evaluation";
import { getCandidate } from "@/lib/automation/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/automation/evaluate
 * Query params:
 *   - id: evaluate single candidate
 *   - all: evaluate all candidates (default)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const candidate = getCandidate(id);
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const promotion = evaluatePromotion(id);
    return NextResponse.json({
      candidateId: id,
      candidateName: candidate.name,
      stage: candidate.stage,
      promotion,
    });
  }

  const evaluations = evaluateAllCandidates();
  const summary = {
    total: evaluations.length,
    netPositive: evaluations.filter(e => e.netSavings?.isNetPositive).length,
    readyForPromotion: evaluations.filter(e => e.promotion.shouldTransition).length,
    degraded: evaluations.filter(e => e.promotion.recommendedStage === "degraded").length,
    rolledBack: evaluations.filter(e => e.promotion.recommendedStage === "rolled_back").length,
    withOutcomes: evaluations.filter(e => e.outcomes > 0).length,
  };

  return NextResponse.json({ evaluations, summary });
}
