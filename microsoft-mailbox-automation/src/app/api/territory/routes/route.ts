import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  createFieldRoute,
  getFieldRoutes,
  getFieldRoute,
  updateFieldRouteStatus,
} from "@/lib/phone/server-store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/territory/routes?date=<YYYY-MM-DD>
 *   List field routes for the current user, optionally filtered by date.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const date = request.nextUrl.searchParams.get("date") || undefined;
    const routes = getFieldRoutes(ctx.orgId, ctx.user.id, date);
    return NextResponse.json({ routes });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/territory/routes
 *   Create a new field route or update route status.
 *
 * Body:
 *   action: "create" | "update_status"
 *   For "create": date, stops?
 *   For "update_status": id, status
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "create") {
      if (!body.date) {
        return NextResponse.json({ error: "date is required" }, { status: 400 });
      }
      const route = createFieldRoute(ctx.orgId, ctx.user.id, {
        date: body.date,
        stops: body.stops,
      });
      return NextResponse.json({ route });
    }

    if (action === "update_status") {
      if (!body.id || !body.status) {
        return NextResponse.json({ error: "id and status are required" }, { status: 400 });
      }
      const route = updateFieldRouteStatus(ctx.orgId, ctx.user.id, body.id, body.status);
      if (!route) {
        return NextResponse.json({ error: "Route not found" }, { status: 404 });
      }
      return NextResponse.json({ route });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[territory/routes] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
