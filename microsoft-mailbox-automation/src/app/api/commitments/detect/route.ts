import { NextRequest, NextResponse } from "next/server";
import { detectCommitments } from "@/lib/commitment/detector";
import { loadProcessedEmails } from "@/lib/config";
import { upsertCommitmentByEmailId, listCommitments, loadMetrics } from "@/lib/commitment/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const records = Array.isArray(body.records) ? body.records : loadProcessedEmails();

    const detected = detectCommitments(records);

    for (const c of detected) {
      try {
        upsertCommitmentByEmailId(c);
      } catch (e: any) {
        console.error("[commitments/detect] upsert error:", e);
      }
    }

    const commitments = listCommitments();
    const metrics = loadMetrics();

    return NextResponse.json({
      success: true,
      detected: detected.length,
      count: commitments.length,
      commitments,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[commitments/detect] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
