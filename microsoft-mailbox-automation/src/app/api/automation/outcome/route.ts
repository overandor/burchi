import { NextRequest, NextResponse } from "next/server";
import { recordAutomationOutcome } from "@/lib/automation/stagnation-bridge";
import { getCandidate } from "@/lib/automation/catalog";

export const dynamic = "force-dynamic";

/**
 * POST /api/automation/outcome
 *
 * Record a measured automation outcome.
 * This is the closed loop — actual human minutes, automation minutes,
 * errors, and compliance incidents from a real invocation.
 *
 * Body:
 *   candidateId: string
 *   humanMinutes: number (review + correction + exception time)
 *   automationMinutes: number (compute time)
 *   reviewMinutes: number
 *   correctionMinutes: number
 *   exceptions: number
 *   exceptionMinutes: number
 *   outputErrors: number
 *   complianceIncidents: number
 *   correctResult: boolean
 *   notes?: string
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.candidateId) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }

    const candidate = getCandidate(body.candidateId);
    if (!candidate) {
      return NextResponse.json({ error: `Candidate ${body.candidateId} not found` }, { status: 404 });
    }

    if (typeof body.humanMinutes !== "number" || typeof body.correctResult !== "boolean") {
      return NextResponse.json({
        error: "humanMinutes (number) and correctResult (boolean) are required",
      }, { status: 400 });
    }

    const result = recordAutomationOutcome(body.candidateId, {
      humanMinutes: body.humanMinutes,
      automationMinutes: body.automationMinutes || 0,
      automationOperatingCost: body.automationOperatingCost || 0,
      reviewMinutes: body.reviewMinutes || 0,
      correctionMinutes: body.correctionMinutes || 0,
      exceptions: body.exceptions || 0,
      exceptionMinutes: body.exceptionMinutes || 0,
      outputErrors: body.outputErrors || 0,
      complianceIncidents: body.complianceIncidents || 0,
      correctResult: body.correctResult,
      notes: body.notes,
    });

    return NextResponse.json({
      outcomeId: result.outcomeId,
      netSavings: result.netSavings,
      promotion: result.promotion,
      stageChanged: result.promotion.shouldTransition,
    }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
