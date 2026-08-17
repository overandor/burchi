import { NextRequest, NextResponse } from "next/server";
import {
  searchEntities,
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

    const query = (formData.get("query") as string) || "";
    const sheet = (formData.get("sheet") as string) || undefined;
    const field = (formData.get("field") as string) || undefined;

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const filePath = await saveUploadedFile(file);

    try {
      const results = await searchEntities(filePath, query, { sheet, field });
      return NextResponse.json({
        success: true,
        fileName: file.name,
        query,
        resultCount: results.length,
        results,
      });
    } finally {
      cleanupFile(filePath);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
