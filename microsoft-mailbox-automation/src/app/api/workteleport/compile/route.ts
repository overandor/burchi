import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { compileEvidenceEnvelope, listTaskIRs, getTaskIR } from "@/lib/workteleport/compiler";
import { planCapabilities, seedDefaultCapabilities } from "@/lib/workteleport/capability-graph";
import { setPermittedTools } from "@/lib/workteleport/compiler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status") as any;

    if (id) {
      const task = getTaskIR(ctx.orgId, id);
      if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ task });
    }

    const tasks = listTaskIRs(ctx.orgId, ctx.user.id, status);
    return NextResponse.json({ tasks, count: tasks.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.evidenceEnvelopeId) {
      return NextResponse.json(
        { error: "evidenceEnvelopeId is required" },
        { status: 400 },
      );
    }

    // Ensure default capabilities exist
    seedDefaultCapabilities(ctx.orgId);

    // Determine org domain from user email
    const orgDomain = ctx.user.email.split("@")[1] || "";

    // Compile the evidence envelope through stages 1-4
    const result = compileEvidenceEnvelope(
      ctx.orgId,
      ctx.user.id,
      body.evidenceEnvelopeId,
      orgDomain,
    );

    // Stage 5: Plan capabilities for each task
    for (const task of result.tasks) {
      const capabilities = planCapabilities(
        ctx.orgId,
        task.taskType,
        ctx.user.role,
        ctx.user.id,
      );
      const toolIds = capabilities.map((c) => c.id);
      setPermittedTools(ctx.orgId, task.id, toolIds);
    }

    return NextResponse.json({
      understanding: result.understanding,
      roleContract: result.roleContract,
      tasks: result.tasks,
      taskCount: result.tasks.length,
    }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
