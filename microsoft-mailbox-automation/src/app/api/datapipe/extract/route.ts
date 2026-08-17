import { NextRequest, NextResponse } from "next/server";
import {
  extractEntities,
  saveUploadedFile,
  cleanupFile,
} from "@/lib/datapipe";

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
    const entityType = (formData.get("type") as string) || undefined;
    const dedupe = formData.get("dedupe") !== "false";

    const filePath = await saveUploadedFile(file);

    try {
      const entities = await extractEntities(filePath, { sheet, entityType, dedupe });
      return NextResponse.json({
        success: true,
        fileName: file.name,
        entityCount: entities.length,
        entities,
      });
    } finally {
      cleanupFile(filePath);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
