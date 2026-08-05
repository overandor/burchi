import { NextRequest, NextResponse } from "next/server";
import {
  getCommitmentById,
  listCommitments,
  loadMetrics,
  upsertCommitment,
  addCommitmentAuditEvent,
} from "@/lib/commitment/store";
import { executeCommitment } from "@/lib/commitment/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const executeAll = !!body.executeAll;
    const id = typeof body.id === "string" ? body.id : "";

    if (!executeAll && !id) {
      return NextResponse.json({ error: "id is required (or executeAll=true)" }, { status: 400 });
    }

    let targets = [];
    if (executeAll) {
      targets = listCommitments().filter((c) => c.status === "detected");
    } else {
      const found = getCommitmentById(id);
      if (!found) {
        return NextResponse.json({ error: `Commitment not found: ${id}` }, { status: 404 });
      }
      targets = [found];
    }

    let metrics = loadMetrics();
    const executed: any[] = [];

    for (const c of targets) {
      try {
        addCommitmentAuditEvent(c.id, "execute_requested", executeAll ? "Bulk execution requested" : "Execution requested");
      } catch (e) {
        console.error("[commitments/execute] audit error:", e);
      }

      const result = executeCommitment(c, metrics);
      metrics = result.metrics;

      const saved = upsertCommitment(result.contract);
      executed.push({
        id: saved.id,
        emailId: saved.emailId,
        status: saved.status,
        staged: result.staged,
        deliverableCount: saved.deliverables?.length ?? 0,
      });
    }

    return NextResponse.json({
      success: true,
      executedCount: executed.length,
      executed,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[commitments/execute] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
