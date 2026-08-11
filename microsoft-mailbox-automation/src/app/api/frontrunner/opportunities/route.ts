import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  getOpportunities,
  scanOpportunities,
  getOpportunity,
} from "@/lib/frontrunner";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "list";

    if (action === "list") {
      const opportunities = getOpportunities(ctx.orgId, 20);
      return NextResponse.json({ opportunities, count: opportunities.length });
    }

    if (action === "get") {
      const id = searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const opp = getOpportunity(ctx.orgId, id);
      if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(opp);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await req.json();
    const { action } = body;

    if (action === "scan") {
      if (!Array.isArray(body.userSignals)) {
        return NextResponse.json({ error: "userSignals must be an array" }, { status: 400 });
      }
      const opportunities = await scanOpportunities(ctx.orgId, body.userSignals);
      return NextResponse.json({ opportunities, count: opportunities.length });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
