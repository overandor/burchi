import { NextRequest, NextResponse } from "next/server";
import { awardDividend, listDividends } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/dividend?recipient=xxx — list dividends
 * POST /api/runtime/dividend — award dividend based on measured economic effect
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const recipient = searchParams.get("recipient") || undefined;
  return NextResponse.json({ dividends: listDividends(recipient || undefined) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { experimentId, economicEffect, verifiedByReplication, counterfactualSurvived } = body;

    if (!experimentId || economicEffect === undefined) {
      return NextResponse.json({ error: "experimentId and economicEffect are required" }, { status: 400 });
    }

    const awards = awardDividend(
      experimentId,
      Number(economicEffect),
      !!verifiedByReplication,
      !!counterfactualSurvived,
    );
    if (awards.length === 0) {
      return NextResponse.json({
        error: "No dividend awarded. Either no attribution exists, or the experiment was not verified by replication (correlation ≠ innovation safeguard).",
      }, { status: 400 });
    }

    return NextResponse.json({ awards, message: "Innovation dividend awarded" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
