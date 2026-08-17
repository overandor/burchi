import { NextRequest, NextResponse } from "next/server";
import {
  groupEntities,
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

    const groupBy = (formData.get("groupBy") as string) || "address";
    const sheet = (formData.get("sheet") as string) || undefined;
    const filePath = await saveUploadedFile(file);

    try {
      const groups = await groupEntities(filePath, groupBy, { sheet });
      return NextResponse.json({
        success: true,
        fileName: file.name,
        groupBy,
        groups,
      });
    } finally {
      cleanupFile(filePath);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
