import { NextRequest, NextResponse } from "next/server";
import {
  generateCompetitivePlan,
  getEmployee,
  updateActionStatus,
  recordActionOutcome,
} from "@/lib/competitive/engine";
import { ActionStatus, ActionOutcome } from "@/types";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  const requestedId = req.nextUrl.searchParams.get("employeeId") || ctx.user.id;
  const employeeId = getEmployee(requestedId) ? requestedId : "emp-001";

  try {
    const plan = generateCompetitivePlan(employeeId);
    if (!plan) {
      return NextResponse.json(
        { error: `Employee not found: ${employeeId}` },
        { status: 404 },
      );
    }
    return NextResponse.json(plan.portfolio);
  } catch (e) {
    console.error("[api/competitive/actions] GET error:", e);
    return NextResponse.json(
      { error: "Failed to get actions" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await req.json();
    const { actionId, operation, feedback, outcome, context } = body;

    if (!actionId || !operation) {
      return NextResponse.json(
        { error: "actionId and operation are required" },
        { status: 400 },
      );
    }

    const validOperations = ["accept", "modify", "replace", "decline", "complete", "explain"];
    if (!validOperations.includes(operation)) {
      return NextResponse.json(
        { error: `Invalid operation: ${operation}. Must be one of: ${validOperations.join(", ")}` },
        { status: 400 },
      );
    }

    const statusMap: Record<string, ActionStatus> = {
      accept: "accepted",
      modify: "modified",
      replace: "replaced",
      decline: "declined",
      complete: "completed",
      explain: "accepted",
    };

    const updated = updateActionStatus(actionId, statusMap[operation], feedback);

    if (operation === "complete" && outcome) {
      const outcomeRecord = recordActionOutcome({
        actionId,
        employeeId: body.employeeId || ctx.user.id,
        experimentId: body.experimentId,
        variant: body.variant,
        actionTaken: body.actionTaken || updated?.title || "Action completed",
        outcome: outcome as ActionOutcome["outcome"],
        timeToOutcomeHours: body.timeToOutcomeHours || 0,
        context: context || {},
      });
      return NextResponse.json({ action: updated, outcome: outcomeRecord });
    }

    return NextResponse.json({ action: updated });
  } catch (e) {
    console.error("[api/competitive/actions] POST error:", e);
    return NextResponse.json(
      { error: "Failed to update action" },
      { status: 500 },
    );
  }
}
