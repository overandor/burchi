import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Registration runs can be long (Playwright + email verification polling).
export const maxDuration = 300;

/**
 * POST /api/registrar/run
 * Body: { mode: "suggested" | "all" | "site", siteId?: string, limit?: number }
 *
 * Runs the autonomous registrar. This is a long-running operation; in
 * serverless environments it may need to be invoked as a background task.
 */
export async function POST(req: Request) {
  const { registerOnSuggested, registerOnAll, registerOnSiteById } = await import("@/lib/registrar");
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "suggested";
    const limit = body.limit ? parseInt(body.limit) : undefined;

    let results;
    if (mode === "site") {
      if (!body.siteId) return NextResponse.json({ error: "siteId required for mode=site" }, { status: 400 });
      const r = await registerOnSiteById(String(body.siteId));
      results = [r];
    } else if (mode === "all") {
      results = await registerOnAll(limit);
    } else {
      results = await registerOnSuggested(limit);
    }

    return NextResponse.json({ ok: true, results, count: results.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.message.includes("identity") ? 400 : 500 });
  }
}
