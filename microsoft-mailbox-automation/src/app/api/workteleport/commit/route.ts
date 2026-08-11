import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { evaluateCommit, listCommitRecords, verifyReceipt } from "@/lib/workteleport/commit-gate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId");
    const verifyId = searchParams.get("verify");

    if (verifyId) {
      const result = verifyReceipt(ctx.orgId, verifyId);
      return NextResponse.json(result);
    }

    const records = listCommitRecords(ctx.orgId, workflowId || undefined);
    return NextResponse.json({ records, count: records.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.workflowId || !body.stepId || !body.actionType) {
      return NextResponse.json(
        { error: "workflowId, stepId, and actionType are required" },
        { status: 400 },
      );
    }

    const result = evaluateCommit({
      orgId: ctx.orgId,
      workflowId: body.workflowId,
      stepId: body.stepId,
      actionType: body.actionType,
      actionTarget: body.actionTarget || "",
      actionPayload: body.actionPayload || {},
      userRole: ctx.user.role,
      userId: ctx.user.id,
      dataClass: body.dataClass,
      evidenceEnvelopeId: body.evidenceEnvelopeId,
    });

    return NextResponse.json({ result }, { status: result.committed ? 201 : 403 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
