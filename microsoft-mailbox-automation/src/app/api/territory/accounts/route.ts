import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  createTerritoryAccount,
  getTerritoryAccounts,
  getTerritoryAccount,
  updateTerritoryAccount,
  deleteTerritoryAccount,
} from "@/lib/phone/server-store";
import { calculatePriorityScore } from "@/lib/territory/scorer";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/territory/accounts
 *   List the current user's territory accounts.
 */
export async function GET() {
  try {
    const ctx = await getAuthContext();
    const accounts = getTerritoryAccounts(ctx.orgId, ctx.user.id);
    return NextResponse.json({ accounts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/territory/accounts
 *   Create or update a territory account.
 *
 * Body:
 *   action: "create" | "update" | "delete"
 *   For "create": accountName, hcpName?, specialty?, territory?, funnelState?, autonomyClass?, barriers?
 *   For "update": id, ...fields to update
 *   For "delete": id
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "create") {
      if (!body.accountName) {
        return NextResponse.json({ error: "accountName is required" }, { status: 400 });
      }
      const account = createTerritoryAccount(ctx.orgId, ctx.user.id, {
        accountName: body.accountName,
        hcpName: body.hcpName,
        specialty: body.specialty,
        territory: body.territory,
        funnelState: body.funnelState,
        autonomyClass: body.autonomyClass,
        barriers: body.barriers,
        metadata: body.metadata,
      });
      return NextResponse.json({ account });
    }

    if (action === "update") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const account = updateTerritoryAccount(ctx.orgId, ctx.user.id, body.id, {
        funnelState: body.funnelState,
        autonomyClass: body.autonomyClass,
        lastVisit: body.lastVisit,
        lastInteraction: body.lastInteraction,
        barriers: body.barriers,
        priorityScore: body.priorityScore,
        metadata: body.metadata,
      });
      if (!account) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      return NextResponse.json({ account });
    }

    if (action === "delete") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const ok = deleteTerritoryAccount(ctx.orgId, ctx.user.id, body.id);
      if (!ok) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      return NextResponse.json({ deleted: true });
    }

    if (action === "score") {
      // Recalculate priority scores for all accounts
      const accounts = getTerritoryAccounts(ctx.orgId, ctx.user.id);
      let updated = 0;
      for (const a of accounts) {
        const score = calculatePriorityScore(a as any);
        updateTerritoryAccount(ctx.orgId, ctx.user.id, a.id, { priorityScore: score });
        updated++;
      }
      return NextResponse.json({ updated, total: accounts.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[territory/accounts] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
