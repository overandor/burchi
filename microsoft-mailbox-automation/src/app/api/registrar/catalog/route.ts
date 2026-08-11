import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { listCatalog, listSites } = await import("@/lib/registrar");
  try {
    const sites = listCatalog();
    return NextResponse.json({ sites, count: sites.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
