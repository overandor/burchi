/**
 * Ambient Delegation Runtime — core types.
 *
 * The runtime is a persistent cognitive layer that:
 *   1. Senses events from authorized streams (voice, email, CRM, datasets, etc.)
 *   2. Maintains a world model (goals, permissions, data, capabilities, history)
 *   3. Decides whether anything should happen
 *   4. Selects an action and delegates: agent-executes or human-required
 *   5. Observes results and updates reusable operators
 *   6. Runs experiments through a fitness-gated tournament
 *   7. Attributes successful innovations through lineage to a dividend
 *
 * Voice is one sensor. The runtime is the product.
 */

// ─── Event Bus ────────────────────────────────────────────────────────────

export type EventStreamType =
  | "voice"
  | "email"
  | "crm"
  | "dataset"
  | "calendar"
  | "workspace"
  | "file"
  | "metrics"
  | "experiment_result"
  | "pipeline_failure"
  | "customer_behavior"
  | "external_signal";

export interface RuntimeEvent {
  id: string;
  stream: EventStreamType;
  /** Raw payload — transcript text, email JSON, dataset row, etc. */
  payload: string;
  /** Structured extraction if already parsed */
  structured?: Record<string, unknown>;
  timestamp: string;
  /** Source system that emitted the event */
  source: string;
  /** Org scope */
  orgId: string;
  /** User who triggered or is associated with the event */
  userId?: string;
  /** Whether this event has been processed by the runtime */
  processed: boolean;
}

export interface StreamConsent {
  stream: EventStreamType;
  enabled: boolean;
  /** When consent was granted */
  grantedAt: string;
  /** Who granted it */
  grantedBy: string;
  /** Audit note */
  note: string;
}

// ─── World Model ──────────────────────────────────────────────────────────

export interface WorldModel {
  orgId: string;
  goals: OrgGoal[];
  permissions: PermissionSet;
  availableData: DataAsset[];
  capabilities: Capability[];
  experimentHistory: HistorySummary[];
  /** Persistent task graph — what the runtime knows is happening */
  activeWork: ActiveWorkItem[];
  /** Items waiting on external input */
  waitingOn: WaitingItem[];
  updatedAt: string;
}

// ─── Persistent Task Graph ─────────────────────────────────────────────────

