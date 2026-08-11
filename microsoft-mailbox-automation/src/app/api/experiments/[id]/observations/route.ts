import { NextRequest, NextResponse } from "next/server";
import { observeExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });
    const result = observeExperiment(decodeURIComponent(params.id), body.actor, {
      outcomeDescription: body.outcomeDescription || "",
      metrics: body.metrics,
      falsified: body.falsified,
      externalFactors: body.externalFactors,
      deviation: body.deviation,
    });
    return NextResponse.json({ result }, result.success ? { status: 200 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/observations] error:", e);
    return NextResponse.json({ error: e.message || "Failed to record observation" }, { status: 500 });
  }
}
