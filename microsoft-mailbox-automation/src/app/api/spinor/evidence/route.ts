import { NextRequest, NextResponse } from "next/server";
import { loadProcessedEmails } from "@/lib/config";
import { mailboxRecordsToEvidence } from "@/lib/spinor/mailbox-adapter";
import { createSpinorRepository } from "@/lib/spinor/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export async function GET(request: NextRequest) {
  try {
    const organizationId = required(request.nextUrl.searchParams.get("organizationId"), "organizationId");
    const provider = request.nextUrl.searchParams.get("provider")?.trim() || "mailbox-scientific-data";
    const mailbox = request.nextUrl.searchParams.get("mailbox")?.trim() || null;
    const limit = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10) || 100, 1),
      500,
    );

    const records = loadProcessedEmails().slice(0, limit);
    const evidence = mailboxRecordsToEvidence(records, {
      organizationId,
      provider,
      mailbox,
      importedFrom: request.nextUrl.origin,
    });

    return NextResponse.json({
      organizationId,
      provider,
      persisted: false,
      count: evidence.length,
      evidence,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to normalize mailbox evidence." },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      organizationId?: string;
      provider?: string;
      mailbox?: string | null;
      actorId?: string;
      recordIds?: string[];
      limit?: number;
    };

    const organizationId = required(body.organizationId, "organizationId");
    const actorId = required(body.actorId, "actorId");
    const provider = required(body.provider, "provider");
    const requestedIds = new Set(Array.isArray(body.recordIds) ? body.recordIds : []);
    const limit = Math.min(Math.max(body.limit ?? 100, 1), 500);

    const sourceRecords = loadProcessedEmails()
      .filter((record) => requestedIds.size === 0 || requestedIds.has(record.id))
      .slice(0, limit);

    if (sourceRecords.length === 0) {
      return NextResponse.json(
        { error: "No processed mailbox records matched the import request." },
        { status: 404 },
      );
    }

    const evidence = mailboxRecordsToEvidence(sourceRecords, {
      organizationId,
      provider,
      mailbox: body.mailbox ?? null,
      actorId,
      importedFrom: request.nextUrl.origin,
    });
    const repository = createSpinorRepository();
    const receipts = [];

    for (const item of evidence) {
      receipts.push(await repository.append({
        organizationId,
        type: "mailbox.evidence.imported",
        actorId,
        subjectId: String(item.id),
        occurredAt: String(item.ingestedAt),
        payload: item as Record<string, unknown>,
      }));
    }

    return NextResponse.json({
      organizationId,
      provider,
      storageProvider: repository.provider,
      imported: receipts.length,
      receipts,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Mailbox evidence import failed.";
    const missingProductionStore = message.includes("SPINOR_STORE_URL is required");
    return NextResponse.json(
      { error: message },
      { status: missingProductionStore ? 503 : 400 },
    );
  }
}
