/**
 * SPINOR WORKTELEPORT-RL — Core Type Definitions
 *
 * The Perpetual Human–LLM Experiment Game with Evidence-to-Execution compilation.
 *
 * Architecture:
 *   Signal → Evidence Envelope → ClientContinuity → Intent+Authority Compiler
 *   → Task IR → Capability Planner → Durable Workflow → Commit Gate
 *   → Verified Deliverables → SPINOR-RL → Skill Genome / Experiment Twin / Golden Node
 *   → Venture Capsule → Evidence
 */

import type { EvidenceLevel } from "./index";

// ═══════════════════════════════════════════════════════════════════════
// Evidence Envelope — Universal Input Layer
// ═══════════════════════════════════════════════════════════════════════

export type EvidenceSource =
  | "email"
  | "attachment"
  | "pdf"
  | "csv"
  | "spreadsheet"
  | "image"
  | "receipt"
  | "voice_message"
  | "calendar_event"
  | "crm_record"
  | "card_transaction"
  | "bank_transaction"
  | "travel_record"
  | "expense_policy"
  | "browser_page"
  | "internal_database"
  | "erp_record"
  | "user_instruction"
  | "field_observation"
  | "api_webhook";

export type ConfidentialityClass =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "regulated";

export interface EvidenceEnvelope {
  id: string;
  source: EvidenceSource;
  sourceIdentifier: string;       // email message ID, transaction ID, etc.
  sender: string;                 // who or what produced this evidence
  recipient: string;              // which employee or system received it
  receivedAt: string;             // ISO timestamp
  originalContent: string;        // preserved, never modified by LLM
  contentHash: string;            // SHA-256 of originalContent for provenance
  attachments: EvidenceAttachment[];
  extractedEntities: ExtractedEntity[];
  factualClaims: FactualClaim[];
  requestedWork: string | null;   // what work is being requested, if any
  deadlines: string[];            // ISO timestamps
  confidentialityClass: ConfidentialityClass;
  permittedUses: string[];        // what this evidence may be used for
  retentionRule: string;          // how long to keep it
  orgId: string;                  // tenant isolation
  userId: string;                 // assigned employee
  // LLM interpretations are stored separately, never in originalContent
  llmInterpretation?: EvidenceInterpretation;
}

export interface EvidenceAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentHash: string;
  parsedData?: unknown;           // structured extraction (CSV rows, PDF text, etc.)
}

export interface ExtractedEntity {
  type: string;                   // "person", "organization", "amount", "date", "address", etc.
  value: string;
  confidence: number;             // 0..1
  sourceSpan?: { start: number; end: number };
}

export interface FactualClaim {
  claim: string;
  evidenceLevel: EvidenceLevel;
  source: "extracted" | "inferred" | "external";
  verified: boolean;
}

