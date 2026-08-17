import { NextRequest, NextResponse } from "next/server";
import {
  matchEntities,
  saveUploadedFile,
  cleanupFile,
} from "@/lib/datapipe";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file1 = formData.get("file1") as File | null;
    const file2 = formData.get("file2") as File | null;
    if (!file1 || !file2) {
      return NextResponse.json({ error: "Two files required (file1, file2)" }, { status: 400 });
    }

    const sheet = (formData.get("sheet") as string) || undefined;
    const onTypes = (formData.get("on") as string) || undefined;
    const threshold = parseFloat((formData.get("threshold") as string) || "80");

    const path1 = await saveUploadedFile(file1, "match1");
    const path2 = await saveUploadedFile(file2, "match2");

    try {
      const matches = await matchEntities(path1, path2, { sheet, onTypes, threshold });
      return NextResponse.json({
        success: true,
        file1Name: file1.name,
        file2Name: file2.name,
        matchCount: matches.length,
        matches,
      });
    } finally {
      cleanupFile(path1);
      cleanupFile(path2);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
