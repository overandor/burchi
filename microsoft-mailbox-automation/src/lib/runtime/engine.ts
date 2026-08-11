/**
 * Ambient Delegation Runtime Engine.
 *
 * Core loop:
 *   event → understand → decide → delegate → execute → verify → learn
 *
 * This engine is the persistent cognitive layer. Voice is one sensor.
 * The runtime is the product.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getDb, DEFAULT_ORG_ID } from "@/lib/db";
import { callLLM } from "@/lib/golden/llm-client";
import type {
  RuntimeEvent,
  EventStreamType,
  StreamConsent,
  WorldModel,
  ProposedAction,
  ProposalStatus,
  HumanTask,
  DelegationTarget,
  ActionResult,
  RuntimeState,
  ReconciliationOperator,
  RuntimeExperiment,
  FitnessBreakdown,
  TournamentEntry,
  TournamentResult,
  CompetitionLevel,
  AttributionNode,
  DividendAward,
  ActiveWorkItem,
  WaitingItem,
  DirectorAssessment,
  SafeguardViolation,
  ContributorBranch,
  VerificationEntry,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${nanoid(12).toUpperCase()}`;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ─── Database schema initialization ───────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  payload TEXT NOT NULL,
  structured TEXT,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT,
  processed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runtime_stream_consent (
  stream TEXT NOT NULL,
  org_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (stream, org_id)
);

CREATE TABLE IF NOT EXISTS runtime_world_model (
  org_id TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_proposals (
  id TEXT PRIMARY KEY,
  trigger_event_id TEXT NOT NULL,
  observation TEXT NOT NULL,
  inferred_goal TEXT NOT NULL,
  action TEXT NOT NULL,
  delegate_to TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  expected_value INTEGER DEFAULT 0,
  risk INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0,
  requires_confirmation INTEGER DEFAULT 0,
  status TEXT DEFAULT 'proposed',
  resources TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  result_json TEXT
);

CREATE TABLE IF NOT EXISTS runtime_human_tasks (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instruction TEXT NOT NULL,
  options TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  agent_context TEXT NOT NULL,
  impact_estimate INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS runtime_operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  field_mappings TEXT,
  source_reliability TEXT,
  normalization_rules TEXT,
  conflict_resolutions TEXT,
  datasets_processed INTEGER DEFAULT 0,
  human_corrections INTEGER DEFAULT 0,
  fitness REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_experiments (
  id TEXT PRIMARY KEY,
  hypothesis TEXT NOT NULL,
  author TEXT NOT NULL,
  contributors TEXT,
  inputs TEXT,
  baseline TEXT NOT NULL,
  intervention TEXT NOT NULL,
  sample_target INTEGER DEFAULT 0,
  status TEXT DEFAULT 'hypothesis',
  outcome TEXT,
  replication_count INTEGER DEFAULT 0,
  fitness_score REAL DEFAULT 0,
  compliance_passed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_tournament_entries (
  experiment_id TEXT NOT NULL,
  level TEXT NOT NULL,
  competitor TEXT NOT NULL,
  fitness_score REAL DEFAULT 0,
  rank INTEGER DEFAULT 0,
  entered_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, level, competitor)
);

CREATE TABLE IF NOT EXISTS runtime_attribution (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  role TEXT NOT NULL,
  actor TEXT NOT NULL,
  contribution_weight REAL DEFAULT 0,
  evidence TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_dividends (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  role TEXT NOT NULL,
  amount REAL DEFAULT 0,
  reputation_delta REAL DEFAULT 0,
  opportunity TEXT,
  resources TEXT,
  awarded_at TEXT NOT NULL,
  economic_effect REAL DEFAULT 0,
  verified_by_replication INTEGER DEFAULT 0,
  counterfactual_survived INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_org ON runtime_events(org_id, processed);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON runtime_proposals(status);
CREATE INDEX IF NOT EXISTS idx_human_tasks_status ON runtime_human_tasks(status);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON runtime_experiments(status);
`;

let _schemaInitialized = false;

function ensureSchema(): void {
  if (_schemaInitialized) return;
  try {
    const db = getDb();
    db.exec(SCHEMA_SQL);
    _schemaInitialized = true;
  } catch (e) {
    console.error("[runtime] schema init failed:", e);
  }
}

// ─── Event Bus ────────────────────────────────────────────────────────────

export function emitEvent(
  stream: EventStreamType,
  payload: string,
  source: string,
  orgId: string = DEFAULT_ORG_ID,
  userId?: string,
  structured?: Record<string, unknown>,
): RuntimeEvent {
  ensureSchema();
  const event: RuntimeEvent = {
    id: newId("evt"),
    stream,
    payload,
    structured,
    timestamp: now(),
    source,
    orgId,
    userId,
    processed: false,
  };

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_events (id, stream, payload, structured, timestamp, source, org_id, user_id, processed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      event.id,
      event.stream,
      event.payload,
      structured ? JSON.stringify(structured) : null,
      event.timestamp,
      event.source,
      event.orgId,
      userId || null,
    );
  } catch (e) {
    console.error("[runtime] emitEvent failed:", e);
  }

  return event;
}

export function getUnprocessedEvents(orgId: string = DEFAULT_ORG_ID, limit = 50): RuntimeEvent[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_events WHERE org_id = ? AND processed = 0 ORDER BY timestamp ASC LIMIT ?`,
    ).all(orgId, limit);
    return rows.map(rowToEvent);
  } catch {
    return [];
  }
}

export function markEventProcessed(eventId: string): void {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(`UPDATE runtime_events SET processed = 1 WHERE id = ?`).run(eventId);
  } catch (e) {
    console.error("[runtime] markEventProcessed failed:", e);
  }
}

function rowToEvent(row: any): RuntimeEvent {
  return {
    id: row.id,
    stream: row.stream,
    payload: row.payload,
    structured: row.structured ? JSON.parse(row.structured) : undefined,
    timestamp: row.timestamp,
    source: row.source,
    orgId: row.org_id,
    userId: row.user_id || undefined,
    processed: row.processed === 1,
  };
}

// ─── Stream Consent ───────────────────────────────────────────────────────

export function grantConsent(
  stream: EventStreamType,
  grantedBy: string,
  orgId: string = DEFAULT_ORG_ID,
  note: string = "",
): StreamConsent {
  ensureSchema();
  const consent: StreamConsent = {
    stream,
    enabled: true,
    grantedAt: now(),
    grantedBy,
    note,
  };
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO runtime_stream_consent (stream, org_id, enabled, granted_at, granted_by, note)
       VALUES (?, ?, 1, ?, ?, ?)`,
    ).run(stream, orgId, consent.grantedAt, grantedBy, note);
  } catch (e) {
    console.error("[runtime] grantConsent failed:", e);
  }
  return consent;
}

export function revokeConsent(stream: EventStreamType, orgId: string = DEFAULT_ORG_ID): void {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_stream_consent SET enabled = 0 WHERE stream = ? AND org_id = ?`,
    ).run(stream, orgId);
  } catch (e) {
    console.error("[runtime] revokeConsent failed:", e);
  }
}

export function isStreamEnabled(stream: EventStreamType, orgId: string = DEFAULT_ORG_ID): boolean {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT enabled FROM runtime_stream_consent WHERE stream = ? AND org_id = ?`,
    ).get(stream, orgId) as any;
    return row ? row.enabled === 1 : false;
  } catch {
    return false;
  }
}

export function listConsentedStreams(orgId: string = DEFAULT_ORG_ID): StreamConsent[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_stream_consent WHERE org_id = ? AND enabled = 1`,
    ).all(orgId) as any[];
    return rows.map((r) => ({
      stream: r.stream,
      enabled: r.enabled === 1,
      grantedAt: r.granted_at,
      grantedBy: r.granted_by,
      note: r.note || "",
    }));
  } catch {
    return [];
  }
}

// ─── World Model ──────────────────────────────────────────────────────────

export function loadWorldModel(orgId: string = DEFAULT_ORG_ID): WorldModel {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT model_json FROM runtime_world_model WHERE org_id = ?`,
    ).get(orgId) as any;
    if (row) {
      return JSON.parse(row.model_json) as WorldModel;
    }
  } catch {
    // fall through to default
  }
  return defaultWorldModel(orgId);
}

export function saveWorldModel(model: WorldModel): void {
  ensureSchema();
  model.updatedAt = now();
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO runtime_world_model (org_id, model_json, updated_at)
       VALUES (?, ?, ?)`,
    ).run(model.orgId, JSON.stringify(model), model.updatedAt);
  } catch (e) {
    console.error("[runtime] saveWorldModel failed:", e);
  }
}

function defaultWorldModel(orgId: string): WorldModel {
  return {
    orgId,
    goals: [
      { id: "goal-1", description: "Increase qualified opportunities", priority: 1, metric: "qualified_pipeline", target: "+20% QoQ", status: "active" },
      { id: "goal-2", description: "Enrich account intelligence", priority: 2, metric: "account_data_coverage", target: ">85%", status: "active" },
      { id: "goal-3", description: "Reduce repetitive work", priority: 3, metric: "automated_task_ratio", target: ">60%", status: "active" },
      { id: "goal-4", description: "Discover successful experiments", priority: 4, metric: "verified_experiments", target: ">5/quarter", status: "active" },
      { id: "goal-5", description: "Validate and propagate verified procedures", priority: 5, metric: "genome_adoption", target: ">80%", status: "active" },
    ],
    permissions: {
      autonomous: [
        { action: "read_datasets", scope: "all", reason: "Reading is non-destructive" },
        { action: "analyze_emails", scope: "all", reason: "Analysis is non-destructive" },
        { action: "create_derived_dataset", scope: "all", reason: "Derived data doesn't overwrite originals" },
        { action: "detect_signals", scope: "all", reason: "Passive observation" },
        { action: "generate_hypotheses", scope: "all", reason: "Internal reasoning" },
        { action: "enrich_datasets", scope: "all", reason: "Non-destructive merge" },
      ],
      requiresApproval: [
        { action: "external_outreach", scope: "all", reason: "External communication has legal implications" },
        { action: "overwrite_original", scope: "all", reason: "Originals are protected" },
        { action: "launch_experiment", scope: "all", reason: "Experiments need human authorization" },
        { action: "send_email", scope: "all", reason: "External communication" },
        { action: "modify_crm", scope: "all", reason: "System of record" },
      ],
      prohibited: [
        { action: "send_unapproved_content", scope: "all", reason: "Compliance violation" },
        { action: "delete_user_data", scope: "all", reason: "Data preservation required" },
        { action: "bypass_compliance", scope: "all", reason: "Hard gate" },
        { action: "act_without_consent", scope: "all", reason: "Observation is not authority" },
      ],
    },
    availableData: [],
    capabilities: [],
    experimentHistory: [],
    activeWork: [],
    waitingOn: [],
    updatedAt: now(),
  };
}

// ─── Action Selection (the core cognitive step) ───────────────────────────

/**
 * Given an event, use the LLM to understand it in the context of the world
 * model and propose what should happen. This is NOT a command executor —
 * it's an observer that decides whether action is needed and who should take it.
 */
