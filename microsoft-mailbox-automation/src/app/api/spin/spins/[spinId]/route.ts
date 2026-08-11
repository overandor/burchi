import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { loadSpin, loadClaims, getSPINWithClaims, spinSummary } from "@/lib/spinor/spin-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: { spinId: string } },
) {
  try {
    const { searchParams } = new URL(req.url);
    const withClaims = searchParams.get("claims") === "true";

    if (withClaims) {
      const result = getSPINWithClaims(params.spinId);
      if (!result) return NextResponse.json({ error: "SPIN not found" }, { status: 404 });
      return NextResponse.json(result);
    }

    const spin = loadSpin(params.spinId);
    if (!spin) return NextResponse.json({ error: "SPIN not found" }, { status: 404 });
    return NextResponse.json({ spin, summary: spinSummary(spin) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
