/**
 * Rep Telemetry Parser
 *
 * Parses .xlsm (macro-enabled Excel) and .xlsx files to extract
 * field rep telemetry data. Handles three sheet structures:
 *
 *   1. Named ranges — macros write to named cells like "ResponseRate",
 *      "CallCount", "TerritoryCoverage". We read the cached values.
 *   2. Summary sheet — a worksheet (e.g. "Summary", "Dashboard") holds
 *      computed totals in a known layout.
 *   3. Raw call log — each row is a call/visit with date, HCP, outcome.
 *      We aggregate from the raw data.
 *
 * Auto-detection: we try all three methods and merge results. The parser
 * returns whatever it finds, tagged by source, so the caller can see
 * which method produced which metric.
 *
 * Key insight: Excel stores macro-computed values as cached cell values
 * when the file is saved. We can't run VBA server-side, but we CAN read
 * the results the macros already computed. If the rep saved the file
 * after the macros ran, the cached values are there.
 */

import type { ParsedAttachmentData } from "@/types";

// ─── Types ──────────────────────────────────────────────────────────────

export interface TelemetryMetric {
  /** Metric name as found in the sheet (e.g. "Response Rate", "Call Count") */
  name: string;
  /** Numeric value */
  value: number;
  /** Unit if detectable (e.g. "%", "count", "hours") */
  unit: string;
  /** Baseline/comparison value if present in the sheet */
  baseline?: number;
  /** Whether higher is better (inferred from metric name) */
  higherIsBetter: boolean;
  /** Where this metric was found */
  source: "named_range" | "summary_sheet" | "call_log_aggregate" | "cell_label";
  /** Cell reference (e.g. "Summary!B4" or "ResponseRate") */
  cellRef: string;
  /** The worksheet name where this was found */
  sheetName: string;
}

export interface CallLogEntry {
  date?: string;
  hcpName?: string;
  hcpId?: string;
  account?: string;
  outcome?: string;
  durationMinutes?: number;
  productsDiscussed?: string[];
  followUpRequired?: boolean;
  rawRow: Record<string, unknown>;
}

export interface TelemetrySheet {
  /** All metrics extracted from the sheet */
  metrics: TelemetryMetric[];
  /** Raw call log entries if a call log was detected */
  callLog: CallLogEntry[];
  /** All worksheets found, with their names and dimensions */
  sheets: { name: string; rowCount: number; colCount: number }[];
  /** Named ranges found in the workbook */
  namedRanges: { name: string; value: unknown; cellRef: string }[];
  /** Which detection methods produced results */
  detectionMethods: ("named_range" | "summary_sheet" | "call_log")[];
  /** The summary sheet name if one was detected */
  summarySheetName?: string;
  /** The call log sheet name if one was detected */
  callLogSheetName?: string;
  /** Period covered by the data (if detectable) */
  periodStart?: string;
  periodEnd?: string;
  /** Rep identifier if found in the sheet */
  repId?: string;
  /** Territory identifier if found */
  territory?: string;
  /** Raw parsed data for debugging */
  raw: {
    allCells: Record<string, { sheet: string; cell: string; value: unknown }>[];
  };
}

// ─── Metric name patterns ───────────────────────────────────────────────