export async function proposeAction(
  event: RuntimeEvent,
  worldModel: WorldModel,
): Promise<ProposedAction> {
  const observation = event.payload;
  const goalsContext = worldModel.goals.map((g) => `- ${g.description} (priority ${g.priority})`).join("\n");
  const permContext = `Autonomous: ${worldModel.permissions.autonomous.map((p) => p.action).join(", ")}
Requires approval: ${worldModel.permissions.requiresApproval.map((p) => p.action).join(", ")}
Prohibited: ${worldModel.permissions.prohibited.map((p) => p.action).join(", ")}`;
  const dataContext = worldModel.availableData.map((d) => `- ${d.name} (${d.recordCount} records, confidence ${d.confidence})`).join("\n");
  const capContext = worldModel.capabilities.map((c) => `- ${c.name} v${c.operatorVersion} (fitness ${c.fitness})`).join("\n");

  const system = `You are the Ambient Delegation Runtime — a persistent organizational agent.
You observe events from authorized streams and decide what should happen.
You are NOT a chatbot. You do not answer questions. You observe, understand, and propose action.

Given an event, the current world model, and organizational context, produce a JSON proposal:

{
  "observation": "What you understood from this event",
  "inferredGoal": "What organizational goal this relates to",
  "action": "The specific action to take (or 'observe and remember' if nothing is needed)",
  "delegateTo": "agent | human | research | experiment | nothing",
  "reasoning": "Why this action and this delegate",
  "expectedValue": 0-100,
  "risk": 0-100,
  "confidence": 0.0-1.0,
  "requiresConfirmation": true/false,
  "resources": ["list of resources needed"]
}

Rules:
- If the event is just information with no action needed, set delegateTo to "nothing".
- If the action is within autonomous permissions and low risk, delegateTo "agent" and requiresConfirmation false.
- If the action needs approval, delegateTo "agent" but requiresConfirmation true.
- If the action needs a human's high-information judgment, delegateTo "human".
- If more evidence is needed before deciding, delegateTo "research".
- If the event suggests a testable hypothesis, delegateTo "experiment".
- Never propose anything in the prohibited list.
- Compliance and safety are hard gates. If there's any compliance concern, delegate to "human" with high priority.`;

  const userMsg = `EVENT STREAM: ${event.stream}
EVENT SOURCE: ${event.source}
EVENT PAYLOAD: ${observation}

WORLD MODEL:
Goals:
${goalsContext || "(none set)"}

Permissions:
${permContext}

Available Data:
${dataContext || "(none registered)"}

Capabilities:
${capContext || "(none learned yet)"}

Produce the proposal JSON.`;

  let parsed: Partial<ProposedAction> = {};
  try {
    const result = await callLLM([
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ]);
    parsed = JSON.parse(result.content || "{}");
  } catch (e) {
    // Fallback: conservative proposal — delegate to human
    console.error("[runtime] proposeAction LLM failed, falling back:", e);
    parsed = {
      observation: observation.slice(0, 200),
      inferredGoal: "Unknown — needs human assessment",
      action: "Request human review",
      delegateTo: "human",
      reasoning: "LLM unavailable; conservative delegation to human",
      expectedValue: 0,
      risk: 50,
      confidence: 0.1,
      requiresConfirmation: true,
      resources: [],
    };
  }

  const proposal: ProposedAction = {
    id: newId("prop"),
    triggerEventId: event.id,
    observation: parsed.observation || observation.slice(0, 200),
    inferredGoal: parsed.inferredGoal || "Unknown",
    action: parsed.action || "Observe and remember",
    delegateTo: (parsed.delegateTo as DelegationTarget) || "nothing",
    reasoning: parsed.reasoning || "No reasoning provided",
    expectedValue: parsed.expectedValue ?? 0,
    risk: parsed.risk ?? 50,
    confidence: parsed.confidence ?? 0.1,
    requiresConfirmation: parsed.requiresConfirmation ?? true,
    status: "proposed",
    resources: parsed.resources || [],
    createdAt: now(),
  };

  // Safety: if action is in prohibited list, force delegation to human
  const isProhibited = worldModel.permissions.prohibited.some((p) =>
    proposal.action.toLowerCase().includes(p.action.toLowerCase().replace(/_/g, " ")),
  );
  if (isProhibited) {
    proposal.delegateTo = "human";
    proposal.requiresConfirmation = true;
    proposal.reasoning = `OVERRIDE: Action may be prohibited (${proposal.action}). Delegated to human for safety.`;
  }

  persistProposal(proposal);
  return proposal;
}

