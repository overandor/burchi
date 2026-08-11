/**
 * Server-side phone telemetry store.
 *
 * Persists phone records, events, and images in SQLite so they survive
 * across sessions and can be queried server-side for territory routing
 * and frontrunner integration.
 *
 * Replaces the localStorage-only client storage in phone-telemetry.ts.
 */

import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export interface PhoneRecordRow {
  id: string;
  orgId: string;
  userId: string;
  phoneNumber: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneEventRow {
  id: string;
  phoneId: string;
  timestamp: string;
  type: string;
  direction: string;
  durationSec: number | null;
  metadata: Record<string, any>;
  notes: string | null;
  createdAt: string;
}

// ─── Phone Records ─────────────────────────────────────────────────────

export function createPhoneRecord(
  orgId: string,
  userId: string,
  phoneNumber: string,
  label: string,
): PhoneRecordRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Validate phone number (7-15 digits, optional +)
  const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, "");
  if (!/^\+?\d{7,15}$/.test(cleaned)) {
    throw new Error("Phone number must be 7-15 digits");
  }

  // Check if a record with the same phone number already exists
  const existing = db
    .prepare(
      `SELECT id FROM phone_records WHERE org_id = ? AND user_id = ? AND phone_number = ?`,
    )
    .get(orgId, userId, cleaned) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE phone_records SET label = ?, updated_at = ? WHERE id = ?`,
    ).run(label, now, existing.id);
    return getPhoneRecord(orgId, userId, existing.id)!;
  }

  db.prepare(
    `INSERT INTO phone_records (id, org_id, user_id, phone_number, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, userId, cleaned, label, now, now);

  return getPhoneRecord(orgId, userId, id)!;
}

export function getPhoneRecord(
  orgId: string,
  userId: string,
  recordId: string,
): PhoneRecordRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM phone_records WHERE org_id = ? AND user_id = ? AND id = ?`)
    .get(orgId, userId, recordId) as any;
  return row ? decodePhoneRow(row) : null;
}

export function getPhoneRecords(orgId: string, userId: string): PhoneRecordRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM phone_records WHERE org_id = ? AND user_id = ? ORDER BY updated_at DESC`)
    .all(orgId, userId) as any[];
  return rows.map(decodePhoneRow);
}

export function deletePhoneRecord(orgId: string, userId: string, recordId: string): boolean {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM phone_records WHERE org_id = ? AND user_id = ? AND id = ?`)
    .run(orgId, userId, recordId);
  return info.changes > 0;
}

// ─── Phone Events ──────────────────────────────────────────────────────

export function addPhoneEvent(
  orgId: string,
  userId: string,
  phoneId: string,
  event: {
    timestamp?: string;
    type: string;
    direction: string;
    durationSec?: number;
    metadata?: Record<string, any>;
    notes?: string;
  },
): PhoneEventRow {
  const db = getDb();

  // Verify ownership
  const record = getPhoneRecord(orgId, userId, phoneId);
  if (!record) throw new Error("Phone record not found");

  // Validate
  const validTypes = ["call", "sms", "mms", "data", "status", "alert", "custom"];
  if (!validTypes.includes(event.type)) {
    throw new Error(`Invalid event type: ${event.type}`);
  }
  if (!["inbound", "outbound"].includes(event.direction)) {
    throw new Error(`Invalid direction: ${event.direction}`);
  }
  if (event.durationSec !== undefined && event.durationSec < 0) {
    throw new Error("durationSec must be non-negative");
  }

  const id = randomUUID();
  const ts = event.timestamp || new Date().toISOString();
  db.prepare(
    `INSERT INTO phone_events (id, phone_id, timestamp, type, direction, duration_sec, metadata, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    phoneId,
    ts,
    event.type,
    event.direction,
    event.durationSec ?? null,
    JSON.stringify(event.metadata || {}),
    event.notes || null,
  );

  // Update parent record's updated_at
  db.prepare(`UPDATE phone_records SET updated_at = datetime('now') WHERE id = ?`).run(phoneId);

  return getPhoneEvents(orgId, userId, phoneId).find((e) => e.id === id)!;
}

export function getPhoneEvents(
  orgId: string,
  userId: string,
  phoneId: string,
): PhoneEventRow[] {
  const db = getDb();
  // Verify ownership
  const record = getPhoneRecord(orgId, userId, phoneId);
  if (!record) return [];
  const rows = db
    .prepare(`SELECT * FROM phone_events WHERE phone_id = ? ORDER BY timestamp DESC`)
    .all(phoneId) as any[];
  return rows.map(decodeEventRow);
}

