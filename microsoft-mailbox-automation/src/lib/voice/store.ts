/**
 * JSON-file persistence for voice sessions.
 *
 * Portable across all platforms (Vercel, Netlify, local, HF Space).
 * Uses an in-memory cache backed by a JSON file on disk. On serverless
 * platforms where the filesystem is read-only or ephemeral, the in-memory
 * cache still works for the duration of the request.
 *
 * No foreign key constraints — no auth dependency.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { VoiceSession, VoiceEscalationRecord } from "@/types";

const DB_PATH = process.env.VOICE_DB_PATH || join(tmpdir(), "voice-sessions.json");

interface DBShape {
  sessions: Record<string, VoiceSession>;
  escalations: VoiceEscalationRecord[];
}

let _cache: DBShape | null = null;

function loadDB(): DBShape {
  if (_cache) return _cache;
  try {
    if (existsSync(DB_PATH)) {
      _cache = JSON.parse(readFileSync(DB_PATH, "utf-8"));
    } else {
      _cache = { sessions: {}, escalations: [] };
      saveDB();
    }
  } catch {
    _cache = { sessions: {}, escalations: [] };
  }
  return _cache!;
}

function saveDB(): void {
  try {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(DB_PATH, JSON.stringify(_cache, null, 2));
  } catch {
    // Ephemeral filesystem — cache still works for request duration
  }
}

export interface VoiceSessionFilters {
  orgId?: string;
  userId?: string;
  state?: string;
  includeExpired?: boolean;
}

export function saveVoiceSession(session: VoiceSession): void {
  const db = loadDB();
  db.sessions[session.sessionId] = session;
  saveDB();
}

export function getVoiceSession(sessionId: string): VoiceSession | undefined {
  return loadDB().sessions[sessionId];
}

export function listVoiceSessions(filters: VoiceSessionFilters = {}): VoiceSession[] {
  const db = loadDB();
  let sessions = Object.values(db.sessions);

  if (filters.orgId) sessions = sessions.filter((s) => s.organizationId === filters.orgId);
  if (filters.userId) sessions = sessions.filter((s) => s.userId === filters.userId);
  if (filters.state) sessions = sessions.filter((s) => s.state === filters.state);

  if (!filters.includeExpired) {
    const now = new Date().toISOString();
    sessions = sessions.filter((s) => s.expiresAt >= now);
  }

  return sessions.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function deleteVoiceSession(sessionId: string): void {
  const db = loadDB();
  delete db.sessions[sessionId];
  saveDB();
}

export function deleteExpiredVoiceSessions(): number {
  const db = loadDB();
  const now = new Date().toISOString();
  let count = 0;
  for (const id of Object.keys(db.sessions)) {
    if (db.sessions[id].expiresAt < now) {
      delete db.sessions[id];
      count++;
    }
  }
  if (count > 0) saveDB();
  return count;
}

export function saveVoiceSessions(sessions: VoiceSession[]): void {
  const db = loadDB();
  for (const session of sessions) {
    db.sessions[session.sessionId] = session;
  }
  saveDB();
}

// ─── Escalation receipts ─────────────────────────────────────────────

export function saveVoiceEscalation(
  _orgId: string,
  record: VoiceEscalationRecord,
): void {
  const db = loadDB();
  db.escalations.push(record);
  saveDB();
}

export function listVoiceEscalations(
  _orgId: string,
  filters: { sessionId?: string; artifactId?: string } = {},
): VoiceEscalationRecord[] {
  const db = loadDB();
  return db.escalations.filter((r) => {
    if (filters.sessionId && r.sessionId !== filters.sessionId) return false;
    if (filters.artifactId && r.artifactId !== filters.artifactId) return false;
    return true;
  });
}

export function getVoiceEscalation(
  _orgId: string,
  escalationId: string,
): VoiceEscalationRecord | undefined {
  return loadDB().escalations.find((r) => r.escalationId === escalationId);
}
