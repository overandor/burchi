import { NextResponse } from "next/server";
import { loadSyncStatus, loadProcessedEmails } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = loadSyncStatus();
    const records = loadProcessedEmails();
    return NextResponse.json({
      ...status,
      recentRecords: records.slice(0, 10),
    });
  } catch (e: any) {
    console.error("[mailbox/status] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
