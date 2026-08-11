import { NextResponse } from "next/server";
import { getCircuitStatus } from "@/lib/llm/fallback-chain";

export const dynamic = "force-dynamic";

/**
 * GET /api/llm/fallback-status
 *
 * Returns the current status of the LLM fallback chain, including
 * circuit breaker state for each provider.
 *
 * Providers: primary → llm7 → pollinations → rule-based
 */
export async function GET() {
  const circuits = getCircuitStatus();

  return NextResponse.json({
    chain: ["primary", "llm7", "pollinations", "rule-based"],
    circuits,
    allCircuitsOpen: Object.entries(circuits)
      .filter(([k]) => k !== "rule-based")
      .every(([, v]) => v.tripped),
    timestamp: new Date().toISOString(),
  });
}
