import { NextRequest, NextResponse } from "next/server";
import type { TerritoryAccount } from "@/types";
import { recommendContent } from "@/lib/content/recommender";
import { runSpinoredAnalysis } from "@/lib/spinored/analysis";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const account: TerritoryAccount = body.account;

    if (!account || !account.id) {
      return NextResponse.json({ error: "Missing or invalid account" }, { status: 400 });
    }

    const spinored = runSpinoredAnalysis(account);
    const recommendations = recommendContent(account);

    return NextResponse.json({ spinored, recommendations });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Analysis failed" }, { status: 500 });
  }
}
