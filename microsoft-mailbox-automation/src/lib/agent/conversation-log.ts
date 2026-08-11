/**
 * Voice Conversation Log
 *
 * Persists every voice interaction to the database for auditability
 * and backup. Each turn (user input + agent response + actions taken)
 * is stored in the voice_conversation_log table.
 */

import { getDb } from "@/lib/db";

// ─── Schema ─────────────────────────────────────────────────────

let _tableInitialized = false;

function ensureTable() {
  if (_tableInitialized) return;
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_conversation_log (
        id            TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        org_id        TEXT NOT NULL DEFAULT 'foundry',
        user_id       TEXT,
        role          TEXT NOT NULL,           -- 'user' | 'assistant' | 'system'
        content       TEXT NOT NULL,           -- what was said
        page_context  TEXT,                    -- current page when the turn happened
        actions_json  TEXT DEFAULT '[]',       -- JSON array of actions taken
        llm_provider  TEXT,                    -- which LLM provider responded
        llm_used      INTEGER DEFAULT 0,       -- 1 if LLM was used, 0 if deterministic
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_voice_conv_id ON voice_conversation_log(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_voice_conv_user ON voice_conversation_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_voice_conv_created ON voice_conversation_log(created_at);
    `);
    _tableInitialized = true;
  } catch (e) {
    console.error("[conversation-log] table init error:", e);
    _tableInitialized = true; // Don't retry
  }
}

// ─── Types ──────────────────────────────────────────────────────

export interface ConversationTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  pageContext?: string;
  actions?: { tool: string; args: Record<string, unknown>; result: string; success: boolean }[];
  llmProvider?: string;
  llmUsed?: boolean;
  createdAt: string;
}

// ─── Functions ──────────────────────────────────────────────────

let _idCounter = 0;
function generateId(): string {
  _idCounter++;
  return `vcl_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

/**
 * Create a new conversation ID. A conversation groups all turns
 * from a single voice session together.
 */
export function createConversation(userId: string): string {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Log a single conversation turn.
 */
export function logVoiceTurn(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  pageContext?: string,
  actions?: { tool: string; args: Record<string, unknown>; result: string; success: boolean }[],
  llmProvider?: string,
  llmUsed?: boolean,
): void {
  ensureTable();
  try {
    const db = getDb();
    const id = generateId();
    const actionsJson = actions ? JSON.stringify(actions) : "[]";
    db.prepare(`
      INSERT INTO voice_conversation_log
        (id, conversation_id, org_id, user_id, role, content, page_context, actions_json, llm_provider, llm_used)
      VALUES (?, ?, 'foundry', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      conversationId,
      null, // user_id — resolved from session if available
      role,
      content,
      pageContext || null,
      actionsJson,
      llmProvider || null,
      llmUsed ? 1 : 0,
    );
  } catch (e) {
    console.error("[conversation-log] log error:", e);
  }
}

/**
 * Retrieve all turns for a conversation, in order.
 */
export function getConversation(conversationId: string): ConversationTurn[] {
  ensureTable();
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM voice_conversation_log
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(conversationId) as any[];

    return rows.map(rowToTurn);
  } catch (e) {
    console.error("[conversation-log] get conversation error:", e);
    return [];
  }
}

/**
 * List recent conversations with their first and last turn.
 */
export function listConversations(limit: number = 20): {
  conversationId: string;
  turnCount: number;
  firstTurn: string;
  lastTurn: string;
  createdAt: string;
}[] {
  ensureTable();
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        conversation_id,
        COUNT(*) as turn_count,
        MIN(content) as first_content,
        MAX(content) as last_content,
        MIN(created_at) as created_at
      FROM voice_conversation_log
      GROUP BY conversation_id
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      conversationId: r.conversation_id,
      turnCount: r.turn_count,
      firstTurn: r.first_content,
      lastTurn: r.last_content,
      createdAt: r.created_at,
    }));
  } catch (e) {
    console.error("[conversation-log] list conversations error:", e);
    return [];
  }
}

/**
 * Export all conversation logs as JSON (for backup).
 */
export function exportAllLogs(): ConversationTurn[] {
  ensureTable();
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM voice_conversation_log
      ORDER BY created_at ASC
    `).all() as any[];
    return rows.map(rowToTurn);
  } catch (e) {
    console.error("[conversation-log] export error:", e);
    return [];
  }
}

/**
 * Get conversation statistics.
 */
export function getConversationStats(): {
  totalTurns: number;
  totalConversations: number;
  userTurns: number;
  assistantTurns: number;
  llmCalls: number;
  toolCalls: number;
} {
  ensureTable();
  try {
    const db = getDb();
    const total = db.prepare(`SELECT COUNT(*) as c FROM voice_conversation_log`).get() as { c: number };
    const conversations = db.prepare(`SELECT COUNT(DISTINCT conversation_id) as c FROM voice_conversation_log`).get() as { c: number };
    const userTurns = db.prepare(`SELECT COUNT(*) as c FROM voice_conversation_log WHERE role = 'user'`).get() as { c: number };
    const assistantTurns = db.prepare(`SELECT COUNT(*) as c FROM voice_conversation_log WHERE role = 'assistant'`).get() as { c: number };
    const llmCalls = db.prepare(`SELECT COUNT(*) as c FROM voice_conversation_log WHERE llm_used = 1`).get() as { c: number };
    const toolCalls = db.prepare(`SELECT COUNT(*) as c FROM voice_conversation_log WHERE actions_json != '[]' AND actions_json IS NOT NULL`).get() as { c: number };

    return {
      totalTurns: total.c,
      totalConversations: conversations.c,
      userTurns: userTurns.c,
      assistantTurns: assistantTurns.c,
      llmCalls: llmCalls.c,
      toolCalls: toolCalls.c,
    };
  } catch (e) {
    console.error("[conversation-log] stats error:", e);
    return {
      totalTurns: 0,
      totalConversations: 0,
      userTurns: 0,
      assistantTurns: 0,
      llmCalls: 0,
      toolCalls: 0,
    };
  }
}

function rowToTurn(row: any): ConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    pageContext: row.page_context,
    actions: row.actions_json ? JSON.parse(row.actions_json) : [],
    llmProvider: row.llm_provider,
    llmUsed: row.llm_used === 1,
    createdAt: row.created_at,
  };
}
