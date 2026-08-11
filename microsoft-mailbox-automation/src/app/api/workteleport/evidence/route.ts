import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createEvidenceEnvelope,
  getEvidenceEnvelope,
  listEvidenceEnvelopes,
  verifyIntegrity,
} from "@/lib/workteleport/evidence";
import type { EvidenceSource, ConfidentialityClass } from "@/types/workteleport";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (id) {
      const envelope = getEvidenceEnvelope(ctx.orgId, id);
      if (!envelope) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ envelope });
    }

    const envelopes = listEvidenceEnvelopes(ctx.orgId, ctx.user.id, limit);
    return NextResponse.json({ envelopes, count: envelopes.length });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const body = await req.json();

    if (!body.source || !body.originalContent) {
      return NextResponse.json(
        { error: "source and originalContent are required" },
        { status: 400 },
      );
    }

    const envelope = createEvidenceEnvelope({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      source: body.source as EvidenceSource,
      sourceIdentifier: body.sourceIdentifier || `manual_${Date.now()}`,
      sender: body.sender || "user",
      recipient: body.recipient || ctx.user.email,
      originalContent: body.originalContent,
      attachments: body.attachments,
      extractedEntities: body.extractedEntities,
      factualClaims: body.factualClaims,
      requestedWork: body.requestedWork,
      deadlines: body.deadlines,
      confidentialityClass: body.confidentialityClass as ConfidentialityClass,
      permittedUses: body.permittedUses,
      retentionRule: body.retentionRule,
    });

    return NextResponse.json({ envelope }, { status: 201 });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const integrity = verifyIntegrity(ctx.orgId, id);
    return NextResponse.json({ integrity });
  } catch (e: any) {
    const status = e.message === "Authentication required" ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
