import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/registrar/keys/rotate
 * Body: { platformId: string }  — rotate a single platform's key.
 * Body: { all: true }           — rotate all keys that are due.
 * Body: { allDue: true }        — same as all (only due ones).
 */
export async function POST(req: Request) {
  const { rotateKey, rotateDueKeys, defaultLaunchBrowser } = await import("@/lib/registrar");
  try {
    const body = await req.json().catch(() => ({}));

    if (body.allDue || body.all) {
      const results = await rotateDueKeys(defaultLaunchBrowser);
      return NextResponse.json({ ok: true, results, count: results.length });
    }
    if (!body.platformId) {
      return NextResponse.json({ error: "platformId required (or set allDue: true)" }, { status: 400 });
    }
    const result = await rotateKey(String(body.platformId), defaultLaunchBrowser);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
