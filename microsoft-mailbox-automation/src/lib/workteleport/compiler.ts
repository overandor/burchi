/**
 * Task IR Compiler — Email-to-Execution Pipeline
 *
 * Converts an Evidence Envelope into a machine-readable Task IR through
 * seven controlled stages:
 *
 *   1. Communication understanding (ClientContinuity)
 *   2. Request decomposition (typed tasks)
 *   3. Role Operating Contract (authority resolution)
 *   4. Task Intermediate Representation (machine-readable)
 *   5. Capability planning (select safest execution method)
 *   6. Durable execution (workflow runtime)
 *   7. Commit verification (pre-action recheck)
 *
 * Stages 1-4 are implemented here. Stage 5 is in capability-graph.ts.
 * Stage 6 is in workflow-runtime.ts. Stage 7 is in commit-gate.ts.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { getEvidenceEnvelope } from "./evidence";
import {
  getContinuity,
  upsertContinuity,
  inferAuthority,
  inferRelationship,
  inferPreferredSpeaker,
  checkAuthority,
  recordCommunication,
} from "./continuity";
import type {
  TaskIR,
  TaskType,
  TaskStatus,
  TaskInput,
  TaskOutput,
  TaskConstraint,
  ApprovalBoundary,
  CompletionTest,
  RollbackStep,
  IntentType,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface TaskIRRow {
  id: string;
  org_id: string;
  user_id: string;
  evidence_envelope_id: string;
  parent_task_id: string | null;
  objective: string;
  task_type: string;
  inputs: string;
  required_outputs: string;
  constraints: string;
  dependencies: string;
  evidence_requirements: string;
  permitted_tools: string;
  approval_boundary: string;
  failure_conditions: string;
  completion_tests: string;
  rollback_plan: string;
  status: string;
  created_at: string;
  authorized_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
}

function rowToTaskIR(row: TaskIRRow): TaskIR {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    evidenceEnvelopeId: row.evidence_envelope_id,
    parentTaskId: row.parent_task_id || undefined,
    objective: row.objective,
    taskType: row.task_type as TaskType,
    inputs: JSON.parse(row.inputs),
    requiredOutputs: JSON.parse(row.required_outputs),
    constraints: JSON.parse(row.constraints),
    dependencies: JSON.parse(row.dependencies),
    evidenceRequirements: JSON.parse(row.evidence_requirements),
    permittedTools: JSON.parse(row.permitted_tools),
    approvalBoundary: JSON.parse(row.approval_boundary),
    failureConditions: JSON.parse(row.failure_conditions),
    completionTests: JSON.parse(row.completion_tests),
    rollbackPlan: JSON.parse(row.rollback_plan),
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    authorizedAt: row.authorized_at || undefined,
    executedAt: row.executed_at || undefined,
    completedAt: row.completed_at || undefined,
  };
}

// ─── Stage 1: Communication Understanding ──────────────────────────────

export interface CommunicationUnderstanding {
  senderId: string;
  senderName: string;
  relationship: string;
  authorityLevel: string;
  intentTypes: IntentType[];
  properSpeaker: "human" | "llm_assisted" | "system";
  identityContinuityRequired: boolean;
}

/**
 * Stage 1: Understand the communication.
 * Determines who sent it, their relationship, authority, and intent.
 */
export function understandCommunication(
  orgId: string,
  userId: string,
  senderEmail: string,
  senderName: string,
  orgDomain: string,
  content: string,
): CommunicationUnderstanding {
  const relationship = inferRelationship(senderEmail, userId, orgDomain);
  const authorityLevel = inferAuthority(senderEmail, userId, orgDomain);

  // Ensure continuity record exists
  let record = getContinuity(orgId, senderEmail);
  if (!record) {
    record = upsertContinuity({
      orgId,
      personId: senderEmail,
      personName: senderName,
      relationship,
      authorityLevel,
    });
  }

  // Classify intent from content
  const intentTypes = classifyIntent(content);

  // Resolve proper speaker
  const primaryIntent = intentTypes[0] || "informational";
  const properSpeaker = inferPreferredSpeaker(record.communicationHistory);

  // Record this communication
  recordCommunication(orgId, senderEmail, {
    at: new Date().toISOString(),
    direction: "inbound",
    channel: "email",
    summary: content.substring(0, 200),
    intent: primaryIntent,
  });

  return {
    senderId: senderEmail,
    senderName,
    relationship,
    authorityLevel,
    intentTypes,
    properSpeaker,
    identityContinuityRequired: relationship !== "system",
  };
}

