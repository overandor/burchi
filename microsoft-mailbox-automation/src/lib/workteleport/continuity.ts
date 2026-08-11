/**
 * ClientContinuity — Identity, Relationship, Authority Resolution
 *
 * Determines who is communicating, their relationship to the user,
 * their authority level, and who should be the proper speaker.
 *
 * This is the first stage of the Email-to-Execution Compiler.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  ClientContinuityRecord,
  RelationshipType,
  AuthorityLevel,
  IntentType,
  CommunicationSummary,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface ContinuityRow {
  id: string;
  org_id: string;
  person_id: string;
  person_name: string;
  relationship: string;
  authority_level: string;
  communication_history: string;
  active_commitments: string;
  escalation_boundaries: string;
  preferred_speaker: string;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ContinuityRow): ClientContinuityRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    personId: row.person_id,
    personName: row.person_name,
    relationshipToUser: row.relationship as RelationshipType,
    authorityLevel: row.authority_level as AuthorityLevel,
    communicationHistory: JSON.parse(row.communication_history),
    activeCommitments: JSON.parse(row.active_commitments),
    escalationBoundaries: JSON.parse(row.escalation_boundaries),
    preferredSpeaker: row.preferred_speaker as "human" | "llm_assisted" | "system",
    lastInteractionAt: row.last_interaction_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Authority inference ───────────────────────────────────────────────

/**
 * Infer authority level from email domain and sender patterns.
 * External domains get "none" or "informational".
 * Internal domains get higher authority based on patterns.
 */
export function inferAuthority(
  senderEmail: string,
  recipientEmail: string,
  orgDomain: string,
): AuthorityLevel {
  const senderDomain = senderEmail.split("@")[1] || "";
  const isInternal = senderDomain === orgDomain;

  if (!isInternal) {
    // External senders have no authority unless explicitly granted
    return "none";
  }

  // Check for manager/director patterns
  const senderLocal = senderEmail.split("@")[0].toLowerCase();
  if (
    senderLocal.includes("director") ||
    senderLocal.includes("manager") ||
    senderLocal.includes("vp") ||
    senderLocal.includes("head")
  ) {
    return "assign";
  }

  // Same domain but no management pattern
  return "request";
}

/**
 * Infer relationship type from sender/recipient comparison.
 */
export function inferRelationship(
  senderEmail: string,
  recipientEmail: string,
  orgDomain: string,
): RelationshipType {
  const senderDomain = senderEmail.split("@")[1] || "";
  const isInternal = senderDomain === orgDomain;

  if (!isInternal) {
    if (senderEmail.includes("noreply") || senderEmail.includes("notification")) {
      return "system";
    }
    return "external_client";
  }

  // Internal — check if sender is the same as recipient
  if (senderEmail === recipientEmail) {
    return "self";
  }

  // Default internal relationship
  return "peer";
}

/**
 * Infer preferred speaker from communication history.
 * If the person has mostly communicated with humans, prefer human.
 */
export function inferPreferredSpeaker(
  history: CommunicationSummary[],
): "human" | "llm_assisted" | "system" {
  if (history.length === 0) return "human";
  const humanInteractions = history.filter((h) =>
    h.summary.toLowerCase().includes("call") ||
    h.summary.toLowerCase().includes("meeting") ||
    h.summary.toLowerCase().includes("in person"),
  ).length;
  const digitalInteractions = history.length - humanInteractions;
  if (humanInteractions > digitalInteractions * 2) return "human";
  if (digitalInteractions > humanInteractions * 3) return "llm_assisted";
  return "human";
}

// ─── Public API ────────────────────────────────────────────────────────

export interface UpsertContinuityInput {
  orgId: string;
  personId: string;
  personName: string;
  relationship?: RelationshipType;
  authorityLevel?: AuthorityLevel;
  escalationBoundaries?: string[];
  preferredSpeaker?: "human" | "llm_assisted" | "system";
}

/**
 * Create or update a ClientContinuity record.
 */
