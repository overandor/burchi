import { NextRequest, NextResponse } from "next/server";
import {
  AUTOMATION_CANDIDATES,
  getCandidate,
  getCandidatesByChain,
  getPostCallPipeline,
  getUpstream,
} from "@/lib/automation/catalog";
import { calculateNetSavings, getOutcomes, evaluatePromotion, getStageHistory } from "@/lib/automation/evaluation";

export const dynamic = "force-dynamic";

/**
 * GET /api/automation/catalog
 * Query params:
 *   - chain: filter by chain (pre_call, call_to_record, learning)
 *   - id: get single candidate with outcomes and evaluation
 *   - pipeline: get post-call pipeline
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain");
  const id = searchParams.get("id");
  const pipeline = searchParams.get("pipeline");

  if (id) {
    const candidate = getCandidate(id);
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const outcomes = getOutcomes(id, 50);
    const netSavings = calculateNetSavings(id);
    const promotion = evaluatePromotion(id);
    const history = getStageHistory(id);
    const upstream = getUpstream(id);
    return NextResponse.json({
      candidate,
      outcomes: outcomes.slice(0, 10),
      outcomeCount: outcomes.length,
      netSavings,
      promotion,
      stageHistory: history,
      upstreamDependencies: upstream.map(c => ({ id: c.id, name: c.name })),
    });
  }

  if (pipeline === "post-call") {
    const candidates = getPostCallPipeline().map(c => ({
      ...c,
      netSavings: calculateNetSavings(c.id),
      outcomeCount: getOutcomes(c.id).length,
    }));
    return NextResponse.json({
      pipeline: "post-call",
      description: "Transcript → Safety → CallReport → CRM → FollowUp",
      candidates,
    });
  }

  if (chain) {
    const candidates = getCandidatesByChain(chain as any).map(c => ({
      ...c,
      netSavings: calculateNetSavings(c.id),
      outcomeCount: getOutcomes(c.id).length,
    }));
    return NextResponse.json({ chain, candidates });
  }

  const candidates = AUTOMATION_CANDIDATES.map(c => ({
    ...c,
    netSavings: calculateNetSavings(c.id),
    outcomeCount: getOutcomes(c.id).length,
  }));

  return NextResponse.json({
    candidates,
    count: candidates.length,
    chains: {
      pre_call: getCandidatesByChain("pre_call").map(c => c.id),
      call_to_record: getCandidatesByChain("call_to_record").map(c => c.id),
      learning: getCandidatesByChain("learning").map(c => c.id),
    },
    headline: "Nine highest-priority hypotheses for recovering up to several hours of rep capacity per day; actual net savings measured prospectively by SPINOR.",
  });
}