export interface ActiveWorkItem {
  id: string;
  category: "email_conversation" | "dataset_reconciliation" | "experiment_collecting" | "account_enrichment" | "workflow_qa" | "research" | "other";
  title: string;
  description: string;
  status: "active" | "blocked" | "stale";
  /** What the agent is doing about it */
  agentAction: string;
  /** Whether the agent or human is currently driving */
  drivenBy: "agent" | "human" | "both";
  relatedExperimentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WaitingItem {
  id: string;
  waitingFor: "human_approval" | "customer_response" | "external_data" | "scheduled_event" | "replication_result";
  title: string;
  description: string;
  /** When this was put into waiting state */
  waitingSince: string;
  /** Whether this waiting item is stale (no update for >7 days) */
  isStale: boolean;
  relatedProposalId?: string;
}

export interface OrgGoal {
  id: string;
  description: string;
  priority: number; // 1 = highest
  metric: string;
  target: string;
  status: "active" | "achieved" | "abandoned";
}

export interface PermissionSet {
  /** What the agent may do without asking */
  autonomous: PermissionAction[];
  /** What requires human approval each time */
  requiresApproval: PermissionAction[];
  /** What is prohibited */
  prohibited: PermissionAction[];
}

export interface PermissionAction {
  action: string;
  scope: string;
  reason: string;
}

export interface DataAsset {
  id: string;
  name: string;
  type: string;
  recordCount: number;
  freshness: string;
  confidence: number; // 0-1
  source: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  /** Version of the reusable operator */
  operatorVersion: number;
  /** How many times it has been successfully applied */
  successfulApplications: number;
  /** How many times it failed */
  failedApplications: number;
  /** Fitness score from verified outcomes */
  fitness: number;
  lastUsedAt: string;
}

export interface HistorySummary {
  experimentId: string;
  hypothesis: string;
  outcome: "success" | "failure" | "inconclusive";
  fitnessScore: number;
  replicated: boolean;
}

// ─── Action Selection & Delegation ────────────────────────────────────────

export type DelegationTarget =
  | "agent" // runtime executes autonomously
  | "human" // delegate to user
  | "research" // gather more evidence first
  | "experiment" // launch a test
  | "nothing"; // observe and remember

export interface ProposedAction {
  id: string;
  /** The event that triggered this proposal */
  triggerEventId: string;
  /** What the agent understood from the event */
  observation: string;
  /** Inferred goal */
  inferredGoal: string;
  /** The action to take */
  action: string;
  /** Who should perform it */
  delegateTo: DelegationTarget;
  /** Why this action was selected */
  reasoning: string;
  /** Expected value (0-100) */
  expectedValue: number;
  /** Risk level (0-100) */
  risk: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Whether this requires human confirmation before executing */
  requiresConfirmation: boolean;
  /** Status of the proposal */
  status: ProposalStatus;
  /** Resources needed */
  resources: string[];
  createdAt: string;
  resolvedAt?: string;
  /** Result after execution */
  result?: ActionResult;
}

export type ProposalStatus =
  | "proposed" // waiting for confirmation if required
  | "confirmed" // human said yes
  | "rejected" // human said no
  | "executing" // agent is running it
  | "completed" // finished successfully
  | "failed" // finished with error
  | "delegated" // handed to human queue
  | "expired"; // timed out

export interface ActionResult {
  success: boolean;
  output: string;
  evidenceId?: string;
  operatorUpdated?: boolean;
  learnedRule?: string;
  timestamp: string;
}

// ─── Delegation Queue (NEXT BEST HUMAN ACTION) ────────────────────────────

export interface HumanTask {
  id: string;
  proposalId: string;
  title: string;
  description: string;
  /** What the human needs to do specifically */
  instruction: string;
  /** Options if it's a choice (e.g., "Pick A, B, or neither") */
  options?: string[];
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "accepted" | "completed" | "declined" | "expired";
  createdAt: string;
  resolvedAt?: string;
  /** What the agent did before handing this to the human */
  agentContext: string;
  /** How many related items this resolution will affect */
  impactEstimate: number;
}

// ─── Compounding Operators ────────────────────────────────────────────────

export interface ReconciliationOperator {
  id: string;
  name: string;
  version: number;
  /** Field mappings that worked */
  fieldMappings: FieldMapping[];
  /** Which sources were reliable (0-1) */
  sourceReliability: Record<string, number>;
  /** Normalization rules learned from human corrections */
  normalizationRules: NormalizationRule[];
  /** Conflicts encountered and how they were resolved */
  conflictResolutions: ConflictResolution[];
  /** Number of datasets processed */
  datasetsProcessed: number;
  /** Number of human corrections incorporated */
  humanCorrectionsIncorporated: number;
  /** Fitness score from verified outcomes */
  fitness: number;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMapping {
  sourceField: string;
  canonicalField: string;
  confidence: number;
  timesObserved: number;
}

export interface NormalizationRule {
  pattern: string;
  replacement: string;
  learnedFrom: string;
  appliedCount: number;
  successRate: number;
}

export interface ConflictResolution {
  field: string;
  strategy: "prefer_source" | "prefer_recent" | "prefer_confident" | "human_resolved";
  detail: string;
  timesApplied: number;
  successRate: number;
}

// ─── Experiment Lifecycle & Fitness ───────────────────────────────────────

export interface RuntimeExperiment {
  id: string;
  hypothesis: string;
  author: string;
  contributors: string[];
  inputs: string[];
  baseline: string;
  intervention: string;
  sampleTarget: number;
  status: ExperimentRuntimeStatus;
  outcome?: string;
  replicationCount: number;
  fitnessScore: number;
  /** Compliance gate — if false, experiment never enters tournament */
  compliancePassed: boolean;
  createdAt: string;
  completedAt?: string;
}

export type ExperimentRuntimeStatus =
  | "hypothesis"
  | "baseline_set"
  | "intervention_running"
  | "outcome_recorded"
  | "replicating"
  | "verified"
  | "failed"
  | "blocked_compliance";

// Response B hierarchy — hard gates, not weights
export const FITNESS_HIERARCHY = [
  "compliance",
  "customer_safety",
  "evidence_quality",
  "reproducibility",
  "novelty",
  "economic_value",
] as const;

export type FitnessDimension = (typeof FITNESS_HIERARCHY)[number];

export interface FitnessBreakdown {
  compliance: boolean; // hard gate
  customerSafety: boolean; // hard gate
  evidenceQuality: number; // 0-100
  reproducibility: number; // 0-100
  novelty: number; // 0-100
  economicValue: number; // 0-100
  risk: number; // 0-100 (penalty)
  cost: number; // 0-100 (penalty)
  /** Final composite — 0 if any hard gate failed */
  composite: number;
}

// ─── Tournament & Competition ─────────────────────────────────────────────

export type CompetitionLevel = "individual" | "team" | "company";

export interface TournamentEntry {
  experimentId: string;
  level: CompetitionLevel;
  competitor: string; // rep id, team id, or company id
  fitnessScore: number;
  rank: number;
  enteredAt: string;
}

export interface TournamentResult {
  level: CompetitionLevel;
  entries: TournamentEntry[];
  winner: string;
  winningExperimentId: string;
  computedAt: string;
}

// ─── Attribution Lineage & Innovation Dividend ────────────────────────────

export interface AttributionNode {
  id: string;
  experimentId: string;
  role: "originator" | "contributor" | "data_contributor" | "improver" | "replicator";
  actor: string; // user id
  contributionWeight: number; // 0-1
  evidence: string;
  createdAt: string;
}

export interface DividendAward {
  id: string;
  experimentId: string;
  recipient: string;
  role: AttributionNode["role"];
  amount: number;
  reputationDelta: number;
  /** Non-monetary rewards */
  opportunity?: string;
  resources?: string;
  awardedAt: string;
  /** Measured economic effect that triggered this dividend */
  economicEffect: number;
  /** Whether this dividend was gated on verified replication */
  verifiedByReplication: boolean;
  /** Whether the experiment survived counterfactual comparison */
  counterfactualSurvived: boolean;
}

// ─── Snowflake Model: Per-Contributor Branches ──────────────────────────────

export interface ContributorBranch {
  id: string;
  contributor: string;
  experimentIds: string[];
  verifiedProcedures: string[];
  totalDividends: number;
  reputationScore: number;
  /** Whether this contributor is also a consumer of org intelligence */
  consumesFromCore: boolean;
  /** Whether this contributor's discoveries have propagated to the org genome */
  propagatedToGenome: boolean;
  updatedAt: string;
}

// ─── Verification Market ───────────────────────────────────────────────────

export interface VerificationEntry {
  id: string;
  experimentId: string;
  submittedBy: string;
  status: "pending_verification" | "replicating" | "survived" | "failed" | "archived";
  replicationAttempts: number;
  successfulReplications: number;
  counterfactualChecked: boolean;
  enteredAt: string;
  resolvedAt?: string;
}

// ─── Runtime State (what the orb displays) ────────────────────────────────

export interface RuntimeState {
  status: "active" | "idle" | "error";
  streamsObserved: number;
  tasksExecuting: number;
  experimentsRunning: number;
  tasksWaitingOnHuman: number;
  validatedOpportunityValue: number;
  activeProposals: ProposedAction[];
  humanQueue: HumanTask[];
  recentLearnings: string[];
  currentOpportunities: string[];
  /** Director: what the agent is doing right now */
  activeWork: ActiveWorkItem[];
  /** Director: what's being neglected */
  neglectedItems: WaitingItem[];
  /** Director: what the agent discovered recently */
  discoveries: string[];
  /** Adversarial safeguard violations */
  safeguardViolations: SafeguardViolation[];
  updatedAt: string;
}

// ─── Adversarial Safeguards (Response B) ────────────────────────────────────

export interface SafeguardViolation {
  safeguard: "observation_not_authority" | "correlation_not_innovation" | "dirty_data" | "internal_competition";
  description: string;
  severity: "warning" | "critical";
  detectedAt: string;
  context: string;
}

// ─── Director / Executor Split ─────────────────────────────────────────────

export interface DirectorAssessment {
  whatShouldHappenNext: string;
  whatIsNeglected: string[];
  whatCanExecuteWithoutInterruption: string[];
  whatRequiresApproval: string[];
  whatShouldBeKilled: string[];
  whatShouldBeReplicated: string[];
  missingHumanInformation: string[];
  generatedAt: string;
}
