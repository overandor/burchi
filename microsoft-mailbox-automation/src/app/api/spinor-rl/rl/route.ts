import { NextRequest, NextResponse } from "next/server";
import { buildRLAgentState, computeRLReward, selectRLAction } from "@/lib/spinor-rl/engine";
import { loadRLAgentStates, loadRLRewards, saveRLAgentStates, saveRLRewards } from "@/lib/config";
import { loadHypothesisOutcomes } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/spinor-rl/rl?employeeId=emp-001&action=state|reward|select
 * - action=state: get RL agent state
 * - action=select: get recommended RL action
 * - action=rewards: get all rewards
 *
 * POST /api/spinor-rl/rl
 * Body: { action: "compute_reward", outcomeId }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "state";
    const employeeId = searchParams.get("employeeId") || "emp-001";

    switch (action) {
      case "state": {
        const state = buildRLAgentState(employeeId);
        return NextResponse.json({ state });
      }
      case "select": {
        const result = selectRLAction(employeeId);
        return NextResponse.json(result);
      }
      case "rewards": {
        return NextResponse.json({ rewards: loadRLRewards(), count: loadRLRewards().length });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "compute_reward") {
      const outcomes = loadHypothesisOutcomes();
      const outcome = outcomes.find((o) => o.id === body.outcomeId);
      if (!outcome) return NextResponse.json({ error: "Outcome not found" }, { status: 404 });
      const reward = computeRLReward(outcome);
      const rewards = loadRLRewards();
      rewards.push(reward);
      saveRLRewards(rewards);
      return NextResponse.json({ reward });
    }
    if (body.action === "update_state") {
      const employeeId = body.employeeId || "emp-001";
      const state = buildRLAgentState(employeeId);
      const states = loadRLAgentStates();
      const idx = states.findIndex((s) => s.employeeId === employeeId);
      if (idx >= 0) states[idx] = state;
      else states.push(state);
      saveRLAgentStates(states);
      return NextResponse.json({ state });
    }
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