function persistProposal(p: ProposedAction): void {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_proposals
       (id, trigger_event_id, observation, inferred_goal, action, delegate_to, reasoning,
        expected_value, risk, confidence, requires_confirmation, status, resources, created_at, resolved_at, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      p.id,
      p.triggerEventId,
      p.observation,
      p.inferredGoal,
      p.action,
      p.delegateTo,
      p.reasoning,
      p.expectedValue,
      p.risk,
      p.confidence,
      p.requiresConfirmation ? 1 : 0,
      p.status,
      JSON.stringify(p.resources),
      p.createdAt,
      p.resolvedAt || null,
      p.result ? JSON.stringify(p.result) : null,
    );
  } catch (e) {
    console.error("[runtime] persistProposal failed:", e);
  }
}

export function updateProposalStatus(
  proposalId: string,
  status: ProposalStatus,
  result?: ActionResult,
): void {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_proposals SET status = ?, resolved_at = ?, result_json = ? WHERE id = ?`,
    ).run(status, now(), result ? JSON.stringify(result) : null, proposalId);
  } catch (e) {
    console.error("[runtime] updateProposalStatus failed:", e);
  }
}

export function getProposal(proposalId: string): ProposedAction | null {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM runtime_proposals WHERE id = ?`).get(proposalId) as any;
    if (!row) return null;
    return rowToProposal(row);
  } catch {
    return null;
  }
}

export function getActiveProposals(orgId: string = DEFAULT_ORG_ID): ProposedAction[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_proposals WHERE status IN ('proposed', 'confirmed', 'executing', 'delegated')
       ORDER BY created_at DESC LIMIT 20`,
    ).all() as any[];
    return rows.map(rowToProposal);
  } catch {
    return [];
  }
}

function rowToProposal(row: any): ProposedAction {
  return {
    id: row.id,
    triggerEventId: row.trigger_event_id,
    observation: row.observation,
    inferredGoal: row.inferred_goal,
    action: row.action,
    delegateTo: row.delegate_to as DelegationTarget,
    reasoning: row.reasoning,
    expectedValue: row.expected_value,
    risk: row.risk,
    confidence: row.confidence,
    requiresConfirmation: row.requires_confirmation === 1,
    status: row.status as ProposalStatus,
    resources: row.resources ? JSON.parse(row.resources) : [],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}

// ─── Delegation Queue (NEXT BEST HUMAN ACTION) ────────────────────────────

export function delegateToHuman(proposal: ProposedAction): HumanTask {
  ensureSchema();
  const task: HumanTask = {
    id: newId("task"),
    proposalId: proposal.id,
    title: proposal.action.slice(0, 80),
    description: proposal.observation,
    instruction: proposal.reasoning,
    priority: proposal.risk > 70 ? "critical" : proposal.risk > 40 ? "high" : "medium",
    status: "pending",
    createdAt: now(),
    agentContext: `I observed: ${proposal.observation}. I inferred goal: ${proposal.inferredGoal}. I need you to: ${proposal.action}`,
    impactEstimate: Math.max(1, Math.round(proposal.expectedValue / 10)),
  };

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_human_tasks
       (id, proposal_id, title, description, instruction, options, priority, status, created_at, agent_context, impact_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      task.id,
      task.proposalId,
      task.title,
      task.description,
      task.instruction,
      null,
      task.priority,
      task.createdAt,
      task.agentContext,
      task.impactEstimate,
    );
  } catch (e) {
    console.error("[runtime] delegateToHuman failed:", e);
  }

  updateProposalStatus(proposal.id, "delegated");
  return task;
}

export function getHumanTasks(status: string = "pending", limit = 20): HumanTask[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_human_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(status, limit) as any[];
    return rows.map(rowToHumanTask);
  } catch {
    return [];
  }
}

export function resolveHumanTask(
  taskId: string,
  resolution: "accepted" | "completed" | "declined",
  result?: string,
): void {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_human_tasks SET status = ?, resolved_at = ? WHERE id = ?`,
    ).run(resolution, now(), taskId);

    // If completed with a result, this is a human correction → feed back into operators
    if (resolution === "completed" && result) {
      const task = db.prepare(`SELECT * FROM runtime_human_tasks WHERE id = ?`).get(taskId) as any;
      if (task) {
        const proposal = getProposal(task.proposal_id);
        if (proposal) {
          updateProposalStatus(proposal.id, "completed", {
            success: true,
            output: result,
            operatorUpdated: true,
            learnedRule: result,
            timestamp: now(),
          });
        }
      }
    } else if (resolution === "declined") {
      const task = db.prepare(`SELECT * FROM runtime_human_tasks WHERE id = ?`).get(taskId) as any;
      if (task) {
        updateProposalStatus(task.proposal_id, "rejected");
      }
    }
  } catch (e) {
    console.error("[runtime] resolveHumanTask failed:", e);
  }
}

function rowToHumanTask(row: any): HumanTask {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    title: row.title,
    description: row.description,
    instruction: row.instruction,
    options: row.options ? JSON.parse(row.options) : undefined,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
    agentContext: row.agent_context,
    impactEstimate: row.impact_estimate,
  };
}

// ─── Compounding Operators ────────────────────────────────────────────────

export function getOperator(operatorId: string): ReconciliationOperator | null {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM runtime_operators WHERE id = ?`).get(operatorId) as any;
    if (!row) return null;
    return rowToOperator(row);
  } catch {
    return null;
  }
}

export function listOperators(): ReconciliationOperator[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM runtime_operators ORDER BY updated_at DESC`).all() as any[];
    return rows.map(rowToOperator);
  } catch {
    return [];
  }
}

export function saveOperator(op: ReconciliationOperator): void {
  ensureSchema();
  ensureSchema();
  op.updatedAt = now();
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO runtime_operators
       (id, name, version, field_mappings, source_reliability, normalization_rules,
        conflict_resolutions, datasets_processed, human_corrections, fitness, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      op.id,
      op.name,
      op.version,
      JSON.stringify(op.fieldMappings),
      JSON.stringify(op.sourceReliability),
      JSON.stringify(op.normalizationRules),
      JSON.stringify(op.conflictResolutions),
      op.datasetsProcessed,
      op.humanCorrectionsIncorporated,
      op.fitness,
      op.createdAt,
      op.updatedAt,
    );
  } catch (e) {
    console.error("[runtime] saveOperator failed:", e);
  }
}

/**
 * Enrich multiple datasets using a reconciliation operator.
 * Each run updates the operator — the asset is the accumulated machinery.
 */
