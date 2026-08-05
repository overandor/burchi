import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  PhoneRecord,
  PhoneTelemetryEvent,
} from "@/types";
import {
  createPhoneRecord,
  generatePhoneSummary,
} from "@/lib/phone-telemetry";

export const dynamic = "force-dynamic";

/**
 * GET /api/phones — list all phone records with summaries
 * POST /api/phones — create a new phone record, or add an event to existing
 */
export async function GET() {
  // Records are stored client-side in localStorage; the API returns
  // a structure the client can merge. On serverless, we return empty
  // and the client populates from localStorage.
  return NextResponse.json({ records: [], source: "client" });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Action: add event to existing record
    if (body.action === "addEvent" && body.phoneId) {
      const event: PhoneTelemetryEvent = {
        id: nanoid(12),
        timestamp: new Date().toISOString(),
        type: body.type || "custom",
        direction: body.direction || "inbound",
        durationSec: body.durationSec,
        metadata: body.metadata || {},
        notes: body.notes,
      };
      return NextResponse.json({ event, ok: true });
    }

    // Action: create new phone record
    const record = createPhoneRecord(body.phoneNumber || "", body.label || "");
    return NextResponse.json({ record, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deletedId: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
