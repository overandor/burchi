import { NextRequest, NextResponse } from "next/server";
import { authorizeSpinorRequest, SpinorAccessError } from "@/lib/spinor/access";
import {
  assertComplianceTransition,
  calculateEffect,
  classifyEvidence,
  confounderAdjustedConfidence,
  evaluateGoldenNodeReadiness,
  evaluateMissionRepetition,
} from "@/lib/spinor/core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateRequest {
  organizationId?: string;
  effect?: Record<string, unknown>;
  attribution?: {
    baseConfidence?: number;
    executionFidelity?: number;
    confounders?: Record<string, unknown>[];
  };
  evidence?: Record<string, unknown>;
  goldenNode?: Record<string, unknown>;
  activityGenome?: {
    candidate?: Record<string, unknown>;
    recentMissions?: Record<string, unknown>[];
    options?: { similarityThreshold?: number; maximumSimilarMissions?: number };
  };
  complianceTransition?: { from?: string; to?: string };
  thresholds?: Record<string, number>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as EvaluateRequest;
    const organizationId = body.organizationId?.trim();
    if (!organizationId) throw new Error("organizationId is required.");
    authorizeSpinorRequest(request, organizationId);

    const result: Record<string, unknown> = {
      organizationId,
      evaluatedAt: new Date().toISOString(),
    };

    if (body.effect) {
      result.effect = calculateEffect(body.effect);
    }

    if (body.attribution) {
      result.attribution = confounderAdjustedConfidence({
        baseConfidence: body.attribution.baseConfidence ?? 0,
        executionFidelity: body.attribution.executionFidelity ?? 0,
        confounders: body.attribution.confounders ?? [],
      });
    }

    if (body.evidence) {
      result.evidence = classifyEvidence(body.evidence, body.thresholds);
    }

    if (body.goldenNode) {
      result.goldenNode = evaluateGoldenNodeReadiness(body.goldenNode, body.thresholds);
    }

    if (body.activityGenome?.candidate) {
      result.activityGenome = evaluateMissionRepetition(
        body.activityGenome.candidate,
        body.activityGenome.recentMissions ?? [],
        body.activityGenome.options,
      );
    }

    if (body.complianceTransition?.from || body.complianceTransition?.to) {
      const from = body.complianceTransition.from;
      const to = body.complianceTransition.to;
      if (!from || !to) throw new Error("Compliance transition requires both from and to states.");
      assertComplianceTransition(from, to);
      result.complianceTransition = { valid: true, from, to };
    }

    if (Object.keys(result).length === 2) {
      return NextResponse.json(
        { error: "Provide at least one of: effect, attribution, evidence, goldenNode, activityGenome, or complianceTransition." },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof SpinorAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SPINOR evaluation failed." },
      { status: 400 },
    );
  }
}