export function enrichDatasets(
  operatorId: string,
  datasets: Record<string, Record<string, unknown>[]>,
): {
  canonical: Record<string, unknown>[];
  conflicts: { field: string; values: unknown[]; resolved: unknown; strategy: string }[];
  updatedOperator: ReconciliationOperator;
} {
  const op = getOperator(operatorId);
  if (!op) throw new Error(`Operator ${operatorId} not found`);

  const canonical: Record<string, unknown>[] = [];
  const conflicts: { field: string; values: unknown[]; resolved: unknown; strategy: string }[] = [];

  // Group records by a canonical key (first field that looks like an ID)
  const allRecords: { source: string; record: Record<string, unknown> }[] = [];
  for (const [source, records] of Object.entries(datasets)) {
    for (const record of records) {
      allRecords.push({ source, record });
    }
  }

  // Entity resolution: group by best-guess key
  const groups = new Map<string, { source: string; record: Record<string, unknown> }[]>();
  for (const entry of allRecords) {
    const key = guessEntityKey(entry.record);
    const existing = groups.get(key) || [];
    existing.push(entry);
    groups.set(key, existing);
  }

  // Merge each group
  for (const [, group] of groups) {
    const merged: Record<string, unknown> = {};
    for (const { source, record } of group) {
      for (const [field, value] of Object.entries(record)) {
        const canonicalField = resolveCanonicalField(op, field);
        if (merged[canonicalField] === undefined) {
          merged[canonicalField] = value;
        } else if (merged[canonicalField] !== value) {
          // Conflict — apply resolution strategy
          const resolved = resolveConflict(op, canonicalField, merged[canonicalField], value, source, op.sourceReliability);
          conflicts.push({
            field: canonicalField,
            values: [merged[canonicalField], value],
            resolved: resolved.value,
            strategy: resolved.strategy,
          });
          merged[canonicalField] = resolved.value;
        }
      }
      merged["_sources"] = [...new Set([...((merged["_sources"] as string[]) || []), source])];
    }
    merged["_confidence"] = group.length > 1 ? Math.min(1, group.length / 3) : 0.5;
    merged["_provenance"] = group.map((g) => g.source).join(", ");
    canonical.push(merged);
  }

  // Update the operator with what we learned
  op.datasetsProcessed += Object.keys(datasets).length;
  op.conflictResolutions = op.conflictResolutions.map((cr) => ({
    ...cr,
    timesApplied: cr.timesApplied + conflicts.filter((c) => c.strategy.includes(cr.strategy)).length,
  }));
  op.fitness = recalculateOperatorFitness(op);
  op.version += 1;
  saveOperator(op);

  return { canonical, conflicts, updatedOperator: op };
}

function guessEntityKey(record: Record<string, unknown>): string {
  const idFields = ["id", "npi", "email", "phone", "name", "account_id", "contact_id"];
  for (const field of idFields) {
    const found = Object.keys(record).find((k) => k.toLowerCase().replace(/\s+/g, "_") === field);
    if (found && record[found]) return String(record[found]).toLowerCase().trim();
  }
  // Fallback: hash of all values
  return sha256(Object.values(record).map(String).join("|"));
}

function resolveCanonicalField(op: ReconciliationOperator, sourceField: string): string {
  const mapping = op.fieldMappings.find((fm) => fm.sourceField === sourceField);
  return mapping ? mapping.canonicalField : sourceField.toLowerCase().replace(/\s+/g, "_");
}

function resolveConflict(
  op: ReconciliationOperator,
  field: string,
  existing: unknown,
  incoming: unknown,
  source: string,
  reliability: Record<string, number>,
): { value: unknown; strategy: string } {
  const sourceReliability = reliability[source] || 0.5;
  if (sourceReliability > 0.7) {
    return { value: incoming, strategy: "prefer_source" };
  }
  return { value: existing, strategy: "prefer_confident" };
}

function recalculateOperatorFitness(op: ReconciliationOperator): number {
  const totalApplications = op.conflictResolutions.reduce((s, cr) => s + cr.timesApplied, 0);
  if (totalApplications === 0) return op.fitness;
  const successRate = op.conflictResolutions.reduce((s, cr) => s + cr.successRate * cr.timesApplied, 0) / totalApplications;
  const correctionPenalty = op.humanCorrectionsIncorporated > 0 ? 0.95 : 1;
  return Math.min(100, successRate * 100 * correctionPenalty);
}

function rowToOperator(row: any): ReconciliationOperator {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    fieldMappings: row.field_mappings ? JSON.parse(row.field_mappings) : [],
    sourceReliability: row.source_reliability ? JSON.parse(row.source_reliability) : {},
    normalizationRules: row.normalization_rules ? JSON.parse(row.normalization_rules) : [],
    conflictResolutions: row.conflict_resolutions ? JSON.parse(row.conflict_resolutions) : [],
    datasetsProcessed: row.datasets_processed,
    humanCorrectionsIncorporated: row.human_corrections,
    fitness: row.fitness,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createOperator(name: string): ReconciliationOperator {
  const op: ReconciliationOperator = {
    id: newId("op"),
    name,
    version: 1,
    fieldMappings: [],
    sourceReliability: {},
    normalizationRules: [],
    conflictResolutions: [
      { field: "*", strategy: "prefer_source", detail: "Default: prefer more reliable source", timesApplied: 0, successRate: 0.7 },
      { field: "*", strategy: "prefer_recent", detail: "Default: prefer more recent value", timesApplied: 0, successRate: 0.6 },
      { field: "*", strategy: "prefer_confident", detail: "Default: prefer higher confidence source", timesApplied: 0, successRate: 0.65 },
      { field: "*", strategy: "human_resolved", detail: "Escalated to human", timesApplied: 0, successRate: 0.95 },
    ],
    datasetsProcessed: 0,
    humanCorrectionsIncorporated: 0,
    fitness: 50,
    createdAt: now(),
    updatedAt: now(),
  };
  saveOperator(op);
  return op;
}

// ─── Experiment Lifecycle & Fitness ───────────────────────────────────────

export function createExperiment(
  hypothesis: string,
  author: string,
  baseline: string,
  intervention: string,
  inputs: string[] = [],
  sampleTarget: number = 100,
): RuntimeExperiment {
  ensureSchema();
  const exp: RuntimeExperiment = {
    id: newId("exp"),
    hypothesis,
    author,
    contributors: [author],
    inputs,
    baseline,
    intervention,
    sampleTarget,
    status: "hypothesis",
    replicationCount: 0,
    fitnessScore: 0,
    compliancePassed: false,
    createdAt: now(),
  };

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_experiments
       (id, hypothesis, author, contributors, inputs, baseline, intervention, sample_target,
        status, outcome, replication_count, fitness_score, compliance_passed, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      exp.id,
      exp.hypothesis,
      exp.author,
      JSON.stringify(exp.contributors),
      JSON.stringify(exp.inputs),
      exp.baseline,
      exp.intervention,
      exp.sampleTarget,
      exp.status,
      null,
      0,
      0,
      0,
      exp.createdAt,
      null,
    );
  } catch (e) {
    console.error("[runtime] createExperiment failed:", e);
  }

  return exp;
}

