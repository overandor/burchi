import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

import {
  parseTelemetrySheet,
  telemetryToObservationMetrics,
  telemetryToOutcomeDescription,
  parseXlsmAsAttachment,
} from "../telemetry/sheet-parser";

// ─── Test helpers: create test Excel files ──────────────────────────────

async function createSummarySheetTestFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Summary");

  // Vertical label-value layout
  ws.getCell("A1").value = "Response Rate";
  ws.getCell("B1").value = 0.45;
  ws.getCell("A2").value = "Call Count";
  ws.getCell("B2").value = 127;
  ws.getCell("A3").value = "Territory Coverage";
  ws.getCell("B3").value = 0.78;
  ws.getCell("A4").value = "Engagement Rate";
  ws.getCell("B4").value = 0.62;

  // With baseline
  ws.getCell("A5").value = "Conversion Rate";
  ws.getCell("B5").value = 0.15;
  ws.getCell("D5").value = 0.10; // baseline

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function createCallLogTestFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Call Log");

  // Headers
  ws.getCell("A1").value = "Date";
  ws.getCell("B1").value = "HCP Name";
  ws.getCell("C1").value = "Account";
  ws.getCell("D1").value = "Outcome";
  ws.getCell("E1").value = "Duration";
  ws.getCell("F1").value = "Products";
  ws.getCell("G1").value = "Follow-up";

  // Data rows
  const rows = [
    ["2026-01-15", "Dr. Smith", "Hospital A", "Completed", 30, "Biktarvy", "Yes"],
    ["2026-01-16", "Dr. Jones", "Clinic B", "Completed", 45, "Biktarvy, Descovy", "No"],
    ["2026-01-17", "Dr. Smith", "Hospital A", "No response", 0, "", "No"],
    ["2026-01-18", "Dr. Brown", "Hospital C", "Completed", 25, "Descovy", "Yes"],
    ["2026-01-19", "Dr. Jones", "Clinic B", "Completed", 40, "Biktarvy", "Yes"],
  ];

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    row.forEach((val, j) => {
      ws.getCell(rowNum, j + 1).value = val;
    });
  });

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function createNamedRangesTestFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Data");

  // Write values that named ranges will point to
  ws.getCell("B1").value = 0.52;  // Response Rate
  ws.getCell("B2").value = 150;   // Call Count
  ws.getCell("B3").value = 0.85;  // Territory Coverage

  // Add defined names (named ranges) — ExcelJS requires sheet-qualified refs
  workbook.definedNames.add("Data!B1", "ResponseRate");
  workbook.definedNames.add("Data!B2", "CallCount");
  workbook.definedNames.add("Data!B3", "TerritoryCoverage");

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function createMixedTestFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Summary sheet
  const summary = workbook.addWorksheet("Dashboard");
  summary.getCell("A1").value = "Response Rate";
  summary.getCell("B1").value = 0.48;
  summary.getCell("A2").value = "Call Count";
  summary.getCell("B2").value = 95;

  // Call log sheet
  const callLog = workbook.addWorksheet("Activity Log");
  callLog.getCell("A1").value = "Date";
  callLog.getCell("B1").value = "HCP Name";
  callLog.getCell("C1").value = "Outcome";
  callLog.getCell("D1").value = "Duration";

  const logRows = [
    ["2026-02-01", "Dr. A", "Completed", 30],
    ["2026-02-02", "Dr. B", "No response", 0],
    ["2026-02-03", "Dr. A", "Completed", 25],
  ];
  logRows.forEach((row, i) => {
    row.forEach((val, j) => {
      callLog.getCell(i + 2, j + 1).value = val;
    });
  });

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function createEmptyTestFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1");
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Telemetry Sheet Parser", () => {

  test("Parses summary sheet with vertical label-value layout", async () => {
    const buf = await createSummarySheetTestFile();
    const result = await parseTelemetrySheet(buf);

    assert.ok(result.metrics.length > 0, "Should extract metrics from summary sheet");
    assert.ok(result.detectionMethods.includes("summary_sheet"));

    const responseRate = result.metrics.find(m => /response\s*rate/i.test(m.name));
    assert.ok(responseRate, "Should find Response Rate metric");
    assert.equal(responseRate!.value, 0.45);
    assert.equal(responseRate!.unit, "%");
    assert.equal(responseRate!.higherIsBetter, true);
    assert.equal(responseRate!.source, "summary_sheet");

    const callCount = result.metrics.find(m => /call\s*count/i.test(m.name));
    assert.ok(callCount, "Should find Call Count metric");
    assert.equal(callCount!.value, 127);
  });

  test("Parses call log and aggregates metrics", async () => {
    const buf = await createCallLogTestFile();
    const result = await parseTelemetrySheet(buf);

    assert.ok(result.callLog.length === 5, `Expected 5 call log entries, got ${result.callLog.length}`);
    assert.ok(result.detectionMethods.includes("call_log"));

    // Should aggregate Call Count
    const callCount = result.metrics.find(m => /call\s*count/i.test(m.name));
    assert.ok(callCount, "Should aggregate Call Count from call log");
    assert.equal(callCount!.value, 5);
    assert.equal(callCount!.source, "call_log_aggregate");

    // Should aggregate Response Rate (4 completed out of 5, 1 is "No response")
    const responseRate = result.metrics.find(m => /response\s*rate/i.test(m.name));
    assert.ok(responseRate, "Should aggregate Response Rate from call log");
    assert.equal(responseRate!.value, 80); // 4/5 = 80%
  });

  test("Parses named ranges", async () => {
    const buf = await createNamedRangesTestFile();
    const result = await parseTelemetrySheet(buf);

    assert.ok(result.namedRanges.length >= 3, `Expected 3 named ranges, got ${result.namedRanges.length}`);

    const responseRate = result.metrics.find(m => /response\s*rate/i.test(m.name));
    assert.ok(responseRate, "Should find Response Rate from named range");
    assert.equal(responseRate!.value, 0.52);
    assert.equal(responseRate!.source, "named_range");
  });

  test("Parses mixed file (summary + call log)", async () => {
    const buf = await createMixedTestFile();
    const result = await parseTelemetrySheet(buf);

    assert.ok(result.detectionMethods.includes("summary_sheet"));
    assert.ok(result.detectionMethods.includes("call_log"));
    assert.equal(result.summarySheetName, "Dashboard");
    assert.equal(result.callLogSheetName, "Activity Log");

    // Should have metrics from both sources
    const summaryMetrics = result.metrics.filter(m => m.source === "summary_sheet");
    const callLogMetrics = result.metrics.filter(m => m.source === "call_log_aggregate");
    assert.ok(summaryMetrics.length > 0, "Should have summary sheet metrics");
    assert.ok(callLogMetrics.length > 0, "Should have call log aggregated metrics");
  });

  test("Handles empty file gracefully", async () => {
    const buf = await createEmptyTestFile();
    const result = await parseTelemetrySheet(buf);

    assert.equal(result.metrics.length, 0);
    assert.equal(result.callLog.length, 0);
    assert.equal(result.detectionMethods.length, 0);
  });

  test("Deduplicates metrics from different sources", async () => {
    // Create a file where both summary sheet and call log produce "Call Count"
    const buf = await createMixedTestFile();
    const result = await parseTelemetrySheet(buf);

    const callCounts = result.metrics.filter(m => /call\s*count/i.test(m.name));
    // Should only have one Call Count (deduped)
    assert.equal(callCounts.length, 1, `Expected 1 Call Count after dedup, got ${callCounts.length}`);
  });

  test("Detects rep info and territory from cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Summary");
    ws.getCell("A1").value = "Rep ID: REP-001";
    ws.getCell("A2").value = "Territory: North California";
    ws.getCell("A4").value = "Response Rate";
    ws.getCell("B4").value = 0.45;

    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseTelemetrySheet(buf);

    assert.equal(result.repId, "REP-001");
    assert.equal(result.territory, "North California");
  });
});

