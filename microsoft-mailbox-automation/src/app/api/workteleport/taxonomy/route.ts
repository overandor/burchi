import { NextResponse } from "next/server";
import { getCoinedTerms, getCoinedTerm, getTermsByFamily } from "@/lib/workteleport/taxonomy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const family = searchParams.get("family");

  if (id) {
    const term = getCoinedTerm(id);
    if (!term) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ term });
  }

  if (family) {
    const terms = getTermsByFamily(family);
    return NextResponse.json({ terms, count: terms.length });
  }

  const terms = getCoinedTerms();
  return NextResponse.json({ terms, count: terms.length });
}
