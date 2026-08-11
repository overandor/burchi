import { NextRequest, NextResponse } from "next/server";
import { plantExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const { actor } = await req.json().catch(() => ({}));
    if (!actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });
    const result = plantExperiment(decodeURIComponent(params.id), actor);
    return NextResponse.json({ result }, result.success ? { status: 200 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/plant] error:", e);
    return NextResponse.json({ error: e.message || "Failed to plant experiment" }, { status: 500 });
  }
}
