import { NextRequest, NextResponse } from "next/server";
import { getEngineState } from "@/lib/competitive/engine";
import {
  getValidatedStrategies,
  getExperimentalStrategies,
} from "@/lib/competitive/learning";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter") || "all";

  try {
    const state = getEngineState();
    let strategies = state.strategies;

    if (filter === "validated") {
      strategies = getValidatedStrategies(state.strategies);
    } else if (filter === "experimental") {
      strategies = getExperimentalStrategies(state.strategies);
    }

    strategies = [...strategies].sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({ strategies, total: strategies.length });
  } catch (e) {
    console.error("[api/competitive/learnings] error:", e);
    return NextResponse.json(
      { error: "Failed to get learnings" },
      { status: 500 },
    );
  }
}
