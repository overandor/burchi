import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";
import { listOutcomes, getOutcomesForEmployee, getOutcomesForAssignment } from "@/lib/golden/outcomes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/golden/outcomes?employeeId=...&assignmentId=... */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const assignmentId = searchParams.get("assignmentId");
    const outcomes = employeeId
      ? getOutcomesForEmployee(employeeId)
      : assignmentId
        ? getOutcomesForAssignment(assignmentId)
        : listOutcomes();
    return NextResponse.json({ outcomes, count: outcomes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const MetricSchema = z.object({
  metric: z.string(),
  value: z.number(),
  unit: z.string(),
  baseline: z.number(),
  higherIsBetter: z.boolean(),
});

const OutcomeSchema = z.object({
  assignmentId: z.string().min(1),
  successKind: z.enum(["performance", "efficiency", "discovery", "boundary", "system", "channel", "falsification"]),
  outcomeDescription: z.string().min(1),
  metrics: z.array(MetricSchema),
  falsified: z.boolean(),
  falsificationEvidence: z.string().optional(),
  contextAtObservation: z.object({
    externalFactors: z.array(z.string()).optional(),
    concurrentHypotheses: z.array(z.string()).optional(),
  }).optional(),
});

/** POST /api/golden/outcomes — record an outcome and run attribution + derivative generation.
 *  If useLLM=true in the body, uses LLM-enhanced attribution (with deterministic fallback). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = OutcomeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // Record the outcome first (deterministic).
    const { recordOutcome } = await import("@/lib/golden/outcomes");
    const outcome = recordOutcome(parsed.data);

    // Attribution: LLM-enhanced if requested, otherwise deterministic.
    let attribution: any = undefined;
    let llmUsed = false;
    let llmError: string | undefined;
    if (body.useLLM) {
      const { attributeOutcomeWithLLM } = await import("@/lib/golden/outcomes");
      const llmResult = await attributeOutcomeWithLLM(outcome.id);
      attribution = llmResult.attribution;
      llmUsed = llmResult.llmUsed;
      llmError = llmResult.llmError;
    } else {
      const { attributeOutcome } = await import("@/lib/golden/outcomes");
      attribution = attributeOutcome(outcome.id);
    }

    // Derivatives: LLM-enhanced if requested.
    let derivatives: any[] = [];
    if (body.useLLM && attribution) {
      const { loadHypotheses } = await import("@/lib/config");
      const { generateLlmPermutationsAsync } = await import("@/lib/golden/derivatives");
      const hypotheses = loadHypotheses();
      const parent = hypotheses.find((h: any) => h.id === outcome.hypothesisId);
      if (parent) {
        const derResult = await generateLlmPermutationsAsync(parent, outcome.outcomeDescription, attribution.reasoning);
        derivatives = derResult.derivatives;
      }
    } else {
      const { getDerivativesForParent } = await import("@/lib/golden/derivatives");
      derivatives = getDerivativesForParent(outcome.hypothesisId);
    }

    return NextResponse.json({
      outcome,
      attribution,
      derivatives,
      llmUsed,
      llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
