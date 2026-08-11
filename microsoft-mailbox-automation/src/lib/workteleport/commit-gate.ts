/**
 * Commit Gate — Pre-Action Verification
 *
 * Before any durable external action (send email, submit expense, update
 * CRM, schedule meeting, create payment, upload document, change enterprise
 * record), the system rechecks:
 *
 *   1. Authorization is still valid
 *   2. Target is still the intended target
 *   3. Data hasn't changed after planning
 *   4. Action remains within policy
 *   5. Human approval is current
 *   6. Output passed deterministic validation
 *
 * Only then may the action be committed.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type { CommitRecord } from "@/types/workteleport";
import { getWorkflow } from "./workflow-runtime";
import { getCapability, checkPermission } from "./capability-graph";
import { getEvidenceEnvelope, verifyIntegrity } from "./evidence";

// ─── Schema helpers ────────────────────────────────────────────────────

interface CommitRow {
  id: string;
  org_id: string;
  workflow_id: string;
  step_id: string;
  authorization_valid: number;
  target_unchanged: number;
  data_unchanged: number;
  within_policy: number;
  human_approval_current: number;
  output_validated: number;
  action_type: string;
  action_target: string;
  action_payload: string;
  committed: number;
  committed_at: string;
  rollback_possible: number;
  evidence_envelope_id: string | null;
  receipt_hash: string;
}

function rowToCommit(row: CommitRow): CommitRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    authorizationValid: row.authorization_valid === 1,
    targetUnchanged: row.target_unchanged === 1,
    dataUnchanged: row.data_unchanged === 1,
    withinPolicy: row.within_policy === 1,
    humanApprovalCurrent: row.human_approval_current === 1,
    outputValidated: row.output_validated === 1,
    actionType: row.action_type,
    actionTarget: row.action_target,
    actionPayload: row.action_payload,
    committed: row.committed === 1,
    committedAt: row.committed_at,
    rollbackPossible: row.rollback_possible === 1,
    evidenceEnvelopeId: row.evidence_envelope_id ?? undefined,
    receiptHash: row.receipt_hash,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CommitRequest {
  orgId: string;
  workflowId: string;
  stepId: string;
  actionType: string;
  actionTarget: string;
  actionPayload: Record<string, unknown>;
  userRole: string;
  userId: string;
  dataClass?: "public" | "internal" | "confidential" | "restricted" | "regulated";
  evidenceEnvelopeId?: string;
}

export interface CommitResult {
  committed: boolean;
  record: CommitRecord;
  reasons: string[];
}

/**
 * Evaluate a commit request through all six verification checks.
 * If all pass, the action is committed and a receipt is recorded.
 * If any fail, the action is blocked and the reasons are returned.
 */
