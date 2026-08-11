import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { addClaimToSPIN, addReplicationClaim, loadClaims } from "@/lib/spinor/spin-engine";
import { nanoid } from "nanoid";

const ClaimSchema = z.object({
  spinId: z.string().min(1),
  isReplication: z.boolean().optional().default(false),
  experimentId: z.string().min(1),
  hypothesisId: z.string().min(1),
  outcomeMetric: z.string().default("response_rate"),
  outcomeValue: z.number().nullable().optional(),
  counterfactualEstimate: z.number().nullable().optional(),
  causalEffect: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
  method: z.enum(["rct", "diff_in_diff", "synthetic_control", "regression_discontinuity", "instrumental_variable", "bayesian", "expert_judgment"]),
  falsificationSurvived: z.boolean(),
  significanceLevel: z.number().default(0.05),
  segments: z.array(z.string()).default([]),
  territories: z.array(z.string()).default([]),
  testedBy: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ClaimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { spinId, isReplication, ...claimFields } = parsed.data;
    const claim = {
      claimId: `CLM-${nanoid(10).toUpperCase()}`,
      ...claimFields,
    };

    const spin = isReplication
      ? addReplicationClaim(spinId, claim as any)
      : addClaimToSPIN(spinId, claim as any);

    return NextResponse.json({ spin, claim }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spinId = searchParams.get("spinId");
    if (!spinId) return NextResponse.json({ error: "spinId required" }, { status: 400 });
    const claims = loadClaims(spinId);
    return NextResponse.json({ claims, count: claims.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
