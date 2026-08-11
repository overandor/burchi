import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  createPhoneRecord,
  getPhoneRecords,
  deletePhoneRecord,
  addPhoneEvent,
  getPhoneEvents,
  getPhoneEventSummary,
} from "@/lib/phone/server-store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/phones/records
 *   List the current user's phone records with optional event summaries.
 */
export async function GET() {
  try {
    const ctx = await getAuthContext();
    const records = getPhoneRecords(ctx.orgId, ctx.user.id);
    const withSummaries = records.map((r) => ({
      ...r,
      summary: getPhoneEventSummary(ctx.orgId, ctx.user.id, r.id),
    }));
    return NextResponse.json({ records: withSummaries });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/phones/records
 *   Create a new phone record, or add an event to an existing record.
 *
 * Body:
 *   action: "create" | "add_event" | "events"
 *   For "create": phoneNumber, label
 *   For "add_event": phoneId, type, direction, durationSec?, notes?, metadata?
 *   For "events": phoneId  (returns events for the phone)
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "create") {
      if (!body.phoneNumber) {
        return NextResponse.json({ error: "phoneNumber is required" }, { status: 400 });
      }
      const record = createPhoneRecord(ctx.orgId, ctx.user.id, body.phoneNumber, body.label || "");
      return NextResponse.json({ record });
    }

    if (action === "add_event") {
      if (!body.phoneId) {
        return NextResponse.json({ error: "phoneId is required" }, { status: 400 });
      }
      if (!body.type || !body.direction) {
        return NextResponse.json({ error: "type and direction are required" }, { status: 400 });
      }
      const event = addPhoneEvent(ctx.orgId, ctx.user.id, body.phoneId, {
        type: body.type,
        direction: body.direction,
        durationSec: body.durationSec,
        notes: body.notes,
        metadata: body.metadata,
        timestamp: body.timestamp,
      });
      return NextResponse.json({ event });
    }

    if (action === "events") {
      if (!body.phoneId) {
        return NextResponse.json({ error: "phoneId is required" }, { status: 400 });
      }
      const events = getPhoneEvents(ctx.orgId, ctx.user.id, body.phoneId);
      return NextResponse.json({ events });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[phones/records] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/phones/records?id=<recordId>
 *   Delete a phone record and all its events.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }
    const ok = deletePhoneRecord(ctx.orgId, ctx.user.id, id);
    if (!ok) {
      return NextResponse.json({ error: "Phone record not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