/**
 * Classify intent from message content using keyword patterns.
 */
export function classifyIntent(content: string): IntentType[] {
  const lower = content.toLowerCase();
  const intents: IntentType[] = [];

  if (lower.match(/\bplease (do|create|make|build|generate|send|update|fix|prepare|compile|reconcile|research|find|look|analyze|review|check|provide|submit|schedule|arrange|set up)\b/)) {
    intents.push("request");
  }
  if (lower.match(/\bwhat|why|how|when|where|who\b/) && !intents.includes("request")) {
    intents.push("question");
  }
  if (lower.match(/\bi will|i'll|commit|promise|guarantee\b/)) {
    intents.push("commitment");
  }
  if (lower.match(/\bcomplaint|unhappy|dissatisfied|unacceptable|broken|wrong\b/)) {
    intents.push("complaint");
  }
  if (lower.match(/\byou must|required|mandatory|do this|ensure that\b/)) {
    intents.push("instruction");
  }
  if (lower.match(/\bfyi|for your information|heads up|noted|update\b/) && intents.length === 0) {
    intents.push("informational");
  }
  if (lower.match(/\bapprove|approved|sign off|authorized\b/)) {
    intents.push("approval");
  }
  if (lower.match(/\bescalat|urgent|critical|asap|immediately\b/)) {
    intents.push("escalation");
  }
  if (lower.match(/\btest|experiment|hypothesis|trial\b/)) {
    intents.push("experiment");
  }

  return intents.length > 0 ? intents : ["informational"];
}

// ─── Stage 2: Request Decomposition ────────────────────────────────────

export interface DecomposedTask {
  objective: string;
  taskType: TaskType;
  inputs: TaskInput[];
  requiredOutputs: TaskOutput[];
  dependencies: string[]; // indices of other decomposed tasks
}

/**
 * Stage 2: Decompose a request into typed tasks.
 * Uses keyword matching to identify task types and their dependencies.
 */
export function decomposeRequest(
  content: string,
  attachments: { filename: string; mimeType: string }[],
): DecomposedTask[] {
  const lower = content.toLowerCase();
  const tasks: DecomposedTask[] = [];

  // Receipt/expense reconciliation
  if (lower.match(/\breconcile|expense|receipt|travel\b/) || attachments.some((a) => a.mimeType.includes("pdf") || a.filename.match(/receipt|invoice/i))) {
    tasks.push({
      objective: "Parse and extract data from attachments",
      taskType: "research",
      inputs: [{
        name: "attachments",
        type: "file",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "parsed_data",
        type: "record",
        validationRules: ["all_fields_present", "amounts_numeric"],
      }],
      dependencies: [],
    });

    tasks.push({
      objective: "Match receipts to transactions and apply expense policy",
      taskType: "reconcile",
      inputs: [{
        name: "parsed_data",
        type: "record",
        source: "task:0",
        required: true,
      }],
      requiredOutputs: [{
        name: "reconciled_report",
        type: "report",
        validationRules: ["all_transactions_matched", "policy_compliant"],
      }],
      dependencies: ["0"],
    });

    tasks.push({
      objective: "Create or update expense report with exceptions",
      taskType: "create",
      inputs: [{
        name: "reconciled_report",
        type: "report",
        source: "task:1",
        required: true,
      }],
      requiredOutputs: [{
        name: "expense_report",
        type: "document",
        validationRules: ["format_compliant", "totals_match"],
      }],
      dependencies: ["1"],
    });
  }

  // CSV/data enrichment
  if (attachments.some((a) => a.filename.endsWith(".csv") || a.mimeType.includes("csv"))) {
    tasks.push({
      objective: "Detect schema and profile data quality",
      taskType: "research",
      inputs: [{
        name: "csv_file",
        type: "file",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "schema_profile",
        type: "record",
        validationRules: ["columns_identified", "row_count_verified"],
      }],
      dependencies: [],
    });

    tasks.push({
      objective: "Enrich and optimize data per request",
      taskType: "enrich",
      inputs: [{
        name: "schema_profile",
        type: "record",
        source: "task:0",
        required: true,
      }],
      requiredOutputs: [{
        name: "enriched_data",
        type: "file",
        validationRules: ["no_data_loss", "enrichment_verified"],
      }],
      dependencies: ["0"],
    });
  }

  // Research task
  if (lower.match(/\bresearch|investigate|analyze|find out|look into\b/)) {
    tasks.push({
      objective: "Conduct research and produce findings report",
      taskType: "research",
      inputs: [{
        name: "research_query",
        type: "evidence",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "research_report",
        type: "report",
        validationRules: ["sources_cited", "claims_supported"],
      }],
      dependencies: [],
    });
  }

  // Meeting/scheduling
  if (lower.match(/\bschedule|meeting|calendar|appointment\b/)) {
    tasks.push({
      objective: "Schedule meeting and send invitations",
      taskType: "schedule",
      inputs: [{
        name: "meeting_details",
        type: "evidence",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "calendar_event",
        type: "record",
        validationRules: ["time_conflict_checked", "attendees_notified"],
      }],
      dependencies: [],
    });
  }

  // Communication
  if (lower.match(/\bsend|reply|respond|notify|inform\b/)) {
    tasks.push({
      objective: "Draft and send communication",
      taskType: "communicate",
      inputs: [{
        name: "message_context",
        type: "evidence",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "sent_message",
        type: "message",
        validationRules: ["recipient_verified", "content_approved"],
      }],
      dependencies: [],
    });
  }

  // Fallback: generic task
  if (tasks.length === 0) {
    tasks.push({
      objective: "Process the incoming request",
      taskType: "research",
      inputs: [{
        name: "request_content",
        type: "evidence",
        source: "evidence_envelope",
        required: true,
      }],
      requiredOutputs: [{
        name: "response",
        type: "document",
        validationRules: ["request_addressed"],
      }],
      dependencies: [],
    });
  }

  return tasks;
}

// ─── Stage 3: Role Operating Contract ──────────────────────────────────

export interface RoleOperatingContract {
  employeeResponsibilities: string[];
  requesterPermitted: boolean;
  accessibleData: string[];
  allowedExternalEffects: string[];
  actionsRequiringApproval: string[];
  monetaryThreshold: number;
  prohibitedActions: string[];
  segregationOfDutiesRequired: boolean;
}

/**
 * Stage 3: Resolve the Role Operating Contract.
 * Determines what the employee is responsible for, what the requester
 * is permitted to request, and what data/actions are allowed.
 */
export function resolveRoleContract(
  orgId: string,
  senderId: string,
  taskType: TaskType,
  understanding: CommunicationUnderstanding,
): RoleOperatingContract {
  const authorityCheck = checkAuthority(orgId, senderId, "request");

  // Determine if monetary actions require approval
  const monetaryActions: TaskType[] = ["submit", "approve"];
  const requiresApproval = monetaryActions.includes(taskType);

  // Determine prohibited actions based on authority
  const prohibitedActions: string[] = [];
  if (!authorityCheck.authorized) {
    prohibitedActions.push("execute_external_action");
    prohibitedActions.push("access_confidential_data");
  }

  // Segregation of duties for financial tasks
  const financialTasks: TaskType[] = ["submit", "approve", "reconcile"];
  const segregationRequired = financialTasks.includes(taskType);

  return {
    employeeResponsibilities: [
      "Execute assigned task within authority boundaries",
      "Preserve evidence of all actions taken",
      "Escalate when authority is insufficient",
      "Do not invent business purposes or clinical claims",
    ],
    requesterPermitted: authorityCheck.authorized,
    accessibleData: authorityCheck.authorized
      ? ["own_records", "public_records", "assigned_tasks"]
      : ["public_records"],
    allowedExternalEffects: authorityCheck.authorized
      ? ["send_email", "update_crm", "create_report"]
      : [],
    actionsRequiringApproval: requiresApproval
      ? ["submit_expense", "post_to_ledger", "send_external_communication"]
      : [],
    monetaryThreshold: requiresApproval ? 100 : 0,
    prohibitedActions,
    segregationOfDutiesRequired: segregationRequired,
  };
}

// ─── Stage 4: Task IR Generation ───────────────────────────────────────

/**
 * Stage 4: Convert a decomposed task into a Task IR.
 * This is the machine-readable intermediate representation.
 */
export function createTaskIR(
  orgId: string,
  userId: string,
  evidenceEnvelopeId: string,
  decomposed: DecomposedTask,
  roleContract: RoleOperatingContract,
  parentTaskId?: string,
): TaskIR {
  const id = `task_${nanoid(16)}`;
  const now = new Date().toISOString();

  const constraints: TaskConstraint[] = [
    { type: "compliance", description: "Do not invent business purposes", value: "strict" },
    { type: "policy", description: "Operate within role operating contract", value: "strict" },
  ];
  if (roleContract.monetaryThreshold > 0) {
    constraints.push({
      type: "cost",
      description: "Monetary threshold",
      value: String(roleContract.monetaryThreshold),
    });
  }

  const approvalBoundary: ApprovalBoundary = {
    required: roleContract.actionsRequiringApproval.length > 0,
    approverRole: "manager",
    monetaryThreshold: roleContract.monetaryThreshold,
    irreversibleEffects: roleContract.allowedExternalEffects.includes("post_to_ledger"),
    complianceReviewRequired: roleContract.segregationOfDutiesRequired,
  };

  const failureConditions = [
    "authority_insufficient",
    "data_validation_failed",
    "timeout_exceeded",
    "policy_violation_detected",
    ...roleContract.prohibitedActions.map((a) => `prohibited:${a}`),
  ];

  const completionTests: CompletionTest[] = decomposed.requiredOutputs.map((out) => ({
    name: `validate_${out.name}`,
    test: `output.${out.name} exists and passes validation`,
    expectedResult: "valid",
  }));

  const rollbackPlan: RollbackStep[] = [
    { step: 1, action: "halt_execution", compensation: "no_external_effects_yet" },
    { step: 2, action: "revert_local_changes", compensation: "restore_previous_state" },
    { step: 3, action: "notify_user", compensation: "inform_of_rollback" },
  ];

  const taskIR: TaskIR = {
    id,
    orgId,
    userId,
    evidenceEnvelopeId,
    parentTaskId,
    objective: decomposed.objective,
    taskType: decomposed.taskType,
    inputs: decomposed.inputs,
    requiredOutputs: decomposed.requiredOutputs,
    constraints,
    dependencies: [],
    evidenceRequirements: ["evidence_envelope_linked", "content_hash_verified"],
    permittedTools: [], // populated by capability planner (stage 5)
    approvalBoundary,
    failureConditions,
    completionTests,
    rollbackPlan,
    status: "drafted",
    createdAt: now,
  };

  persistTaskIR(taskIR);
  return taskIR;
}

/**
 * Persist a Task IR to the database.
 */
function persistTaskIR(task: TaskIR): void {
  getDb()
    .prepare(
      `INSERT INTO task_irs (
        id, org_id, user_id, evidence_envelope_id, parent_task_id,
        objective, task_type, inputs, required_outputs, constraints,
        dependencies, evidence_requirements, permitted_tools,
        approval_boundary, failure_conditions, completion_tests,
        rollback_plan, status, created_at, authorized_at, executed_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.orgId,
      task.userId,
      task.evidenceEnvelopeId,
      task.parentTaskId || null,
      task.objective,
      task.taskType,
      JSON.stringify(task.inputs),
      JSON.stringify(task.requiredOutputs),
      JSON.stringify(task.constraints),
      JSON.stringify(task.dependencies),
      JSON.stringify(task.evidenceRequirements),
      JSON.stringify(task.permittedTools),
      JSON.stringify(task.approvalBoundary),
      JSON.stringify(task.failureConditions),
      JSON.stringify(task.completionTests),
      JSON.stringify(task.rollbackPlan),
      task.status,
      task.createdAt,
      task.authorizedAt || null,
      task.executedAt || null,
      task.completedAt || null,
    );
}

/**
 * Update a Task IR's status.
 */
export function updateTaskIRStatus(
  orgId: string,
  taskId: string,
  status: TaskStatus,
): void {
  const updates: string[] = [`status = ?`];
  const params: (string | null)[] = [status];

  if (status === "authorized") {
    updates.push("authorized_at = datetime('now')");
  } else if (status === "executing") {
    updates.push("executed_at = datetime('now')");
  } else if (status === "completed") {
    updates.push("completed_at = datetime('now')");
  }

  getDb()
    .prepare(
      `UPDATE task_irs SET ${updates.join(", ")} WHERE org_id = ? AND id = ?`,
    )
    .run(...params, orgId, taskId);
}

/**
 * Update permitted tools for a Task IR (set by capability planner).
 */
export function setPermittedTools(
  orgId: string,
  taskId: string,
  toolIds: string[],
): void {
  getDb()
    .prepare(
      `UPDATE task_irs SET permitted_tools = ? WHERE org_id = ? AND id = ?`,
    )
    .run(JSON.stringify(toolIds), orgId, taskId);
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getTaskIR(orgId: string, id: string): TaskIR | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM task_irs WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as TaskIRRow | undefined;
  return row ? rowToTaskIR(row) : undefined;
}

export function listTaskIRs(
  orgId: string,
  userId?: string,
  status?: TaskStatus,
): TaskIR[] {
  let sql = `SELECT * FROM task_irs WHERE org_id = ?`;
  const params: (string)[] = [orgId];
  if (userId) {
    sql += ` AND user_id = ?`;
    params.push(userId);
  }
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const rows = getDb().prepare(sql).all(...params) as TaskIRRow[];
  return rows.map(rowToTaskIR);
}

export function countTaskIRs(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM task_irs WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}

// ─── Full Compiler: Stages 1-4 ─────────────────────────────────────────

export interface CompilationResult {
  understanding: CommunicationUnderstanding;
  roleContract: RoleOperatingContract;
  tasks: TaskIR[];
}

/**
 * Compile an Evidence Envelope through stages 1-4.
 * Returns the communication understanding, role contract, and generated Task IRs.
 */
export function compileEvidenceEnvelope(
  orgId: string,
  userId: string,
  evidenceEnvelopeId: string,
  orgDomain: string,
): CompilationResult {
  const envelope = getEvidenceEnvelope(orgId, evidenceEnvelopeId);
  if (!envelope) {
    throw new Error(`Evidence envelope not found: ${evidenceEnvelopeId}`);
  }

  // Stage 1: Communication understanding
  const understanding = understandCommunication(
    orgId,
    userId,
    envelope.sender,
    envelope.sender, // use sender as name if not available
    orgDomain,
    envelope.originalContent,
  );

  // Stage 2: Request decomposition
  const decomposedTasks = decomposeRequest(
    envelope.originalContent,
    envelope.attachments,
  );

  // Stage 3 + 4: Role contract + Task IR generation
  const tasks: TaskIR[] = [];
  for (const decomposed of decomposedTasks) {
    const roleContract = resolveRoleContract(
      orgId,
      understanding.senderId,
      decomposed.taskType,
      understanding,
    );

    // Resolve dependencies to actual task IDs
    const dependencyIds: string[] = [];
    for (const dep of decomposed.dependencies) {
      const depIdx = parseInt(dep, 10);
      if (tasks[depIdx]) {
        dependencyIds.push(tasks[depIdx].id);
      }
    }

    const task = createTaskIR(
      orgId,
      userId,
      evidenceEnvelopeId,
      decomposed,
      roleContract,
    );

    // Update dependencies now that we have the ID
    if (dependencyIds.length > 0) {
      task.dependencies = dependencyIds;
      getDb()
        .prepare(
          `UPDATE task_irs SET dependencies = ? WHERE org_id = ? AND id = ?`,
        )
        .run(JSON.stringify(dependencyIds), orgId, task.id);
    }

    tasks.push(task);
  }

  return { understanding, roleContract: resolveRoleContract(orgId, understanding.senderId, tasks[0]?.taskType || "research", understanding), tasks };
}
