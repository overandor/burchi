import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getCommitmentById,
  upsertCommitment,
  addCommitmentAuditEvent,
  updateCommitmentStatus,
  recordAcceptanceOutcome,
} from "@/lib/commitment/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OutcomeSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(6),
  accepted: z.boolean(),
  revisionRequested: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = OutcomeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, eventId, accepted, revisionRequested, notes } = parsed.data;

    const existing = getCommitmentById(id);
    if (!existing) {
      return NextResponse.json({ error: `Commitment not found: ${id}` }, { status: 404 });
    }

    const already = (existing.auditEvents || []).some(
      (e) => e.event === "outcome" && (e.detail || "").includes(`eventId=${eventId}`),
    );

    if (already) {
      return NextResponse.json({
        success: true,
        alreadyRecorded: true,
        id,
        timestamp: new Date().toISOString(),
      });
    }

    const acceptedWithoutRevision = accepted && !revisionRequested;

    recordAcceptanceOutcome({ acceptedWithoutRevision });

    const detail = [
      `eventId=${eventId}`,
      `accepted=${accepted}`,
      `revisionRequested=${revisionRequested}`,
      notes ? `notes=${notes}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    try {
      addCommitmentAuditEvent(id, "outcome", detail);
    } catch (e) {
      console.error("[commitments/outcome] audit error:", e);
    }

    // Update the contract status based on outcome feedback.
    try {
      if (accepted) {
        updateCommitmentStatus(id, "completed", "Outcome recorded: accepted");
      } else if (revisionRequested) {
        updateCommitmentStatus(id, "executing", "Outcome recorded: revision requested");
      } else {
        updateCommitmentStatus(id, "escalated", "Outcome recorded: rejected");
      }
    } catch (e) {
      console.error("[commitments/outcome] status update error:", e);
    }

    // Ensure latest contract is persisted
    const updated = getCommitmentById(id);
    if (updated) {
      upsertCommitment(updated);
    }

    return NextResponse.json({
      success: true,
      alreadyRecorded: false,
      id,
      acceptedWithoutRevision,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[commitments/outcome] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