/** Patterns that identify metric names in cell labels, named ranges, or headers */
const METRIC_PATTERNS: { pattern: RegExp; unit: string; higherIsBetter: boolean; aliases: string[] }[] = [
  { pattern: /response\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["response_rate", "responseRate", "response rate"] },
  { pattern: /call\s*count/i, unit: "count", higherIsBetter: true, aliases: ["call_count", "callCount", "calls"] },
  { pattern: /visit\s*count/i, unit: "count", higherIsBetter: true, aliases: ["visit_count", "visitCount", "visits"] },
  { pattern: /meeting\s*count/i, unit: "count", higherIsBetter: true, aliases: ["meeting_count", "meetingCount", "meetings"] },
  { pattern: /reach\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["reach_rate", "reachRate"] },
  { pattern: /engagement\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["engagement_rate", "engagementRate"] },
  { pattern: /conversion\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["conversion_rate", "conversionRate"] },
  { pattern: /prescription\s*(volume|count)/i, unit: "count", higherIsBetter: true, aliases: ["rx_volume", "rx_count", "prescriptions"] },
  { pattern: /territory\s*coverage/i, unit: "%", higherIsBetter: true, aliases: ["territory_coverage", "territoryCoverage"] },
  { pattern: /target\s*met/i, unit: "boolean", higherIsBetter: true, aliases: ["target_met", "targetMet"] },
  { pattern: /time\s*per\s*call/i, unit: "minutes", higherIsBetter: false, aliases: ["time_per_call", "avg_call_time"] },
  { pattern: /follow.?up\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["follow_up_rate", "followup_rate"] },
  { pattern: /sample\s*count/i, unit: "count", higherIsBetter: true, aliases: ["sample_count", "samples"] },
  { pattern: /new\s*(accounts|hcp)/i, unit: "count", higherIsBetter: true, aliases: ["new_accounts", "new_hcps"] },
  { pattern: /retention\s*rate/i, unit: "%", higherIsBetter: true, aliases: ["retention_rate", "retentionRate"] },
  { pattern: /revenue/i, unit: "$", higherIsBetter: true, aliases: ["revenue", "sales"] },
  { pattern: /market\s*share/i, unit: "%", higherIsBetter: true, aliases: ["market_share", "marketShare"] },
];

/** Patterns that identify a summary/dashboard worksheet */
const SUMMARY_SHEET_PATTERNS = [
  /summary/i,
  /dashboard/i,
  /telemetry/i,
  /metrics/i,
  /overview/i,
  /kpi/i,
  /report/i,
  /totals/i,
];

/** Patterns that identify a call log worksheet */
const CALL_LOG_SHEET_PATTERNS = [
  /call\s*log/i,
  /visit\s*log/i,
  /activity/i,
  /interactions/i,
  /field\s*activity/i,
  /daily\s*log/i,
  /call\s*report/i,
];

/** Headers that indicate a call log row structure */
const CALL_LOG_HEADER_PATTERNS = {
  date: [/^date$/i, /^call\s*date$/i, /^visit\s*date$/i, /^interaction\s*date$/i, /^day$/i],
  hcpName: [/^hcp/i, /^physician/i, /^doctor/i, /^provider\s*name$/i, /^contact\s*name$/i, /^name$/i],
  hcpId: [/^hcp\s*id$/i, /^provider\s*id$/i, /^npi$/i, /^account\s*id$/i],
  account: [/^account/i, /^territory/i, /^facility/i, /^hospital/i, /^clinic/i],
  outcome: [/^outcome/i, /^result/i, /^disposition/i, /^status/i, /^call\s*result$/i],
  duration: [/^duration/i, /^time\s*spent/i, /^minutes/i, /^length/i],
  products: [/^product/i, /^products/i, /^discussed/i, /^topics/i],
  followUp: [/^follow.?up/i, /^next\s*step/i, /^action\s*required/i, /^callback/i],
};

// ─── Main parser ────────────────────────────────────────────────────────

/**
 * Parse an .xlsm or .xlsx file and extract telemetry data.
 *
 * This is the main entry point. It:
 *   1. Loads the workbook with exceljs
 *   2. Reads all worksheets
 *   3. Reads named ranges (defined names)
 *   4. Detects summary sheets and call log sheets
 *   5. Extracts metrics from all three sources
 *   6. Merges and returns
 */