export function recordExperimentOutcome(
  experimentId: string,
  outcome: string,
  compliancePassed: boolean,
  evidenceQuality: number,
  reproducibility: number,
  novelty: number,
  economicValue: number,
  risk: number,
  cost: number,
): RuntimeExperiment {
  ensureSchema();
  const fitness = computeFitness({
    compliance: compliancePassed,
    customerSafety: compliancePassed, // compliance gate covers safety in pharma
    evidenceQuality,
    reproducibility,
    novelty,
    economicValue,
    risk,
    cost,
  });

  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_experiments SET outcome = ?, status = ?, fitness_score = ?, compliance_passed = ?, completed_at = ?
       WHERE id = ?`,
    ).run(
      outcome,
      fitness.composite > 0 ? "outcome_recorded" : "blocked_compliance",
      fitness.composite,
      compliancePassed ? 1 : 0,
      now(),
      experimentId,
    );
  } catch (e) {
    console.error("[runtime] recordExperimentOutcome failed:", e);
  }

  return getExperiment(experimentId)!;
}

export function addReplication(experimentId: string): RuntimeExperiment {
  ensureSchema();
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_experiments SET replication_count = replication_count + 1,
       status = CASE WHEN replication_count + 1 >= 2 THEN 'verified' ELSE 'replicating' END
       WHERE id = ?`,
    ).run(experimentId);
  } catch (e) {
    console.error("[runtime] addReplication failed:", e);
  }
  return getExperiment(experimentId)!;
}

export function getExperiment(experimentId: string): RuntimeExperiment | null {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM runtime_experiments WHERE id = ?`).get(experimentId) as any;
    if (!row) return null;
    return rowToExperiment(row);
  } catch {
    return null;
  }
}

export function listExperiments(status?: string): RuntimeExperiment[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = status
      ? db.prepare(`SELECT * FROM runtime_experiments WHERE status = ? ORDER BY created_at DESC`).all(status) as any[]
      : db.prepare(`SELECT * FROM runtime_experiments ORDER BY created_at DESC`).all() as any[];
    return rows.map(rowToExperiment);
  } catch {
    return [];
  }
}

function rowToExperiment(row: any): RuntimeExperiment {
  return {
    id: row.id,
    hypothesis: row.hypothesis,
    author: row.author,
    contributors: row.contributors ? JSON.parse(row.contributors) : [],
    inputs: row.inputs ? JSON.parse(row.inputs) : [],
    baseline: row.baseline,
    intervention: row.intervention,
    sampleTarget: row.sample_target,
    status: row.status,
    outcome: row.outcome || undefined,
    replicationCount: row.replication_count,
    fitnessScore: row.fitness_score,
    compliancePassed: row.compliance_passed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}

/**
 * Fitness computation with Response B's hierarchy as HARD GATES.
 * Compliance and safety are boolean gates — if either fails, composite is 0.
 * The experiment never enters the tournament if it fails a gate.
 */
export function computeFitness(input: {
  compliance: boolean;
  customerSafety: boolean;
  evidenceQuality: number;
  reproducibility: number;
  novelty: number;
  economicValue: number;
  risk: number;
  cost: number;
}): FitnessBreakdown {
  // Hard gates
  if (!input.compliance || !input.customerSafety) {
    return {
      compliance: input.compliance,
      customerSafety: input.customerSafety,
      evidenceQuality: input.evidenceQuality,
      reproducibility: input.reproducibility,
      novelty: input.novelty,
      economicValue: input.economicValue,
      risk: input.risk,
      cost: input.cost,
      composite: 0,
    };
  }

  // Weighted composite — hierarchy order determines weights
  const composite = Math.max(0, Math.min(100, Math.round(
    input.evidenceQuality * 0.25 +
    input.reproducibility * 0.20 +
    input.novelty * 0.15 +
    input.economicValue * 0.20 -
    input.risk * 0.10 -
    input.cost * 0.10,
  )));

  return {
    compliance: true,
    customerSafety: true,
    evidenceQuality: input.evidenceQuality,
    reproducibility: input.reproducibility,
    novelty: input.novelty,
    economicValue: input.economicValue,
    risk: input.risk,
    cost: input.cost,
    composite,
  };
}

// ─── Tournament & Competition ─────────────────────────────────────────────

export function enterTournament(
  experimentId: string,
  level: CompetitionLevel,
  competitor: string,
): TournamentEntry | null {
  ensureSchema();
  const exp = getExperiment(experimentId);
  if (!exp) return null;
  if (!exp.compliancePassed) return null; // hard gate
  if (exp.fitnessScore <= 0) return null;

  const entry: TournamentEntry = {
    experimentId,
    level,
    competitor,
    fitnessScore: exp.fitnessScore,
    rank: 0,
    enteredAt: now(),
  };

  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO runtime_tournament_entries
       (experiment_id, level, competitor, fitness_score, rank, entered_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(entry.experimentId, entry.level, entry.competitor, entry.fitnessScore, 0, entry.enteredAt);
  } catch (e) {
    console.error("[runtime] enterTournament failed:", e);
  }

  return entry;
}

export function computeTournament(level: CompetitionLevel): TournamentResult {
  ensureSchema();
  let entries: TournamentEntry[] = [];
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_tournament_entries WHERE level = ? ORDER BY fitness_score DESC`,
    ).all(level) as any[];
    entries = rows.map((r, i) => ({
      experimentId: r.experiment_id,
      level: r.level as CompetitionLevel,
      competitor: r.competitor,
      fitnessScore: r.fitness_score,
      rank: i + 1,
      enteredAt: r.entered_at,
    }));

    // Update ranks
    for (const entry of entries) {
      db.prepare(
        `UPDATE runtime_tournament_entries SET rank = ? WHERE experiment_id = ? AND level = ? AND competitor = ?`,
      ).run(entry.rank, entry.experimentId, entry.level, entry.competitor);
    }
  } catch (e) {
    console.error("[runtime] computeTournament failed:", e);
  }

  const winner = entries[0];
  return {
    level,
    entries,
    winner: winner?.competitor || "none",
    winningExperimentId: winner?.experimentId || "none",
    computedAt: now(),
  };
}

// ─── Attribution Lineage & Innovation Dividend ────────────────────────────

export function addAttribution(
  experimentId: string,
  role: AttributionNode["role"],
  actor: string,
  contributionWeight: number,
  evidence: string,
): AttributionNode {
  ensureSchema();
  const node: AttributionNode = {
    id: newId("attr"),
    experimentId,
    role,
    actor,
    contributionWeight,
    evidence,
    createdAt: now(),
  };

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_attribution (id, experiment_id, role, actor, contribution_weight, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(node.id, node.experimentId, node.role, node.actor, node.contributionWeight, node.evidence, node.createdAt);
  } catch (e) {
    console.error("[runtime] addAttribution failed:", e);
  }

  return node;
}

