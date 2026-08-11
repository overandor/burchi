import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getWorkflowGenomes, getWorkflowGenome } from "@/lib/frontrunner";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "list";

    if (action === "list") {
      const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 100);
      const workflows = getWorkflowGenomes(ctx.orgId, limit);
      return NextResponse.json({ workflows, count: workflows.length });
    }

    if (action === "get") {
      const id = searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const wf = getWorkflowGenome(ctx.orgId, id);
      if (!wf) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(wf);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
