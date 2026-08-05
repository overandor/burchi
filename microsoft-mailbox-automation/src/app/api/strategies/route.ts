import { NextRequest, NextResponse } from "next/server";
import { ensureStrategiesSeeded } from "@/lib/strategy/library";

export async function GET(_req: NextRequest) {
  try {
    const strategies = ensureStrategiesSeeded();
    return NextResponse.json({ strategies, count: strategies.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