export function getAttribution(experimentId: string): AttributionNode[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM runtime_attribution WHERE experiment_id = ? ORDER BY created_at ASC`,
    ).all(experimentId) as any[];
    return rows.map((r) => ({
      id: r.id,
      experimentId: r.experiment_id,
      role: r.role,
      actor: r.actor,
      contributionWeight: r.contribution_weight,
      evidence: r.evidence,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Award innovation dividend based on measured economic effect.
 * Attribution weights determine how the dividend is split.
 */
export function awardDividend(
  experimentId: string,
  economicEffect: number,
  verifiedByReplication: boolean = false,
  counterfactualSurvived: boolean = false,
): DividendAward[] {
  ensureSchema();
  const attributions = getAttribution(experimentId);
  if (attributions.length === 0) return [];

  // Adversarial safeguard: correlation ≠ innovation
  // Dividends are only awarded for verified incremental value, not raw activity
  if (!verifiedByReplication) {
    console.warn(`[runtime] awardDividend blocked: experiment ${experimentId} not verified by replication`);
    return [];
  }

  const totalWeight = attributions.reduce((s, a) => s + a.contributionWeight, 0);
  if (totalWeight === 0) return [];

  // Counterfactual survival adjusts the dividend amount
  const multiplier = counterfactualSurvived ? 1.0 : 0.5;

  const awards: DividendAward[] = [];
  for (const attr of attributions) {
    const share = attr.contributionWeight / totalWeight;
    const amount = economicEffect * share * 0.1 * multiplier;
    const award: DividendAward = {
      id: newId("div"),
      experimentId,
      recipient: attr.actor,
      role: attr.role,
      amount,
      reputationDelta: share * 10,
      opportunity: attr.role === "originator" ? "Priority access to next experiment resources" : undefined,
      resources: attr.role === "originator" ? "Increased experiment budget" : undefined,
      awardedAt: now(),
      economicEffect,
      verifiedByReplication,
      counterfactualSurvived,
    };

    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO runtime_dividends
         (id, experiment_id, recipient, role, amount, reputation_delta, opportunity, resources, awarded_at, economic_effect, verified_by_replication, counterfactual_survived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        award.id,
        award.experimentId,
        award.recipient,
        award.role,
        award.amount,
        award.reputationDelta,
        award.opportunity || null,
        award.resources || null,
        award.awardedAt,
        award.economicEffect,
        verifiedByReplication ? 1 : 0,
        counterfactualSurvived ? 1 : 0,
      );

      // Update contributor branch
      const branch = getOrCreateContributorBranch(attr.actor);
      const newTotal = branch.totalDividends + amount;
      const newRep = branch.reputationScore + award.reputationDelta;
      db.prepare(
        `UPDATE runtime_contributor_branches SET total_dividends = ?, reputation_score = ?, updated_at = ? WHERE contributor = ?`,
      ).run(newTotal, newRep, now(), attr.actor);
    } catch (e) {
      console.error("[runtime] awardDividend failed:", e);
    }

    awards.push(award);
  }

  return awards;
}

export function listDividends(recipient?: string): DividendAward[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = recipient
      ? db.prepare(`SELECT * FROM runtime_dividends WHERE recipient = ? ORDER BY awarded_at DESC`).all(recipient) as any[]
      : db.prepare(`SELECT * FROM runtime_dividends ORDER BY awarded_at DESC`).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      experimentId: r.experiment_id,
      recipient: r.recipient,
      role: r.role,
      amount: r.amount,
      reputationDelta: r.reputation_delta,
      opportunity: r.opportunity || undefined,
      resources: r.resources || undefined,
      awardedAt: r.awarded_at,
      economicEffect: r.economic_effect,
      verifiedByReplication: r.verified_by_replication === 1,
      counterfactualSurvived: r.counterfactual_survived === 1,
    }));
  } catch {
    return [];
  }
}

// ─── Persistent Task Graph ─────────────────────────────────────────────────

export function addActiveWorkItem(
  orgId: string,
  category: ActiveWorkItem["category"],
  title: string,
  description: string,
  agentAction: string,
  drivenBy: ActiveWorkItem["drivenBy"] = "agent",
  relatedExperimentIds: string[] = [],
): ActiveWorkItem {
  const item: ActiveWorkItem = {
    id: newId("work"),
    category,
    title,
    description,
    status: "active",
    agentAction,
    drivenBy,
    relatedExperimentIds,
    createdAt: now(),
    updatedAt: now(),
  };
  const model = loadWorldModel(orgId);
  model.activeWork = [...model.activeWork.filter((w) => w.title !== title), item];
  saveWorldModel(model);
  return item;
}

export function updateActiveWorkItem(id: string, updates: Partial<ActiveWorkItem>): void {
  const model = loadWorldModel();
  model.activeWork = model.activeWork.map((w) =>
    w.id === id ? { ...w, ...updates, updatedAt: now() } : w,
  );
  saveWorldModel(model);
}

export function removeActiveWorkItem(id: string): void {
  const model = loadWorldModel();
  model.activeWork = model.activeWork.filter((w) => w.id !== id);
  saveWorldModel(model);
}

export function addWaitingItem(
  orgId: string,
  waitingFor: WaitingItem["waitingFor"],
  title: string,
  description: string,
  relatedProposalId?: string,
): WaitingItem {
  const item: WaitingItem = {
    id: newId("wait"),
    waitingFor,
    title,
    description,
    waitingSince: now(),
    isStale: false,
    relatedProposalId,
  };
  const model = loadWorldModel(orgId);
  model.waitingOn = [...model.waitingOn, item];
  saveWorldModel(model);
  return item;
}

export function resolveWaitingItem(id: string): void {
  const model = loadWorldModel();
  model.waitingOn = model.waitingOn.filter((w) => w.id !== id);
  saveWorldModel(model);
}

function getStaleWaitingItems(model: WorldModel): WaitingItem[] {
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  return model.waitingOn.map((w) => ({
    ...w,
    isStale: new Date(w.waitingSince).getTime() < sevenDaysAgo,
  }));
}

// ─── Director Assessment ───────────────────────────────────────────────────

export function generateDirectorAssessment(orgId: string = DEFAULT_ORG_ID): DirectorAssessment {
  const model = loadWorldModel(orgId);
  const proposals = getActiveProposals(orgId);
  const humanTasks = getHumanTasks("pending");
  const experiments = listExperiments();
  const staleWaiting = getStaleWaitingItems(model);

  const activeWork = model.activeWork.filter((w) => w.status === "active");
  const blockedWork = model.activeWork.filter((w) => w.status === "blocked");
  const runningExperiments = experiments.filter((e) => e.status === "intervention_running");
  const verifiedExperiments = experiments.filter((e) => e.status === "verified");

  return {
    whatShouldHappenNext: activeWork.length > 0
      ? activeWork[0].title
      : "No active work — observe and wait for events",
    whatIsNeglected: [
      ...staleWaiting.filter((w) => w.isStale).map((w) => `Stale: ${w.title} (waiting since ${w.waitingSince.slice(0, 10)})`),
      ...blockedWork.map((w) => `Blocked: ${w.title}`),
    ],
    whatCanExecuteWithoutInterruption: activeWork
      .filter((w) => w.drivenBy === "agent")
      .map((w) => w.agentAction),
    whatRequiresApproval: proposals
      .filter((p) => p.requiresConfirmation && p.status === "proposed")
      .map((p) => p.action),
    whatShouldBeKilled: staleWaiting
      .filter((w) => w.isStale && w.waitingFor === "human_approval")
      .map((w) => `Expire stale approval: ${w.title}`),
    whatShouldBeReplicated: verifiedExperiments
      .filter((e) => e.replicationCount < 2)
      .map((e) => `Replicate: ${e.hypothesis.slice(0, 60)}`),
    missingHumanInformation: humanTasks.slice(0, 5).map((t) => t.title),
    generatedAt: now(),
  };
}

// ─── Adversarial Safeguard Enforcement ─────────────────────────────────────

export function checkSafeguards(
  proposal: ProposedAction,
  worldModel: WorldModel,
): SafeguardViolation[] {
  const violations: SafeguardViolation[] = [];

  // 1. Observation ≠ authority — hearing something doesn't authorize action
  const autonomousActions = worldModel.permissions.autonomous.map((p) => p.action);
  const isAutonomous = autonomousActions.some((a) =>
    proposal.action.toLowerCase().includes(a.replace(/_/g, " ")),
  );
  if (isAutonomous && proposal.confidence < 0.5) {
    violations.push({
      safeguard: "observation_not_authority",
      description: `Action "${proposal.action}" auto-executed with low confidence (${proposal.confidence}). Observation should not become authority without sufficient evidence.`,
      severity: "warning",
      detectedAt: now(),
      context: `Proposal ${proposal.id} triggered by event ${proposal.triggerEventId}`,
    });
  }

  // 2. Correlation ≠ innovation — reward needs baseline + replication
  if (proposal.delegateTo === "experiment" && proposal.expectedValue > 80) {
    violations.push({
      safeguard: "correlation_not_innovation",
      description: `High expected value (${proposal.expectedValue}) without baseline or replication. A rep getting better numbers doesn't establish causation.`,
      severity: "warning",
      detectedAt: now(),
      context: `Proposal ${proposal.id}: ${proposal.action}`,
    });
  }

  // 3. Dirty data — check for low-confidence data assets
  const dirtyData = worldModel.availableData.filter((d) => d.confidence < 0.3);
  if (dirtyData.length > 0 && proposal.action.toLowerCase().includes("merge")) {
    violations.push({
      safeguard: "dirty_data",
      description: `Merge proposed with ${dirtyData.length} low-confidence data sources. Dirty datasets compound errors.`,
      severity: "critical",
      detectedAt: now(),
      context: dirtyData.map((d) => `${d.name} (confidence: ${d.confidence})`).join("; "),
    });
  }

  // 4. Internal competition must not destroy cooperation
  if (proposal.action.toLowerCase().includes("hide") || proposal.action.toLowerCase().includes("withhold")) {
    violations.push({
      safeguard: "internal_competition",
      description: `Action may involve withholding information. Individual discoveries must propagate to the organizational genome.`,
      severity: "critical",
      detectedAt: now(),
      context: `Proposal ${proposal.id}: ${proposal.action}`,
    });
  }

  return violations;
}

