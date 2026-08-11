import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  enqueueSync,
  getSyncQueue,
  executeSync,
  processPendingSyncs,
  getAvailableCRMs,
  getCRMConfig,
  type CRMProvider,
  type SyncEntityType,
} from "@/lib/crm/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/crm
 *   ?action=status — show available CRMs and sync queue status
 *   ?action=queue  — list sync queue entries (optional filters: status, provider, entityType)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const action = request.nextUrl.searchParams.get("action") || "status";

    if (action === "status") {
      const providers = getAvailableCRMs();
      const configs = providers.map((p) => {
        const cfg = getCRMConfig(p)!;
        return { provider: p, host: cfg.host, configured: true };
      });

      const queue = getSyncQueue(ctx.orgId);
      const byStatus = {
        pending: queue.filter((e) => e.status === "pending").length,
        synced: queue.filter((e) => e.status === "synced").length,
        failed: queue.filter((e) => e.status === "failed").length,
        skipped: queue.filter((e) => e.status === "skipped").length,
      };

      return NextResponse.json({
        providers: configs,
        queue: byStatus,
        total: queue.length,
      });
    }

    if (action === "queue") {
      const status = request.nextUrl.searchParams.get("status") as any;
      const provider = request.nextUrl.searchParams.get("provider") as any;
      const entityType = request.nextUrl.searchParams.get("entityType") as any;
      const queue = getSyncQueue(ctx.orgId, {
        status: status || undefined,
        provider: provider || undefined,
        entityType: entityType || undefined,
      });
      return NextResponse.json({ queue });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/crm
 *   Enqueue a sync, execute a specific sync, or process all pending syncs.
 *
 * Body:
 *   action: "enqueue" | "execute" | "process_all"
 *   For "enqueue": provider, entityType, entityId, payload
 *   For "execute": entryId
 *   For "process_all": provider?
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));
    const action = body.action || "enqueue";

    if (action === "enqueue") {
      const provider = body.provider as CRMProvider;
      const entityType = body.entityType as SyncEntityType;
      const entityId = body.entityId as string;
      const payload = body.payload || {};

      if (!provider || !["veeva", "salesforce"].includes(provider)) {
        return NextResponse.json({ error: "provider must be 'veeva' or 'salesforce'" }, { status: 400 });
      }
      if (!entityType) {
        return NextResponse.json({ error: "entityType is required" }, { status: 400 });
      }
      if (!entityId) {
        return NextResponse.json({ error: "entityId is required" }, { status: 400 });
      }

      const entry = enqueueSync(ctx.orgId, ctx.user.id, provider, entityType, entityId, payload);
      return NextResponse.json({ entry, queued: true });
    }

    if (action === "execute") {
      if (!body.entryId) {
        return NextResponse.json({ error: "entryId is required" }, { status: 400 });
      }
      const result = await executeSync(ctx.orgId, body.entryId);
      return NextResponse.json({ result });
    }

    if (action === "process_all") {
      const provider = body.provider as CRMProvider | undefined;
      const result = await processPendingSyncs(ctx.orgId, provider);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[crm] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
