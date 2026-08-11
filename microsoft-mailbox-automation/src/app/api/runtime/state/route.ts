import { NextRequest, NextResponse } from "next/server";
import { getRuntimeState, listConsentedStreams, listOperators, listExperiments } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/state
 * Returns the current runtime state — what the orb displays.
 */
export async function GET() {
  const state = getRuntimeState();
  const streams = listConsentedStreams();
  const operators = listOperators();
  const experiments = listExperiments();
  return NextResponse.json({
    ...state,
    consentedStreams: streams,
    operators,
    experiments,
  });
}
