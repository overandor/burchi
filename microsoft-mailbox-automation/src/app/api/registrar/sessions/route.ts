import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/registrar/sessions — list session handoff metadata (no cookie values). */
export async function GET() {
  const { listSessions } = await import("@/lib/registrar");
  try {
    const sessions = listSessions();
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/registrar/sessions?scopeId=... — destroy sessions for a scope. */
export async function DELETE(req: Request) {
  const { destroySessions } = await import("@/lib/registrar");
  try {
    const url = new URL(req.url);
    const scopeId = url.searchParams.get("scopeId");
    if (!scopeId) return NextResponse.json({ error: "scopeId required" }, { status: 400 });
    const destroyed = destroySessions(scopeId);
    return NextResponse.json({ ok: true, destroyed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
