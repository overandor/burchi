import { NextRequest, NextResponse } from "next/server";
import { getHumanTasks, resolveHumanTask } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/tasks?status=pending — list human tasks (NEXT BEST HUMAN ACTION queue)
 * POST /api/runtime/tasks — resolve a human task (accept/complete/decline)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  const tasks = getHumanTasks(status);
  return NextResponse.json({ tasks, count: tasks.length });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, resolution, result } = body;

    if (!taskId || !resolution) {
      return NextResponse.json({ error: "taskId and resolution are required" }, { status: 400 });
    }

    if (!["accepted", "completed", "declined"].includes(resolution)) {
      return NextResponse.json({ error: "resolution must be 'accepted', 'completed', or 'declined'" }, { status: 400 });
    }

    resolveHumanTask(taskId, resolution, result);
    return NextResponse.json({ message: `Task ${resolution}`, taskId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
