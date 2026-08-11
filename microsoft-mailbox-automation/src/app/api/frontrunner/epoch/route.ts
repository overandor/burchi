import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { runEpochCycle, getEpochs } from "@/lib/frontrunner";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const epochs = getEpochs(ctx.orgId, 10);
    return NextResponse.json({ epochs, count: epochs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await req.json().catch(() => ({}));
    const userSignals = Array.isArray(body.userSignals) ? body.userSignals : [];

    const result = await runEpochCycle(ctx.orgId, ctx.user.id, userSignals);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
