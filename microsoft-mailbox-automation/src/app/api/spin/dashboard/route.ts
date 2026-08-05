import { NextResponse } from "next/server";
import { getDashboardStats, dbHealth } from "@/lib/spinor/spin-engine";

export async function GET() {
  try {
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
