import { NextRequest, NextResponse } from "next/server";
import {
  getStats,
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
    const filePath = await saveUploadedFile(file);

    try {
      const stats = await getStats(filePath, { sheet });
      return NextResponse.json({
        success: true,
        fileName: file.name,
        stats,
      });
    } finally {
      cleanupFile(filePath);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
