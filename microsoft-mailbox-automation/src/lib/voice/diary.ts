/**
 * Voice Diary — the real integration layer between voice and the pipeline.
 *
 * When a rep speaks into a voice session, their words become diary entries.
 * Those entries don't just sit there — they flow into the pipeline:
 *
 *   Voice transcript
 *   → diary entry (dated, tagged, with session + segment refs)
 *   → email signal (if it reveals an email behavioral uncertainty)
 *   → experiment outcome (if it records what happened in an experiment)
 *   → golden node evidence (if it supports a winning method)
 *   → reverse falsification result (if it reports a palindrome test)
 *
 * Persisted in SQLite for durability across deployments.
 */

import { callLLM } from "@/lib/golden/llm-client";
import { getDb, DEFAULT_ORG_ID, ensureDefaultOrg, getUser, createUser } from "@/lib/db";
import { buildPipelineFromDiary } from "./diary-pipeline";

export type DiaryEntryType =
  | "field_observation"
  | "experiment_outcome"
  | "customer_interaction"
  | "compliance_event"
  | "hypothesis_insight"
  | "golden_node_evidence"
  | "reverse_falsification_result"
  | "uncategorized";

export type DiaryPipelineLink =
  | "email_signal"
  | "experiment"
  | "experiment_outcome"
  | "golden_node"
  | "reverse_test"
  | "skill"
  | "unlinked";

export interface DiaryEntry {
  id: string;
  orgId: string;
  userId: string;
  sessionId: string;
  segmentId: string;
  date: string;          // YYYY-MM-DD
  timestamp: string;     // ISO
  text: string;          // the transcript text
  type: DiaryEntryType;
  tags: string[];
  // Pipeline connections — these are REAL links to real objects
  pipelineLinks: PipelineLink[];
  // LLM-extracted structured data
  extractedEntities: {
    accounts?: string[];
    outcomes?: string[];
    uncertainties?: string[];
    complianceFlags?: string[];
  };
  // URL to stored audio blob if the entry was captured with audio
  audioUrl?: string;
  // Whether this entry has been processed into the pipeline
  processed: boolean;
  processedAt: string | null;
}

export interface PipelineLink {
  type: DiaryPipelineLink;
  objectId: string;
  description: string;
  createdAt: string;
}

// ─── Schema helpers ────────────────────────────────────────────────────

interface DiaryRow {
  id: string;
  org_id: string;
  user_id: string;
  session_id: string;
  segment_id: string;
  date: string;
  timestamp: string;
  text: string;
  entry_type: string;
  tags: string;
  pipeline_links: string;
  extracted_entities: string;
  audio_url: string | null;
  processed: number;
  processed_at: string | null;
}

function rowToEntry(row: DiaryRow): DiaryEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    sessionId: row.session_id,
    segmentId: row.segment_id,
    date: row.date,
    timestamp: row.timestamp,
    text: row.text,
    type: row.entry_type as DiaryEntryType,
    tags: JSON.parse(row.tags),
    pipelineLinks: JSON.parse(row.pipeline_links),
    extractedEntities: JSON.parse(row.extracted_entities),
    audioUrl: row.audio_url || undefined,
    processed: row.processed === 1,
    processedAt: row.processed_at,
  };
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Validation ────────────────────────────────────────────────────────

const VALID_TYPES: DiaryEntryType[] = [
  "field_observation",
  "experiment_outcome",
  "customer_interaction",
  "compliance_event",
  "hypothesis_insight",
  "golden_node_evidence",
  "reverse_falsification_result",
  "uncategorized",
];

function validateText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Diary text cannot be empty");
  if (trimmed.length > 10000) throw new Error("Diary text exceeds 10000 characters");
  return trimmed;
}

function validateType(type: string): DiaryEntryType {
  if (!VALID_TYPES.includes(type as DiaryEntryType)) {
    return "uncategorized";
  }
  return type as DiaryEntryType;
}

// ─── Create a diary entry from a transcript segment ────────────────────

