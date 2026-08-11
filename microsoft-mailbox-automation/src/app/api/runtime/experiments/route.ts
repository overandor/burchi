import { NextRequest, NextResponse } from "next/server";
import {
  createExperiment,
  listExperiments,
  recordExperimentOutcome,
  addReplication,
  getExperiment,
} from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/experiments?status=verified — list experiments
 * POST /api/runtime/experiments — create or update an experiment
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  return NextResponse.json({ experiments: listExperiments(status || undefined) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "create") {
      const { hypothesis, author, baseline, intervention, inputs, sampleTarget } = body;
      if (!hypothesis || !author || !baseline || !intervention) {
        return NextResponse.json({ error: "hypothesis, author, baseline, intervention are required" }, { status: 400 });
      }
      const exp = createExperiment(hypothesis, author, baseline, intervention, inputs || [], sampleTarget || 100);
      return NextResponse.json({ experiment: exp, message: "Experiment created" });
    }

    if (action === "outcome") {
      const {
        experimentId, outcome, compliancePassed, evidenceQuality,
        reproducibility, novelty, economicValue, risk, cost,
      } = body;
      if (!experimentId || !outcome) {
        return NextResponse.json({ error: "experimentId and outcome are required" }, { status: 400 });
      }
      const exp = recordExperimentOutcome(
        experimentId, outcome,
        compliancePassed ?? false,
        evidenceQuality ?? 50,
        reproducibility ?? 50,
        novelty ?? 50,
        economicValue ?? 50,
        risk ?? 50,
        cost ?? 50,
      );
      return NextResponse.json({ experiment: exp, message: "Outcome recorded" });
    }

    if (action === "replicate") {
      const { experimentId } = body;
      if (!experimentId) {
        return NextResponse.json({ error: "experimentId is required" }, { status: 400 });
      }
      const exp = addReplication(experimentId);
      return NextResponse.json({ experiment: exp, message: "Replication added" });
    }

    return NextResponse.json({ error: "action must be 'create', 'outcome', or 'replicate'" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
