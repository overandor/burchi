import { NextRequest, NextResponse } from "next/server";
import { listCommitments, loadMetrics } from "@/lib/commitment/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const commitments = listCommitments();
    const metrics = loadMetrics();

    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(500, parseInt(limitRaw))) : 200;

    return NextResponse.json({
      success: true,
      count: commitments.length,
      commitments: commitments.slice(0, limit),
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[commitments] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
