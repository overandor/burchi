import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAttributions, attributeOutcome, getAttributionById } from "@/lib/golden/outcomes";

export const dynamic = "force-dynamic";

/** GET /api/golden/attributions?id=... */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const attributions = id ? (getAttributionById(id) ? [getAttributionById(id)!] : []) : listAttributions();
    return NextResponse.json({ attributions, count: attributions.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const AttributeSchema = z.object({ outcomeId: z.string().min(1) });

/** POST /api/golden/attributions — run causal attribution for an outcome. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AttributeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const attribution = attributeOutcome(parsed.data.outcomeId);
    if (!attribution) return NextResponse.json({ error: "Outcome not found" }, { status: 404 });
    return NextResponse.json({ attribution });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
