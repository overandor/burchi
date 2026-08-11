import { NextRequest, NextResponse } from "next/server";
import { deriveExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const { actor, changedVariable, newValue } = await req.json().catch(() => ({}));
    if (!actor || !changedVariable) return NextResponse.json({ error: "actor and changedVariable are required" }, { status: 400 });
    const result = deriveExperiment(decodeURIComponent(params.id), actor, changedVariable, newValue || "");
    return NextResponse.json({ result }, result.success ? { status: 201 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/derive] error:", e);
    return NextResponse.json({ error: e.message || "Failed to derive experiment" }, { status: 500 });
  }
}
