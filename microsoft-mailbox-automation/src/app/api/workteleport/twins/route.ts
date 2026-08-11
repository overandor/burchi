import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createExperimentTwin,
  getTwin,
  listTwins,
  recordTwinResult,
  proposeTwinCandidates,
} from "@/lib/workteleport/experiment-twin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status") as any;

    if (id) {
      const twin = getTwin(ctx.orgId, id);
      if (!twin) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ twin });
    }

    const twins = listTwins(ctx.orgId, status);
    return NextResponse.json({ twins, count: twins.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (body.proposeCandidates) {
      const candidates = proposeTwinCandidates(ctx.orgId, body.workflowId, body.stepCount || 3);
      return NextResponse.json({ candidates });
    }

    if (!body.workflowId || !body.hypothesis) {
      return NextResponse.json(
        { error: "workflowId and hypothesis are required" },
        { status: 400 },
      );
    }

    const twin = createExperimentTwin({
      orgId: ctx.orgId,
      workflowId: body.workflowId,
      skillGenomeId: body.skillGenomeId,
      researchQuestion: body.researchQuestion || body.hypothesis,
      hypothesis: body.hypothesis,
      permutationType: body.permutationType || "fewer_steps",
      permutationDescription: body.permutationDescription || "",
      controlWorkflowId: body.controlWorkflowId || body.workflowId,
      successMetrics: body.successMetrics,
    });

    return NextResponse.json({ twin }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.twinId || !body.result) {
      return NextResponse.json({ error: "twinId and result are required" }, { status: 400 });
    }

    const twin = recordTwinResult(ctx.orgId, body.twinId, body.result);
    return NextResponse.json({ twin });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
