import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/registrar/keys — list stored keys (redacted) + available platforms. */
export async function GET() {
  const { listKeysRedacted, listKeyPlatforms } = await import("@/lib/registrar");
  try {
    const keys = listKeysRedacted();
    const platforms = listKeyPlatforms();
    return NextResponse.json({ keys, platforms, keyCount: keys.length, platformCount: platforms.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/registrar/keys?platformId=... — remove a stored key record. */
export async function DELETE(req: Request) {
  const { deleteKey } = await import("@/lib/registrar");
  try {
    const url = new URL(req.url);
    const platformId = url.searchParams.get("platformId");
    if (!platformId) return NextResponse.json({ error: "platformId required" }, { status: 400 });
    deleteKey(platformId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
