import { NextRequest, NextResponse } from "next/server";
import {
  parseTelemetrySheet,
  telemetryToObservationMetrics,
  telemetryToOutcomeDescription,
} from "@/lib/telemetry/sheet-parser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/telemetry/parse
 *
 * Upload an .xlsm or .xlsx file and extract telemetry data.
 *
 * Body: multipart/form-data with "file" field
 *   OR raw file body with Content-Type header
 *
 * Returns:
 *   - metrics: extracted telemetry metrics
 *   - callLog: raw call log entries if detected
 *   - sheets: all worksheets found
 *   - namedRanges: defined names in the workbook
 *   - detectionMethods: which methods produced results
 *   - observation: pre-formatted observation data ready for workflow submission
 */
export async function POST(req: NextRequest) {
  try {
    let buffer: Buffer;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file uploaded. Include a 'file' field." }, { status: 400 });
      }
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);

      // Validate file type
      const name = file.name.toLowerCase();
      if (!name.endsWith(".xlsm") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        return NextResponse.json({
          error: "File must be .xlsm, .xlsx, or .xls",
          receivedName: file.name,
          receivedType: file.type,
        }, { status: 400 });
      }
    } else {
      // Raw body
      const arrayBuffer = await req.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (buffer.length > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
    }

    // Parse the telemetry sheet
    const telemetry = await parseTelemetrySheet(buffer);

    // Convert to workflow observation format
    const observationMetrics = telemetryToObservationMetrics(telemetry);
    const outcomeDescription = telemetryToOutcomeDescription(telemetry);

    return NextResponse.json({
      success: true,
      metrics: telemetry.metrics,
      callLog: telemetry.callLog,
      callLogCount: telemetry.callLog.length,
      sheets: telemetry.sheets,
      namedRanges: telemetry.namedRanges,
      detectionMethods: telemetry.detectionMethods,
      summarySheetName: telemetry.summarySheetName,
      callLogSheetName: telemetry.callLogSheetName,
      periodStart: telemetry.periodStart,
      periodEnd: telemetry.periodEnd,
      repId: telemetry.repId,
      territory: telemetry.territory,
      // Pre-formatted for workflow submission
      observation: {
        metrics: observationMetrics,
        outcomeDescription,
      },
      // Summary for UI display
      summary: {
        totalMetrics: telemetry.metrics.length,
        totalCalls: telemetry.callLog.length,
        methodsUsed: telemetry.detectionMethods,
        hasData: telemetry.metrics.length > 0 || telemetry.callLog.length > 0,
      },
    });
  } catch (e: any) {
    console.error("[telemetry/parse] Error:", e);
    return NextResponse.json({
      error: e.message,
      hint: "Ensure the file is a valid .xlsm or .xlsx file saved after macro execution.",
    }, { status: 500 });
  }
}

/**
 * GET /api/telemetry/parse
 *
 * Returns info about the telemetry parser.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/telemetry/parse",
    accepts: [".xlsm", ".xlsx", ".xls"],
    maxSize: "50MB",
    inputMethods: [
      "multipart/form-data with 'file' field (upload from browser)",
      "raw body with Content-Type header (programmatic upload)",
      "email attachment auto-detection (via email-kernel attachment pipeline)",
    ],
    detectionMethods: [
      "named_range — macros write to named cells like 'ResponseRate'",
      "summary_sheet — a worksheet (Summary/Dashboard/KPI) holds computed totals",
      "call_log — each row is a call/visit; we aggregate from raw data",
    ],
    extractedMetrics: [
      "Response Rate", "Call Count", "Visit Count", "Meeting Count",
      "Reach Rate", "Engagement Rate", "Conversion Rate",
      "Prescription Volume", "Territory Coverage", "Follow-up Rate",
      "Avg Time Per Call", "Sample Count", "New Accounts", "Revenue", "Market Share",
    ],
    outputFormat: {
      metrics: "TelemetryMetric[] — name, value, unit, baseline, source, cellRef",
      callLog: "CallLogEntry[] — date, hcpName, outcome, duration, products",
      observation: "{ metrics: [{metric, value, unit, baseline, higherIsBetter}], outcomeDescription: string }",
    },
  });
}