export async function createDiaryEntryFromTranscript(input: {
  sessionId: string;
  segmentId: string;
  text: string;
  employeeId: string;
  orgId?: string;
  audioUrl?: string;
}): Promise<DiaryEntry> {
  const text = validateText(input.text);
  const orgId = input.orgId || DEFAULT_ORG_ID;
  ensureDefaultOrg();

  // Ensure user exists for FK constraint
  if (!getUser(input.employeeId)) {
    createUser(input.employeeId, orgId, `${input.employeeId}@diary.local`, "Diary User", "field_rep", null);
  }

  const db = getDb();

  // Check if this segment already has a diary entry
  const existing = db
    .prepare(`SELECT * FROM diary_entries WHERE org_id = ? AND session_id = ? AND segment_id = ?`)
    .get(orgId, input.sessionId, input.segmentId) as DiaryRow | undefined;
  if (existing) return rowToEntry(existing);

  // Classify the entry and extract entities using LLM
  const classification = await classifyTranscript(text);

  const id = genId("diary");
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO diary_entries (
      id, org_id, user_id, session_id, segment_id, date, timestamp,
      text, entry_type, tags, pipeline_links, extracted_entities, audio_url, processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    orgId,
    input.employeeId,
    input.sessionId,
    input.segmentId,
    now.slice(0, 10),
    now,
    text,
    classification.type,
    JSON.stringify(classification.tags),
    JSON.stringify([]),
    JSON.stringify(classification.entities),
    input.audioUrl || null,
  );

  return getDiaryEntry(id)!;
}

// ─── Classify a transcript using LLM ───────────────────────────────────

async function classifyTranscript(text: string): Promise<{
  type: DiaryEntryType;
  tags: string[];
  entities: DiaryEntry["extractedEntities"];
}> {
  const systemPrompt = `You are Foundry, classifying a field rep's voice diary entry.
Analyze the transcript and return ONLY valid JSON:
{
  "type": "field_observation" | "experiment_outcome" | "customer_interaction" | "compliance_event" | "hypothesis_insight" | "golden_node_evidence" | "reverse_falsification_result" | "uncategorized",
  "tags": ["short", "relevant", "tags"],
  "entities": {
    "accounts": ["account names or emails mentioned"],
    "outcomes": ["outcomes mentioned"],
    "uncertainties": ["uncertainties revealed"],
    "complianceFlags": ["any compliance concerns"]
  }
}`;

  try {
    const result = await callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      { temperature: 0.3, maxTokens: 400 }
    );

    if (result.content) {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type: validateType(parsed.type || "uncategorized"),
          tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
          entities: parsed.entities || {},
        };
      }
    }
  } catch { /* fall through to keyword classification */ }

  // Fallback: simple keyword classification
  const lower = text.toLowerCase();
  let type: DiaryEntryType = "uncategorized";
  const tags: string[] = [];

  if (lower.includes("outcome") || lower.includes("result") || lower.includes("happened")) {
    type = "experiment_outcome";
    tags.push("outcome");
  }
  if (lower.includes("account") || lower.includes("doctor") || lower.includes("office") || lower.includes("spoke with")) {
    type = type === "uncategorized" ? "customer_interaction" : type;
    tags.push("customer");
  }
  if (lower.includes("compliance") || lower.includes("adverse") || lower.includes("off-label")) {
    type = "compliance_event";
    tags.push("compliance");
  }
  if (lower.includes("hypothesis") || lower.includes("idea") || lower.includes("theory")) {
    type = type === "uncategorized" ? "hypothesis_insight" : type;
    tags.push("hypothesis");
  }
  if (lower.includes("golden") || lower.includes("validated") || lower.includes("winning")) {
    type = "golden_node_evidence";
    tags.push("golden-node");
  }
  if (lower.includes("reverse") || lower.includes("falsif") || lower.includes("destroyed")) {
    type = "reverse_falsification_result";
    tags.push("palindrome");
  }
  if (type === "uncategorized") {
    type = "field_observation";
    tags.push("observation");
  }

  return { type, tags, entities: {} };
}

