import { NextRequest, NextResponse } from "next/server";
import { extractEntities, saveUploadedFile, cleanupFile } from "@/lib/datapipe";
import {
  ingestEntities,
  hashFile,
  isFileIngested,
  DEFAULT_ORG_ID,
} from "@/lib/datapipe-store";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const sheet = (formData.get("sheet") as string) || undefined;
    const period = (formData.get("period") as string) || undefined;
    const entityType = (formData.get("entityType") as string) || "hcp";
    const dedupe = formData.get("dedupe") !== "false";
    const force = formData.get("force") === "true";

    // Determine org from auth context
    let orgId = DEFAULT_ORG_ID;
    try {
      const ctx = await getAuthContext();
      if (ctx.orgId) orgId = ctx.orgId;
    } catch {}

    // Read file bytes for hashing
    const bytes = await file.arrayBuffer();
    const fileHash = hashFile(Buffer.from(bytes));

    // Check for duplicate ingestion (unless forced)
    if (!force && isFileIngested(orgId, fileHash)) {
      return NextResponse.json({
        error: "File already ingested",
        fileHash,
        message: "This file has already been processed. Use force=true to re-ingest.",
      }, { status: 409 });
    }

    // Save to temp file for the Python extractor
    const filePath = await saveUploadedFile(file);

    try {
      // Extract entities using the Python datapipe tool
      const extracted = await extractEntities(filePath, {
        sheet,
        dedupe,
      });

      // Group extracted entities by source_row into composite records.
      // The Python extractor treats each column as a separate entity (person, city, etc.),
      // but we want one HCP per row with all columns as attributes.
      // We use the original column header names (Name, City, NPI, etc.) as attribute keys,
      // not the extractor's entity_type labels.
      const META_KEYS = new Set([
        "entity_type", "value", "source_file", "source_sheet",
        "source_row", "source_page", "confidence",
        "first_name", "last_name",
      ]);
      const rowGroups = new Map<string, any>();
      for (const ext of extracted) {
        const rowKey = `${ext.source_file}:${ext.source_row}`;
        if (!rowGroups.has(rowKey)) {
          rowGroups.set(rowKey, {
            entity_type: entityType,
            value: "",
            source_sheet: ext.source_sheet,
            source_row: ext.source_row,
            confidence: ext.confidence,
            fields: {} as Record<string, any>,
          });
        }
        const group = rowGroups.get(rowKey)!;
        // Collect original column header names as attribute keys
        for (const [key, val] of Object.entries(ext)) {
          if (META_KEYS.has(key)) continue;
          if (val != null && String(val).trim() !== "") {
            group.fields[key] = val;
          }
        }
        // Use the Name column as the canonical name
        if (ext.Name && !group.value) {
          group.value = ext.Name;
        } else if (ext.entity_type === "person" && ext.value && !group.value) {
          group.value = ext.value;
        }
      }

      const grouped = Array.from(rowGroups.values());
      // Filter out empty rows
      const filtered = grouped.filter((e: any) => Object.keys(e.fields).length > 0);

      // Ingest into the living dataset
      const result = ingestEntities(
        orgId,
        file.name,
        fileHash,
        period || null,
        sheet || null,
        filtered,
      );

      return NextResponse.json({
        success: true,
        fileName: file.name,
        fileHash,
        period: period || null,
        ...result,
      });
    } finally {
      cleanupFile(filePath);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
