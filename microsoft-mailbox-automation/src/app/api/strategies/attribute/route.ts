import { NextRequest, NextResponse } from "next/server";
import { attributeOutcome, listAttributions, getAttributionById } from "@/lib/strategy/attribution";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const outcomeEventId = searchParams.get("outcomeEventId");

    if (id) {
      const attr = getAttributionById(id);
      if (!attr) return NextResponse.json({ error: "Attribution not found" }, { status: 404 });
      return NextResponse.json(attr);
    }

    let attributions = listAttributions();
    if (outcomeEventId) {
      attributions = attributions.filter((a) => a.outcomeEventId === outcomeEventId);
    }

    return NextResponse.json({ attributions, count: attributions.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const outcomeEventId = searchParams.get("outcomeEventId");

    if (!outcomeEventId) {
      const body = await req.json();
      const id = body?.outcomeEventId;
      if (!id) {
        return NextResponse.json({ error: "outcomeEventId is required" }, { status: 400 });
      }
      const result = attributeOutcome(id);
      if (!result) {
        return NextResponse.json({ error: "Outcome event not found" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const result = attributeOutcome(outcomeEventId);
    if (!result) {
      return NextResponse.json({ error: "Outcome event not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