describe("Telemetry to Workflow Conversion", () => {

  test("telemetryToObservationMetrics converts to workflow format", async () => {
    const buf = await createSummarySheetTestFile();
    const telemetry = await parseTelemetrySheet(buf);
    const metrics = telemetryToObservationMetrics(telemetry);

    assert.ok(metrics.length > 0);
    assert.ok(metrics.every(m => typeof m.metric === "string"));
    assert.ok(metrics.every(m => typeof m.value === "number"));
    assert.ok(metrics.every(m => typeof m.unit === "string"));
    assert.ok(metrics.every(m => typeof m.higherIsBetter === "boolean"));
  });

  test("telemetryToOutcomeDescription generates human-readable text", async () => {
    const buf = await createSummarySheetTestFile();
    const telemetry = await parseTelemetrySheet(buf);
    const description = telemetryToOutcomeDescription(telemetry);

    assert.ok(description.length > 0);
    assert.ok(description.includes("Response Rate") || description.includes("metrics"), "Description should mention metrics");
  });

  test("telemetryToOutcomeDescription handles empty telemetry", async () => {
    const buf = await createEmptyTestFile();
    const telemetry = await parseTelemetrySheet(buf);
    const description = telemetryToOutcomeDescription(telemetry);

    assert.ok(description.length > 0);
    assert.ok(description.includes("No telemetry"), "Should say 'No telemetry data extracted'");
  });
});

describe("Telemetry as Attachment Parser", () => {

  test("parseXlsmAsAttachment returns ParsedAttachmentData-compatible format", async () => {
    const buf = await createCallLogTestFile();
    const result = await parseXlsmAsAttachment(buf);

    assert.equal(result.type, "excel");
    assert.ok(result.rows);
    assert.ok(result.rows.length > 0);
    assert.ok(result.metadata);
  });
});
