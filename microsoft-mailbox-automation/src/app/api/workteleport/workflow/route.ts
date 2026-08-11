import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  executeStep,
  advanceWorkflow,
  approveStep,
  rollbackWorkflow,
} from "@/lib/workteleport/workflow-runtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const state = searchParams.get("state") as any;

    if (id) {
      const wf = getWorkflow(ctx.orgId, id);
      if (!wf) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ workflow: wf });
    }

    const workflows = listWorkflows(ctx.orgId, ctx.user.id, state);
    return NextResponse.json({ workflows, count: workflows.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.taskIRId) {
      return NextResponse.json({ error: "taskIRId is required" }, { status: 400 });
    }

    const deadlineHours = body.deadlineHours || 24;
    const wf = createWorkflow(ctx.orgId, ctx.user.id, body.taskIRId, deadlineHours);
    return NextResponse.json({ workflow: wf }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (!body.workflowId) {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    switch (action) {
      case "execute_step":
        if (!body.stepId) {
          return NextResponse.json({ error: "stepId is required" }, { status: 400 });
        }
        const stepResult = executeStep(ctx.orgId, body.workflowId, body.stepId, body.inputs || {});
        return NextResponse.json({ result: stepResult });

      case "advance":
        const advanced = advanceWorkflow(ctx.orgId, body.workflowId);
        return NextResponse.json({ workflow: advanced });

      case "approve_step":
        if (!body.stepId) {
          return NextResponse.json({ error: "stepId is required" }, { status: 400 });
        }
        const approved = approveStep(
          ctx.orgId,
          body.workflowId,
          body.stepId,
          ctx.user.id,
          body.approved !== false,
        );
        return NextResponse.json({ workflow: approved });

      case "rollback":
        const rollback = rollbackWorkflow(ctx.orgId, body.workflowId);
        return NextResponse.json({ rollback });

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
