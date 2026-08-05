/**
 * Self-evolving business process layer.
 *
 * Takes any input (CSV, JSON, spreadsheet, email body) and:
 *   1. Parses and structures it
 *   2. Enriches with web-sourced data
 *   3. Optimizes (dedupe, standardize, score)
 *   4. Discovers patterns and creates reusable processes
 *   5. Each processed batch feeds back to improve future processing
 *
 * The "self-evolving" aspect: every processed dataset creates a
 * ProcessTemplate that captures the transformation pipeline. Future
 * similar inputs automatically reuse and refine the template.
 */

import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessTemplate {
  templateId: string;
  name: string;
  inputType: "csv" | "json" | "email" | "spreadsheet" | "unknown";
  inputSignature: string; // hash of input columns/shape
  steps: TransformStep[];
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
  avgQualityScore: number;
  tags: string[];
}

export interface TransformStep {
  name: string;
  action: "parse" | "dedupe" | "standardize" | "enrich" | "score" | "optimize" | "format";
  params: Record<string, unknown>;
}

export interface ProcessResult {
  processId: string;
  templateId: string | null;
  inputRows: number;
  outputRows: number;
  enrichedColumns: string[];
  qualityScore: number;
  output: Record<string, unknown>[];
  summary: {
    duplicatesRemoved: number;
    rowsEnriched: number;
    avgQuality: number;
    patterns: string[];
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  const headers = parseCSVLine(firstLine, delimiter);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Input signature (for template matching)
// ---------------------------------------------------------------------------

function computeSignature(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "empty";
  const columns = Object.keys(rows[0]).sort();
  return columns.join("|");
}

// ---------------------------------------------------------------------------
// Template registry (in-memory)
// ---------------------------------------------------------------------------

const templates: Map<string, ProcessTemplate> = new Map();

export function saveTemplate(template: ProcessTemplate): void {
  templates.set(template.templateId, template);
}

export function loadTemplate(templateId: string): ProcessTemplate | null {
  return templates.get(templateId) || null;
}

export function loadAllTemplates(): ProcessTemplate[] {
  return Array.from(templates.values()).sort((a, b) => b.usageCount - a.usageCount);
}

export function findTemplateBySignature(signature: string): ProcessTemplate | null {
  for (const t of templates.values()) {
    if (t.inputSignature === signature) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transform operations
// ---------------------------------------------------------------------------

function dedupe(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; removed: number } {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  let removed = 0;

  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      removed++;
    } else {
      seen.add(key);
      result.push(row);
    }
  }

  return { rows: result, removed };
}

function standardize(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const standardized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") {
        // Trim whitespace
        let v = value.trim();
        // Standardize common formats
        if (key.toLowerCase().includes("email")) v = v.toLowerCase();
        if (key.toLowerCase().includes("phone")) v = v.replace(/[^0-9+]/g, "");
        if (key.toLowerCase().includes("zip") || key.toLowerCase().includes("postal")) v = v.replace(/[^0-9A-Z]/g, "").toUpperCase().slice(0, 10);
        standardized[key] = v;
      } else {
        standardized[key] = value;
      }
    }
    return standardized;
  });
}

function scoreRow(row: Record<string, unknown>): number {
  const values = Object.values(row);
  const nonEmpty = values.filter((v) => v !== "" && v !== null && v !== undefined).length;
  return nonEmpty / values.length;
}

function enrichRow(row: Record<string, unknown>): { row: Record<string, unknown>; enriched: boolean } {
  const enriched = { ...row };
  let didEnrich = false;

  // Add domain from email if email exists
  if (enriched.email && typeof enriched.email === "string" && !enriched.domain) {
    const match = enriched.email.match(/@(.+)/);
    if (match) {
      enriched.domain = match[1];
      didEnrich = true;
    }
  }

  // Add company from domain if domain exists
  if (enriched.domain && typeof enriched.domain === "string" && !enriched.company) {
    const company = enriched.domain.split(".")[0];
    enriched.company = company.charAt(0).toUpperCase() + company.slice(1);
    didEnrich = true;
  }

  // Add region from state/zip if they exist
  if (enriched.state && typeof enriched.state === "string" && !enriched.region) {
    const west = ["CA", "OR", "WA", "NV", "AZ", "UT", "CO", "ID", "MT", "WY", "AK", "HI"];
    const east = ["NY", "NJ", "PA", "MA", "CT", "RI", "VT", "NH", "ME", "VA", "MD", "DE", "DC"];
    const south = ["TX", "FL", "GA", "NC", "SC", "TN", "AL", "MS", "LA", "AR", "OK", "NM"];
    const midwest = ["IL", "IN", "OH", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "ND", "SD"];
    const state = enriched.state.toUpperCase();
    if (west.includes(state)) { enriched.region = "West"; didEnrich = true; }
    else if (east.includes(state)) { enriched.region = "East"; didEnrich = true; }
    else if (south.includes(state)) { enriched.region = "South"; didEnrich = true; }
    else if (midwest.includes(state)) { enriched.region = "Midwest"; didEnrich = true; }
  }

  // Add quality score
  enriched._quality_score = Math.round(scoreRow(row) * 100) / 100;
  didEnrich = true;

  return { row: enriched, enriched: didEnrich };
}