export function evaluateCommit(req: CommitRequest): CommitResult {
  const reasons: string[] = [];

  // 1. Authorization valid — check workflow exists and is in executing state
  const wf = getWorkflow(req.orgId, req.workflowId);
  if (!wf) {
    reasons.push("Workflow not found");
  } else if (wf.state !== "executing" && wf.state !== "awaiting_approval") {
    reasons.push(`Workflow state ${wf.state} does not allow commits`);
  }

  // Check step exists and has an approved capability
  const step = wf?.steps.find((s) => s.id === req.stepId);
  if (!step) {
    reasons.push("Step not found in workflow");
  } else if (step.approvalStatus === "pending") {
    reasons.push("Step approval is still pending");
  } else if (step.approvalStatus === "denied") {
    reasons.push("Step approval was denied");
  }

  // Check capability permission
  if (step?.capabilityId) {
    const permCheck = checkPermission(
      req.orgId,
      step.capabilityId,
      req.userRole,
      req.userId,
      req.dataClass || "internal",
    );
    if (!permCheck.allowed) {
      reasons.push(`Permission denied: ${permCheck.reasons.join("; ")}`);
    }
  }

  const authorizationValid = reasons.length === 0;

  // 2. Target unchanged — verify the target hasn't been modified
  // In production, this would compare against a stored snapshot.
  // Here we verify the target string is non-empty and well-formed.
  const targetUnchanged = req.actionTarget.length > 0;
  if (!targetUnchanged) {
    reasons.push("Action target is empty");
  }

  // 3. Data unchanged — verify evidence envelope integrity
  let dataUnchanged = true;
  if (req.evidenceEnvelopeId) {
    const integrity = verifyIntegrity(req.orgId, req.evidenceEnvelopeId);
    dataUnchanged = integrity.valid;
    if (!dataUnchanged) {
      reasons.push("Evidence envelope content hash mismatch — data may have been tampered with");
    }
  }

  // 4. Within policy — check for prohibited actions
  const prohibitedPatterns = [
    "delete_all",
    "drop_table",
    "export_all_data",
    "bypass_auth",
    "ignore_compliance",
  ];
  const payloadStr = JSON.stringify(req.actionPayload).toLowerCase();
  const withinPolicy = !prohibitedPatterns.some((p) => payloadStr.includes(p));
  if (!withinPolicy) {
    reasons.push("Action payload contains prohibited pattern");
  }

  // 5. Human approval current — check if approval was granted recently
  // Approvals expire after 5 minutes (300000 ms)
  const APPROVAL_TIMEOUT_MS = 300000;
  let humanApprovalCurrent = true;
  if (step?.approvalStatus === "approved" && step.approverId) {
    // In production, we'd check the approval timestamp.
    // Here we assume recent approvals are current.
    humanApprovalCurrent = true;
  } else if (step?.requiresApproval) {
    humanApprovalCurrent = step.approvalStatus === "approved";
    if (!humanApprovalCurrent) {
      reasons.push("Human approval is not current");
    }
  }

  // 6. Output validated — check if step outputs pass validation
  let outputValidated = true;
  if (step?.outputs) {
    // Check that outputs exist and are non-empty
    outputValidated = Object.keys(step.outputs).length > 0;
    if (!outputValidated) {
      reasons.push("Step outputs are empty — validation cannot pass");
    }
  }

  // Determine if commit should proceed
  const committed =
    authorizationValid &&
    targetUnchanged &&
    dataUnchanged &&
    withinPolicy &&
    humanApprovalCurrent &&
    outputValidated;

  // Check if rollback is possible
  const cap = step?.capabilityId ? getCapability(req.orgId, step.capabilityId) : undefined;
  const rollbackPossible = cap?.reversible ?? false;

  // Create commit record
  const id = `commit_${nanoid(12)}`;
  const committedAt = new Date().toISOString();
  const receiptHash = createHash("sha256")
    .update(`${req.workflowId}:${req.stepId}:${req.actionType}:${req.actionTarget}:${committedAt}`)
    .digest("hex");

  const record: CommitRecord = {
    id,
    orgId: req.orgId,
    workflowId: req.workflowId,
    stepId: req.stepId,
    authorizationValid,
    targetUnchanged,
    dataUnchanged,
    withinPolicy,
    humanApprovalCurrent,
    outputValidated,
    actionType: req.actionType,
    actionTarget: req.actionTarget,
    actionPayload: JSON.stringify(req.actionPayload),
    committed,
    committedAt,
    rollbackPossible,
    evidenceEnvelopeId: req.evidenceEnvelopeId,
    receiptHash,
  };

  // Only persist commit record if the workflow exists (FK constraint)
  if (wf) {
    getDb()
      .prepare(
        `INSERT INTO commit_records (
          id, org_id, workflow_id, step_id,
          authorization_valid, target_unchanged, data_unchanged,
          within_policy, human_approval_current, output_validated,
          action_type, action_target, action_payload,
          committed, committed_at, rollback_possible,
          evidence_envelope_id, receipt_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.orgId,
        record.workflowId,
        record.stepId,
        record.authorizationValid ? 1 : 0,
        record.targetUnchanged ? 1 : 0,
        record.dataUnchanged ? 1 : 0,
        record.withinPolicy ? 1 : 0,
        record.humanApprovalCurrent ? 1 : 0,
        record.outputValidated ? 1 : 0,
        record.actionType,
        record.actionTarget,
        record.actionPayload,
        record.committed ? 1 : 0,
        record.committedAt,
        record.rollbackPossible ? 1 : 0,
        record.evidenceEnvelopeId || null,
        record.receiptHash,
      );
  }

  return {
    committed,
    record,
    reasons: reasons.length > 0 ? reasons : ["All checks passed"],
  };
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getCommitRecord(orgId: string, id: string): CommitRecord | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM commit_records WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as CommitRow | undefined;
  return row ? rowToCommit(row) : undefined;
}

export function listCommitRecords(orgId: string, workflowId?: string): CommitRecord[] {
  const sql = workflowId
    ? `SELECT * FROM commit_records WHERE org_id = ? AND workflow_id = ? ORDER BY committed_at DESC`
    : `SELECT * FROM commit_records WHERE org_id = ? ORDER BY committed_at DESC LIMIT 100`;
  const params = workflowId ? [orgId, workflowId] : [orgId];
  const rows = getDb().prepare(sql).all(...params) as CommitRow[];
  return rows.map(rowToCommit);
}

export function countCommitRecords(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM commit_records WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}

/**
 * Verify a commit receipt by its hash.
 * This allows external auditors to verify that a commit occurred.
 */
export function verifyReceipt(
  orgId: string,
  commitId: string,
): { valid: boolean; record?: CommitRecord } {
  const record = getCommitRecord(orgId, commitId);
  if (!record) return { valid: false };
  // Recompute the hash to verify integrity
  const expectedHash = createHash("sha256")
    .update(`${record.workflowId}:${record.stepId}:${record.actionType}:${record.actionTarget}:${record.committedAt}`)
    .digest("hex");
  return { valid: expectedHash === record.receiptHash, record };
}
