import { NextRequest, NextResponse } from "next/server";
import { loadConfig, loadProcessedEmails } from "@/lib/config";
import { exportToExcel, exportToCSV } from "@/lib/sheets/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const records = loadProcessedEmails();
  const format = request.nextUrl.searchParams.get("format");

  if (format === "json") {
    return NextResponse.json({ records });
  }

  return NextResponse.json({ records });
}

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const body = await request.json().catch(() => ({}));
    const records = loadProcessedEmails();

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No processed emails to export" },
        { status: 400 }
      );
    }

    const filteredRecords = body.category
      ? records.filter((r) => r.category === body.category)
      : records;

    if (filteredRecords.length === 0) {
      return NextResponse.json(
        { error: "No records match the specified category" },
        { status: 400 }
      );
    }

    const format = body.format || config.export.format;
    const outputPath = config.export.outputPath;

    let filepath: string;
    if (format === "csv") {
      filepath = await exportToCSV(filteredRecords, outputPath);
    } else {
      filepath = await exportToExcel(filteredRecords, outputPath);
    }

    return NextResponse.json({
      success: true,
      filepath,
      recordCount: filteredRecords.length,
      format,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
