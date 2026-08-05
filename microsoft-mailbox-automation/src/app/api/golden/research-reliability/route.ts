import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listResearchReliability, getResearchReliabilityForEmployee, updateResearchReliability } from "@/lib/golden/ledger";

export const dynamic = "force-dynamic";

/** GET /api/golden/research-reliability?employeeId=... */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const reliability = employeeId ? (getResearchReliabilityForEmployee(employeeId) ? [getResearchReliabilityForEmployee(employeeId)!] : []) : listResearchReliability();
    return NextResponse.json({ reliability, count: reliability.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const UpdateSchema = z.object({
  employeeId: z.string().min(1),
  executionFidelity: z.number().min(0).max(1).optional(),
  evidenceQuality: z.number().min(0).max(1).optional(),
  usefulOverrides: z.number().optional(),
  experimentCompletion: z.number().min(0).max(1).optional(),
  confounderDetection: z.number().min(0).max(1).optional(),
  derivativeQuality: z.number().min(0).max(1).optional(),
  collaboration: z.number().min(0).max(1).optional(),
});

/** PATCH /api/golden/research-reliability — update reliability from observed execution. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const { employeeId, ...update } = parsed.data;
    const reliability = updateResearchReliability(employeeId, update);
    return NextResponse.json({ reliability });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
