/**
 * Governed Experiment Store — SQLite-backed persistence.
 *
 * Every write creates a new version or appends an immutable event.
 * No operation overwrites or deletes a prior version.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { getDb, DEFAULT_ORG_ID } from "@/lib/db";
import {
  GovernedExperiment,
  ExperimentState,
  ComplianceState,
  ExecutionEvent,
  ExecutionEventType,
  VALID_STATE_TRANSITIONS,
  VALID_COMPLIANCE_TRANSITIONS,
  ActionResult,
  EvidenceItem,
  ConfounderRecord,
  EffectReport,
  CausalReveal,
  StructuredClaim,
  PriorArtSummary,
  ExperimentalDesign,
  DesignField,
  ContributionSeparation,
  ComplianceDimensions,
  SpinSummary,
  EnvironmentStatus,
  DEVELOPMENT_ENVIRONMENT_STATUS,
  DEFAULT_COMPLIANCE_DIMENSIONS,
  designFieldCompleteness,
} from "./governed-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utcNow(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${nanoid(12).toUpperCase()}`;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function emptyDesignField(label: string): DesignField {
  return { key: label.toLowerCase().replace(/\s+/g, "_"), label, value: "", completeness: "incomplete" };
}

function defaultDesign(): ExperimentalDesign {
  return {
    eligibilityRules: emptyDesignField("Eligibility rules"),
    exclusions: emptyDesignField("Exclusions"),
    treatment: emptyDesignField("Treatment"),
    comparison: emptyDesignField("Comparison"),
    assignmentMethod: emptyDesignField("Assignment method"),
    sampleTarget: emptyDesignField("Sample target"),
    primaryMetric: emptyDesignField("Primary metric"),
    secondaryMetrics: emptyDesignField("Secondary metrics"),
    observationWindow: emptyDesignField("Observation window"),
    stoppingConditions: emptyDesignField("Stopping conditions"),
    allowedDeviations: emptyDesignField("Allowed deviations"),
    prohibitedDeviations: emptyDesignField("Prohibited deviations"),
    instrumentation: emptyDesignField("Instrumentation"),
    attributionPlan: emptyDesignField("Attribution plan"),
    escalationRules: emptyDesignField("Escalation rules"),
    complianceRestrictions: emptyDesignField("Compliance restrictions"),
  };
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ExperimentRow {
  id: string;
  org_id: string;
  hypothesis_id: string | null;
  hypothesis_version: number;
  spin_id: string | null;
  spin_version: number | null;
  owner: string;
  assigned_participant: string | null;
  experiment_state: string;
  compliance_state: string;
  evidence_class: string;
  observation_window_days: number;
  parent_experiment_id: string | null;
  derivative_ids: string;
  replication_of_id: string | null;
  version: number;
  previous_version_id: string | null;
  experiment_data: string;
  created_at: string;
  last_approved_at: string | null;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  experiment_id: string;
  org_id: string;
  actor: string;
  event_type: string;
  source: string;
  previous_event_hash: string;
  payload_hash: string;
  result: string;
  approval_state: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function rowToExperiment(row: ExperimentRow): GovernedExperiment {
  const data = JSON.parse(row.experiment_data || "{}");
  return {
    id: row.id,
    organizationId: row.org_id,
    hypothesisId: row.hypothesis_id || "",
    hypothesisVersion: row.hypothesis_version,
    spinId: row.spin_id || undefined,
    spinVersion: row.spin_version || undefined,
    owner: row.owner,
    assignedParticipant: row.assigned_participant || "",
    experimentState: row.experiment_state as ExperimentState,
    complianceState: row.compliance_state as ComplianceState,
    evidenceClass: row.evidence_class,
    observationWindowDays: row.observation_window_days,
    createdAt: row.created_at,
    lastApprovedAt: row.last_approved_at || undefined,
    parentExperimentId: row.parent_experiment_id || undefined,
    derivativeExperimentIds: JSON.parse(row.derivative_ids || "[]"),
    replicationOfId: row.replication_of_id || undefined,
    version: row.version,
    previousVersionId: row.previous_version_id || undefined,
    claim: data.claim || { population: "", intervention: "", comparison: "", outcome: "", timePeriod: "", mechanism: "", risk: "", falsificationCondition: "" },
    claimProse: data.claimProse || "",
    evidence: data.evidence || [],
    priorArt: data.priorArt || { classification: "untested", establishedSummary: "", transferredSummary: "", internalSignalSummary: "", noveltyDelta: "" },
    design: data.design || defaultDesign(),
    spinSummary: data.spinSummary,
    contributions: data.contributions || { modelContribution: [], humanContribution: [] },
    complianceDimensions: data.complianceDimensions || DEFAULT_COMPLIANCE_DIMENSIONS,
    confounders: data.confounders || [],
    events: [],
    effectReport: data.effectReport,
    causalReveal: data.causalReveal,
    environmentStatus: data.environmentStatus || DEVELOPMENT_ENVIRONMENT_STATUS,
  };
}

function rowToEvent(row: EventRow): ExecutionEvent {
  return {
    eventId: row.event_id,
    experimentId: row.experiment_id,
    organizationId: row.org_id,
    actor: row.actor,
    timestamp: row.timestamp,
    source: row.source,
    eventType: row.event_type as ExecutionEventType,
    previousEventHash: row.previous_event_hash,
    payloadHash: row.payload_hash,
    result: row.result,
    approvalState: row.approval_state,
  };
}

function experimentToData(exp: GovernedExperiment): string {
  return JSON.stringify({
    claim: exp.claim,
    claimProse: exp.claimProse,
    evidence: exp.evidence,
    priorArt: exp.priorArt,
    design: exp.design,
    spinSummary: exp.spinSummary,
    contributions: exp.contributions,
    complianceDimensions: exp.complianceDimensions,
    confounders: exp.confounders,
    effectReport: exp.effectReport,
    causalReveal: exp.causalReveal,
    environmentStatus: exp.environmentStatus,
  });
}

// ---------------------------------------------------------------------------
// Event chain
// ---------------------------------------------------------------------------

function getLatestEventHash(experimentId: string): string {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT payload_hash FROM governed_experiment_events WHERE experiment_id = ? ORDER BY timestamp DESC LIMIT 1`,
    )
    .get(experimentId) as { payload_hash: string } | undefined;
  return row?.payload_hash || "";
}

function appendEvent(
  experimentId: string,
  orgId: string,
  actor: string,
  eventType: ExecutionEventType,
  result: string,
  approvalState: string,
  payload: Record<string, unknown>,
): ExecutionEvent {
  const db = getDb();
  const eventId = newId("EVT");
  const previousHash = getLatestEventHash(experimentId);
  const payloadStr = JSON.stringify(payload);
  const payloadHash = sha256(payloadStr + previousHash);

  db.prepare(
    `INSERT INTO governed_experiment_events
     (event_id, experiment_id, org_id, actor, event_type, source, previous_event_hash, payload_hash, result, approval_state, timestamp)
     VALUES (?, ?, ?, ?, ?, 'api', ?, ?, ?, ?, ?)`,
  ).run(eventId, experimentId, orgId, actor, eventType, previousHash, payloadHash, result, approvalState, utcNow());

  return {
    eventId,
    experimentId,
    organizationId: orgId,
    actor,
    timestamp: utcNow(),
    source: "api",
    eventType,
    previousEventHash: previousHash,
    payloadHash,
    result,
    approvalState,
  };
}

// ---------------------------------------------------------------------------
// State transition validation
// ---------------------------------------------------------------------------

function validateStateTransition(from: ExperimentState, to: ExperimentState): boolean {
  const allowed = VALID_STATE_TRANSITIONS[from];
  return allowed.includes(to);
}

function validateComplianceTransition(from: ComplianceState, to: ComplianceState): boolean {
  const allowed = VALID_COMPLIANCE_TRANSITIONS[from];
  return allowed.includes(to);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createExperiment(input: {
  organizationId?: string;
  hypothesisId?: string;
  owner: string;
  assignedParticipant?: string;
  claim: StructuredClaim;
  claimProse: string;
  priorArt?: Partial<PriorArtSummary>;
  contributions?: Partial<ContributionSeparation>;
  observationWindowDays?: number;
  evidenceClass?: string;
}): GovernedExperiment {
  const db = getDb();
  const id = newId("EXP");
  const orgId = input.organizationId || DEFAULT_ORG_ID;
  const now = utcNow();

  const exp: GovernedExperiment = {
    id,
    organizationId: orgId,
    hypothesisId: input.hypothesisId || "",
    hypothesisVersion: 1,
    owner: input.owner,
    assignedParticipant: input.assignedParticipant || "",
    experimentState: "draft",
    complianceState: "draft",
    evidenceClass: input.evidenceClass || "internal_signal",
    observationWindowDays: input.observationWindowDays || 14,
    createdAt: now,
    derivativeExperimentIds: [],
    version: 1,
    claim: input.claim,
    claimProse: input.claimProse,
    evidence: [],
    priorArt: {
      classification: input.priorArt?.classification || "untested",
      establishedSummary: input.priorArt?.establishedSummary || "",
      transferredSummary: input.priorArt?.transferredSummary || "",
      internalSignalSummary: input.priorArt?.internalSignalSummary || "",
      noveltyDelta: input.priorArt?.noveltyDelta || "",
    },
    design: defaultDesign(),
    contributions: {
      modelContribution: input.contributions?.modelContribution || [],
      humanContribution: input.contributions?.humanContribution || [],
    },
    complianceDimensions: DEFAULT_COMPLIANCE_DIMENSIONS,
    confounders: [],
    events: [],
    environmentStatus: DEVELOPMENT_ENVIRONMENT_STATUS,
  };

  db.prepare(
    `INSERT INTO governed_experiments
     (id, org_id, hypothesis_id, hypothesis_version, owner, assigned_participant,
      experiment_state, compliance_state, evidence_class, observation_window_days,
      derivative_ids, version, experiment_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
  ).run(
    id, orgId, input.hypothesisId || null, 1, input.owner, input.assignedParticipant || null,
    "draft", "draft", exp.evidenceClass, exp.observationWindowDays,
    1, experimentToData(exp), now, now,
  );

  const event = appendEvent(id, orgId, input.owner, "hypothesis_generated", "Experiment created", "draft", { claim: input.claim });
  exp.events = [event];
  return exp;
}

export function getExperiment(id: string): GovernedExperiment | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM governed_experiments WHERE id = ?`).get(id) as ExperimentRow | undefined;
  if (!row) return null;
  const exp = rowToExperiment(row);
  exp.events = getEvents(id);
  return exp;
}

export function listExperiments(orgId?: string): GovernedExperiment[] {
  const db = getDb();
  const rows = orgId
    ? db.prepare(`SELECT * FROM governed_experiments WHERE org_id = ? ORDER BY updated_at DESC`).all(orgId) as ExperimentRow[]
    : db.prepare(`SELECT * FROM governed_experiments ORDER BY updated_at DESC`).all() as ExperimentRow[];
  return rows.map(rowToExperiment);
}

export function getEvents(experimentId: string): ExecutionEvent[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM governed_experiment_events WHERE experiment_id = ? ORDER BY timestamp ASC`)
    .all(experimentId) as EventRow[];
  return rows.map(rowToEvent);
}

// ---------------------------------------------------------------------------
// Save (internal — persists experiment data without creating events)
// ---------------------------------------------------------------------------

function saveExperiment(exp: GovernedExperiment): void {
  const db = getDb();
  db.prepare(
    `UPDATE governed_experiments SET
      experiment_state = ?, compliance_state = ?, experiment_data = ?,
      hypothesis_version = ?, spin_id = ?, spin_version = ?,
      last_approved_at = ?, derivative_ids = ?, version = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    exp.experimentState, exp.complianceState, experimentToData(exp),
    exp.hypothesisVersion, exp.spinId || null, exp.spinVersion || null,
    exp.lastApprovedAt || null, JSON.stringify(exp.derivativeExperimentIds),
    exp.version, utcNow(), exp.id,
  );
}

// ---------------------------------------------------------------------------
// State machine actions
// ---------------------------------------------------------------------------

function transitionState(
  exp: GovernedExperiment,
  newState: ExperimentState,
  actor: string,
  eventType: ExecutionEventType,
  result: string,
  approvalState: string,
  payload: Record<string, unknown>,
): ActionResult {
  if (!validateStateTransition(exp.experimentState, newState)) {
    return {
      success: false,
      experimentId: exp.id,
      newState: exp.experimentState,
      newComplianceState: exp.complianceState,
      eventId: "",
      eventHash: "",
      timestamp: utcNow(),
      message: `Invalid state transition: ${exp.experimentState} → ${newState}`,
      errors: [`Transition from ${exp.experimentState} to ${newState} is not permitted`],
    };
  }

  const oldState = exp.experimentState;
  exp.experimentState = newState;
  saveExperiment(exp);

  const event = appendEvent(exp.id, exp.organizationId, actor, eventType, result, approvalState, { ...payload, oldState, newState });

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: result,
  };
}

function transitionCompliance(
  exp: GovernedExperiment,
  newCompliance: ComplianceState,
  actor: string,
  eventType: ExecutionEventType,
  result: string,
  payload: Record<string, unknown>,
): ActionResult {
  if (!validateComplianceTransition(exp.complianceState, newCompliance)) {
    return {
      success: false,
      experimentId: exp.id,
      newState: exp.experimentState,
      newComplianceState: exp.complianceState,
      eventId: "",
      eventHash: "",
      timestamp: utcNow(),
      message: `Invalid compliance transition: ${exp.complianceState} → ${newCompliance}`,
      errors: [`Compliance transition from ${exp.complianceState} to ${newCompliance} is not permitted`],
    };
  }

  exp.complianceState = newCompliance;
  saveExperiment(exp);

  const event = appendEvent(exp.id, exp.organizationId, actor, eventType, result, newCompliance, { ...payload, oldCompliance: exp.complianceState, newCompliance });

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: result,
  };
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export function reviseExperiment(id: string, actor: string, changes: Partial<StructuredClaim>): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const newVersion = exp.version + 1;
  const newId = `EXP-${nanoid(12).toUpperCase()}`;
  const db = getDb();

  // Create a new version, keeping the old one intact
  const revised: GovernedExperiment = {
    ...exp,
    id: newId,
    version: newVersion,
    previousVersionId: exp.id,
    claim: { ...exp.claim, ...changes },
    claimProse: buildClaimProse({ ...exp.claim, ...changes }),
    experimentState: "draft",
    complianceState: "draft",
    createdAt: utcNow(),
    derivativeExperimentIds: [],
    events: [],
  };

  db.prepare(
    `INSERT INTO governed_experiments
     (id, org_id, hypothesis_id, hypothesis_version, owner, assigned_participant,
      experiment_state, compliance_state, evidence_class, observation_window_days,
      parent_experiment_id, derivative_ids, version, previous_version_id,
      experiment_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
  ).run(
    newId, exp.organizationId, exp.hypothesisId, exp.hypothesisVersion,
    exp.owner, exp.assignedParticipant, "draft", "draft", exp.evidenceClass,
    exp.observationWindowDays, exp.id, newVersion, exp.id,
    experimentToData(revised), utcNow(), utcNow(),
  );

  const event = appendEvent(newId, exp.organizationId, actor, "version_created", `Revised from ${exp.id}`, "draft", { parentId: exp.id, changes });
  return {
    success: true,
    experimentId: newId,
    newState: "draft",
    newComplianceState: "draft",
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `New version ${newVersion} created from ${exp.id}`,
  };
}

export function challengeExperiment(id: string, actor: string, alternativeExplanations: string[], threatsToValidity: string[]): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const event = appendEvent(exp.id, exp.organizationId, actor, "challenge_created", "Adversarial review created", exp.complianceState, { alternativeExplanations, threatsToValidity });

  // Add confounders from threats
  for (const threat of threatsToValidity) {
    const conf: ConfounderRecord = {
      id: newId("CONF"),
      description: threat,
      state: "unresolved",
      evidence: "Identified during adversarial challenge",
      addedAt: utcNow(),
    };
    exp.confounders.push(conf);
  }
  saveExperiment(exp);

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Challenge created with ${alternativeExplanations.length} alternative explanations and ${threatsToValidity.length} threats to validity`,
  };
}

export function approveExperiment(id: string, actor: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const designCheck = designFieldCompleteness(exp.design);
  if (!designCheck.admissibilityPassed) {
    return fail(id, `Admissibility precheck failed: ${designCheck.incomplete} incomplete, ${designCheck.blocked} blocked fields`);
  }

  exp.lastApprovedAt = utcNow();
  const result1 = transitionCompliance(exp, "review_required", actor, "compliance_submitted", "Compliance review requested", {});
  if (!result1.success) return result1;

  // Auto-approve in development mode (would require human review in production)
  const result2 = transitionCompliance(exp, "approved", actor, "compliance_approved", "Compliance approved", {});
  if (!result2.success) return result2;

  return transitionState(exp, "approved", actor, "compliance_approved", "Experiment approved and ready to plant", "approved", {});
}

export function plantExperiment(id: string, actor: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  if (exp.experimentState !== "approved") {
    return fail(id, `Experiment must be in 'approved' state to plant. Current: ${exp.experimentState}`);
  }

  const result = transitionCompliance(exp, "active", actor, "compliance_approved", "Compliance activated for execution", {});
  if (!result.success) return result;

  return transitionState(exp, "active", actor, "experiment_planted", "Experiment planted and active", "active", {});
}

export function observeExperiment(id: string, actor: string, observation: {
  outcomeDescription: string;
  metrics?: { metric: string; value: number; unit: string; baseline: number; higherIsBetter: boolean }[];
  falsified?: boolean;
  externalFactors?: string[];
  deviation?: string;
}): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  if (exp.experimentState !== "active" && exp.experimentState !== "paused") {
    return fail(id, `Experiment must be active or paused to observe. Current: ${exp.experimentState}`);
  }

  const eventType: ExecutionEventType = observation.deviation ? "deviation_recorded" : "outcome_observed";
  const event = appendEvent(exp.id, exp.organizationId, actor, eventType, observation.outcomeDescription, exp.complianceState, observation);

  // If metrics provided, compute effect report
  if (observation.metrics && observation.metrics.length > 0) {
    const m = observation.metrics[0];
    const baseline = m.baseline;
    const observed = m.value;
    const absoluteChange = observed - baseline;
    const relativeChange = baseline !== 0 ? absoluteChange / Math.abs(baseline) : 0;

    exp.effectReport = {
      baseline,
      observed,
      absoluteChange,
      relativeChange,
      baselineSample: 0,
      treatmentSample: 0,
      observationWindowDays: exp.observationWindowDays,
      missingOutcomes: 0,
      replicationCount: 0,
    };

    // Determine causal reveal conservatively
    if (observation.falsified) {
      exp.causalReveal = "rejected";
    } else if (Math.abs(relativeChange) < 0.05) {
      exp.causalReveal = "inconclusive";
    } else {
      exp.causalReveal = "promising";
    }
  }

  saveExperiment(exp);

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: observation.deviation ? `Deviation recorded: ${observation.deviation}` : "Outcome observed",
  };
}

export function addConfounder(id: string, actor: string, description: string, evidence: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const conf: ConfounderRecord = {
    id: newId("CONF"),
    description,
    state: "unresolved",
    evidence,
    addedAt: utcNow(),
  };
  exp.confounders.push(conf);
  saveExperiment(exp);

  const event = appendEvent(exp.id, exp.organizationId, actor, "confounder_added", `Confounder added: ${description}`, exp.complianceState, { confounderId: conf.id });

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Confounder added: ${description}`,
  };
}

export function resolveConfounder(id: string, actor: string, confounderId: string, state: "unresolved" | "measured" | "controlled" | "unlikely" | "confirmed", evidence: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const conf = exp.confounders.find((c) => c.id === confounderId);
  if (!conf) return fail(id, "Confounder not found");

  conf.state = state;
  conf.evidence = evidence;
  conf.resolvedAt = utcNow();
  saveExperiment(exp);

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: newId("EVT"),
    eventHash: sha256(confounderId + state + utcNow()),
    timestamp: utcNow(),
    message: `Confounder ${confounderId} resolved as ${state}`,
  };
}

export function deriveExperiment(id: string, actor: string, changedVariable: string, newValue: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const childId = newId("EXP");
  const db = getDb();

  const child: GovernedExperiment = {
    ...exp,
    id: childId,
    version: 1,
    previousVersionId: undefined,
    parentExperimentId: exp.id,
    experimentState: "draft",
    complianceState: "draft",
    createdAt: utcNow(),
    derivativeExperimentIds: [],
    events: [],
    claim: { ...exp.claim, [changedVariable]: newValue },
    claimProse: buildClaimProse({ ...exp.claim, [changedVariable]: newValue }),
  };

  db.prepare(
    `INSERT INTO governed_experiments
     (id, org_id, hypothesis_id, hypothesis_version, owner, assigned_participant,
      experiment_state, compliance_state, evidence_class, observation_window_days,
      parent_experiment_id, derivative_ids, version, experiment_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?, ?)`,
  ).run(
    childId, exp.organizationId, exp.hypothesisId, exp.hypothesisVersion,
    exp.owner, exp.assignedParticipant, "draft", "draft", exp.evidenceClass,
    exp.observationWindowDays, exp.id, experimentToData(child), utcNow(), utcNow(),
  );

  // Update parent's derivative list
  exp.derivativeExperimentIds.push(childId);
  saveExperiment(exp);

  const event = appendEvent(childId, exp.organizationId, actor, "hypothesis_generated", `Derivative of ${exp.id} with ${changedVariable}=${newValue}`, "draft", { parentId: exp.id, changedVariable, newValue });

  return {
    success: true,
    experimentId: childId,
    newState: "draft",
    newComplianceState: "draft",
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Derivative experiment ${childId} created with ${changedVariable} changed`,
  };
}

export function replicateExperiment(id: string, actor: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const replicaId = newId("EXP");
  const db = getDb();

  const replica: GovernedExperiment = {
    ...exp,
    id: replicaId,
    version: 1,
    previousVersionId: undefined,
    replicationOfId: exp.id,
    parentExperimentId: undefined,
    experimentState: "draft",
    complianceState: "draft",
    createdAt: utcNow(),
    derivativeExperimentIds: [],
    events: [],
    effectReport: undefined,
    causalReveal: undefined,
  };

  db.prepare(
    `INSERT INTO governed_experiments
     (id, org_id, hypothesis_id, hypothesis_version, owner, assigned_participant,
      experiment_state, compliance_state, evidence_class, observation_window_days,
      derivative_ids, replication_of_id, version, experiment_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 1, ?, ?, ?)`,
  ).run(
    replicaId, exp.organizationId, exp.hypothesisId, exp.hypothesisVersion,
    exp.owner, exp.assignedParticipant, "draft", "draft", exp.evidenceClass,
    exp.observationWindowDays, exp.id, experimentToData(replica), utcNow(), utcNow(),
  );

  const event = appendEvent(replicaId, exp.organizationId, actor, "replication_requested", `Replication of ${exp.id}`, "draft", { originalId: exp.id });

  return {
    success: true,
    experimentId: replicaId,
    newState: "draft",
    newComplianceState: "draft",
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Replication experiment ${replicaId} created`,
  };
}

export function pauseExperiment(id: string, actor: string, reason: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");
  return transitionState(exp, "paused", actor, "experiment_paused", `Paused: ${reason}`, exp.complianceState, { reason });
}

export function blockExperiment(id: string, actor: string, reason: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const result = transitionCompliance(exp, "blocked", actor, "experiment_blocked", `Blocked: ${reason}`, { reason });
  if (!result.success) return result;

  return transitionState(exp, "blocked", actor, "experiment_blocked", `Blocked: ${reason}`, "blocked", { reason });
}

export function closeExperiment(id: string, actor: string): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const event = appendEvent(exp.id, exp.organizationId, actor, "observation_window_closed", "Observation window closed", exp.complianceState, {});

  // Move to under_attribution if we have results
  if (exp.effectReport) {
    return transitionState(exp, "under_attribution", actor, "attribution_calculated", "Moved to attribution analysis", exp.complianceState, {});
  }

  return transitionState(exp, "completed", actor, "experiment_closed", "Experiment completed", exp.complianceState, {});
}

export function addEvidence(id: string, actor: string, evidence: Omit<EvidenceItem, "id" | "provenanceHash">): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const item: EvidenceItem = {
    ...evidence,
    id: newId("EVI"),
    provenanceHash: sha256(JSON.stringify(evidence)),
  };
  exp.evidence.push(item);
  saveExperiment(exp);

  const event = appendEvent(exp.id, exp.organizationId, actor, "evidence_reviewed", `Evidence added: ${item.direction}`, exp.complianceState, { evidenceId: item.id });

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Evidence item added: ${item.direction}`,
  };
}

export function updateDesignField(id: string, actor: string, fieldKey: string, value: string, completeness: "complete" | "incomplete" | "awaiting_review" | "approved" | "blocked" | "superseded"): ActionResult {
  const exp = getExperiment(id);
  if (!exp) return fail(id, "Experiment not found");

  const design = exp.design as unknown as Record<string, DesignField>;
  const field = Object.values(design).find((f) => f.key === fieldKey);
  if (!field) return fail(id, `Design field ${fieldKey} not found`);

  field.value = value;
  field.completeness = completeness;
  saveExperiment(exp);

  const event = appendEvent(exp.id, exp.organizationId, actor, "protocol_revised", `Design field ${fieldKey} updated`, exp.complianceState, { fieldKey, value, completeness });

  return {
    success: true,
    experimentId: exp.id,
    newState: exp.experimentState,
    newComplianceState: exp.complianceState,
    eventId: event.eventId,
    eventHash: event.payloadHash,
    timestamp: event.timestamp,
    message: `Design field ${fieldKey} updated to ${completeness}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(experimentId: string, message: string): ActionResult {
  return {
    success: false,
    experimentId,
    newState: "draft",
    newComplianceState: "draft",
    eventId: "",
    eventHash: "",
    timestamp: utcNow(),
    message,
    errors: [message],
  };
}

function buildClaimProse(claim: StructuredClaim): string {
  return `Among ${claim.population}, ${claim.intervention} compared with ${claim.comparison} will improve ${claim.outcome} within ${claim.timePeriod}. Mechanism: ${claim.mechanism}. Risk: ${claim.risk}. Falsification condition: ${claim.falsificationCondition}.`;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function governedExperimentsHealth(): { ok: boolean; count: number; eventCount: number } {
  try {
    const db = getDb();
    const expCount = db.prepare(`SELECT COUNT(*) as c FROM governed_experiments`).get() as { c: number };
    const evtCount = db.prepare(`SELECT COUNT(*) as c FROM governed_experiment_events`).get() as { c: number };
    return { ok: true, count: expCount.c, eventCount: evtCount.c };
  } catch {
    return { ok: false, count: 0, eventCount: 0 };
  }
}
