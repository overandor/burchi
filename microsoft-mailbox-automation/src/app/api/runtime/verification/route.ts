import { NextRequest, NextResponse } from "next/server";
import {
  submitForVerification,
  recordVerificationReplication,
  listVerificationEntries,
} from "@/lib/runtime/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime/verification?status=pending_verification — list verification entries
 * POST /api/runtime/verification — submit or replicate
 *   action: "submit" | "replicate"
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const entries = listVerificationEntries(status || undefined);
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "submit") {
      const { experimentId, submittedBy } = body;
      if (!experimentId || !submittedBy) {
        return NextResponse.json({ error: "experimentId and submittedBy are required" }, { status: 400 });
      }
      const entry = submitForVerification(experimentId, submittedBy);
      return NextResponse.json(entry);
    } else if (action === "replicate") {
      const { entryId, success, counterfactualChecked } = body;
      if (!entryId) {
        return NextResponse.json({ error: "entryId is required" }, { status: 400 });
      }
      const entry = recordVerificationReplication(entryId, !!success, !!counterfactualChecked);
      if (!entry) {
        return NextResponse.json({ error: "Verification entry not found" }, { status: 404 });
      }
      return NextResponse.json(entry);
    } else {
      return NextResponse.json({ error: "action must be 'submit' or 'replicate'" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
