import { NextRequest, NextResponse } from "next/server";
import { updatePhysicianModel } from "@/lib/spinor-rl/engine";
import { loadPhysicians } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spinor-rl/physician?physicianId=...
 * Returns physician model.
 *
 * POST /api/spinor-rl/physician
 * Body: { physicianId, name, emails: EmailMessage[] }
 * Updates physician model from observed email behavior.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const physicianId = searchParams.get("physicianId");
    const physicians = loadPhysicians();
    if (physicianId) {
      const p = physicians.find((p) => p.physicianId === physicianId);
      return NextResponse.json({ physician: p || null });
    }
    return NextResponse.json({ physicians, count: physicians.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { physicianId, name, emails } = body;
    if (!physicianId || !emails) {
      return NextResponse.json({ error: "physicianId and emails required" }, { status: 400 });
    }
    const result = await updatePhysicianModel(physicianId, name || physicianId, emails);
    return NextResponse.json({
      physician: result.physician,
      llmUsed: result.llmUsed,
      llmError: result.llmError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
