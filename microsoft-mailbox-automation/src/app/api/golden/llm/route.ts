import { NextRequest, NextResponse } from "next/server";
import { loadHypotheses } from "@/lib/config";
import { ensureGoldenSeeded } from "@/lib/golden/seed";
import { researchHypothesisWithLLM } from "@/lib/golden/prior-art";
import { generateLlmPermutationsAsync } from "@/lib/golden/derivatives";
import { attributeOutcomeWithLLM } from "@/lib/golden/outcomes";
import { llmGenerateHypothesis } from "@/lib/golden/llm-client";
import { assessGoldenNodeWithLLM } from "@/lib/golden/golden-node";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/golden/llm
 *
 * LLM-powered GOLDEN NODE operations. Every operation has a deterministic
 * fallback — the system always works; the LLM enhances it when available.
 *
 * Body:
 *   action: "research" | "derivatives" | "attribution" | "hypothesis" | "assess"
 *
 * action=research:    { claim: string }
 * action=derivatives: { hypothesisId: string, outcomeDescription?, attributionReasoning? }
 * action=attribution: { outcomeId: string }
 * action=hypothesis:  { domain: string, priorArtSummary: string, targetEngagementMode? }
 * action=assess:      { hypothesisId: string, replicationCount: number }
 */
export async function POST(request: NextRequest) {
  try {
    // Ensure seed data is loaded so loadHypotheses() finds records.
    ensureGoldenSeeded();

    const body = await request.json().catch(() => ({}));
    const action = body.action;
    if (!action) {
      return NextResponse.json({ error: "action is required (research|derivatives|attribution|hypothesis|assess)" }, { status: 400 });
    }

    switch (action) {
      case "research": {
        if (!body.claim) return NextResponse.json({ error: "claim is required" }, { status: 400 });
        const result = await researchHypothesisWithLLM(body.claim);
        return NextResponse.json({
          record: result.record,
          llmUsed: result.llmUsed,
          llmError: result.llmError,
        });
      }

      case "derivatives": {
        if (!body.hypothesisId) return NextResponse.json({ error: "hypothesisId is required" }, { status: 400 });
        const hypotheses = loadHypotheses();
        const parent = hypotheses.find((h: any) => h.id === body.hypothesisId);
        if (!parent) return NextResponse.json({ error: `Hypothesis not found: ${body.hypothesisId} (have ${hypotheses.length})` }, { status: 404 });
        const result = await generateLlmPermutationsAsync(parent, body.outcomeDescription, body.attributionReasoning);
        return NextResponse.json({
          derivatives: result.derivatives,
          count: result.derivatives.length,
          llmUsed: result.llmUsed,
          llmError: result.llmError,
        });
      }

      case "attribution": {
        if (!body.outcomeId) return NextResponse.json({ error: "outcomeId is required" }, { status: 400 });
        const result = await attributeOutcomeWithLLM(body.outcomeId);
        return NextResponse.json({
          attribution: result.attribution,
          llmUsed: result.llmUsed,
          llmError: result.llmError,
        });
      }

      case "hypothesis": {
        if (!body.domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });
        const result = await llmGenerateHypothesis(body.domain, body.priorArtSummary || "", body.targetEngagementMode);
        return NextResponse.json({
          hypothesis: result.result,
          llmUsed: result.used,
          llmError: result.error,
        });
      }

      case "assess": {
        if (!body.hypothesisId) return NextResponse.json({ error: "hypothesisId is required" }, { status: 400 });
        const result = await assessGoldenNodeWithLLM(body.hypothesisId, Number(body.replicationCount) || 0);
        return NextResponse.json({
          criteria: result.criteria,
          recommendedStage: result.recommendedStage,
          llmReasoning: result.llmReasoning,
          llmUsed: result.llmUsed,
          llmError: result.llmError,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[/api/golden/llm] error:", e);
    return NextResponse.json({ error: e.message || "LLM operation failed" }, { status: 500 });
  }
}
