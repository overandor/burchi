import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";
import { listAssignments, getAssignmentsForEmployee, getActiveAssignmentsForEmployee } from "@/lib/golden/allocation";

export const dynamic = "force-dynamic";

/** GET /api/golden/assignments?employeeId=...&active=true
 *
 * Returns real persisted assignments. No auto-seed or auto-allocation.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const active = searchParams.get("active") === "true";

    const assignments = employeeId
      ? active
        ? getActiveAssignmentsForEmployee(employeeId)
        : getAssignmentsForEmployee(employeeId)
      : listAssignments();
    return NextResponse.json({ assignments, count: assignments.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const ActionSchema = z.object({
  action: z.enum(["accept", "reject", "modify"]),
  assignmentId: z.string().min(1),
  note: z.string().optional(),
  dimension: z.enum(["stakeholder", "timing", "channel", "content_sequence", "automation_step", "followup_interval"]).optional(),
  rationale: z.string().optional(),
});

/** PATCH /api/golden/assignments — accept, reject, or modify an assignment. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ActionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const { action, assignmentId, note, dimension, rationale } = parsed.data;
    let result;
    if (action === "accept") result = goldenEngine.accept(assignmentId);
    else if (action === "reject") result = goldenEngine.reject(assignmentId, note);
    else if (action === "modify") {
      if (!dimension || !rationale) return NextResponse.json({ error: "modify requires dimension and rationale" }, { status: 400 });
      result = goldenEngine.modify(assignmentId, dimension, rationale);
    }
    if (!result) return NextResponse.json({ error: "Assignment not found or modification not allowed" }, { status: 404 });
    return NextResponse.json({ assignment: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
