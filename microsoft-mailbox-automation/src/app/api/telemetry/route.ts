import { NextRequest, NextResponse } from "next/server";
import { generateTelemetry } from "@/lib/telemetry/engine";
import { loadProcessedEmails } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/telemetry — generate telemetry report from processed email records.
 * Auto-called after sync completes, and by the dashboard/telemetry pages.
 */
export async function GET(request: NextRequest) {
  try {
    const records = loadProcessedEmails();
    const userEmail = request.nextUrl.searchParams.get("user") || "mailbox@local";
    const report = generateTelemetry(records, userEmail);
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/telemetry — generate telemetry from records provided in the body
 * (used when records are stored client-side in localStorage on serverless).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const records = body.records || loadProcessedEmails();
    const userEmail = body.user || "mailbox@local";
    const report = generateTelemetry(records, userEmail);
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
