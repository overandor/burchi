import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  createDiaryEntryFromTranscript,
  processDiaryEntry,
  processAllUnprocessed,
  listDiaryEntries,
  getDiaryEntry,
  getDiaryStats,
  deleteDiaryEntry,
  type DiaryEntryType,
} from "@/lib/voice/diary";
import { emitEvent, isStreamEnabled } from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/voice/diary
 *
 * Actions:
 *   create — create a diary entry from a transcript segment
 *   process — process a single entry into the pipeline (creates email signals, records outcomes, etc.)
 *   process_all — process all unprocessed entries
 *   delete — delete a diary entry by id
 *
 * GET /api/voice/diary
 *   ?action=list — list entries (optional: employeeId, date, type, unprocessedOnly)
 *   ?action=stats — diary statistics
 *   ?action=get&id=... — get a single entry
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    switch (action) {
      case "create": {
        if (!body.text || typeof body.text !== "string") {
          return NextResponse.json({ error: "text is required and must be a string" }, { status: 400 });
        }
        if (body.text.trim().length > 10000) {
          return NextResponse.json({ error: "text exceeds maximum length of 10000 characters" }, { status: 400 });
        }
        const entry = await createDiaryEntryFromTranscript({
          sessionId: body.sessionId || "manual",
          segmentId: body.segmentId || `seg_${Date.now()}`,
          text: body.text,
          employeeId: body.employeeId || ctx.user.id,
          orgId: ctx.orgId,
        });

        // ── Emit into the Ambient Delegation Runtime ──
        // Speech is an observation, not a command. The runtime decides what to do.
        if (isStreamEnabled("voice", ctx.orgId)) {
          emitEvent(
            "voice",
            body.text,
            "voice-diary",
            ctx.orgId,
            body.employeeId || ctx.user.id,
            { diaryEntryId: entry.id, type: entry.type },
          );
        }

        return NextResponse.json({ entry });
      }

      case "process": {
        if (!body.entryId || typeof body.entryId !== "string") {
          return NextResponse.json({ error: "entryId is required" }, { status: 400 });
        }
        try {
          const entry = await processDiaryEntry(body.entryId);
          return NextResponse.json({ entry, linksCreated: entry.pipelineLinks.length });
        } catch (e: any) {
          const status = e.message?.includes("not found") ? 404 : 500;
          return NextResponse.json({ error: e.message }, { status });
        }
      }

      case "process_all": {
        const result = await processAllUnprocessed(
          body.employeeId || ctx.user.id,
          ctx.orgId,
        );
        return NextResponse.json(result);
      }

      case "delete": {
        if (!body.entryId || typeof body.entryId !== "string") {
          return NextResponse.json({ error: "entryId is required" }, { status: 400 });
        }
        const deleted = deleteDiaryEntry(body.entryId);
        if (!deleted) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        return NextResponse.json({ deleted: true, entryId: body.entryId });
      }

      default:
        return NextResponse.json({ error: "Unknown action. Valid actions: create, process, process_all, delete" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[voice/diary] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "list";

    switch (action) {
      case "list": {
        const typeParam = searchParams.get("type") as DiaryEntryType | null;
        const entries = listDiaryEntries({
          orgId: ctx.orgId,
          employeeId: searchParams.get("employeeId") || ctx.user.id,
          date: searchParams.get("date") || undefined,
          type: typeParam || undefined,
          unprocessedOnly: searchParams.get("unprocessedOnly") === "true",
        });
        return NextResponse.json({ entries, count: entries.length });
      }

      case "stats": {
        const stats = getDiaryStats({
          orgId: ctx.orgId,
          employeeId: searchParams.get("employeeId") || ctx.user.id,
        });
        return NextResponse.json(stats);
      }

      case "get": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
        const entry = getDiaryEntry(id);
        if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        return NextResponse.json({ entry });
      }

      default:
        return NextResponse.json({ error: "Unknown action. Valid actions: list, stats, get" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[voice/diary GET] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
