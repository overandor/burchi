import { NextRequest, NextResponse } from "next/server";
import {
  createGauntletRun,
  stage1ClaimDissection,
  stage2PriorArtSweep,
  stage3EvidenceIntegrity,
  stage4NoveltyExtraction,
  stage5ConfounderAttack,
  stage6ExperimentalDesign,
  stage7FieldExecution,
  stage8CausalReveal,
  stage9DerivativeGeneration,
  runPreExecutionGauntlet,
  gauntletSummary,
  STAGE_ORDER,
  STAGE_LABEL,
} from "@/lib/spinor/gauntlet";

export const dynamic = "force-dynamic";

/**
 * GET /api/spinor/gauntlet?hypothesisId=HYP-1
 *   Creates a fresh gauntlet run (all stages pending).
 *
 * POST /api/spinor/gauntlet
 *   Body: { action: "run_pre_execution", hypothesisId, claim, priorArt, evidence, novelty, confounders, design }
 *   Runs stages 1-6 in sequence and returns the result.
 *
 * POST with { action: "stage", runId, stage, data }
 *   Executes a single stage on an existing run (run is reconstructed from body).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hypothesisId = searchParams.get("hypothesisId") ?? "HYP-DEMO";
    const run = createGauntletRun(hypothesisId);
    return NextResponse.json({
      run,
      stages: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABEL[s] })),
    });
  } catch (e: any) {
    console.error("[spinor/gauntlet] GET error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action ?? "run_pre_execution";

    if (action === "run_pre_execution") {
      const run = runPreExecutionGauntlet(body.hypothesisId ?? "HYP-1", {
        claim: body.claim,
        priorArt: body.priorArt,
        evidence: body.evidence,
        novelty: body.novelty,
        confounders: body.confounders ?? [],
        design: body.design,
        reviewer: body.reviewer,
      });
      return NextResponse.json({ run, summary: gauntletSummary(run) });
    }

    if (action === "stage") {
      // Reconstruct run from body and execute a single stage
      const run = body.run ?? createGauntletRun(body.hypothesisId ?? "HYP-1");
      const stage = body.stage;
      const data = body.data;
      const reviewer = body.reviewer ?? null;

      switch (stage) {
        case "claim_dissection":
          stage1ClaimDissection(run, data, reviewer);
          break;
        case "prior_art_sweep":
          stage2PriorArtSweep(run, data, reviewer);
          break;
        case "evidence_integrity":
          stage3EvidenceIntegrity(run, data, reviewer);
          break;
        case "novelty_extraction":
          stage4NoveltyExtraction(run, data, reviewer);
          break;
        case "confounder_attack":
          stage5ConfounderAttack(run, data, reviewer);
          break;
        case "experimental_design":
          stage6ExperimentalDesign(run, data, reviewer);
          break;
        case "field_execution":
          stage7FieldExecution(run, data, reviewer);
          break;
        case "causal_reveal":
          stage8CausalReveal(run, data, reviewer);
          break;
        case "derivative_generation":
          stage9DerivativeGeneration(run, data ?? [], reviewer);
          break;
        default:
          return NextResponse.json({ error: `Unknown stage: ${stage}` }, { status: 400 });
      }
      return NextResponse.json({ run, summary: gauntletSummary(run) });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[spinor/gauntlet] POST error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
