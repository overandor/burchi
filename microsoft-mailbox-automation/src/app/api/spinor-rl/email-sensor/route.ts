import { NextRequest, NextResponse } from "next/server";
import { extractEmailSignals } from "@/lib/spinor-rl/engine";
import { loadEmailSignals } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/email-sensor?employeeId=emp-001
 * Returns extracted email signals.
 *
 * POST /api/spinor-rl/email-sensor
 * Body: { email: EmailMessage, employeeId }
 * Extracts competitive signals from an email using LLM.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const signals = loadEmailSignals();
    const filtered = employeeId ? signals.filter((s) => s.employeeId === employeeId) : signals;
    return NextResponse.json({ signals: filtered, count: filtered.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, employeeId } = body;
    if (!email || !employeeId) {
      return NextResponse.json({ error: "email and employeeId required" }, { status: 400 });
    }
    const result = await extractEmailSignals(email, employeeId);
    return NextResponse.json({
      signal: result.signal,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
