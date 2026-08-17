import { NextRequest, NextResponse } from "next/server";
import { runEnrichmentBatch } from "@/lib/datapipe-enrichment";
import { getPendingEnrichment, queueEnrichment, DEFAULT_ORG_ID } from "@/lib/datapipe-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    const body = await request.json().catch(() => ({}));
    const action = body.action || "run";

    if (action === "queue") {
      // Queue enrichment for a specific entity
      const { entityId, enrichmentType, requestData } = body;
      if (!entityId || !enrichmentType) {
        return NextResponse.json({ error: "entityId and enrichmentType required" }, { status: 400 });
      }
      const taskId = queueEnrichment(orgId, entityId, enrichmentType, requestData || {});
      return NextResponse.json({ success: true, taskId });
    }

    if (action === "auto_queue") {
      // Auto-queue NPI lookup for all HCPs that have an NPI
      const db = (await import("@/lib/db")).getDb();
      const entities = db
        .prepare(`
          SELECT DISTINCT e.id, v.value as npi
          FROM dp_entities e
          JOIN dp_values v ON v.entity_id = e.id
          WHERE e.org_id = ? AND e.entity_type = 'hcp' AND e.status = 'active'
            AND v.attribute_key IN ('npi', 'NPI')
            AND v.value IS NOT NULL AND length(v.value) = 10
            AND e.id NOT IN (
              SELECT entity_id FROM dp_enrichment_queue
              WHERE enrichment_type = 'npi_lookup' AND status IN ('pending', 'completed')
            )
        `)
        .all(orgId) as { id: string; npi: string }[];

      let queued = 0;
      for (const e of entities) {
        queueEnrichment(orgId, e.id, "npi_lookup", { npi: e.npi });
        queued++;
      }

      return NextResponse.json({ success: true, queued, totalEligible: entities.length });
    }

    // Default: run pending enrichment batch
    const batchSize = body.batchSize || 5;
    const result = await runEnrichmentBatch(orgId, batchSize);
    const pending = getPendingEnrichment(orgId, 100);

    return NextResponse.json({ success: true, ...result, remaining: pending.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
