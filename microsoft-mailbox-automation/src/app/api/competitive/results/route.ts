import { NextRequest, NextResponse } from "next/server";
import { getEngineState } from "@/lib/competitive/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get("employeeId");

  try {
    const state = getEngineState();
    let outcomes = state.outcomes;

    if (employeeId) {
      outcomes = outcomes.filter((o) => o.employeeId === employeeId);
    }

    outcomes = [...outcomes].sort(
      (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );

    return NextResponse.json({ outcomes, total: outcomes.length });
  } catch (e) {
    console.error("[api/competitive/results] error:", e);
    return NextResponse.json(
      { error: "Failed to get results" },
      { status: 500 },
    );
  }
}
