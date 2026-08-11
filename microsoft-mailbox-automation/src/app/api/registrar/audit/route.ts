import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/registrar/audit — returns the audit log (JSON and plain text). */
export async function GET(req: Request) {
  const { loadAudit, renderAuditText } = await import("@/lib/registrar");
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "json";
    const entries = loadAudit();
    if (format === "text") {
      return new NextResponse(renderAuditText(entries), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.json({ entries, count: entries.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