export interface EvidenceInterpretation {
  interpretedAt: string;
  modelId: string;
  summary: string;
  intentClassification: IntentType[];
  proposedTasks: string[];        // task type names, not full Task IRs
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════
// ClientContinuity — Identity, Relationship, Authority
// ═══════════════════════════════════════════════════════════════════════

export type IntentType =
  | "request"
  | "question"
  | "commitment"
  | "complaint"
  | "instruction"
  | "informational"
  | "approval"
  | "escalation"
  | "experiment";

export type RelationshipType =
  | "manager"
  | "peer"
  | "subordinate"
  | "external_client"
  | "external_vendor"
  | "system"
  | "regulator"
  | "self";

export interface ClientContinuityRecord {
  id: string;
  orgId: string;
  personId: string;               // email address or system ID
  personName: string;
  relationshipToUser: RelationshipType;
  authorityLevel: AuthorityLevel;
  communicationHistory: CommunicationSummary[];
  activeCommitments: string[];    // commitment IDs
  escalationBoundaries: string[]; // what this person can/cannot escalate
  preferredSpeaker: "human" | "llm_assisted" | "system";
  lastInteractionAt: string;
  createdAt: string;
  updatedAt: string;
}

export type AuthorityLevel =
  | "none"          // no authority over the user
  | "informational" // can provide information
  | "request"       // can request work
  | "assign"        // can assign tasks
  | "approve"       // can approve work
  | "override";     // can override decisions

export interface CommunicationSummary {
  at: string;
  direction: "inbound" | "outbound";
  channel: string;
  summary: string;
  intent: IntentType;
}

// ═══════════════════════════════════════════════════════════════════════
// Task IR — Machine-Readable Task Intermediate Representation
// ═══════════════════════════════════════════════════════════════════════

export type TaskType =
  | "research"
  | "create"
  | "modify"
  | "reconcile"
  | "compare"
  | "enrich"
  | "submit"
  | "schedule"
  | "communicate"
  | "approve"
  | "escalate"
  | "monitor"
  | "experiment";

export type TaskStatus =
  | "drafted"
  | "authorized"
  | "planned"
  | "executing"
  | "awaiting_approval"
  | "awaiting_checkpoint"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export interface TaskIR {
  id: string;
  orgId: string;
  userId: string;
  evidenceEnvelopeId: string;     // provenance link
  parentTaskId?: string;          // for decomposed sub-tasks
  objective: string;
  taskType: TaskType;
  inputs: TaskInput[];
  requiredOutputs: TaskOutput[];
  constraints: TaskConstraint[];
  dependencies: string[];         // other task IDs
  evidenceRequirements: string[];
  permittedTools: string[];       // capability IDs
  approvalBoundary: ApprovalBoundary;
  failureConditions: string[];
  completionTests: CompletionTest[];
  rollbackPlan: RollbackStep[];
  status: TaskStatus;
  createdAt: string;
  authorizedAt?: string;
  executedAt?: string;
  completedAt?: string;
}

export interface TaskInput {
  name: string;
  type: string;                   // "evidence", "database", "api", "file", "human"
  source: string;                 // where to get it
  required: boolean;
  schema?: Record<string, unknown>;
}

export interface TaskOutput {
  name: string;
  type: string;                   // "document", "record", "message", "report", "file"
  schema?: Record<string, unknown>;
  validationRules: string[];
}

export interface TaskConstraint {
  type: "time" | "cost" | "compliance" | "policy" | "technical";
  description: string;
  value: string;
}

export interface ApprovalBoundary {
  required: boolean;
  approverRole: string;
  monetaryThreshold?: number;
  irreversibleEffects: boolean;
  complianceReviewRequired: boolean;
}

export interface CompletionTest {
  name: string;
  test: string;                   // deterministic test expression
  expectedResult: string;
}

export interface RollbackStep {
  step: number;
  action: string;
  compensation: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Capability Graph — Constrained Tool Permissions
// ═══════════════════════════════════════════════════════════════════════

export type CapabilityCategory =
  | "read"
  | "create"
  | "modify"
  | "delete"
  | "submit"
  | "communicate"
  | "execute"
  | "approve";

export type ExecutionMethod =
  | "native_api"
  | "deterministic_service"
  | "file_exchange"
  | "browser_agent"
  | "human_checkpoint";

export interface CapabilityDeclaration {
  id: string;
  orgId: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  executionMethod: ExecutionMethod;
  // What it can do
  canRead: string[];
  canCreate: string[];
  canModify: string[];
  canDelete: string[];
  // Who can use it
  permittedRoles: string[];
  permittedUsers: string[];
  // What data classes are allowed
  permittedDataClasses: ConfidentialityClass[];
  // What approvals are required
  requiredApprovals: string[];
  // Whether effects are reversible
  reversible: boolean;
  // Validation tests that must pass
  validationTests: string[];
  // Monetary threshold if applicable
  monetaryThreshold?: number;
  // Whether this capability can be used in separation-of-duties violation
  segregationOfDutiesConflict: string[]; // other capability IDs
}

// ═══════════════════════════════════════════════════════════════════════
// Durable Workflow Runtime
// ═══════════════════════════════════════════════════════════════════════

export type WorkflowState =
  | "pending"
  | "planning"
  | "awaiting_authorization"
  | "executing"
  | "awaiting_approval"
  | "awaiting_checkpoint"
  | "commit_gate"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export type StepState =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "skipped"
  | "retrying"
  | "awaiting_input";

export type FailureClassification =
  | "timeout"
  | "api_error"
  | "browser_crash"
  | "missing_document"
  | "approval_denied"
  | "validation_failure"
  | "policy_violation"
  | "compensation_required"
  | "unknown";

export interface Workflow {
  id: string;
  orgId: string;
  userId: string;
  taskIRId: string;
  state: WorkflowState;
  steps: WorkflowStep[];
  idempotencyKey: string;
  checkpointedState: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  deadline: string;
  failureClassification?: FailureClassification;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  stepNumber: number;
  capabilityId: string;
  executionMethod: ExecutionMethod;
  state: StepState;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
  requiresApproval: boolean;
  approvalStatus?: "pending" | "approved" | "denied";
  approverId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Commit Gate — Pre-Action Verification
// ═══════════════════════════════════════════════════════════════════════

export interface CommitRecord {
  id: string;
  orgId: string;
  workflowId: string;
  stepId: string;
  // What was checked
  authorizationValid: boolean;
  targetUnchanged: boolean;
  dataUnchanged: boolean;
  withinPolicy: boolean;
  humanApprovalCurrent: boolean;
  outputValidated: boolean;
  // What action was committed
  actionType: string;
  actionTarget: string;
  actionPayload: string;          // JSON
  // Result
  committed: boolean;
  committedAt: string;
  rollbackPossible: boolean;
  // Evidence
  evidenceEnvelopeId?: string;
  receiptHash: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Skill Genome — Reusable Executable Representation
// ═══════════════════════════════════════════════════════════════════════

export type SkillMaturity =
  | "first_occurrence"    // researched and manually supervised
  | "model_assisted"      // LLM helps but human executes
  | "workflow_assisted"   // workflow handles most, human reviews
  | "deterministic"       // fully automated, human monitors
  | "reopened_experiment"; // something changed, needs re-examination

export interface SkillGenome {
  id: string;
  orgId: string;
  name: string;
  description: string;
  // Trigger: what incoming signal activates this skill
  trigger: SkillTrigger;
  // Input schema
  inputSchema: Record<string, unknown>;
  // Task IR template
  taskIRTemplate: Partial<TaskIR>;
  // Tool requirements
  toolRequirements: string[];     // capability IDs
  // Authorization requirements
  authorizationRequirements: string[];
  // Execution DAG (directed acyclic graph)
  executionDag: DagNode[];
  // Validation tests
  validationTests: string[];
  // Known failure modes
  knownFailureModes: string[];
  // Human checkpoints
  humanCheckpoints: string[];     // step names where human must approve
  // Output schema
  outputSchema: Record<string, unknown>;
  // Performance history
  performanceHistory: SkillPerformance[];
  // Experiment history
  experimentHistory: string[];    // experiment twin IDs
  // Attribution
  modelContribution: string;      // what the LLM did
  humanContribution: string;      // what the employee did
  // Version lineage
  version: number;
  parentSkillId?: string;
  // Maturity level
  maturity: SkillMaturity;
  // Usage
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillTrigger {
  type: "email_pattern" | "attachment_type" | "keyword" | "schedule" | "manual" | "api_event";
  pattern: string;                // regex, cron, keyword, etc.
  priority: number;
}

export interface DagNode {
  id: string;
  stepName: string;
  capabilityId: string;
  dependsOn: string[];            // other node IDs
  parallelWith?: string[];        // nodes that can run in parallel
}

export interface SkillPerformance {
  executedAt: string;
  durationMs: number;
  success: boolean;
  humanInterventionRequired: boolean;
  cost: number;
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Experiment Twin — Every Workflow Gets an Experimental Counterpart
// ═══════════════════════════════════════════════════════════════════════

export type ExperimentTwinStatus =
  | "proposed"
  | "active"
  | "completed"
  | "falsified"
  | "validated"
  | "graduated";

export interface ExperimentTwin {
  id: string;
  orgId: string;
  workflowId: string;
  skillGenomeId?: string;
  // What the twin is testing
  researchQuestion: string;
  hypothesis: string;
  // What permutation is being tested
  permutationType: "fewer_steps" | "different_tool" | "different_employee" | "different_timing" | "different_channel" | "removed_step" | "new_combination";
  permutationDescription: string;
  // Control vs experiment
  controlWorkflowId: string;
  experimentalWorkflowId?: string;
  // Metrics
  successMetrics: string[];
  status: ExperimentTwinStatus;
  result?: ExperimentTwinResult;
  createdAt: string;
  completedAt?: string;
}

export interface ExperimentTwinResult {
  controlOutcome: string;
  experimentalOutcome: string;
  effectSize: number;
  confidenceInterval: { lower: number; upper: number };
  recommendation: "adopt" | "reject" | "inconclusive" | "replicate";
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Venture Capsule — Golden Node → Business Channel
// ═══════════════════════════════════════════════════════════════════════

export type VentureStatus =
  | "identified"
  | "packaged"
  | "validated"
  | "approved"
  | "deployed"
  | "archived";

export interface VentureCapsule {
  id: string;
  orgId: string;
  goldenNodeId?: string;
  skillGenomeId?: string;
  name: string;
  // Problem solved
  problemSolved: string;
  // Target users
  targetUsers: string[];
  // Triggering evidence
  triggeringEvidence: string[];
  // Validated workflow
  validatedWorkflowId?: string;
  // Required integrations
  requiredIntegrations: string[];
  // Compliance requirements
  complianceRequirements: string[];
  // Outcome evidence
  outcomeEvidence: string[];
  // Replication evidence
  replicationEvidence: string[];
  // Unit economics
  unitEconomics: VentureUnitEconomics;
  // Market alternatives
  marketAlternatives: string[];
  // Deployment package
  deploymentPackage: string;      // JSON or reference
  // Ownership lineage
  ownershipLineage: VentureOwnershipEntry[];
  // Commercialization hypothesis
  commercializationHypothesis: string;
  status: VentureStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VentureUnitEconomics {
  operatingCost: number;
  revenuePotential: number;
  margin: number;
  breakEvenUnits: number;
  notes: string;
}

export interface VentureOwnershipEntry {
  personId: string;
  role: string;
  contribution: string;
  contributionDate: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Canonical Palindrome — Forward + Reverse Evidence Chain
// ═══════════════════════════════════════════════════════════════════════

export type PalindromeStage =
  | "signal"
  | "evidence"
  | "intent"
  | "authority"
  | "task"
  | "plan"
  | "workflow"
  | "tool"
  | "action"
  | "receipt"
  | "outcome"
  | "mechanism"
  | "skill"
  | "system"
  | "channel"
  // Reverse half
  | "system_reversed"
  | "skill_reversed"
  | "mechanism_reversed"
  | "outcome_reversed"
  | "receipt_reversed"
  | "action_reversed"
  | "tool_reversed"
  | "workflow_reversed"
  | "plan_reversed"
  | "task_reversed"
  | "authority_reversed"
  | "intent_reversed"
  | "evidence_reversed"
  | "signal_reversed";

export interface PalindromeChain {
  id: string;
  orgId: string;
  stages: PalindromeStageRecord[];
  completedForward: boolean;
  completedReverse: boolean;
  createdAt: string;
}

export interface PalindromeStageRecord {
  stage: PalindromeStage;
  reachedAt: string;
  evidence: string;
  verified: boolean;
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Hypothesis Dissect-Demoronify-Research-NoveltyMagnify Pipeline
// ═══════════════════════════════════════════════════════════════════════

export interface DissectedHypothesis {
  id: string;
  orgId: string;
  originalClaim: string;
  // Dissect: break into measurable components
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  timing: string;
  mechanism: string;
  risk: string;
  // Demoronify: remove impressive language, produce testable claim
  demoronifiedClaim: string;
  // Research: determine evidence status
  researchStatus: "established" | "supported" | "transferred" | "plausible" | "untested" | "contradicted" | "internal_signal";
  researchSummary: string;
  // Novelty Magnify: identify what is actually new
  novelComponent: string;
  noveltyType: NoveltyType;
  // Experiment: convert to controlled field test
  experimentDesign: string;
  // Replicate: distribute versions
  replicationPlan: string;
  // Capitalize: turn into workflow/system
  capitalizationPlan: string;
  createdAt: string;
}

export type NoveltyType =
  | "new_audience"
  | "new_sequence"
  | "new_timing_rule"
  | "new_channel_combination"
  | "new_automation"
  | "new_human_llm_division"
  | "new_personalization_variable"
  | "new_measurement_method"
  | "new_combination";

// ═══════════════════════════════════════════════════════════════════════
// 40 Coined Terms — Experiment Taxonomy
// ═══════════════════════════════════════════════════════════════════════

export interface CoinedTermCategory {
  id: string;
  term: string;
  definition: string;
  experimentFamily: string;
  exampleHypothesis: string;
  metrics: string[];
  complianceNotes: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Game Actions — What Users Do
// ═══════════════════════════════════════════════════════════════════════

export type GameAction =
  | "plant"
  | "test"
  | "observe"
  | "challenge"
  | "replicate"
  | "derive"
  | "combine"
  | "teach"
  | "automate"
  | "integrate"
  | "spin_out";

export interface GameActionRecord {
  id: string;
  orgId: string;
  userId: string;
  action: GameAction;
  targetId: string;               // hypothesis ID, workflow ID, skill ID, etc.
  targetType: "hypothesis" | "workflow" | "skill" | "golden_node" | "venture";
  evidenceEnvelopeId?: string;
  reward: number;
  notes: string;
  createdAt: string;
}