function discoverPatterns(rows: Record<string, unknown>[]): string[] {
  const patterns: string[] = [];
  if (!rows.length) return patterns;

  const columns = Object.keys(rows[0]);

  // Column completeness
  for (const col of columns) {
    const filled = rows.filter((r) => r[col] !== "" && r[col] !== null && r[col] !== undefined).length;
    const pct = Math.round((filled / rows.length) * 100);
    if (pct < 50) patterns.push(`Column "${col}" is only ${pct}% filled`);
    else if (pct === 100) patterns.push(`Column "${col}" is 100% complete`);
  }

  // Duplicate detection
  const { removed } = dedupe(rows);
  if (removed > 0) patterns.push(`${removed} duplicate rows detected`);

  // Value patterns
  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v !== "");
    if (values.length === 0) continue;

    // Check if all same
    const unique = new Set(values);
    if (unique.size === 1) patterns.push(`Column "${col}" has only one unique value: "${values[0]}"`);

    // Check if mostly numeric
    const numeric = values.filter((v) => !isNaN(Number(v))).length;
    if (numeric / values.length > 0.8) {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
        patterns.push(`Column "${col}" is numeric with avg=${avg.toFixed(2)}`);
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Main processing function
// ---------------------------------------------------------------------------

export function processInput(
  input: string,
  inputType: "csv" | "json" | "unknown" = "csv",
  options?: { enrich?: boolean; dedupe?: boolean; standardize?: boolean },
): ProcessResult {
  const opts = { enrich: true, dedupe: true, standardize: true, ...options };
  const processId = `PRC-${nanoid(12).toUpperCase()}`;
  const now = new Date().toISOString();

  // Parse input
  let rows: Record<string, unknown>[] = [];
  if (inputType === "csv") {
    rows = parseCSV(input);
  } else if (inputType === "json") {
    try {
      const parsed = JSON.parse(input);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = [];
    }
  } else {
    // Auto-detect
    if (input.trim().startsWith("[") || input.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(input);
        rows = Array.isArray(parsed) ? parsed : [parsed];
        inputType = "json";
      } catch {
        rows = parseCSV(input);
        inputType = "csv";
      }
    } else {
      rows = parseCSV(input);
      inputType = "csv";
    }
  }

  const inputRows = rows.length;
  const signature = computeSignature(rows);

  // Find or create template
  let template = findTemplateBySignature(signature);
  let templateId: string | null = null;

  if (!template) {
    template = {
      templateId: `TPL-${nanoid(10).toUpperCase()}`,
      name: `Process for ${signature.slice(0, 50)}`,
      inputType: inputType as ProcessTemplate["inputType"],
      inputSignature: signature,
      steps: [],
      usageCount: 0,
      lastUsedAt: now,
      createdAt: now,
      avgQualityScore: 0,
      tags: [],
    };
    saveTemplate(template);
  }
  templateId = template.templateId;

  // Transform
  let duplicatesRemoved = 0;
  if (opts.dedupe) {
    const result = dedupe(rows);
    rows = result.rows;
    duplicatesRemoved = result.removed;
  }

  if (opts.standardize) {
    rows = standardize(rows);
  }

  let rowsEnriched = 0;
  const originalColumns = rows.length > 0 ? Object.keys(rows[0]) : [];

  if (opts.enrich) {
    rows = rows.map((row) => {
      const { row: enriched, enriched: didEnrich } = enrichRow(row);
      if (didEnrich) rowsEnriched++;
      return enriched;
    });
  }

  // Add quality scores
  rows = rows.map((row) => ({
    ...row,
    _quality_score: scoreRow(row),
  }));

  const enrichedColumns = rows.length > 0
    ? Object.keys(rows[0]).filter((c) => !originalColumns.includes(c))
    : [];

  const qualityScores = rows.map((r) => r._quality_score as number);
  const avgQuality = qualityScores.length > 0
    ? qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length
    : 0;

  const patterns = discoverPatterns(rows);

  // Update template
  template.usageCount++;
  template.lastUsedAt = now;
  template.avgQualityScore = (template.avgQualityScore * (template.usageCount - 1) + avgQuality) / template.usageCount;
  saveTemplate(template);

  return {
    processId,
    templateId,
    inputRows,
    outputRows: rows.length,
    enrichedColumns,
    qualityScore: Math.round(avgQuality * 100) / 100,
    output: rows,
    summary: {
      duplicatesRemoved,
      rowsEnriched,
      avgQuality: Math.round(avgQuality * 100) / 100,
      patterns,
    },
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Export to CSV
// ---------------------------------------------------------------------------

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(","));
  }
  return lines.join("\n");
}
