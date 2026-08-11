import { NextRequest, NextResponse } from "next/server";
import { challengeExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const { actor, alternativeExplanations, threatsToValidity } = await req.json().catch(() => ({}));
    if (!actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });
    const result = challengeExperiment(
      decodeURIComponent(params.id),
      actor,
      alternativeExplanations || [],
      threatsToValidity || [],
    );
    return NextResponse.json({ result }, result.success ? { status: 200 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/challenge] error:", e);
    return NextResponse.json({ error: e.message || "Failed to challenge experiment" }, { status: 500 });
  }
}