export async function parseTelemetrySheet(buffer: Buffer): Promise<TelemetrySheet> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (e: any) {
    throw new Error(`Failed to load Excel file: ${e.message}`);
  }

  const sheets: { name: string; rowCount: number; colCount: number }[] = [];
  const namedRanges: { name: string; value: unknown; cellRef: string }[] = [];
  const metrics: TelemetryMetric[] = [];
  const callLog: CallLogEntry[] = [];
  const detectionMethods: ("named_range" | "summary_sheet" | "call_log")[] = [];
  const allCells: Record<string, { sheet: string; cell: string; value: unknown }>[] = [];

  let summarySheetName: string | undefined;
  let callLogSheetName: string | undefined;

  // ─── 1. Read all worksheets ─────────────────────────────────────
  for (const worksheet of workbook.worksheets) {
    const name = worksheet.name;
    const rowCount = worksheet.rowCount;
    const colCount = worksheet.columnCount;
    sheets.push({ name, rowCount, colCount });

    // Detect summary sheet
    if (!summarySheetName && SUMMARY_SHEET_PATTERNS.some(p => p.test(name))) {
      summarySheetName = name;
    }

    // Detect call log sheet
    if (!callLogSheetName && CALL_LOG_SHEET_PATTERNS.some(p => p.test(name))) {
      callLogSheetName = name;
    }

    // Auto-detect call log by header structure (even if sheet name doesn't match)
    if (!callLogSheetName) {
      const headers = readHeaders(worksheet);
      if (isCallLogHeaders(headers)) {
        callLogSheetName = name;
      }
    }
  }

  // ─── 2. Read named ranges (defined names) ───────────────────────
  // ExcelJS stores defined names in workbook.definedNames
  // Each defined name maps to a cell or range, and the cached value
  // is available when the file was saved after macro execution.
  try {
    const definedNames = (workbook as any).definedNames;
    if (definedNames) {
      // ExcelJS definedNames.forEach gives (cellRefObj, name) where cellRefObj
      // has { sheetName, address, row, col }
      const entries: { name: string; cellRefObj: any }[] = [];

      if (typeof definedNames.forEach === "function") {
        // ExcelJS definedNames.forEach gives (name: string, cellRefObj: { sheetName, address, ... })
        definedNames.forEach((name: any, cellRefObj: any) => {
          entries.push({ name: String(name), cellRefObj });
        });
      }

      // Also check matrixMap directly (ExcelJS internal structure)
      if (entries.length === 0 && definedNames.matrixMap) {
        for (const [name, def] of Object.entries(definedNames.matrixMap)) {
          const sheets = (def as any)?.sheets;
          if (sheets) {
            for (const [sheetName, rows] of Object.entries(sheets)) {
              if (Array.isArray(rows)) {
                for (const row of rows) {
                  if (Array.isArray(row)) {
                    for (const cell of row) {
                      if (cell && cell.address) {
                        entries.push({ name, cellRefObj: cell });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      for (const { name, cellRefObj } of entries) {
        try {
          const sheetName = cellRefObj?.sheetName || "";
          const address = cellRefObj?.address || "";
          const cellRef = `${sheetName}!${address}`;

          // Resolve the cell value from the worksheet
          const ws = workbook.getWorksheet(sheetName);
          let resolvedValue: unknown = undefined;
          if (ws && address) {
            const cell = ws.getCell(address);
            resolvedValue = readCellValue(cell);
          }

          namedRanges.push({ name, value: resolvedValue, cellRef });

          // Check if this named range matches a metric pattern
          const metricPattern = METRIC_PATTERNS.find(p => p.pattern.test(name));
          if (metricPattern && typeof resolvedValue === "number") {
            metrics.push({
              name: name,
              value: resolvedValue,
              unit: metricPattern.unit,
              higherIsBetter: metricPattern.higherIsBetter,
              source: "named_range",
              cellRef,
              sheetName,
            });
            if (!detectionMethods.includes("named_range")) {
              detectionMethods.push("named_range");
            }
          }
        } catch {
          // Skip individual named range errors
        }
      }
    }
  } catch (e) {
    // Named ranges may not be available in all Excel versions
    console.error("[telemetry-parser] Named range reading failed:", e);
  }

  // ─── 3. Extract metrics from summary sheet ─────────────────────
  if (summarySheetName) {
    const ws = workbook.getWorksheet(summarySheetName);
    if (ws) {
      const summaryMetrics = extractMetricsFromSummarySheet(ws, summarySheetName);
      metrics.push(...summaryMetrics);
      if (summaryMetrics.length > 0 && !detectionMethods.includes("summary_sheet")) {
        detectionMethods.push("summary_sheet");
      }
    }
  } else {
    // No summary sheet detected by name — try every sheet for label-value pairs
    for (const ws of workbook.worksheets) {
      const sheetMetrics = extractMetricsFromSummarySheet(ws, ws.name);
      if (sheetMetrics.length > 0) {
        metrics.push(...sheetMetrics);
        if (!detectionMethods.includes("summary_sheet")) {
          detectionMethods.push("summary_sheet");
        }
        if (!summarySheetName) {
          summarySheetName = ws.name;
        }
      }
    }
  }

  // ─── 4. Extract call log entries and aggregate ─────────────────
  if (callLogSheetName) {
    const ws = workbook.getWorksheet(callLogSheetName);
    if (ws) {
      const entries = extractCallLog(ws);
      callLog.push(...entries);

      // Aggregate metrics from call log
      const aggregated = aggregateCallLogMetrics(entries, callLogSheetName);
      metrics.push(...aggregated);
      if (aggregated.length > 0 && !detectionMethods.includes("call_log")) {
        detectionMethods.push("call_log");
      }
    }
  } else {
    // No call log detected by name — try auto-detect on all sheets
    for (const ws of workbook.worksheets) {
      if (ws.name === summarySheetName) continue;
      const headers = readHeaders(ws);
      if (isCallLogHeaders(headers)) {
        const entries = extractCallLog(ws);
        if (entries.length > 0) {
          callLog.push(...entries);
          callLogSheetName = ws.name;
          const aggregated = aggregateCallLogMetrics(entries, ws.name);
          metrics.push(...aggregated);
          if (!detectionMethods.includes("call_log")) {
            detectionMethods.push("call_log");
          }
        }
      }
    }
  }

  // ─── 5. Detect rep ID and territory ─────────────────────────────
  const repInfo = detectRepInfo(workbook, sheets);
  const periodInfo = detectPeriod(workbook, sheets);

  // ─── 6. Deduplicate metrics ─────────────────────────────────────
  const deduped = deduplicateMetrics(metrics);

  return {
    metrics: deduped,
    callLog,
    sheets,
    namedRanges,
    detectionMethods,
    summarySheetName,
    callLogSheetName,
    periodStart: periodInfo.start,
    periodEnd: periodInfo.end,
    repId: repInfo.repId,
    territory: repInfo.territory,
    raw: { allCells },
  };
}

// ─── Helper: Read cell value (handles formula results) ──────────────────

function readCellValue(cell: any): unknown {
  if (!cell) return undefined;
  // ExcelJS: cell.value can be:
  //   - null
  //   - number, string, boolean, Date
  //   - { formula: "...", result: <cached value> }  ← formula with cached result
  //   - { sharedFormula: "...", result: <cached value> }
  //   - { richText: [...] }
  //   - { error: "..." }
  const value = cell.value;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return value.result; // formula cached result
    if ("richText" in value) return value.richText.map((r: any) => r.text).join("");
    if ("error" in value) return undefined;
  }
  return undefined;
}

function resolveCellValue(workbook: any, cellRef: string): unknown {
  // cellRef format: "SheetName!$B$4" or "SheetName!B4"
  try {
    const match = cellRef.match(/^(.+?)!([A-Z]+)([0-9]+)$/);
    if (!match) return undefined;
    const [, sheetName, col, row] = match;
    const ws = workbook.getWorksheet(sheetName.replace(/'/g, ""));
    if (!ws) return undefined;
    const cell = ws.getCell(`${col}${row}`);
    return readCellValue(cell);
  } catch {
    return undefined;
  }
}

// ─── Helper: Read headers from first row ────────────────────────────────

function readHeaders(ws: any): string[] {
  const headers: string[] = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell: any, colNumber: number) => {
    const value = readCellValue(cell);
    headers[colNumber - 1] = String(value || `Column${colNumber}`);
  });
  return headers.filter(Boolean);
}

// ─── Helper: Detect if headers look like a call log ─────────────────────

function isCallLogHeaders(headers: string[]): boolean {
  let matchCount = 0;
  for (const [field, patterns] of Object.entries(CALL_LOG_HEADER_PATTERNS)) {
    const found = headers.some(h => patterns.some(p => p.test(String(h))));
    if (found) matchCount++;
  }
  // If at least 3 of the 8 call log fields are present, it's likely a call log
  return matchCount >= 3;
}

// ─── Helper: Extract metrics from summary sheet ─────────────────────────

/**
 * Summary sheets typically have label-value pairs in two patterns:
 *   1. Label in column A, value in column B (vertical layout)
 *   2. Labels in row 1, values in row 2 (horizontal layout)
 *
 * We scan for cells whose value matches a known metric name, then
 * read the adjacent cell for the value.
 */
function extractMetricsFromSummarySheet(ws: any, sheetName: string): TelemetryMetric[] {
  const metrics: TelemetryMetric[] = [];
  const maxRow = Math.min(ws.rowCount, 100); // cap scan to first 100 rows
  const maxCol = Math.min(ws.columnCount, 20); // cap scan to first 20 cols

  // Pattern 1: Vertical (label in A, value in B)
  for (let r = 1; r <= maxRow; r++) {
    const labelCell = ws.getCell(`A${r}`);
    const labelValue = readCellValue(labelCell);
    if (typeof labelValue !== "string") continue;

    const metricPattern = METRIC_PATTERNS.find(p => p.pattern.test(labelValue));
    if (!metricPattern) continue;

    // Value is in column B (or C if B is empty)
    const valueCellB = ws.getCell(`B${r}`);
    const valueB = readCellValue(valueCellB);
    const valueCellC = ws.getCell(`C${r}`);
    const valueC = readCellValue(valueCellC);

    const value = typeof valueB === "number" ? valueB : (typeof valueC === "number" ? valueC : undefined);
    if (value === undefined) continue;

    // Check for baseline in adjacent cell
    const baselineCell = ws.getCell(`D${r}`);
    const baseline = readCellValue(baselineCell);
    const baselineNum = typeof baseline === "number" ? baseline : undefined;

    metrics.push({
      name: labelValue,
      value,
      unit: metricPattern.unit,
      higherIsBetter: metricPattern.higherIsBetter,
      baseline: baselineNum,
      source: "summary_sheet",
      cellRef: `${sheetName}!B${r}`,
      sheetName,
    });
  }

  // Pattern 2: Horizontal (labels in row 1, values in row 2)
  if (metrics.length === 0) {
    const headerRow = ws.getRow(1);
    const valueRow = ws.getRow(2);

    headerRow.eachCell((cell: any, colNumber: number) => {
      const label = readCellValue(cell);
      if (typeof label !== "string") return;

      const metricPattern = METRIC_PATTERNS.find(p => p.pattern.test(label));
      if (!metricPattern) return;

      const valueCell = valueRow.getCell(colNumber);
      const value = readCellValue(valueCell);
      if (typeof value !== "number") return;

      metrics.push({
        name: label,
        value,
        unit: metricPattern.unit,
        higherIsBetter: metricPattern.higherIsBetter,
        source: "summary_sheet",
        cellRef: `${sheetName}!${colNumber}2`,
        sheetName,
      });
    });
  }

  // Pattern 3: Any cell with a label-like value followed by a number
  // (catches "Response Rate: 45%" in a single cell)
  if (metrics.length === 0) {
    for (let r = 1; r <= maxRow; r++) {
      for (let c = 1; c <= maxCol; c++) {
        const cell = ws.getCell(r, c);
        const value = readCellValue(cell);
        if (typeof value !== "string") continue;

        // Check for "Label: value" pattern in a single cell
        const inlineMatch = value.match(/^(.+?):\s*([\d.]+)\s*(%?)/);
        if (inlineMatch) {
          const [, label, numStr, pct] = inlineMatch;
          const metricPattern = METRIC_PATTERNS.find(p => p.pattern.test(label));
          if (metricPattern) {
            metrics.push({
              name: label.trim(),
              value: parseFloat(numStr),
              unit: pct ? "%" : metricPattern.unit,
              higherIsBetter: metricPattern.higherIsBetter,
              source: "cell_label",
              cellRef: `${sheetName}!${cell.address}`,
              sheetName,
            });
          }
        }
      }
    }
  }

  return metrics;
}

// ─── Helper: Extract call log entries ───────────────────────────────────

function extractCallLog(ws: any): CallLogEntry[] {
  const headers = readHeaders(ws);
  const entries: CallLogEntry[] = [];

  // Map headers to fields
  const fieldMap: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const [field, patterns] of Object.entries(CALL_LOG_HEADER_PATTERNS)) {
      if (patterns.some(p => p.test(h))) {
        if (!(field in fieldMap)) {
          fieldMap[field] = i;
        }
      }
    }
  }

  // Read data rows
  ws.eachRow((row: any, rowNum: number) => {
    if (rowNum === 1) return; // skip header
    const rowData: Record<string, unknown> = {};
    row.eachCell((cell: any, colNumber: number) => {
      const header = headers[colNumber - 1] || `Column${colNumber}`;
      rowData[header] = readCellValue(cell);
    });

    if (Object.keys(rowData).length === 0) return;

    const entry: CallLogEntry = {
      rawRow: rowData,
    };

    if ("date" in fieldMap) {
      const dateVal = Object.values(rowData)[fieldMap["date"]];
      entry.date = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || "");
    }
    if ("hcpName" in fieldMap) {
      entry.hcpName = String(Object.values(rowData)[fieldMap["hcpName"]] || "");
    }
    if ("hcpId" in fieldMap) {
      entry.hcpId = String(Object.values(rowData)[fieldMap["hcpId"]] || "");
    }
    if ("account" in fieldMap) {
      entry.account = String(Object.values(rowData)[fieldMap["account"]] || "");
    }
    if ("outcome" in fieldMap) {
      entry.outcome = String(Object.values(rowData)[fieldMap["outcome"]] || "");
    }
    if ("duration" in fieldMap) {
      const dur = Object.values(rowData)[fieldMap["duration"]];
      entry.durationMinutes = typeof dur === "number" ? dur : parseFloat(String(dur || "0"));
    }
    if ("products" in fieldMap) {
      const products = Object.values(rowData)[fieldMap["products"]];
      entry.productsDiscussed = String(products || "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
    if ("followUp" in fieldMap) {
      const fu = Object.values(rowData)[fieldMap["followUp"]];
      entry.followUpRequired = /^(yes|true|y|1|required)/i.test(String(fu || ""));
    }

    entries.push(entry);
  });

  return entries;
}

// ─── Helper: Aggregate call log into metrics ────────────────────────────

function aggregateCallLogMetrics(entries: CallLogEntry[], sheetName: string): TelemetryMetric[] {
  const metrics: TelemetryMetric[] = [];
  if (entries.length === 0) return metrics;

  // Total calls
  metrics.push({
    name: "Call Count",
    value: entries.length,
    unit: "count",
    higherIsBetter: true,
    source: "call_log_aggregate",
    cellRef: `${sheetName}!aggregate`,
    sheetName,
  });

  // Unique HCPs
  const uniqueHcps = new Set(entries.filter(e => e.hcpName).map(e => e.hcpName));
  if (uniqueHcps.size > 0) {
    metrics.push({
      name: "Unique HCPs Visited",
      value: uniqueHcps.size,
      unit: "count",
      higherIsBetter: true,
      source: "call_log_aggregate",
      cellRef: `${sheetName}!aggregate`,
      sheetName,
    });
  }

  // Response rate (calls with a non-empty, non-"no response" outcome / total)
  const responded = entries.filter(e => {
    const outcome = (e.outcome || "").toLowerCase();
    return outcome && !outcome.includes("no response") && !outcome.includes("no answer") && !outcome.includes("missed");
  });
  if (responded.length > 0) {
    metrics.push({
      name: "Response Rate",
      value: Math.round((responded.length / entries.length) * 100),
      unit: "%",
      higherIsBetter: true,
      source: "call_log_aggregate",
      cellRef: `${sheetName}!aggregate`,
      sheetName,
    });
  }

  // Follow-up rate
  const followUps = entries.filter(e => e.followUpRequired);
  if (followUps.length > 0) {
    metrics.push({
      name: "Follow-up Rate",
      value: Math.round((followUps.length / entries.length) * 100),
      unit: "%",
      higherIsBetter: true,
      source: "call_log_aggregate",
      cellRef: `${sheetName}!aggregate`,
      sheetName,
    });
  }

  // Average call duration
  const durations = entries.filter(e => e.durationMinutes && e.durationMinutes > 0);
  if (durations.length > 0) {
    const avg = durations.reduce((sum, e) => sum + (e.durationMinutes || 0), 0) / durations.length;
    metrics.push({
      name: "Avg Time Per Call",
      value: Math.round(avg * 10) / 10,
      unit: "minutes",
      higherIsBetter: false,
      source: "call_log_aggregate",
      cellRef: `${sheetName}!aggregate`,
      sheetName,
    });
  }

  // Date range
  const dates = entries.filter(e => e.date).map(e => new Date(e.date!).getTime()).filter(t => !isNaN(t));
  if (dates.length > 0) {
    // Not a metric but useful for period detection
  }

  return metrics;
}

// ─── Helper: Detect rep ID and territory ────────────────────────────────

function detectRepInfo(workbook: any, sheets: { name: string }[]): { repId?: string; territory?: string } {
  let repId: string | undefined;
  let territory: string | undefined;

  // Scan first few cells of each sheet for rep/territory identifiers
  for (const ws of workbook.worksheets) {
    if (repId && territory) break;
    for (let r = 1; r <= 5; r++) {
      if (repId && territory) break;
      for (let c = 1; c <= 5; c++) {
        const cell = ws.getCell(r, c);
        const value = readCellValue(cell);
        if (typeof value !== "string") continue;

        if (!repId) {
          const repMatch = value.match(/rep\s*id:?\s*([A-Z0-9_-]+)/i);
          if (repMatch) repId = repMatch[1];
        }
        if (!territory) {
          // Require "Territory:" with colon to avoid matching "Territory Coverage" as a metric name
          const territoryMatch = value.match(/territory:\s*([A-Za-z0-9_\s-]+)/i);
          if (territoryMatch) territory = territoryMatch[1].trim();
        }
      }
    }
  }
  return { repId, territory };
}

// ─── Helper: Detect period ──────────────────────────────────────────────

function detectPeriod(workbook: any, sheets: { name: string }[]): { start?: string; end?: string } {
  for (const ws of workbook.worksheets) {
    for (let r = 1; r <= 10; r++) {
      for (let c = 1; c <= 5; c++) {
        const cell = ws.getCell(r, c);
        const value = readCellValue(cell);
        if (typeof value !== "string") continue;

        // "Period: 2026-01-01 to 2026-01-31"
        const periodMatch = value.match(/period:?\s*(\d{4}[-/]\d{2}[-/]\d{2})\s*(?:to|-|–)\s*(\d{4}[-/]\d{2}[-/]\d{2})/i);
        if (periodMatch) {
          return { start: periodMatch[1], end: periodMatch[2] };
        }

        // "Week of 2026-01-15"
        const weekMatch = value.match(/week\s*of:?\s*(\d{4}[-/]\d{2}[-/]\d{2})/i);
        if (weekMatch) {
          return { start: weekMatch[1] };
        }
      }
    }
  }
  return {};
}

// ─── Helper: Deduplicate metrics ────────────────────────────────────────

function deduplicateMetrics(metrics: TelemetryMetric[]): TelemetryMetric[] {
  const seen = new Map<string, TelemetryMetric>();

  // Prefer named_range > summary_sheet > call_log_aggregate > cell_label
  const sourcePriority = { named_range: 0, summary_sheet: 1, call_log_aggregate: 2, cell_label: 3 };

  for (const m of metrics) {
    const key = m.name.toLowerCase().replace(/\s+/g, "_");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, m);
    } else {
      // Keep the one with higher priority source
      const existingPriority = (sourcePriority as any)[existing.source] ?? 99;
      const newPriority = (sourcePriority as any)[m.source] ?? 99;
      if (newPriority < existingPriority) {
        seen.set(key, m);
      }
    }
  }

  return Array.from(seen.values());
}

// ─── Convert to workflow observation metrics ────────────────────────────

/**
 * Convert parsed telemetry metrics into the format expected by the
 * workflow observation stage. This is the bridge between the sheet
 * parser and the workflow engine.
 */
export function telemetryToObservationMetrics(
  telemetry: TelemetrySheet,
): { metric: string; value: number; unit: string; baseline: number; higherIsBetter: boolean }[] {
  return telemetry.metrics.map(m => ({
    metric: m.name,
    value: m.value,
    unit: m.unit,
    baseline: m.baseline || 0,
    higherIsBetter: m.higherIsBetter,
  }));
}

/**
 * Generate an outcome description from the telemetry data.
 * This auto-writes the "what happened" text from the sheet data,
 * so the rep doesn't have to type it.
 */
export function telemetryToOutcomeDescription(telemetry: TelemetrySheet): string {
  const parts: string[] = [];

  if (telemetry.detectionMethods.length > 0) {
    parts.push(`Telemetry extracted via: ${telemetry.detectionMethods.join(", ")}.`);
  }

  if (telemetry.metrics.length > 0) {
    const metricLines = telemetry.metrics.slice(0, 10).map(m => {
      const baseline = m.baseline ? ` (baseline: ${m.baseline}${m.unit})` : "";
      return `${m.name}: ${m.value}${m.unit}${baseline}`;
    });
    parts.push(`Metrics: ${metricLines.join("; ")}.`);
  }

  if (telemetry.callLog.length > 0) {
    parts.push(`${telemetry.callLog.length} call log entries from ${telemetry.callLogSheetName}.`);
  }

  if (telemetry.periodStart) {
    parts.push(`Period: ${telemetry.periodStart}${telemetry.periodEnd ? ` to ${telemetry.periodEnd}` : ""}.`);
  }

  return parts.join(" ") || "No telemetry data extracted from sheet.";
}

// ─── Also export as ParsedAttachmentData for compatibility ──────────────

export async function parseXlsmAsAttachment(buffer: Buffer): Promise<ParsedAttachmentData> {
  const telemetry = await parseTelemetrySheet(buffer);
  return {
    type: "excel" as any,
    rows: telemetry.callLog.map(e => e.rawRow),
    metadata: {
      rowCount: telemetry.callLog.length,
      sheetName: telemetry.summarySheetName || telemetry.callLogSheetName || "",
      telemetryMetrics: telemetry.metrics,
      detectionMethods: telemetry.detectionMethods,
      repId: telemetry.repId,
      territory: telemetry.territory,
      periodStart: telemetry.periodStart,
      periodEnd: telemetry.periodEnd,
    } as any,
  };
}
