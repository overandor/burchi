/**
 * Governed Experiment types — the durable, versioned execution layer.
 *
 * A GovernedExperiment is not a dashboard widget. It is a versioned,
 * stateful object that enforces the canonical transformation:
 *
 *   mailbox evidence → structured claim → admissibility precheck
 *   → protocol → SPIN record → human approval → execution
 *   → observation → attribution → replication decision
 *
 * Every state transition appends an immutable ExecutionEvent.
 * No transition may overwrite or delete a prior version.
 */

// ---------------------------------------------------------------------------
// Experiment state machine
// ---------------------------------------------------------------------------

export type ExperimentState =
  | "draft"
  | "awaiting_review"
  | "approved"
  | "active"
  | "paused"
  | "completed"
  | "blocked"
  | "under_attribution"
  | "awaiting_replication"
  | "retired";

export const EXPERIMENT_STATE_ORDER: ExperimentState[] = [
  "draft",
  "awaiting_review",
  "approved",
  "active",
  "paused",
  "completed",
  "blocked",
  "under_attribution",
  "awaiting_replication",
  "retired",
];

export const VALID_STATE_TRANSITIONS: Record<ExperimentState, ExperimentState[]> = {
  draft: ["awaiting_review", "retired"],
  awaiting_review: ["approved", "draft", "blocked", "retired"],
  approved: ["active", "paused", "blocked", "retired"],
  active: ["paused", "completed", "blocked", "under_attribution"],
  paused: ["active", "blocked", "retired"],
  completed: ["under_attribution", "awaiting_replication", "retired"],
  blocked: ["draft", "awaiting_review", "retired"],
  under_attribution: ["awaiting_replication", "completed", "retired"],
  awaiting_replication: ["completed", "retired"],
  retired: [],
};

// ---------------------------------------------------------------------------
// Compliance state machine
// ---------------------------------------------------------------------------

export type ComplianceState =
  | "draft"
  | "review_required"
  | "approved"
  | "active"
  | "suspended"
  | "blocked";

export const VALID_COMPLIANCE_TRANSITIONS: Record<ComplianceState, ComplianceState[]> = {
  draft: ["review_required"],
  review_required: ["approved", "blocked"],
  approved: ["active", "suspended", "blocked"],
  active: ["suspended", "blocked"],
  suspended: ["active", "blocked"],
  blocked: ["draft", "review_required"],
};

// ---------------------------------------------------------------------------
// Structured claim (PICO-T + mechanism + risk + falsification)
// ---------------------------------------------------------------------------

export interface StructuredClaim {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  timePeriod: string;
  mechanism: string;
  risk: string;
  falsificationCondition: string;
}

// ---------------------------------------------------------------------------
// Evidence items with full provenance
// ---------------------------------------------------------------------------

export type EvidenceDirection =
  | "supports"
  | "contradicts"
  | "contextual"
  | "ambiguous"
  | "compliance_concern"
  | "missing_evidence";

export interface EvidenceItem {
  id: string;
  sourceType: string;
  sourceId: string;
  mailboxMessageId?: string;
  threadId?: string;
  sender?: string;
  timestamp: string;
  excerpt: string;
  structuredExtraction?: Record<string, unknown>;
  provenanceHash: string;
  extractionModel?: string;
  extractionConfidence: number;
  humanReviewState: "pending" | "reviewed" | "rejected";
  direction: EvidenceDirection;
}

// ---------------------------------------------------------------------------
// Prior-art classification
// ---------------------------------------------------------------------------

export type PriorArtClassification =
  | "established"
  | "supported"
  | "transferred"
  | "plausible"
  | "untested"
  | "previously_failed"
  | "contradicted"
  | "unsupported"
  | "internal_signal";

export interface PriorArtSummary {
  classification: PriorArtClassification;
  establishedSummary: string;
  transferredSummary: string;
  internalSignalSummary: string;
  noveltyDelta: string;
}

// ---------------------------------------------------------------------------
// Experimental design with field-level completeness
// ---------------------------------------------------------------------------

