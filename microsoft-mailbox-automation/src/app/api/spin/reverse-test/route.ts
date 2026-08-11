import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { runReverseTest, loadSpin } from "@/lib/spinor/spin-engine";

const ReverseTestSchema = z.object({
  spinId: z.string().min(1),
  passed: z.boolean(),
  evidence: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ReverseTestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const spin = runReverseTest(parsed.data.spinId, parsed.data.passed, parsed.data.evidence);
    return NextResponse.json({ spin, reverseTest: spin.reverseTest });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spinId = searchParams.get("spinId");
    if (!spinId) return NextResponse.json({ error: "spinId required" }, { status: 400 });

    const spin = loadSpin(spinId);
    if (!spin) return NextResponse.json({ error: "SPIN not found" }, { status: 404 });

    return NextResponse.json({
      hasReverseTest: spin.reverseTest !== null,
      reverseTest: spin.reverseTest,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
