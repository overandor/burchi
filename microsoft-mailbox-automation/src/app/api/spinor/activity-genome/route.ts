import { NextRequest, NextResponse } from "next/server";
import {
  evaluateFatigue,
  detectMastery,
  genomeSimilarity,
  deriveMode,
} from "@/lib/spinor/activity-genome";
import { ActivityGenome } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/spinor/activity-genome
 *   Body: { candidate: ActivityGenome, recent: ActivityGenome[] }
 *   Returns fatigue evaluation + recommended mode.
 *
 * POST with { action: "mastery", ...masteryInput }
 *   Returns mastery detection result.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === "mastery") {
      const result = detectMastery({
        missionId: body.missionId ?? "M-1",
        successCount: Number(body.successCount ?? 0),
        failureCount: Number(body.failureCount ?? 0),
        qualityVariance: Number(body.qualityVariance ?? 1),
        deviationRate: Number(body.deviationRate ?? 1),
        judgmentRequired: !!body.judgmentRequired,
        inputPredictability: Number(body.inputPredictability ?? 0),
        riskLevel: body.riskLevel ?? "high",
        complianceSensitive: !!body.complianceSensitive,
        exceptionRate: Number(body.exceptionRate ?? 1),
      });
      return NextResponse.json({ mastery: result });
    }

    if (body.action === "similarity") {
      const a = body.a as ActivityGenome;
      const b = body.b as ActivityGenome;
      if (!a || !b) {
        return NextResponse.json({ error: "Both a and b genomes required" }, { status: 400 });
      }
      const sim = genomeSimilarity(a, b);
      return NextResponse.json({ similarity: sim });
    }

    const candidate = body.candidate as ActivityGenome;
    const recent = (body.recent ?? []) as ActivityGenome[];
    if (!candidate) {
      return NextResponse.json({ error: "candidate genome required" }, { status: 400 });
    }
    const result = evaluateFatigue(candidate, recent);
    return NextResponse.json({ evaluation: result, candidateMode: deriveMode(candidate) });
  } catch (e: any) {
    console.error("[spinor/activity-genome] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
