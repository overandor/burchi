import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/registrar/suggest — recommend free services the user lacks. */
export async function GET(req: Request) {
  const { suggestServices, requireIdentity } = await import("@/lib/registrar");
  try {
    const profile = requireIdentity();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const suggestions = suggestServices(profile, limit);
    return NextResponse.json({ suggestions, count: suggestions.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.message.includes("identity") ? 400 : 500 });
  }
}
