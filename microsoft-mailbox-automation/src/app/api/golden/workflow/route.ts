import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptAssignment,
  rejectAssignment,
  saveIntel,
  skipIntel,
  commitExecutionPlan,
  recordObservation,
  runAttribution,
  finalizeAssignment,
  getWorkflowStatus,
  getActiveWorkflow,
  getCompletedCycles,
  intelQualityScore,
} from "@/lib/golden/workflow";
import { loadHypothesisAssignments } from "@/lib/config";

export const dynamic = "force-dynamic";

// ─── GET: workflow status ───────────────────────────────────────────────

/** GET /api/golden/workflow?employeeId=...
 *
 * Returns the current workflow state for the employee's active assignment.
 * This is the spine of the /today page — it tells the UI what stage the
 * employee is in and what they can do next.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const assignmentId = searchParams.get("assignmentId");

    if (!employeeId && !assignmentId) {
      return NextResponse.json({ error: "employeeId or assignmentId required" }, { status: 400 });
    }

    let assignment;
    if (assignmentId) {
      assignment = loadHypothesisAssignments().find((a) => a.id === assignmentId);
    } else {
      assignment = getActiveWorkflow(employeeId!);
    }

    if (!assignment) {
      return NextResponse.json({
        hasActiveWorkflow: false,
        completedCycles: employeeId ? getCompletedCycles(employeeId) : 0,
        message: "No active workflow. Plant a Daily Seed to begin.",
      });
    }

    const status = getWorkflowStatus(assignment);

    return NextResponse.json({
      hasActiveWorkflow: true,
      assignment,
      status,
      completedCycles: employeeId ? getCompletedCycles(employeeId) : 0,
      intelQuality: intelQualityScore(assignment.intel),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── POST: workflow actions ─────────────────────────────────────────────

const ActionSchema = z.object({
  action: z.enum([
    "accept",
    "reject",
    "saveIntel",
    "skipIntel",
    "commitPlan",
    "observe",
    "attribute",
    "finalize",
  ]),
  assignmentId: z.string().min(1),

  // accept/reject
  note: z.string().optional(),

  // saveIntel
  intel: z.object({
    research: z.object({
      summary: z.string(),
      sourceDomains: z.array(z.string()),
      adjacentSupport: z.string(),
    }).optional(),
    confounders: z.object({
      items: z.array(z.string()),
    }).optional(),
    challenge: z.object({
      text: z.string(),
      weakestPoint: z.string(),
      falsificationCondition: z.string(),
    }).optional(),
  }).optional(),

  // commitPlan
  plan: z.object({
    accountIds: z.array(z.string()),
    modification: z.object({
      dimension: z.enum(["stakeholder", "timing", "channel", "content_sequence", "automation_step", "followup_interval"]),
      rationale: z.string(),
    }).optional(),
    prediction: z.object({
      metric: z.string(),
      expectedDirection: z.enum(["increase", "decrease", "no_change"]),
      expectedMagnitude: z.string(),
      unit: z.string(),
    }),
    falsificationCriteria: z.string(),
    evaluationDays: z.number().min(1).max(365),
  }).optional(),

  // observe
  observation: z.object({
    successKind: z.enum(["confirmed", "falsified", "inconclusive", "partial"]),
    outcomeDescription: z.string(),
    metrics: z.array(z.object({
      metric: z.string(),
      value: z.number(),
      unit: z.string(),
      baseline: z.number(),
      higherIsBetter: z.boolean(),
    })),
    falsified: z.boolean(),
    falsificationEvidence: z.string().optional(),
    externalFactors: z.array(z.string()).optional(),
  }).optional(),
});

/** POST /api/golden/workflow
 *
 * Execute a workflow action. Each action transitions the assignment
 * to the next stage in the chain.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { action, assignmentId } = parsed.data;

    switch (action) {
      case "accept": {
        const result = acceptAssignment(assignmentId);
        if (!result) return NextResponse.json({ error: "Cannot accept — assignment not found or not in 'assigned' state" }, { status: 400 });
        return NextResponse.json({ assignment: result, status: getWorkflowStatus(result) });
      }

      case "reject": {
        const result = rejectAssignment(assignmentId, parsed.data.note);
        if (!result) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
        return NextResponse.json({ assignment: result, status: getWorkflowStatus(result) });
      }

      case "saveIntel": {
        if (!parsed.data.intel) return NextResponse.json({ error: "intel required for saveIntel" }, { status: 400 });
        const result = saveIntel(assignmentId, parsed.data.intel);
        if (!result) return NextResponse.json({ error: "Cannot save intel — assignment not in 'accepted' state" }, { status: 400 });
        return NextResponse.json({
          assignment: result,
          status: getWorkflowStatus(result),
          intelQuality: intelQualityScore(result.intel),
        });
      }

      case "skipIntel": {
        const result = skipIntel(assignmentId);
        if (!result) return NextResponse.json({ error: "Cannot skip intel — assignment not in 'accepted' state" }, { status: 400 });
        return NextResponse.json({
          assignment: result,
          status: getWorkflowStatus(result),
          warning: "Intel skipped — attribution confidence will be capped at 10%",
        });
      }

      case "commitPlan": {
        if (!parsed.data.plan) return NextResponse.json({ error: "plan required for commitPlan" }, { status: 400 });
        const result = commitExecutionPlan(assignmentId, parsed.data.plan);
        if (!result) return NextResponse.json({ error: "Cannot commit plan — assignment not in 'researched' state" }, { status: 400 });
        return NextResponse.json({ assignment: result, status: getWorkflowStatus(result) });
      }

      case "observe": {
        if (!parsed.data.observation) return NextResponse.json({ error: "observation required for observe" }, { status: 400 });
        const result = recordObservation(assignmentId, parsed.data.observation);
        if (!result) return NextResponse.json({ error: "Cannot observe — assignment not in 'executing' state" }, { status: 400 });
        return NextResponse.json({
          assignment: result.assignment,
          status: getWorkflowStatus(result.assignment),
          outcomeId: result.outcomeId,
        });
      }

      case "attribute": {
        const result = runAttribution(assignmentId);
        if (!result) return NextResponse.json({ error: "Cannot attribute — assignment not in 'observed' state" }, { status: 400 });
        return NextResponse.json({
          assignment: result.assignment,
          status: getWorkflowStatus(result.assignment),
          attribution: result.attribution,
          derivatives: result.derivatives,
        });
      }

      case "finalize": {
        const result = finalizeAssignment(assignmentId);
        if (!result) return NextResponse.json({ error: "Cannot finalize — assignment not in 'attributed' state" }, { status: 400 });
        return NextResponse.json({
          assignment: result.assignment,
          status: getWorkflowStatus(result.assignment),
          unlocked: result.unlocked,
          nextMissionHint: result.nextMissionHint,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