export type FieldCompleteness =
  | "complete"
  | "incomplete"
  | "awaiting_review"
  | "approved"
  | "blocked"
  | "superseded";

export interface DesignField {
  key: string;
  label: string;
  value: string;
  completeness: FieldCompleteness;
}

export interface ExperimentalDesign {
  eligibilityRules: DesignField;
  exclusions: DesignField;
  treatment: DesignField;
  comparison: DesignField;
  assignmentMethod: DesignField;
  sampleTarget: DesignField;
  primaryMetric: DesignField;
  secondaryMetrics: DesignField;
  observationWindow: DesignField;
  stoppingConditions: DesignField;
  allowedDeviations: DesignField;
  prohibitedDeviations: DesignField;
  instrumentation: DesignField;
  attributionPlan: DesignField;
  escalationRules: DesignField;
  complianceRestrictions: DesignField;
}

export function designFieldCompleteness(design: ExperimentalDesign): {
  total: number;
  complete: number;
  incomplete: number;
  awaitingReview: number;
  approved: number;
  blocked: number;
  admissibilityPassed: boolean;
} {
  const fields = Object.values(design);
  const total = fields.length;
  const complete = fields.filter((f) => f.completeness === "complete").length;
  const incomplete = fields.filter((f) => f.completeness === "incomplete").length;
  const awaitingReview = fields.filter((f) => f.completeness === "awaiting_review").length;
  const approved = fields.filter((f) => f.completeness === "approved").length;
  const blocked = fields.filter((f) => f.completeness === "blocked").length;
  return {
    total,
    complete,
    incomplete,
    awaitingReview,
    approved,
    blocked,
    admissibilityPassed: incomplete === 0 && blocked === 0,
  };
}

// ---------------------------------------------------------------------------
// SPIN summary (read-only view of the SPIN record)
// ---------------------------------------------------------------------------

export interface SpinSummary {
  spinId: string;
  assignedUser: string;
  population: string;
  eligibleAccounts: string[];
  treatment: string;
  comparison: string;
  allocationMethod: string;
  permittedVariables: string[];
  prohibitedVariables: string[];
  modelContribution: string[];
  humanModifications: string[];
  timing: string;
  knownExternalConditions: string[];
  parentSpinId?: string;
  derivativeSpinIds: string[];
}

// ---------------------------------------------------------------------------
// Human–LLM contribution separation
// ---------------------------------------------------------------------------

export interface ContributionSeparation {
  modelContribution: string[];
  humanContribution: string[];
}

// ---------------------------------------------------------------------------
// Confounder tracking
// ---------------------------------------------------------------------------

export type ConfounderState =
  | "unresolved"
  | "measured"
  | "controlled"
  | "unlikely"
  | "confirmed";