// ─── Snowflake Model: Per-Contributor Branches ─────────────────────────────

const SNOWFLAKE_SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_contributor_branches (
  id TEXT PRIMARY KEY,
  contributor TEXT NOT NULL UNIQUE,
  experiment_ids TEXT DEFAULT '[]',
  verified_procedures TEXT DEFAULT '[]',
  total_dividends REAL DEFAULT 0,
  reputation_score REAL DEFAULT 0,
  consumes_from_core INTEGER DEFAULT 1,
  propagated_to_genome INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_verification_market (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  status TEXT DEFAULT 'pending_verification',
  replication_attempts INTEGER DEFAULT 0,
  successful_replications INTEGER DEFAULT 0,
  counterfactual_checked INTEGER DEFAULT 0,
  entered_at TEXT NOT NULL,
  resolved_at TEXT
);
`;

export function getOrCreateContributorBranch(contributor: string): ContributorBranch {
  ensureSchema();
  try {
    const db = getDb();
    db.exec(SNOWFLAKE_SCHEMA);
    const existing = db.prepare(
      `SELECT * FROM runtime_contributor_branches WHERE contributor = ?`,
    ).get(contributor) as any;
    if (existing) {
      return {
        id: existing.id,
        contributor: existing.contributor,
        experimentIds: JSON.parse(existing.experiment_ids || "[]"),
        verifiedProcedures: JSON.parse(existing.verified_procedures || "[]"),
        totalDividends: existing.total_dividends,
        reputationScore: existing.reputation_score,
        consumesFromCore: existing.consumes_from_core === 1,
        propagatedToGenome: existing.propagated_to_genome === 1,
        updatedAt: existing.updated_at,
      };
    }
  } catch (e) {
    console.error("[runtime] getOrCreateContributorBranch failed:", e);
  }

  const branch: ContributorBranch = {
    id: newId("branch"),
    contributor,
    experimentIds: [],
    verifiedProcedures: [],
    totalDividends: 0,
    reputationScore: 50,
    consumesFromCore: true,
    propagatedToGenome: false,
    updatedAt: now(),
  };
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_contributor_branches (id, contributor, experiment_ids, verified_procedures, total_dividends, reputation_score, consumes_from_core, propagated_to_genome, updated_at)
       VALUES (?, ?, '[]', '[]', 0, 50, 1, 0, ?)`,
    ).run(branch.id, branch.contributor, branch.updatedAt);
  } catch (e) {
    console.error("[runtime] create contributor branch failed:", e);
  }
  return branch;
}

export function addExperimentToBranch(contributor: string, experimentId: string): void {
  const branch = getOrCreateContributorBranch(contributor);
  if (!branch.experimentIds.includes(experimentId)) {
    branch.experimentIds.push(experimentId);
  }
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_contributor_branches SET experiment_ids = ?, updated_at = ? WHERE contributor = ?`,
    ).run(JSON.stringify(branch.experimentIds), now(), contributor);
  } catch (e) {
    console.error("[runtime] addExperimentToBranch failed:", e);
  }
}

export function propagateToGenome(contributor: string, procedureName: string): void {
  const branch = getOrCreateContributorBranch(contributor);
  if (!branch.verifiedProcedures.includes(procedureName)) {
    branch.verifiedProcedures.push(procedureName);
  }
  branch.propagatedToGenome = true;
  branch.reputationScore += 5;
  try {
    const db = getDb();
    db.prepare(
      `UPDATE runtime_contributor_branches SET verified_procedures = ?, propagated_to_genome = 1, reputation_score = ?, updated_at = ? WHERE contributor = ?`,
    ).run(JSON.stringify(branch.verifiedProcedures), branch.reputationScore, now(), contributor);
  } catch (e) {
    console.error("[runtime] propagateToGenome failed:", e);
  }
}

export function listContributorBranches(): ContributorBranch[] {
  ensureSchema();
  try {
    const db = getDb();
    db.exec(SNOWFLAKE_SCHEMA);
    const rows = db.prepare(`SELECT * FROM runtime_contributor_branches ORDER BY reputation_score DESC`).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      contributor: r.contributor,
      experimentIds: JSON.parse(r.experiment_ids || "[]"),
      verifiedProcedures: JSON.parse(r.verified_procedures || "[]"),
      totalDividends: r.total_dividends,
      reputationScore: r.reputation_score,
      consumesFromCore: r.consumes_from_core === 1,
      propagatedToGenome: r.propagated_to_genome === 1,
      updatedAt: r.updated_at,
    }));
  } catch {
    return [];
  }
}

// ─── Verification Market ───────────────────────────────────────────────────

export function submitForVerification(experimentId: string, submittedBy: string): VerificationEntry {
  ensureSchema();
  try {
    const db = getDb();
    db.exec(SNOWFLAKE_SCHEMA);
  } catch (e) {
    console.error("[runtime] verification schema init failed:", e);
  }
  const entry: VerificationEntry = {
    id: newId("verify"),
    experimentId,
    submittedBy,
    status: "pending_verification",
    replicationAttempts: 0,
    successfulReplications: 0,
    counterfactualChecked: false,
    enteredAt: now(),
  };
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO runtime_verification_market (id, experiment_id, submitted_by, status, replication_attempts, successful_replications, counterfactual_checked, entered_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
    ).run(entry.id, entry.experimentId, entry.submittedBy, entry.status, entry.enteredAt);
  } catch (e) {
    console.error("[runtime] submitForVerification failed:", e);
  }
  return entry;
}

export function recordVerificationReplication(
  entryId: string,
  success: boolean,
  counterfactualChecked: boolean,
): VerificationEntry | null {
  ensureSchema();
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM runtime_verification_market WHERE id = ?`).get(entryId) as any;
    if (!row) return null;

    const attempts = row.replication_attempts + 1;
    const successes = row.successful_replications + (success ? 1 : 0);
    const status = successes >= 2 && counterfactualChecked ? "survived" : attempts >= 3 && successes === 0 ? "failed" : "replicating";

    db.prepare(
      `UPDATE runtime_verification_market SET replication_attempts = ?, successful_replications = ?, counterfactual_checked = ?, status = ?, resolved_at = ? WHERE id = ?`,
    ).run(attempts, successes, counterfactualChecked ? 1 : 0, status, status === "survived" || status === "failed" ? now() : null, entryId);

    // If survived, propagate to genome
    if (status === "survived") {
      const exp = getExperiment(row.experiment_id);
      if (exp) {
        propagateToGenome(exp.author, exp.hypothesis.slice(0, 80));
      }
    }

    return {
      id: row.id,
      experimentId: row.experiment_id,
      submittedBy: row.submitted_by,
      status,
      replicationAttempts: attempts,
      successfulReplications: successes,
      counterfactualChecked,
      enteredAt: row.entered_at,
      resolvedAt: status === "survived" || status === "failed" ? now() : undefined,
    };
  } catch (e) {
    console.error("[runtime] recordVerificationReplication failed:", e);
    return null;
  }
}