export function upsertContinuity(
  input: UpsertContinuityInput,
): ClientContinuityRecord {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM client_continuity WHERE org_id = ? AND person_id = ?`,
    )
    .get(input.orgId, input.personId) as ContinuityRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE client_continuity SET
        person_name = ?,
        relationship = ?,
        authority_level = ?,
        escalation_boundaries = ?,
        preferred_speaker = ?,
        updated_at = datetime('now')
      WHERE org_id = ? AND person_id = ?`,
    ).run(
      input.personName,
      input.relationship || existing.relationship,
      input.authorityLevel || existing.authority_level,
      JSON.stringify(input.escalationBoundaries || JSON.parse(existing.escalation_boundaries)),
      input.preferredSpeaker || existing.preferred_speaker,
      input.orgId,
      input.personId,
    );
  } else {
    const id = `cc_${nanoid(16)}`;
    db.prepare(
      `INSERT INTO client_continuity (
        id, org_id, person_id, person_name, relationship, authority_level,
        communication_history, active_commitments, escalation_boundaries,
        preferred_speaker, last_interaction_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
    ).run(
      id,
      input.orgId,
      input.personId,
      input.personName,
      input.relationship || "external_client",
      input.authorityLevel || "none",
      JSON.stringify(input.escalationBoundaries || []),
      input.preferredSpeaker || "human",
      new Date().toISOString(),
    );
  }

  return getContinuity(input.orgId, input.personId)!;
}

/**
 * Get a ClientContinuity record.
 */
export function getContinuity(
  orgId: string,
  personId: string,
): ClientContinuityRecord | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM client_continuity WHERE org_id = ? AND person_id = ?`,
    )
    .get(orgId, personId) as ContinuityRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

/**
 * List all continuity records for an org.
 */
export function listContinuity(orgId: string): ClientContinuityRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_continuity WHERE org_id = ? ORDER BY updated_at DESC`,
    )
    .all(orgId) as ContinuityRow[];
  return rows.map(rowToRecord);
}

/**
 * Record a communication event in the continuity history.
 */
export function recordCommunication(
  orgId: string,
  personId: string,
  summary: CommunicationSummary,
): void {
  const record = getContinuity(orgId, personId);
  if (!record) return;

  const history = [...record.communicationHistory, summary].slice(-50); // keep last 50
  getDb()
    .prepare(
      `UPDATE client_continuity SET
        communication_history = ?,
        last_interaction_at = ?,
        updated_at = datetime('now')
      WHERE org_id = ? AND person_id = ?`,
    )
    .run(
      JSON.stringify(history),
      summary.at,
      orgId,
      personId,
    );
}

/**
 * Resolve the proper speaker for a communication.
 * Returns "human" if the user should handle it, "llm_assisted" if the
 * LLM can assist, or "system" if fully automated.
 */
export function resolveSpeaker(
  orgId: string,
  personId: string,
  intent: IntentType,
): "human" | "llm_assisted" | "system" {
  const record = getContinuity(orgId, personId);
  if (!record) return "human";

  // Complaints and escalations always require human
  if (intent === "complaint" || intent === "escalation") return "human";

  // Approvals require human
  if (intent === "approval") return "human";

  // Use the person's preferred speaker for other intents
  return record.preferredSpeaker;
}

/**
 * Check if a sender has authority to make a specific type of request.
 */
export function checkAuthority(
  orgId: string,
  personId: string,
  requiredLevel: AuthorityLevel,
): { authorized: boolean; actualLevel: AuthorityLevel; reason: string } {
  const record = getContinuity(orgId, personId);
  const actualLevel = record?.authorityLevel || "none";

  const hierarchy: AuthorityLevel[] = [
    "none",
    "informational",
    "request",
    "assign",
    "approve",
    "override",
  ];
  const actualIdx = hierarchy.indexOf(actualLevel);
  const requiredIdx = hierarchy.indexOf(requiredLevel);

  return {
    authorized: actualIdx >= requiredIdx,
    actualLevel,
    reason: actualIdx >= requiredIdx
      ? "Sender has sufficient authority"
      : `Sender authority (${actualLevel}) is below required (${requiredLevel})`,
  };
}

/**
 * Count continuity records for health check.
 */
export function countContinuity(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM client_continuity WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}