export function getPhoneEventSummary(orgId: string, userId: string, phoneId: string) {
  const events = getPhoneEvents(orgId, userId, phoneId);
  const totalCalls = events.filter((e) => e.type === "call").length;
  const totalSms = events.filter((e) => e.type === "sms").length;
  const totalDurationSec = events
    .filter((e) => e.type === "call" && e.durationSec)
    .reduce((sum, e) => sum + (e.durationSec || 0), 0);
  const lastActivity = events[0]?.timestamp || null;

  return {
    totalEvents: events.length,
    totalCalls,
    totalSms,
    totalDurationSec,
    lastActivity,
    events,
  };
}

// ─── Territory Accounts ────────────────────────────────────────────────

export interface TerritoryAccountRow {
  id: string;
  orgId: string;
  userId: string;
  accountName: string;
  hcpName: string | null;
  specialty: string | null;
  territory: string | null;
  funnelState: string;
  autonomyClass: number;
  lastVisit: string | null;
  lastInteraction: string | null;
  barriers: string[];
  metadata: Record<string, any>;
  priorityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export function createTerritoryAccount(
  orgId: string,
  userId: string,
  input: {
    accountName: string;
    hcpName?: string;
    specialty?: string;
    territory?: string;
    funnelState?: string;
    autonomyClass?: number;
    barriers?: string[];
    metadata?: Record<string, any>;
  },
): TerritoryAccountRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  if (!input.accountName || input.accountName.trim().length < 2) {
    throw new Error("accountName is required (min 2 characters)");
  }

  // Check if an account with the same name already exists for this user
  const existing = db
    .prepare(
      `SELECT id FROM territory_accounts WHERE org_id = ? AND user_id = ? AND account_name = ?`,
    )
    .get(orgId, userId, input.accountName.trim()) as { id: string } | undefined;

  if (existing) {
    // Update the existing record
    db.prepare(
      `UPDATE territory_accounts SET
         hcp_name = ?, specialty = ?, territory = ?,
         funnel_state = ?, autonomy_class = ?,
         barriers = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.hcpName || null,
      input.specialty || null,
      input.territory || null,
      input.funnelState || "awareness",
      input.autonomyClass || 1,
      JSON.stringify(input.barriers || []),
      JSON.stringify(input.metadata || {}),
      now,
      existing.id,
    );
    return getTerritoryAccount(orgId, userId, existing.id)!;
  }

  db.prepare(
    `INSERT INTO territory_accounts
       (id, org_id, user_id, account_name, hcp_name, specialty, territory,
        funnel_state, autonomy_class, barriers, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    orgId,
    userId,
    input.accountName.trim(),
    input.hcpName || null,
    input.specialty || null,
    input.territory || null,
    input.funnelState || "awareness",
    input.autonomyClass || 1,
    JSON.stringify(input.barriers || []),
    JSON.stringify(input.metadata || {}),
    now,
    now,
  );

  return getTerritoryAccount(orgId, userId, id)!;
}

export function getTerritoryAccount(
  orgId: string,
  userId: string,
  accountId: string,
): TerritoryAccountRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM territory_accounts WHERE org_id = ? AND user_id = ? AND id = ?`)
    .get(orgId, userId, accountId) as any;
  return row ? decodeTerritoryRow(row) : null;
}

export function getTerritoryAccounts(orgId: string, userId: string): TerritoryAccountRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM territory_accounts WHERE org_id = ? AND user_id = ? ORDER BY priority_score DESC NULLS LAST, account_name`,
    )
    .all(orgId, userId) as any[];
  return rows.map(decodeTerritoryRow);
}

