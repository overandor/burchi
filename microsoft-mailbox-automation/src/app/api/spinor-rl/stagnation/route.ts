import { NextRequest, NextResponse } from "next/server";
import { detectStagnation } from "@/lib/spinor-rl/engine";
import { loadStagnationFlags } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/stagnation?employeeId=emp-001
 * Returns stagnation flags.
 *
 * POST /api/spinor-rl/stagnation
 * Body: { employeeId, taskDescription, repetitionCount }
 * Detects repetitive tasks and recommends transformation.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const flags = loadStagnationFlags();
    const filtered = employeeId ? flags.filter((f) => f.employeeId === employeeId) : flags;
    return NextResponse.json({ flags: filtered, count: filtered.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { employeeId, taskDescription, repetitionCount } = body;
    if (!employeeId || !taskDescription) {
      return NextResponse.json({ error: "employeeId and taskDescription required" }, { status: 400 });
    }
    const result = await detectStagnation(employeeId, taskDescription, Number(repetitionCount) || 1);
    return NextResponse.json({
      flag: result.flag,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
