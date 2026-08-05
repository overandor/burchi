import { NextRequest, NextResponse } from "next/server";
import { runPalindromeUpdate } from "@/lib/spinor-rl/engine";
import { loadPalindromeUpdates } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/palindrome?outcomeId=...
 * Returns palindrome updates.
 *
 * POST /api/spinor-rl/palindrome
 * Body: { outcomeId }
 * Runs the palindromic learning update (forward + reverse passes).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const outcomeId = searchParams.get("outcomeId");
    const updates = loadPalindromeUpdates();
    if (outcomeId) {
      const update = updates.find((u) => u.outcomeId === outcomeId);
      return NextResponse.json({ update: update || null });
    }
    return NextResponse.json({ updates, count: updates.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { outcomeId } = body;
    if (!outcomeId) {
      return NextResponse.json({ error: "outcomeId required" }, { status: 400 });
    }
    const result = await runPalindromeUpdate(outcomeId);
    return NextResponse.json({
      update: result.update,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