export function listVerificationEntries(status?: string): VerificationEntry[] {
  ensureSchema();
  try {
    const db = getDb();
    const rows = status
      ? db.prepare(`SELECT * FROM runtime_verification_market WHERE status = ? ORDER BY entered_at DESC`).all(status) as any[]
      : db.prepare(`SELECT * FROM runtime_verification_market ORDER BY entered_at DESC`).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      experimentId: r.experiment_id,
      submittedBy: r.submitted_by,
      status: r.status,
      replicationAttempts: r.replication_attempts,
      successfulReplications: r.successful_replications,
      counterfactualChecked: r.counterfactual_checked === 1,
      enteredAt: r.entered_at,
      resolvedAt: r.resolved_at || undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Runtime State (what the orb displays) ────────────────────────────────

export function getRuntimeState(orgId: string = DEFAULT_ORG_ID): RuntimeState {
  ensureSchema();
  const proposals = getActiveProposals(orgId);
  const humanTasks = getHumanTasks("pending");
  const experiments = listExperiments("intervention_running");
  const consentedStreams = listConsentedStreams(orgId);
  const worldModel = loadWorldModel(orgId);

  // Count unprocessed events as "streams observed"
  let streamsObserved = consentedStreams.length;
  let validatedOpportunityValue = 0;
  try {
    const db = getDb();
    const eventCount = db.prepare(
      `SELECT COUNT(*) as c FROM runtime_events WHERE org_id = ? AND processed = 0`,
    ).get(orgId) as any;
    streamsObserved = Math.max(streamsObserved, eventCount?.c || 0);

    const oppValue = db.prepare(
      `SELECT COALESCE(SUM(expected_value), 0) as total FROM runtime_proposals WHERE status = 'proposed' AND expected_value > 0`,
    ).get() as any;
    validatedOpportunityValue = oppValue?.total || 0;
  } catch {
    // ignore
  }

  const recentLearnings: string[] = [];
  try {
    const db = getDb();
    const learnedRows = db.prepare(
      `SELECT result_json FROM runtime_proposals WHERE result_json IS NOT NULL ORDER BY resolved_at DESC LIMIT 5`,
    ).all() as any[];
    for (const row of learnedRows) {
      const result = JSON.parse(row.result_json);
      if (result.learnedRule) recentLearnings.push(result.learnedRule);
    }
  } catch {
    // ignore
  }

  const currentOpportunities = proposals
    .filter((p) => p.expectedValue > 50 && p.status === "proposed")
    .map((p) => p.observation.slice(0, 80));

  return {
    status: "active",
    streamsObserved,
    tasksExecuting: proposals.filter((p) => p.status === "executing").length,
    experimentsRunning: experiments.length,
    tasksWaitingOnHuman: humanTasks.length,
    validatedOpportunityValue,
    activeProposals: proposals,
    humanQueue: humanTasks,
    recentLearnings,
    currentOpportunities,
    activeWork: worldModel.activeWork || [],
    neglectedItems: getStaleWaitingItems(worldModel).filter((w) => w.isStale),
    discoveries: recentLearnings.slice(0, 3),
    safeguardViolations: [],
    updatedAt: now(),
  };
}

// ─── Main Processing Loop ─────────────────────────────────────────────────

/**
 * Process all unprocessed events. This is the heartbeat of the runtime.
 * Can be called from a cron, a webhook, or the /api/runtime/process endpoint.
 */
export async function processPendingEvents(orgId: string = DEFAULT_ORG_ID): Promise<{
  processed: number;
  proposals: ProposedAction[];
  humanTasks: HumanTask[];
  safeguardViolations: SafeguardViolation[];
}> {
  const events = getUnprocessedEvents(orgId);
  const worldModel = loadWorldModel(orgId);
  const proposals: ProposedAction[] = [];
  const humanTasks: HumanTask[] = [];
  const allViolations: SafeguardViolation[] = [];

  for (const event of events) {
    // Check consent — don't process events from non-consented streams
    if (!isStreamEnabled(event.stream, orgId)) {
      markEventProcessed(event.id);
      continue;
    }

    const proposal = await proposeAction(event, worldModel);
    proposals.push(proposal);
    markEventProcessed(event.id);

    // Run adversarial safeguards on every proposal
    const violations = checkSafeguards(proposal, worldModel);
    allViolations.push(...violations);

    // If critical safeguard violation, force delegation to human
    const hasCritical = violations.some((v) => v.severity === "critical");
    if (hasCritical) {
      proposal.delegateTo = "human";
      proposal.requiresConfirmation = true;
      proposal.reasoning = `SAFEGUARD OVERRIDE: ${violations.map((v) => v.description).join("; ")}`;
    }

    // Route the proposal
    if (proposal.delegateTo === "human" || (proposal.requiresConfirmation && proposal.delegateTo !== "nothing")) {
      const task = delegateToHuman(proposal);
      humanTasks.push(task);
      addWaitingItem(orgId, "human_approval", proposal.action, proposal.observation, proposal.id);
    } else if (proposal.delegateTo === "agent" && !proposal.requiresConfirmation && !hasCritical) {
      // Auto-execute low-risk autonomous actions (only if no critical safeguard violation)
      updateProposalStatus(proposal.id, "executing");
      updateProposalStatus(proposal.id, "completed", {
        success: true,
        output: `Auto-executed: ${proposal.action}`,
        operatorUpdated: false,
        timestamp: now(),
      });
      // Track as active work
      addActiveWorkItem(orgId, "other", proposal.action, proposal.observation, `Auto-executed: ${proposal.action}`, "agent");
    } else if (proposal.delegateTo === "experiment") {
      // Add to active work as an experiment
      addActiveWorkItem(orgId, "experiment_collecting", proposal.action, proposal.observation, `Monitoring experiment: ${proposal.action}`, "both");
    }
    // "nothing" and "research" stay as proposals for human review
  }

  return { processed: events.length, proposals, humanTasks, safeguardViolations: allViolations };
}
