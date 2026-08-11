import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createVentureCapsule,
  getVenture,
  listVentures,
  updateVentureStatus,
} from "@/lib/workteleport/venture-capsule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status") as any;

    if (id) {
      const venture = getVenture(ctx.orgId, id);
      if (!venture) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ venture });
    }

    const ventures = listVentures(ctx.orgId, status);
    return NextResponse.json({ ventures, count: ventures.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.name || !body.problemSolved || !body.commercializationHypothesis) {
      return NextResponse.json(
        { error: "name, problemSolved, and commercializationHypothesis are required" },
        { status: 400 },
      );
    }

    const venture = createVentureCapsule({
      orgId: ctx.orgId,
      name: body.name,
      problemSolved: body.problemSolved,
      targetUsers: body.targetUsers,
      triggeringEvidence: body.triggeringEvidence,
      requiredIntegrations: body.requiredIntegrations,
      complianceRequirements: body.complianceRequirements,
      unitEconomics: body.unitEconomics,
      commercializationHypothesis: body.commercializationHypothesis,
      goldenNodeId: body.goldenNodeId,
      skillGenomeId: body.skillGenomeId,
    });

    return NextResponse.json({ venture }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.ventureId || !body.status) {
      return NextResponse.json({ error: "ventureId and status are required" }, { status: 400 });
    }

    const venture = updateVentureStatus(ctx.orgId, body.ventureId, body.status);
    return NextResponse.json({ venture });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
