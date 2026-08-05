import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listPriorArt, researchHypothesis } from "@/lib/golden/prior-art";

export const dynamic = "force-dynamic";

/** GET /api/golden/prior-art — list prior-art research records. */
export async function GET() {
  try {
    return NextResponse.json({ priorArt: listPriorArt() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const ResearchSchema = z.object({
  hypothesisClaim: z.string().min(1),
  testedInMarket: z.boolean(),
  testedInAdjacentIndustries: z.boolean(),
  adjacentSupportSummary: z.string(),
  sourceDomains: z.array(z.string()),
  responsibleComponent: z.string().nullable(),
  requiredConditions: z.array(z.string()),
  risksAndConfounders: z.array(z.string()),
  genuinelyUnknown: z.array(z.string()),
});

/** POST /api/golden/prior-art — run the research pipeline on a new claim. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ResearchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const record = researchHypothesis(parsed.data);
    return NextResponse.json({ record });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
