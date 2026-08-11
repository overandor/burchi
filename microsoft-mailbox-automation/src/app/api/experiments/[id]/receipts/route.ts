import { NextRequest, NextResponse } from "next/server";
import { getEvents } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Props) {
  const events = getEvents(decodeURIComponent(params.id));
  return NextResponse.json({ receipts: events, total: events.length });
}