// ─── Process a diary entry into the pipeline ───────────────────────────

export async function processDiaryEntry(entryId: string): Promise<DiaryEntry> {
  const entry = getDiaryEntry(entryId);
  if (!entry) throw new Error(`Diary entry not found: ${entryId}`);
  if (entry.processed) return entry;

  const links = await buildPipelineFromDiary(entry);

  const processedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE diary_entries SET processed = 1, processed_at = ?, pipeline_links = ?
       WHERE id = ?`,
    )
    .run(processedAt, JSON.stringify(links), entryId);

  return getDiaryEntry(entryId)!;
}

// ─── Query diary entries ───────────────────────────────────────────────

export function listDiaryEntries(filters?: {
  orgId?: string;
  employeeId?: string;
  date?: string;
  type?: DiaryEntryType;
  unprocessedOnly?: boolean;
}): DiaryEntry[] {
  ensureDefaultOrg();
  const orgId = filters?.orgId || DEFAULT_ORG_ID;
  let sql = `SELECT * FROM diary_entries WHERE org_id = ?`;
  const params: string[] = [orgId];

  if (filters?.employeeId) {
    sql += ` AND user_id = ?`;
    params.push(filters.employeeId);
  }
  if (filters?.date) {
    sql += ` AND date = ?`;
    params.push(filters.date);
  }
  if (filters?.type) {
    sql += ` AND entry_type = ?`;
    params.push(filters.type);
  }
  if (filters?.unprocessedOnly) {
    sql += ` AND processed = 0`;
  }
  sql += ` ORDER BY timestamp DESC LIMIT 200`;

  const rows = getDb().prepare(sql).all(...params) as DiaryRow[];
  return rows.map(rowToEntry);
}

export function getDiaryEntry(id: string): DiaryEntry | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM diary_entries WHERE id = ?`)
    .get(id) as DiaryRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function deleteDiaryEntry(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM diary_entries WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getDiaryStats(filters?: {
  orgId?: string;
  employeeId?: string;
}): {
  total: number;
  processed: number;
  unprocessed: number;
  byType: Record<string, number>;
  pipelineLinks: number;
  todayCount: number;
} {
  ensureDefaultOrg();
  const orgId = filters?.orgId || DEFAULT_ORG_ID;
  let sql = `SELECT * FROM diary_entries WHERE org_id = ?`;
  const params: string[] = [orgId];

  if (filters?.employeeId) {
    sql += ` AND user_id = ?`;
    params.push(filters.employeeId);
  }

  const rows = getDb().prepare(sql).all(...params) as DiaryRow[];
  const today = new Date().toISOString().slice(0, 10);
  const byType: Record<string, number> = {};
  let pipelineLinks = 0;

  for (const row of rows) {
    byType[row.entry_type] = (byType[row.entry_type] || 0) + 1;
    pipelineLinks += JSON.parse(row.pipeline_links).length;
  }

  return {
    total: rows.length,
    processed: rows.filter((r) => r.processed === 1).length,
    unprocessed: rows.filter((r) => r.processed === 0).length,
    byType,
    pipelineLinks,
    todayCount: rows.filter((r) => r.date === today).length,
  };
}

// ─── Process all unprocessed entries ───────────────────────────────────

export async function processAllUnprocessed(
  employeeId?: string,
  orgId?: string,
): Promise<{
  processed: number;
  links: number;
  entries: DiaryEntry[];
}> {
  const unprocessed = listDiaryEntries({ employeeId, orgId, unprocessedOnly: true });
  let totalLinks = 0;
  const processedEntries: DiaryEntry[] = [];

  for (const entry of unprocessed) {
    try {
      const result = await processDiaryEntry(entry.id);
      processedEntries.push(result);
      totalLinks += result.pipelineLinks.length;
    } catch (e) {
      console.error(`[diary] failed to process entry ${entry.id}:`, e);
    }
  }

  return { processed: processedEntries.length, links: totalLinks, entries: processedEntries };
}
