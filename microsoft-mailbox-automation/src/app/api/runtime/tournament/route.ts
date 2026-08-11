import { NextRequest, NextResponse } from "next/server";
import { enterTournament, computeTournament } from "@/lib/runtime/engine";
import type { CompetitionLevel } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/tournament?level=individual — compute and return tournament standings
 * POST /api/runtime/tournament — enter an experiment into the tournament
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const level = (searchParams.get("level") || "individual") as CompetitionLevel;
  const result = computeTournament(level);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { experimentId, level, competitor } = body;

    if (!experimentId || !level || !competitor) {
      return NextResponse.json({ error: "experimentId, level, and competitor are required" }, { status: 400 });
    }

    const entry = enterTournament(experimentId, level as CompetitionLevel, competitor);
    if (!entry) {
      return NextResponse.json(
        { error: "Experiment not found, failed compliance gate, or has zero fitness" },
        { status: 400 },
      );
    }

    return NextResponse.json({ entry, message: "Entered tournament" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
