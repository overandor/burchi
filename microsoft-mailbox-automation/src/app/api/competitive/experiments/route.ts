import { NextRequest, NextResponse } from "next/server";
import { getEngineState } from "@/lib/competitive/engine";
import { getActiveExperiments, getCompletedExperiments } from "@/lib/competitive/experiment";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  const status = req.nextUrl.searchParams.get("status") || "all";

  try {
    const state = getEngineState();
    let experiments = state.experiments;

    if (status === "active") {
      experiments = getActiveExperiments(state.experiments);
    } else if (status === "completed") {
      experiments = getCompletedExperiments(state.experiments);
    }

    if (employeeId) {
      const empOutcomes = state.outcomes.filter((o) => o.employeeId === employeeId);
      const empExperimentIds = new Set(empOutcomes.map((o) => o.experimentId).filter(Boolean));
      experiments = experiments.filter(
        (e) => empExperimentIds.has(e.id) || e.status === "running",
      );
    }

    return NextResponse.json({ experiments, total: experiments.length });
  } catch (e) {
    console.error("[api/competitive/experiments] error:", e);
    return NextResponse.json(
      { error: "Failed to get experiments" },
      { status: 500 },
    );
  }
}
