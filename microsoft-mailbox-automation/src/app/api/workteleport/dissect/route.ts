import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { processHypothesis, listDissectedHypotheses, getDissectedHypothesis } from "@/lib/workteleport/dissect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const dh = getDissectedHypothesis(ctx.orgId, id);
      if (!dh) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ hypothesis: dh });
    }

    const hypotheses = listDissectedHypotheses(ctx.orgId);
    return NextResponse.json({ hypotheses, count: hypotheses.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.claim) {
      return NextResponse.json({ error: "claim is required" }, { status: 400 });
    }

    const result = processHypothesis(ctx.orgId, body.claim);
    return NextResponse.json({ hypothesis: result }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
