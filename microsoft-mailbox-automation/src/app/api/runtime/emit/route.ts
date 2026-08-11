import { NextRequest, NextResponse } from "next/server";
import { emitEvent, isStreamEnabled } from "@/lib/runtime/engine";
import { DEFAULT_ORG_ID } from "@/lib/db";
import type { EventStreamType } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/runtime/emit
 * Emit an event into the runtime event bus.
 *
 * Body:
 *   stream: "voice" | "email" | "crm" | "dataset" | ...
 *   payload: string (raw text or JSON)
 *   source: string (system that emitted the event)
 *   structured?: object (pre-parsed data)
 *   userId?: string
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stream, payload, source, structured, userId } = body;

    if (!stream || !payload || !source) {
      return NextResponse.json(
        { error: "stream, payload, and source are required" },
        { status: 400 },
      );
    }

    // Check consent — reject events from non-consented streams
    if (!isStreamEnabled(stream as EventStreamType)) {
      return NextResponse.json(
        { error: `Stream '${stream}' is not consented. Grant consent first via /api/runtime/consent` },
        { status: 403 },
      );
    }

    const event = emitEvent(
      stream as EventStreamType,
      String(payload),
      String(source),
      DEFAULT_ORG_ID,
      userId,
      structured,
    );

    return NextResponse.json({ event, message: "Event emitted into runtime" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
