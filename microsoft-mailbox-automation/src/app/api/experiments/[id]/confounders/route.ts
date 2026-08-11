import { NextRequest, NextResponse } from "next/server";
import { addConfounder, resolveConfounder } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });

    if (body.confounderId && body.state) {
      const result = resolveConfounder(
        decodeURIComponent(params.id),
        body.actor,
        body.confounderId,
        body.state,
        body.evidence || "",
      );
      return NextResponse.json({ result }, result.success ? { status: 200 } : { status: 400 });
    }

    const result = addConfounder(
      decodeURIComponent(params.id),
      body.actor,
      body.description || "",
      body.evidence || "",
    );
    return NextResponse.json({ result }, result.success ? { status: 200 } : { status: 400 });
  } catch (e: any) {
    console.error("[experiments/confounders] error:", e);
    return NextResponse.json({ error: e.message || "Failed to manage confounders" }, { status: 500 });
  }
}
