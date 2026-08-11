import { NextRequest, NextResponse } from "next/server";
import {
  listExperiments,
  createExperiment,
  getExperiment,
} from "@/lib/experiment/governed-store";
import type { StructuredClaim } from "@/lib/experiment/governed-types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId") || undefined;
  const experiments = listExperiments(orgId);
  return NextResponse.json({ experiments, total: experiments.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { owner, assignedParticipant, claim, claimProse, priorArt, contributions, observationWindowDays, evidenceClass, hypothesisId, organizationId } = body;

    if (!owner || !claim) {
      return NextResponse.json({ error: "owner and claim are required" }, { status: 400 });
    }

    const exp = createExperiment({
      owner,
      assignedParticipant,
      claim: claim as StructuredClaim,
      claimProse: claimProse || "",
      priorArt,
      contributions,
      observationWindowDays,
      evidenceClass,
      hypothesisId,
      organizationId,
    });

    return NextResponse.json({ experiment: exp }, { status: 201 });
  } catch (e: any) {
    console.error("[api/experiments] POST error:", e);
    return NextResponse.json({ error: e.message || "Failed to create experiment" }, { status: 500 });
  }
}
