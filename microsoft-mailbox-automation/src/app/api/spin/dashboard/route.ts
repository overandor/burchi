import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { getDashboardStats, dbHealth } from "@/lib/spinor/spin-engine";
import { ensureFullDemoSeeded } from "@/lib/golden/demo-seed";

export async function GET() {
  try {
    ensureFullDemoSeeded();
    const stats = getDashboardStats();
    const db = dbHealth();
    return NextResponse.json({
      ...stats,
      db,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