export interface ConfounderRecord {
  id: string;
  description: string;
  state: ConfounderState;
  evidence: string;
  addedAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Execution events (append-only timeline)
// ---------------------------------------------------------------------------

export type ExecutionEventType =
  | "hypothesis_generated"
  | "evidence_reviewed"
  | "protocol_revised"
  | "compliance_submitted"
  | "compliance_approved"
  | "participant_assigned"
  | "experiment_planted"
  | "action_prepared"
  | "human_approved_action"
  | "action_executed"
  | "deviation_recorded"
  | "outcome_observed"
  | "confounder_added"
  | "observation_window_closed"
  | "attribution_calculated"
  | "replication_requested"
  | "experiment_paused"
  | "experiment_blocked"
  | "experiment_closed"
  | "version_created"
  | "challenge_created";

export interface ExecutionEvent {
  eventId: string;
  experimentId: string;
  organizationId: string;
  actor: string;
  timestamp: string;
  source: string;
  eventType: ExecutionEventType;
  previousEventHash: string;
  payloadHash: string;
  result: string;
  approvalState: string;
}

// ---------------------------------------------------------------------------
// Effect reporting
// ---------------------------------------------------------------------------

export interface EffectReport {
  baseline: number;
  observed: number;
  absoluteChange: number;
  relativeChange: number;
  baselineSample: number;
  treatmentSample: number;
  observationWindowDays: number;
  confidenceIntervalLow?: number;
  confidenceIntervalHigh?: number;
  missingOutcomes: number;
  cost?: number;
  customerBurden?: number;
  negativeOutcomes?: number;
  complaints?: number;
  executionFidelity?: number;
  protocolDeviations?: number;
  replicationCount: number;
}

// ---------------------------------------------------------------------------
// Causal reveal
// ---------------------------------------------------------------------------

export type CausalReveal =
  | "rejected"
  | "inconclusive"
  | "promising"
  | "replicated"
  | "golden_node_candidate"
  | "golden_node"
  | "compliance_blocked";

// ---------------------------------------------------------------------------
// Environment status
// ---------------------------------------------------------------------------

export interface EnvironmentStatus {
  durableStorageConnected: boolean;
  authenticationEnforced: boolean;
  organizationIsolationVerified: boolean;
  evidenceProvenanceVerified: boolean;
  experimentWritesTested: boolean;
  complianceTransitionsTested: boolean;
  replicationGateTested: boolean;
  productionDeploymentApproved: boolean;
}

export const DEVELOPMENT_ENVIRONMENT_STATUS: EnvironmentStatus = {
  durableStorageConnected: true,
  authenticationEnforced: false,
  organizationIsolationVerified: false,
  evidenceProvenanceVerified: false,
  experimentWritesTested: false,
  complianceTransitionsTested: false,
  replicationGateTested: false,
  productionDeploymentApproved: false,
};

// ---------------------------------------------------------------------------
// Compliance dimensions
// ---------------------------------------------------------------------------

export interface ComplianceDimensions {
  lockedDimensions: string[];
  editableDimensions: string[];
}

export const DEFAULT_COMPLIANCE_DIMENSIONS: ComplianceDimensions = {
  lockedDimensions: [
    "approved_content",
    "indication",
    "safety_information",
    "audience_permissions",
    "adverse_event_handling",
    "privacy_restrictions",
    "jurisdictional_requirements",
  ],
  editableDimensions: [
    "timing",
    "workflow_sequence",
    "approved_channel",
    "stakeholder_order",
    "internal_preparation",
    "administrative_routing",
    "follow_up_interval",
    "human_vs_automation_responsibilities",
  ],
};

// ---------------------------------------------------------------------------
// The governed experiment — the central durable object
// ---------------------------------------------------------------------------

export interface GovernedExperiment {
  id: string;
  organizationId: string;
  hypothesisId: string;
  hypothesisVersion: number;
  spinId?: string;
  spinVersion?: number;
  owner: string;
  assignedParticipant: string;
  experimentState: ExperimentState;
  complianceState: ComplianceState;
  evidenceClass: string;
  observationWindowDays: number;
  createdAt: string;
  lastApprovedAt?: string;
  parentExperimentId?: string;
  derivativeExperimentIds: string[];
  replicationOfId?: string;
  // Structured claim
  claim: StructuredClaim;
  claimProse: string;
  // Evidence
  evidence: EvidenceItem[];
  // Prior art
  priorArt: PriorArtSummary;
  // Design
  design: ExperimentalDesign;
  // SPIN summary
  spinSummary?: SpinSummary;
  // Contributions
  contributions: ContributionSeparation;
  // Compliance
  complianceDimensions: ComplianceDimensions;
  // Confounders
  confounders: ConfounderRecord[];
  // Execution events
  events: ExecutionEvent[];
  // Effect report
  effectReport?: EffectReport;
  // Causal reveal
  causalReveal?: CausalReveal;
  // Environment status
  environmentStatus: EnvironmentStatus;
  // Versioning
  version: number;
  previousVersionId?: string;
}

// ---------------------------------------------------------------------------
// Action result / execution receipt
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  experimentId: string;
  newState: ExperimentState;
  newComplianceState: ComplianceState;
  eventId: string;
  eventHash: string;
  timestamp: string;
  message: string;
  errors?: string[];
}
