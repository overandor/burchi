import { NextRequest, NextResponse } from "next/server";
import { getSpinorRLState } from "@/lib/spinor-rl/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/spinor-rl/state
 * Returns the full SPINOR-RL engine state snapshot.
 */
export async function GET() {
  try {
    const state = getSpinorRLState();
    return NextResponse.json({
      ...state,
      counts: {
        missions: state.missions.length,
        physicians: state.physicians.length,
        palindromeUpdates: state.palindromeUpdates.length,
        rlAgentStates: state.rlAgentStates.length,
        rlRewards: state.rlRewards.length,
        emailSignals: state.emailSignals.length,
        stagnationFlags: state.stagnationFlags.length,
        sproutTree: state.sproutTree.length,
        diffusionStates: state.diffusionStates.length,
        antiGamingChecks: state.antiGamingChecks.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
