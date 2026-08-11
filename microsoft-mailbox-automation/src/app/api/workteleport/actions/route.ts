import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { recordGameAction, listGameActions, getUserRewardTotal, ACTION_REWARDS } from "@/lib/workteleport/taxonomy";
import type { GameAction } from "@/types/workteleport";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const rewardTotal = searchParams.get("rewardTotal");

    if (rewardTotal === "true") {
      const total = getUserRewardTotal(ctx.orgId, ctx.user.id);
      return NextResponse.json({ rewardTotal: total });
    }

    const actions = listGameActions(ctx.orgId, ctx.user.id);
    return NextResponse.json({ actions, count: actions.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.action || !body.targetId || !body.targetType) {
      return NextResponse.json(
        { error: "action, targetId, and targetType are required" },
        { status: 400 },
      );
    }

    const record = recordGameAction({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      action: body.action as GameAction,
      targetId: body.targetId,
      targetType: body.targetType,
      evidenceEnvelopeId: body.evidenceEnvelopeId,
      notes: body.notes,
    });

    return NextResponse.json({ action: record }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ rewards: ACTION_REWARDS });
}
