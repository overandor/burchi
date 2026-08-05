import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";
import { listDerivatives, getDerivativesForParent } from "@/lib/golden/derivatives";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/golden/derivatives?parentHypothesisId=... */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get("parentHypothesisId");
    const derivatives = parentId ? getDerivativesForParent(parentId) : listDerivatives();
    return NextResponse.json({ derivatives, count: derivatives.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const ProposeSchema = z.object({
  parentHypothesisId: z.string().min(1),
  claim: z.string().min(1),
  modifiedDimension: z.enum(["stakeholder", "timing", "channel", "content_sequence", "automation_step", "followup_interval"]),
  rationale: z.string().min(1),
  proposedByEmployeeId: z.string().optional(),
});

/** POST /api/golden/derivatives — propose a derivative (human) or generate LLM permutations.
 *  Body { action: "propose" | "llm_permutations", useLLM?: boolean, ... }
 *  When useLLM=true, uses real LLM to generate intelligent derivatives (with deterministic fallback). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.action === "llm_permutations") {
      const parsed = z.object({ hypothesisId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      if (body.useLLM) {
        const { loadHypotheses } = await import("@/lib/config");
        const { generateLlmPermutationsAsync } = await import("@/lib/golden/derivatives");
        const hypotheses = loadHypotheses();
        const parent = hypotheses.find((h: any) => h.id === parsed.data.hypothesisId);
        if (!parent) return NextResponse.json({ error: "Hypothesis not found" }, { status: 404 });
        const result = await generateLlmPermutationsAsync(parent, body.outcomeDescription, body.attributionReasoning);
        return NextResponse.json({ derivatives: result.derivatives, count: result.derivatives.length, llmUsed: result.llmUsed, llmError: result.llmError });
      }
      const derivatives = goldenEngine.generateLlmPermutations(parsed.data.hypothesisId);
      return NextResponse.json({ derivatives, count: derivatives.length });
    }
    const parsed = ProposeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const derivative = goldenEngine.proposeDerivative(
      parsed.data.parentHypothesisId,
      parsed.data.claim,
      parsed.data.modifiedDimension,
      parsed.data.rationale,
      parsed.data.proposedByEmployeeId
    );
    return NextResponse.json({ derivative });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const PromoteSchema = z.object({ derivativeId: z.string().min(1) });

/** PATCH /api/golden/derivatives — promote a derivative into a testable hypothesis. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = PromoteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const hypothesis = goldenEngine.promoteDerivative(parsed.data.derivativeId);
    if (!hypothesis) return NextResponse.json({ error: "Derivative or parent not found" }, { status: 404 });
    return NextResponse.json({ hypothesis });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
