import { NextResponse } from "next/server";
import { loadSyncStatus, loadProcessedEmails } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = loadSyncStatus();
  const records = loadProcessedEmails();
  return NextResponse.json({
    ...status,
    recentRecords: records.slice(0, 10),
  });
}
