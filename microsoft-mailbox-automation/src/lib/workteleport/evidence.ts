/**
 * Evidence Envelope — Universal Input Layer
 *
 * Converts any incoming signal (email, attachment, voice, calendar, CRM,
 * transaction, etc.) into a structured Evidence Envelope that preserves
 * the original content while allowing LLM interpretation separately.
 *
 * The original content is NEVER modified by the LLM. Interpretations are
 * stored in a separate field and linked by provenance.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  EvidenceEnvelope,
  EvidenceSource,
  ConfidentialityClass,
  EvidenceAttachment,
  ExtractedEntity,
  FactualClaim,
  EvidenceInterpretation,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface EvidenceRow {
  id: string;
  org_id: string;
  user_id: string;
  source: string;
  source_identifier: string;
  sender: string;
  recipient: string;
  received_at: string;
  original_content: string;
  content_hash: string;
  attachments: string;
  extracted_entities: string;
  factual_claims: string;
  requested_work: string | null;
  deadlines: string;
  confidentiality_class: string;
  permitted_uses: string;
  retention_rule: string;
  llm_interpretation: string | null;
  created_at: string;
}

function rowToEnvelope(row: EvidenceRow): EvidenceEnvelope {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    source: row.source as EvidenceSource,
    sourceIdentifier: row.source_identifier,
    sender: row.sender,
    recipient: row.recipient,
    receivedAt: row.received_at,
    originalContent: row.original_content,
    contentHash: row.content_hash,
    attachments: JSON.parse(row.attachments),
    extractedEntities: JSON.parse(row.extracted_entities),
    factualClaims: JSON.parse(row.factual_claims),
    requestedWork: row.requested_work,
    deadlines: JSON.parse(row.deadlines),
    confidentialityClass: row.confidentiality_class as ConfidentialityClass,
    permittedUses: JSON.parse(row.permitted_uses),
    retentionRule: row.retention_rule,
    llmInterpretation: row.llm_interpretation
      ? JSON.parse(row.llm_interpretation)
      : undefined,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CreateEvidenceInput {
  orgId: string;
  userId: string;
  source: EvidenceSource;
  sourceIdentifier: string;
  sender: string;
  recipient: string;
  originalContent: string;
  attachments?: EvidenceAttachment[];
  extractedEntities?: ExtractedEntity[];
  factualClaims?: FactualClaim[];
  requestedWork?: string | null;
  deadlines?: string[];
  confidentialityClass?: ConfidentialityClass;
  permittedUses?: string[];
  retentionRule?: string;
  llmInterpretation?: EvidenceInterpretation;
}

/**
 * Create and persist an Evidence Envelope.
 * The content hash is computed from the original content to ensure
 * provenance integrity. The original content is never modified.
 */
export function createEvidenceEnvelope(
  input: CreateEvidenceInput,
): EvidenceEnvelope {
  const id = `ev_${nanoid(16)}`;
  const contentHash = createHash("sha256")
    .update(input.originalContent)
    .digest("hex");
  const receivedAt = new Date().toISOString();

  const envelope: EvidenceEnvelope = {
    id,
    orgId: input.orgId,
    userId: input.userId,
    source: input.source,
    sourceIdentifier: input.sourceIdentifier,
    sender: input.sender,
    recipient: input.recipient,
    receivedAt,
    originalContent: input.originalContent,
    contentHash,
    attachments: input.attachments || [],
    extractedEntities: input.extractedEntities || [],
    factualClaims: input.factualClaims || [],
    requestedWork: input.requestedWork || null,
    deadlines: input.deadlines || [],
    confidentialityClass: input.confidentialityClass || "internal",
    permittedUses: input.permittedUses || ["task_execution"],
    retentionRule: input.retentionRule || "30d",
    llmInterpretation: input.llmInterpretation,
  };

  getDb()
    .prepare(
      `INSERT INTO evidence_envelopes (
        id, org_id, user_id, source, source_identifier, sender, recipient,
        received_at, original_content, content_hash, attachments,
        extracted_entities, factual_claims, requested_work, deadlines,
        confidentiality_class, permitted_uses, retention_rule,
        llm_interpretation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      envelope.id,
      envelope.orgId,
      envelope.userId,
      envelope.source,
      envelope.sourceIdentifier,
      envelope.sender,
      envelope.recipient,
      envelope.receivedAt,
      envelope.originalContent,
      envelope.contentHash,
      JSON.stringify(envelope.attachments),
      JSON.stringify(envelope.extractedEntities),
      JSON.stringify(envelope.factualClaims),
      envelope.requestedWork,
      JSON.stringify(envelope.deadlines),
      envelope.confidentialityClass,
      JSON.stringify(envelope.permittedUses),
      envelope.retentionRule,
      envelope.llmInterpretation
        ? JSON.stringify(envelope.llmInterpretation)
        : null,
    );

  return envelope;
}

/**
 * Retrieve an Evidence Envelope by ID.
 */
export function getEvidenceEnvelope(
  orgId: string,
  id: string,
): EvidenceEnvelope | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM evidence_envelopes WHERE org_id = ? AND id = ?`,
    )
    .get(orgId, id) as EvidenceRow | undefined;
  return row ? rowToEnvelope(row) : undefined;
}

/**
 * List Evidence Envelopes for an org, optionally filtered by user.
 */
export function listEvidenceEnvelopes(
  orgId: string,
  userId?: string,
  limit: number = 50,
): EvidenceEnvelope[] {
  const sql = userId
    ? `SELECT * FROM evidence_envelopes WHERE org_id = ? AND user_id = ? ORDER BY received_at DESC LIMIT ?`
    : `SELECT * FROM evidence_envelopes WHERE org_id = ? ORDER BY received_at DESC LIMIT ?`;
  const params = userId ? [orgId, userId, limit] : [orgId, limit];
  const rows = getDb().prepare(sql).all(...params) as EvidenceRow[];
  return rows.map(rowToEnvelope);
}

/**
 * Attach an LLM interpretation to an existing Evidence Envelope.
 * The original content is never modified — only the interpretation field.
 */
export function attachInterpretation(
  orgId: string,
  envelopeId: string,
  interpretation: EvidenceInterpretation,
): void {
  getDb()
    .prepare(
      `UPDATE evidence_envelopes SET llm_interpretation = ? WHERE org_id = ? AND id = ?`,
    )
    .run(JSON.stringify(interpretation), orgId, envelopeId);
}

/**
 * Verify that an Evidence Envelope's content has not been tampered with.
 * Recomputes the hash and compares it to the stored hash.
 */
export function verifyIntegrity(
  orgId: string,
  envelopeId: string,
): { valid: boolean; expectedHash: string; actualHash: string } {
  const envelope = getEvidenceEnvelope(orgId, envelopeId);
  if (!envelope) {
    return { valid: false, expectedHash: "", actualHash: "" };
  }
  const actualHash = createHash("sha256")
    .update(envelope.originalContent)
    .digest("hex");
  return {
    valid: actualHash === envelope.contentHash,
    expectedHash: envelope.contentHash,
    actualHash,
  };
}

/**
 * Count evidence envelopes for health check.
 */
export function countEvidenceEnvelopes(orgId: string): number {
  const row = getDb()
    .prepare(
      `SELECT count(*) as c FROM evidence_envelopes WHERE org_id = ?`,
    )
    .get(orgId) as { c: number };
  return row.c;
}
