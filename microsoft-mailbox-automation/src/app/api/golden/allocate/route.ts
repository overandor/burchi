import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { goldenEngine } from "@/lib/golden/engine";

export const dynamic = "force-dynamic";

const AllocateSchema = z.object({
  employeeId: z.string().min(1),
});

/** POST /api/golden/allocate — allocate today's hypotheses for an employee. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AllocateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    goldenEngine.initialize();
    const assignments = goldenEngine.allocateForEmployee(parsed.data.employeeId);
    return NextResponse.json({ assignments, count: assignments.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
