import { NextRequest, NextResponse } from "next/server";
import { replicateExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const { actor } = await req.json().catch(() => ({}));
    if (!actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });
    const result = replicateExperiment(decodeURIComponent(params.id), actor);
    return NextResponse.json({ result }, result.success ? { status: 201 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/replicate] error:", e);
    return NextResponse.json({ error: e.message || "Failed to replicate experiment" }, { status: 500 });
  }
}