export function updateTerritoryAccount(
  orgId: string,
  userId: string,
  accountId: string,
  updates: Partial<{
    funnelState: string;
    autonomyClass: number;
    lastVisit: string;
    lastInteraction: string;
    barriers: string[];
    priorityScore: number;
    metadata: Record<string, any>;
  }>,
): TerritoryAccountRow | null {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];

  if (updates.funnelState !== undefined) { sets.push("funnel_state = ?"); params.push(updates.funnelState); }
  if (updates.autonomyClass !== undefined) { sets.push("autonomy_class = ?"); params.push(updates.autonomyClass); }
  if (updates.lastVisit !== undefined) { sets.push("last_visit = ?"); params.push(updates.lastVisit); }
  if (updates.lastInteraction !== undefined) { sets.push("last_interaction = ?"); params.push(updates.lastInteraction); }
  if (updates.barriers !== undefined) { sets.push("barriers = ?"); params.push(JSON.stringify(updates.barriers)); }
  if (updates.priorityScore !== undefined) { sets.push("priority_score = ?"); params.push(updates.priorityScore); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(updates.metadata)); }

  if (sets.length === 0) return getTerritoryAccount(orgId, userId, accountId);
  sets.push("updated_at = datetime('now')");
  params.push(orgId, userId, accountId);

  db.prepare(
    `UPDATE territory_accounts SET ${sets.join(", ")} WHERE org_id = ? AND user_id = ? AND id = ?`,
  ).run(...params);

  return getTerritoryAccount(orgId, userId, accountId);
}

export function deleteTerritoryAccount(orgId: string, userId: string, accountId: string): boolean {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM territory_accounts WHERE org_id = ? AND user_id = ? AND id = ?`)
    .run(orgId, userId, accountId);
  return info.changes > 0;
}

// ─── Field Routes ──────────────────────────────────────────────────────

export interface FieldRouteRow {
  id: string;
  orgId: string;
  userId: string;
  date: string;
  stops: Array<{ accountId: string; order: number; plannedTime?: string }>;
  status: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export function createFieldRoute(
  orgId: string,
  userId: string,
  input: { date: string; stops?: Array<{ accountId: string; order: number; plannedTime?: string }> },
): FieldRouteRow {
  const db = getDb();
  const id = randomUUID();
  const stops = input.stops || [];

  if (!input.date) throw new Error("date is required");

  db.prepare(
    `INSERT INTO field_routes (id, org_id, user_id, date, stops, status, metadata)
     VALUES (?, ?, ?, ?, ?, 'planned', '{}')`,
  ).run(id, orgId, userId, input.date, JSON.stringify(stops));

  return getFieldRoute(orgId, userId, id)!;
}

export function getFieldRoute(orgId: string, userId: string, routeId: string): FieldRouteRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM field_routes WHERE org_id = ? AND user_id = ? AND id = ?`)
    .get(orgId, userId, routeId) as any;
  return row ? decodeRouteRow(row) : null;
}

export function getFieldRoutes(orgId: string, userId: string, date?: string): FieldRouteRow[] {
  const db = getDb();
  let sql = `SELECT * FROM field_routes WHERE org_id = ? AND user_id = ?`;
  const params: any[] = [orgId, userId];
  if (date) { sql += ` AND date = ?`; params.push(date); }
  sql += ` ORDER BY date DESC`;
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(decodeRouteRow);
}

export function updateFieldRouteStatus(
  orgId: string,
  userId: string,
  routeId: string,
  status: string,
): FieldRouteRow | null {
  const db = getDb();
  const valid = ["planned", "active", "completed"];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  db.prepare(
    `UPDATE field_routes SET status = ?, updated_at = datetime('now') WHERE org_id = ? AND user_id = ? AND id = ?`,
  ).run(status, orgId, userId, routeId);
  return getFieldRoute(orgId, userId, routeId);
}

// ─── Decoders ──────────────────────────────────────────────────────────

function decodePhoneRow(row: any): PhoneRecordRow {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    phoneNumber: row.phone_number,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeEventRow(row: any): PhoneEventRow {
  return {
    id: row.id,
    phoneId: row.phone_id,
    timestamp: row.timestamp,
    type: row.type,
    direction: row.direction,
    durationSec: row.duration_sec,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function decodeTerritoryRow(row: any): TerritoryAccountRow {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    accountName: row.account_name,
    hcpName: row.hcp_name,
    specialty: row.specialty,
    territory: row.territory,
    funnelState: row.funnel_state,
    autonomyClass: row.autonomy_class,
    lastVisit: row.last_visit,
    lastInteraction: row.last_interaction,
    barriers: row.barriers ? JSON.parse(row.barriers) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    priorityScore: row.priority_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeRouteRow(row: any): FieldRouteRow {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    date: row.date,
    stops: row.stops ? JSON.parse(row.stops) : [],
    status: row.status,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
