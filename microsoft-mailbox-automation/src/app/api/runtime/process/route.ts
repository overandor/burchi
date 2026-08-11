import { NextRequest, NextResponse } from "next/server";
import { processPendingEvents } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/runtime/process
 * Process all unprocessed events through the runtime loop.
 * This is the heartbeat — call from cron, webhook, or manual trigger.
 */
export async function POST() {
  try {
    const result = await processPendingEvents();
    return NextResponse.json({
      processed: result.processed,
      proposalsCreated: result.proposals.length,
      humanTasksCreated: result.humanTasks.length,
      safeguardViolations: result.safeguardViolations,
      proposals: result.proposals,
      humanTasks: result.humanTasks,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
