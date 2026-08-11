import { NextRequest, NextResponse } from "next/server";
import { grantConsent, revokeConsent, listConsentedStreams } from "@/lib/runtime/engine";
import { DEFAULT_ORG_ID } from "@/lib/db";
import type { EventStreamType } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/consent — list consented streams
 * POST /api/runtime/consent — grant consent for a stream
 * DELETE /api/runtime/consent — revoke consent for a stream
 */
export async function GET() {
  return NextResponse.json({ streams: listConsentedStreams() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stream, grantedBy, note } = body;
    if (!stream || !grantedBy) {
      return NextResponse.json({ error: "stream and grantedBy are required" }, { status: 400 });
    }
    const consent = grantConsent(stream as EventStreamType, grantedBy, DEFAULT_ORG_ID, note || "");
    return NextResponse.json({ consent, message: `Consent granted for stream: ${stream}` });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stream = searchParams.get("stream") as EventStreamType;
    if (!stream) {
      return NextResponse.json({ error: "stream query param is required" }, { status: 400 });
    }
    revokeConsent(stream);
    return NextResponse.json({ message: `Consent revoked for stream: ${stream}` });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
