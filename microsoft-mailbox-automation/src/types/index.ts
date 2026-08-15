export interface EmailMessage {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  receivedDate: string;
  bodyPreview: string;
  body: string;
  hasAttachments: boolean;
  attachments: EmailAttachment[];
  isRead: boolean;
  importance: string;
  categories: string[];
  processed: boolean;
  extractedData?: ExtractedData;
  threadId?: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  content?: Uint8Array;
  parsedData?: ParsedAttachmentData;
}

export interface ParsedAttachmentData {
  type: 'csv' | 'excel' | 'pdf' | 'pdf_ocr' | 'text' | 'docx' | 'pptx' | 'json' | 'unknown';
  rows?: Record<string, unknown>[];
  text?: string;
  slides?: { slideNumber: number; title?: string; text: string; tables?: Record<string, unknown>[][] }[];
  metadata?: Record<string, unknown>;
}

export interface ExtractedData {
  emailId: string;
  extractedAt: string;
  fields: ExtractedField[];
  tables: ExtractedTable[];
  summary: string;
  category: string;
  confidence: number;
  source: 'email_body' | 'attachment' | 'both';
}

export interface ExtractedField {
  key: string;
  value: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'scientific_value';
  unit?: string;
  confidence: number;
}

export interface ExtractedTable {
  name: string;
  headers: string[];
  rows: Record<string, string | number>[];
  source: string;
}

export interface AppConfig {
  graph: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    mailbox: string;
  };
  llm: {
    provider: 'openai' | 'anthropic' | 'azure' | 'ollama';
    apiKey: string;
    model: string;
    endpoint?: string;
    /** Pool of inference endpoints for rotation. If set, requests are
     *  distributed across these nodes to bypass per-node timeouts. */
    endpoints?: InferenceEndpoint[];
    /** Target token count for rotated generation (e.g. 50000). When set,
     *  the rotator chains requests until the target is reached. */
    maxTotalTokens?: number;
  };
  processing: {
    autoProcess: boolean;
    pollInterval: number;
    maxEmailsPerSync: number;
    categories: string[];
    extractionPrompt: string;
  };
  export: {
    format: 'excel' | 'csv';
    outputPath: string;
  };
}

export interface SyncStatus {
  lastSync: string | null;
  totalEmails: number;
  processedEmails: number;
  pendingEmails: number;
  isSyncing: boolean;
  errors: string[];
}

export interface ProcessedEmailRecord {
  id: string;
  emailId: string;
  subject: string;
  sender: string;
  senderEmail?: string;
  receivedDate: string;
  processedAt: string;
  category: string;
  confidence: number;
  fieldCount: number;
  tableCount: number;
  extractedData: ExtractedData;
  analysis?: EmailAnalysis;
}

export interface EmailAnalysis {
  wikitree: WikiTree;
  mindmap: Mindmap;
  execution: ExecutionPlan;
}

export interface WikiTree {
  root: WikiTreeNode;
}

export interface WikiTreeNode {
  id: string;
  title: string;
  content: string;
  children: WikiTreeNode[];
  tags: string[];
  sources: string[];
}

export interface Mindmap {
  root: MindmapNode;
}

export interface MindmapNode {
  id: string;
  label: string;
  children: MindmapNode[];
  color?: string;
  icon?: string;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  summary: string;
  estimatedTime: string;
  dependencies: string[];
}

export interface ExecutionStep {
  id: string;
  order: number;
  action: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  inputs: string[];
  outputs: string[];
  dependencies: string[];
}

export interface GmailConfig {
  provider?: "gmail";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  emailAddress: string;
}

export interface InferenceEndpoint {
  url: string;
  apiKey?: string;
  model?: string;
  /** Max tokens this node can generate per request (within its timeout) */
  maxTokensPerRequest?: number;
  /** Whether this node is currently available (set by health check) */
  healthy?: boolean;
  /** Last time this node was used (for round-robin) */
  lastUsed?: number;
  /** Number of requests sent to this node */
  requestCount?: number;
}

export interface RotationResult {
  content: string;
  totalTokens: number;
  rotations: number;
  nodesUsed: string[];
  chunks: { node: string; tokens: number; content: string }[];
  finishReason: string;
  elapsedMs: number;
}

// ─── Phone Telemetry ──────────────────────────────────────────────

export interface PhoneRecord {
  id: string;
  phoneNumber: string;
  label: string;
  createdAt: string;
  events: PhoneTelemetryEvent[];
  images: PhoneImage[];
  llmAnalysis?: PhoneLLMAnalysis;
}

export interface PhoneTelemetryEvent {
  id: string;
  timestamp: string;
  type: "call" | "sms" | "mms" | "data" | "status" | "alert" | "custom";
  direction: "inbound" | "outbound";
  durationSec?: number;
  metadata: Record<string, unknown>;
  notes?: string;
}

export interface PhoneImage {
  id: string;
  timestamp: string;
  filename: string;
  contentType: string;
  /** Base64-encoded image data (data URL) */
  dataUrl: string;
  sizeBytes: number;
  caption?: string;
  /** LLM-generated description of the image, if analyzed */
  aiDescription?: string;
}

export interface PhoneLLMAnalysis {
  analyzedAt: string;
  model: string;
  summary: string;
  insights: PhoneLLMInsight[];
  riskScore: number;
  recommendations: string[];
  imageCount: number;
  eventCount: number;
}

export interface PhoneLLMInsight {
  type: "opportunity" | "risk" | "efficiency" | "anomaly";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
}

export interface PhoneTelemetrySummary {
  phoneNumber: string;
  label: string;
  totalEvents: number;
  totalImages: number;
  totalCalls: number;
  totalSms: number;
  totalDurationSec: number;
  lastActivity: string | null;
  riskScore: number;
  topEventType: string;
  inboundCount: number;
  outboundCount: number;
  eventsByType: Record<string, number>;
  eventsTimeline: { date: string; count: number }[];
}

// ─── Territory Intelligence Spine ──────────────────────────────────

export type HCPFunnelState =
  | "eligible"
  | "relevant_population"
  | "info_gap"
  | "access_opportunity"
  | "engagement_attempted"
  | "meaningful_interaction"
  | "content_consumed"
  | "barrier_identified"
  | "barrier_addressed"
  | "treatment_consideration"
  | "patient_initiation"
  | "persistence";

export type BarrierType =
  | "awareness"
  | "scientific_understanding"
  | "patient_eligibility"
  | "formulary"
  | "diagnosis_testing"
  | "referral_pathway"
  | "reimbursement"
  | "office_workflow"
  | "treatment_initiation"
  | "persistence"
  | "access"
  | "none";

export interface TerritoryAccount {
  id: string;
  hcpName: string;
  specialty: string;
  accountAffiliation?: string;
  territory: string;
  funnelState: HCPFunnelState;
  barrier: BarrierType;
  barrierDetail?: string;
  // Scoring components (P_i formula)
  eligiblePatientOpportunity: number; // E_i
  unmetInfoNeed: number; // N_i
  accessProbability: number; // A_i
  expectedResponsiveness: number; // R_i
  evidenceConfidence: number; // C_i
  fieldTimeRequired: number; // T_i (hours)
  operationalFriction: number; // F_i
  uncertaintyRisk: number; // U_i
  // Computed
  priorityScore: number;
  // Metadata
  lastInteraction?: string;
  lastContentShown?: string;
  channelPreference?: "in_person" | "remote" | "email" | "phone";
  geographicZone?: string;
  reasonCodes: string[];
  recommendedAction?: NextBestAction;
}

export interface NextBestAction {
  action: string;
  rationale: string;
  fieldRole: string;
  permittedChannel: string;
  approvedContentId?: string;
  estimatedTimeMin: number;
  expectedOutcome: string;
  confidenceLevel: number;
  evidenceThatWouldDisprove: string;
  autonomyClass: 1 | 2 | 3 | 4;
}

export interface TerritoryOpportunityMap {
  accounts: TerritoryAccount[];
  totalAccounts: number;
  stalledAccounts: number;
  highPriorityAccounts: number;
  recommendedCoverage: {
    inPerson: number;
    remote: number;
    defer: number;
  };
  topBarriers: { barrier: BarrierType; count: number }[];
  territorySummary: string;
}

export interface FieldRoute {
  accountId: string;
  hcpName: string;
  arrivalTime: string;
  departureTime: string;
  travelTimeMin: number;
  waitTimeMin: number;
  utilityScore: number;
  reason: string;
  deferred: boolean;
  deferredReason?: string;
}

export interface RouteOptimization {
  stops: FieldRoute[];
  totalDriveTimeMin: number;
  totalWaitTimeMin: number;
  totalFieldTimeMin: number;
  timeSavedMin: number;
  deferredCount: number;
  routeUtility: number;
}

// ─── Pre-Call Brief ────────────────────────────────────────────────

export interface PreCallBrief {
  accountId: string;
  hcpName: string;
  whyPrioritized: string;
  lastThreeInteractions: { date: string; summary: string; outcome: string }[];
  unresolvedQuestions: string[];
  knownBarriers: string[];
  payerAccessChanges?: string;
  contentPreviouslyShown: string[];
  contentThatCausedEngagement: string[];
  permittedObjectives: string[];
  likelyObjections: string[];
  commitmentsMade: string[];
  questionsToAsk: string[];
  prohibitedTopics: string[];
  recommendedContentId?: string;
  prepTimeSeconds: number;
}

// ─── Interaction Capture ───────────────────────────────────────────

export interface InteractionCapture {
  accountId: string;
  hcpName: string;
  rawInput: string;
  knowledgeState: string;
  primaryBarrier: BarrierType;
  secondaryBarrier?: BarrierType;
  requestedFollowUp?: string;
  newStakeholder?: string;
  nextBestAction: string;
  confidence: number;
  evidenceSource: string;
  humanConfirmationRequired: boolean;
  structuredAt: string;
}

// ─── Approved Content Intelligence ─────────────────────────────────

export interface ContentRecommendation {
  contentId: string;
  contentName: string;
  slideReference?: string;
  reasonForSelection: string;
  hcpInfoGap: string;
  historicalResponseRate?: number;
  approvedForIndication: string;
  channel: string;
  riskLevel: "low" | "moderate" | "high";
}

// ─── Follow-up Executor ────────────────────────────────────────────

export type FollowUpRiskLevel = "low" | "moderate" | "high" | "prohibited";

export interface FollowUpAction {
  type: "email" | "crm_note" | "meeting_request" | "internal_referral" | "med_info_request" | "action_plan" | "reminder" | "escalation" | "evidence_request";
  description: string;
  riskLevel: FollowUpRiskLevel;
  systemBehavior: "auto_record" | "draft_and_approve" | "route_to_compliance" | "block_and_document";
  draftContent?: string;
  approvedMaterialId?: string;
  recipient?: string;
  deadline?: string;
}

// ─── Outcome Attribution ───────────────────────────────────────────

export interface OutcomeAttribution {
  recommendationId: string;
  actionTaken: string;
  hcpResponse?: string;
  accountStateChange?: string;
  commercialOutcome?: string;
  clinicalOutcome?: string;
  observableEffect: "engaged" | "info_delivered" | "barrier_resolved" | "referral_established" | "workflow_started" | "account_progressed" | "no_effect" | "recommendation_incorrect";
  modelUpdate: {
    feature: string;
    adjustment: string;
    confidenceDelta: number;
  };
  capturedAt: string;
}

// ─── Spine-Ordered Analysis (Spinored) ─────────────────────────────

export interface SpinoredAnalysis {
  accountId: string;
  hcpName: string;
  layer1_reality: {
    events: { type: string; date: string; detail: string }[];
  };
  layer2_state: {
    currentState: string;
    evidence: string[];
  };
  layer3_cause: {
    rootCause: string;
    contributingFactors: string[];
  };
  layer4_intervention: {
    smallestAction: string;
    permitted: boolean;
    alternatives: string[];
  };
  layer5_expectedValue: {
    worthFieldTime: boolean;
    vsAlternatives: string;
    estimatedROI: string;
  };
  layer6_learning: {
    didActionChangeAccount: boolean;
    predictionCorrect: boolean;
    whatWeLearned: string;
  };
}

// ─── Commitment Execution Engine ───────────────────────────────────

export type CommitmentStatus = "detected" | "executing" | "awaiting_approval" | "completed" | "failed" | "escalated" | "declined";

export type AutonomyClass = 1 | 2 | 3 | 4;

export interface CommitmentConfidenceBreakdown {
  capability: number;
  inputsAvailable: number;
  toolCompletion: number;
  qualityApproval: number;
  acceptedWithoutRevision: number;
  overall: number;
}

export interface CommitmentMetrics {
  capability: { success: number; total: number };
  inputsAvailable: { success: number; total: number };
  toolCompletion: { success: number; total: number };
  qualityApproval: { success: number; total: number };
  acceptedWithoutRevision: { success: number; total: number };
  durationsMs: number[];
  modelVersion: string;
  lastUpdatedAt: string;
}

export interface CommitmentContract {
  id: string;
  emailId: string;
  emailSubject: string;
  requester: string;
  requesterEmail: string;
  recipientRole: string;
  authorityVerified: boolean;
  requestedOutcome: string;
  deadline: string;
  mandatoryOutputs: string[];
  inferredOutputs: string[];
  permittedTools: string[];
  externalSendAllowed: boolean;
  autonomyClass: AutonomyClass;
  completionProbability: number;
  confidenceBreakdown?: CommitmentConfidenceBreakdown;
  confidenceModelVersion?: string;
  p50Completion?: string;
  p90Completion?: string;
  dependencies: { description: string; blocksProbability: number }[];
  assumptions: string[];
  status: CommitmentStatus;
  deliverables?: CommitmentDeliverable[];
  auditEvents: { timestamp: string; event: string; detail: string }[];
  detectedAt: string;
  executedAt?: string;
  completedAt?: string;
}

export interface CommitmentDeliverable {
  type: "exact" | "decision_enhancement" | "execution_acceleration" | "preventive";
  name: string;
  format: "report" | "presentation" | "spreadsheet" | "email_draft" | "action_queue" | "data_reconciliation";
  content: string;
  confidence: number;
  approved: boolean;
}

// ─── Role Execution Twins ──────────────────────────────────────────

export type RoleType = "field_representative" | "regional_manager" | "medical_affairs" | "market_access" | "compliance";

export interface RoleTwin {
  role: RoleType;
  title: string;
  jobDescription: string;
  territoryScope?: string;
  reportingStructure?: string;
  permittedSystems: string[];
  approvedActions: string[];
  prohibitedActions: string[];
  recurringDeliverables: string[];
  authorityLimits: {
    canSendExternalEmail: boolean;
    canModifyCRM: boolean;
    canScheduleExternalMeeting: boolean;
    canContactHCP: boolean;
    canApproveContent: boolean;
    financialApprovalLimit?: number;
  };
  domainVocabulary: string[];
  overdeliveryStandard: string;
  correctionHistory?: { task: string; correction: string; date: string }[];
}

// ─── Self-Improvement Loop ─────────────────────────────────────────

export interface ImprovementProposal {
  id: string;
  feature: string;
  currentBehavior: string;
  proposedChange: string;
  evidence: string;
  simulationResult?: string;
  complianceValidated: boolean;
  experimentResult?: string;
  humanApproved: boolean;
  status: "proposed" | "simulating" | "compliance_check" | "experimenting" | "approved" | "deployed" | "rejected";
  rollbackCapable: boolean;
  proposedAt: string;
}

// ─── Advantage Foundry: Strategy Types ─────────────────────────────

export type StrategyClass = "proven" | "personalized" | "experimental";

export type EvidenceLevel =
  | "observed_association"
  | "probable_contribution"
  | "experimentally_supported"
  | "unresolved";

export type StrategyDomain =
  | "territory_planning"
  | "stakeholder_engagement"
  | "communication"
  | "time_management"
  | "data_utilization"
  | "collaboration"
  | "compliance_navigation"
  | "resource_allocation";

export interface StrategyComponent {
  id: string;
  name: string;
  description: string;
  category: "approach" | "tactic" | "behavior" | "tool_usage" | "sequence" | "mindset";
  parameters: Record<string, string | number | boolean>;
}

export interface StrategyContextCondition {
  field: "role" | "territory_type" | "stakeholder_segment" | "workload_level" | "season" | "product_portfolio";
  operator: "equals" | "contains" | "in_range" | "greater_than" | "less_than";
  value: string | number | string[];
}

export interface StrategyExecutionPattern {
  stepOrder: string[];
  toolsUsed: string[];
  timeAllocation: { phase: string; percentage: number };
  decisionRules: string[];
}

export interface StrategyOutcomeMetric {
  metric: string;
  baseline: number;
  expected: number;
  observed: number;
  unit: string;
  higherIsBetter: boolean;
}

export interface StrategyGenome {
  id: string;
  name: string;
  description: string;
  domain: StrategyDomain;
  strategyClass: StrategyClass;
  components: StrategyComponent[];
  applicableContext: StrategyContextCondition[];
  executionPattern: StrategyExecutionPattern;
  expectedOutcomes: StrategyOutcomeMetric[];
  evidenceLevel: EvidenceLevel;
  evidenceCount: number;
  parentIds: string[];
  childIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deprecated: boolean;
  complianceValidated: boolean;
  complianceNotes: string;
  originEmployeeId?: string;
  originContext?: string;
}

export type AssignmentReason = "explore" | "exploit" | "personalized_fit" | "manager_directed" | "peer_transfer";

export interface StrategyAssignment {
  id: string;
  strategyId: string;
  employeeId: string;
  employeeRole: RoleType;
  strategyClass: StrategyClass;
  assignmentReason: AssignmentReason;
  assignedAt: string;
  active: boolean;
  deactivatedAt?: string;
  employeeAccepted: boolean;
  employeeModified: boolean;
  modificationNotes?: string;
  expectedOutcomeMetrics: StrategyOutcomeMetric[];
  contextSnapshot: {
    territoryType?: string;
    workloadLevel?: string;
    stakeholderSegment?: string;
    productPortfolio?: string[];
  };
  trialNumber?: number;
  confidenceAtAssignment: number;
}

export interface ContributionRecord {
  strategyId: string;
  strategyName: string;
  assignmentId: string;
  estimatedContribution: number;
  evidenceLevel: EvidenceLevel;
  reasoning: string;
  counterfactualEstimate: string;
  dataPoints: number;
}

export interface AttributionResult {
  id: string;
  outcomeEventId: string;
  outcomeDescription: string;
  outcomeMetrics: { metric: string; value: number; unit: string; baseline: number }[];
  employeeId: string;
  employeeRole: RoleType;
  contributions: ContributionRecord[];
  unexplainedVariance: number;
  overallConfidence: number;
  attributionMethod: "comparison_group" | "before_after" | "matched_pairs" | "expert_judgment" | "unresolved";
  attributedAt: string;
  notes: string;
}

export interface StrategyPortfolio {
  employeeId: string;
  employeeRole: RoleType;
  activeAssignments: StrategyAssignment[];
  provenStrategies: StrategyAssignment[];
  personalizedStrategies: StrategyAssignment[];
  experimentalStrategies: StrategyAssignment[];
  portfolioDiversityScore: number;
  exploreRatio: number;
  exploitRatio: number;
  lastRebalancedAt: string;
}

export interface StrategyOutcomeEvent {
  id: string;
  assignmentId: string;
  strategyId: string;
  employeeId: string;
  employeeRole: RoleType;
  outcomeDescription: string;
  outcomeMetrics: { metric: string; value: number; unit: string; baseline: number }[];
  observedAt: string;
  contextAtObservation: {
    workloadLevel?: string;
    externalFactors?: string[];
    concurrentStrategies?: string[];
  };
  attributionId?: string;
}

export interface StrategyEvolutionProposal {
  id: string;
  parentStrategyIds: string[];
  proposedComponents: StrategyComponent[];
  proposedExecutionPattern: StrategyExecutionPattern;
  proposedContext: StrategyContextCondition[];
  rationale: string;
  expectedImprovement: string;
  status: "proposed" | "validated" | "deployed" | "rejected";
  complianceValidated: boolean;
  proposedAt: string;
  validatedAt?: string;
}

export interface StrategyMarketplaceEntry {
  strategyId: string;
  strategy: StrategyGenome;
  contributorEmployeeId: string;
  contributorRole: RoleType;
  adoptionCount: number;
  successRate: number;
  averageContribution: number;
  evidenceLevel: EvidenceLevel;
  tags: string[];
  featured: boolean;
  listedAt: string;
}

// ─── Territory Policy Package ──────────────────────────────────────

export interface TerritoryPolicyPackage {
  territory: string;
  approvedProducts: string[];
  approvedIndications: string[];
  permittedClaims: string[];
  contentLibrary: { id: string; name: string; type: string; expiryDate: string }[];
  privacyRequirements: string[];
  consentRequirements: string[];
  interactionRules: string[];
  transferOfValuePolicy: string;
  formularyStructure: string;
  language: string;
  reimbursementSystem: string;
  availableData: string[];
  rolePermissions: Record<RoleType, string[]>;
  channelPreferences: string[];
}

// ─── Competitive Performance Execution Engine ──────────────────────

export type StrategyLifecycleState =
  | "proposed"
  | "simulated"
  | "shadow_tested"
  | "limited_experiment"
  | "validated"
  | "scaled"
  | "monitored"
  | "retired";

export type ActionLane = "proven" | "personalized" | "experimental";

export type ActionStatus =
  | "assigned"
  | "accepted"
  | "modified"
  | "replaced"
  | "declined"
  | "completed"
  | "expired";

export type ExperimentVariantRole = "control" | "variant_a" | "variant_b" | "variant_c" | "variant_d";

export type ExperimentStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "analyzed";

export type StopReason =
  | "compliance_exception"
  | "negative_outcome_threshold"
  | "insufficient_sample"
  | "sufficient_evidence"
  | "manual_stop";

export interface EmployeeProfile {
  id: string;
  name: string;
  role: RoleType;
  territory: string;
  tenureMonths: number;
  territoryMaturity: "early" | "growing" | "mature" | "declining";
  marketRestrictions: string[];
  productFocus: string[];
  experienceLevel: "new" | "intermediate" | "expert" | "elite";
  consentExperimental: boolean;
  cohortTags: string[];
}

export interface CompetitiveScoreDimension {
  label: string;
  score: number;
  peerAverage: number;
  topQuartile: number;
}

export interface CompetitiveScore {
  employeeId: string;
  dimensions: CompetitiveScoreDimension[];
  rawPosition: { rank: number; total: number };
  adjustedPosition: { rank: number; total: number };
  adjustedPerformanceIndex: number;
  percentile: number;
  adjustedPercentile: number;
  computedAt: string;
}

export interface TrajectoryStep {
  order: number;
  objective: string;
  currentState: string;
  targetState: string;
  metric: string;
  currentValue: number;
  targetValue: number;
  status: "pending" | "in_progress" | "achieved" | "at_risk";
}

export interface PerformanceTrajectory {
  employeeId: string;
  primaryConstraint: string;
  constraintDescription: string;
  steps: TrajectoryStep[];
  expectedPercentile30Day: { low: number; high: number };
  generatedAt: string;
}

export interface ActionRecommendation {
  id: string;
  lane: ActionLane;
  title: string;
  description: string;
  competitiveReason: string;
  whyThisAction: string;
  expectedEffortMin: number;
  expectedUpside: "low" | "moderate" | "high";
  confidence: number;
  strategyStatus: StrategyLifecycleState;
  accountId?: string;
  hcpName?: string;
  approvedContentId?: string;
  permittedChannel?: string;
  experimentId?: string;
  experimentVariant?: ExperimentVariantRole;
  experimentDurationDays?: number;
  experimentProtections?: string[];
  riskLevel: "low" | "moderate" | "high";
  status: ActionStatus;
  employeeFeedback?: string;
  assignedAt: string;
  completedAt?: string;
}

export interface ActionPortfolio {
  employeeId: string;
  provenPercent: number;
  personalizedPercent: number;
  experimentalPercent: number;
  actions: ActionRecommendation[];
  generatedAt: string;
}

export interface CompetitivePlan {
  employeeId: string;
  currentPositionPercentile: number;
  expectedPosition30Day: { low: number; high: number };
  primaryPerformanceConstraint: string;
  constraintDescription: string;
  bestNextAction: string;
  expectedEffect: string;
  evidenceConfidence: number;
  portfolio: ActionPortfolio;
  trajectory: PerformanceTrajectory;
  score: CompetitiveScore;
  generatedAt: string;
}

export interface ExperimentVariant {
  role: ExperimentVariantRole;
  description: string;
  assignedCount: number;
  progressionRate: number;
  responseRate: number;
  followUpCompletion: number;
  representativeAcceptance: number;
}

export interface ExperimentContract {
  id: string;
  hypothesis: string;
  description: string;
  eligibleCriteria: string[];
  excludedCriteria: string[];
  primaryOutcome: string;
  secondaryOutcomes: string[];
  guardrails: string[];
  stopConditions: string[];
  variants: ExperimentVariant[];
  status: ExperimentStatus;
  durationDays: number;
  startDate: string;
  endDate?: string;
  stopReason?: StopReason;
  stopDetail?: string;
  totalAssigned: number;
  complianceValidated: boolean;
  createdAt: string;
  analyzedAt?: string;
  winningVariant?: ExperimentVariantRole;
  effectSize?: number;
  confidenceLevel?: number;
}

export interface CohortDefinition {
  id: string;
  name: string;
  criteria: string[];
  employeeIds: string[];
  size: number;
}

export interface StrategyContextKey {
  territoryMaturity?: string;
  barrierType?: BarrierType;
  accountState?: HCPFunnelState;
  employeeExperience?: string;
  channel?: string;
}

export interface StrategyLearning {
  id: string;
  context: StrategyContextKey;
  action: string;
  observedOutcome: string;
  effectSize: number;
  confidence: number;
  sampleSize: number;
  lifecycleState: StrategyLifecycleState;
  discoveredAt: string;
  lastValidatedAt: string;
  patternDescription: string;
}

export interface ActionOutcome {
  id: string;
  actionId: string;
  employeeId: string;
  experimentId?: string;
  variant?: ExperimentVariantRole;
  actionTaken: string;
  outcome: "meaningful_response" | "account_progressed" | "barrier_resolved" | "no_effect" | "recommendation_incorrect" | "follow_up_completed";
  timeToOutcomeHours: number;
  capturedAt: string;
  context: StrategyContextKey;
}

export interface PersonalChallenge {
  id: string;
  employeeId: string;
  objective: string;
  currentRate: number;
  topQuartileRate: number;
  targetRate: number;
  potentialEffect: string;
  weekOf: string;
  progress: number;
  status: "active" | "completed" | "expired";
}

export interface TeamExperiment {
  id: string;
  objective: string;
  employeeStrategy: string;
  otherStrategies: string[];
  resultSharing: "aggregated_after" | "real_time" | "never";
  status: ExperimentStatus;
}

export interface ManagerLabView {
  validatedStrategies: number;
  activeExperiments: number;
  promisingStrategies: number;
  stoppedStrategies: number;
  topEmergingAdvantage: string;
  measuredEffect: string;
  confidence: number;
  eligibleTerritories: number;
  employeeDevelopment: {
    employeeId: string;
    name: string;
    primaryStrength: string;
    primaryConstraint: string;
    currentIntervention: string;
    observedEffect: string;
  }[];
}

export interface AntiGamingFlag {
  type: "artificial_crm_activity" | "duplicate_engagement" | "meaningless_followup" | "selective_reporting" | "delayed_data_entry" | "stage_manipulation";
  employeeId: string;
  detail: string;
  severity: "low" | "moderate" | "high";
  detectedAt: string;
}

export interface CompetitiveEngineState {
  employees: EmployeeProfile[];
  experiments: ExperimentContract[];
  strategies: StrategyLearning[];
  outcomes: ActionOutcome[];
  challenges: PersonalChallenge[];
  antiGamingFlags: AntiGamingFlag[];
  actionHistory: ActionRecommendation[];
}

// ─── GOLDEN NODE: Distributed Hypothesis-to-Business Engine ────────

/** Prior-art classification assigned by the research engine before assignment. */
export type PriorArtStatus =
  | "established"
  | "transfer_candidate"
  | "novel_permutation"
  | "new_mechanism"
  | "unsupported";

/** Distinguishes "untested" from "tested and failed" from "evidence too poor". */
export type PriorArtEvidenceState = "untested" | "supported" | "failed" | "inconclusive";

/** What kind of opportunity a hypothesis represents for the employee. */
export type HypothesisKind =
  | "reliable" // strong chance of immediate value
  | "fit" // matched to strengths/territory
  | "discovery" // less certain, strategically important
  | "builder"; // ownership of a larger process or channel

/** Lifecycle of a hypothesis as it moves through the perpetual progress loop. */
export type HypothesisState =
  | "researched"
  | "assigned"
  | "accepted"
  | "modified"
  | "executing"
  | "observed"
  | "attributed"
  | "finalized"
  | "branched"
  | "candidate"
  | "validated"
  | "scaled"
  | "productized"
  | "channel"
  | "falsified"
  | "rejected";

/** Lifecycle stages a Golden Node passes through on the way to a business channel. */
export type GoldenNodeStage =
  | "hypothesis"
  | "local_success"
  | "rep_owned_process"
  | "replicated_method"
  | "organizational_capability"
  | "productized_service"
  | "independent_channel";

/** Kinds of valuable result the system rewards (success is not only conversion). */
export type SuccessKind =
  | "performance"
  | "efficiency"
  | "discovery"
  | "boundary"
  | "system"
  | "channel"
  | "falsification";

/** Adaptive engagement mode derived from observed interaction behavior (not stereotypes). */
export type EngagementMode = "system_oriented" | "human_guided" | "hybrid" | "unknown";

/** A single observed interaction-preference signal for an account. */
export interface AccountInteractionSignal {
  digitalResponsiveness: number; // 0..1 observed
  preferredChannel: string;
  selfServiceCompletion: number; // 0..1 observed
  staffDelegationPattern: "physician" | "staff" | "mixed";
  meetingPreference: "in_person" | "virtual" | "async" | "mixed";
  responseLatencyHours: number;
  contentDepthPreference: "brief" | "moderate" | "detailed";
  workflowComplexityTolerance: "low" | "medium" | "high";
  priorAutomationAdoption: number; // 0..1 observed
}

/** A prior-art research record produced before a hypothesis reaches an employee. */
export interface PriorArtRecord {
  id: string;
  hypothesisClaim: string;
  status: PriorArtStatus;
  evidenceState: PriorArtEvidenceState;
  sourceDomains: string[];
  testedInMarket: boolean;
  testedInAdjacentIndustries: boolean;
  adjacentSupportSummary: string;
  responsibleComponent: string | null;
  requiredConditions: string[];
  risksAndConfounders: string[];
  genuinelyUnknown: string[];
  researchConfidence: number; // 0..1
  researchedAt: string;
  noveltyDelta?: string;
  categoryOverlap?: string[];
}

/** The structured anatomy of a single hypothesis. */
export interface HypothesisAnatomy {
  id: string;
  claim: string;
  priorArtStatus: PriorArtStatus;
  priorArtId: string;
  sourceDomains: string[];
  targetCondition: string;
  intervention: string;
  control: string;
  primaryOutcome: string;
  secondaryOutcomes: string[];
  knownConfounders: string[];
  complianceBoundary: string;
  expectedValue: string;
  primaryUncertainty: string;
  novelComponent: string | null;
  kind: HypothesisKind;
  researchRisk: "low" | "moderate" | "high";
  createdAt: string;
  /** What is fixed by policy and what the employee may change. */
  fixedConstraints: string[];
  modifiableDimensions: InnovationDimension[];
  /** Eligible account interaction modes this hypothesis targets. */
  targetEngagementModes: EngagementMode[];
  parentHypothesisId?: string;
  /** Origin: "research" | "derivative_human" | "derivative_llm" | "derivative_attribution". */
  origin: "research" | "derivative_human" | "derivative_llm" | "derivative_attribution";
}

/** Dimensions an employee may modify within their innovation window. */
export type InnovationDimension =
  | "stakeholder"
  | "timing"
  | "channel"
  | "content_sequence"
  | "automation_step"
  | "followup_interval";

/** A hypothesis allocated to an employee for the day. */
export interface HypothesisAssignment {
  id: string;
  hypothesisId: string;
  employeeId: string;
  employeeRole: RoleType;
  kind: HypothesisKind;
  state: HypothesisState;
  assignedAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  modifiedAt?: string;
  /** Free-text reason from the employee when modifying or rejecting. */
  employeeNote?: string;
  /** The single dimension the employee chose to modify, if any. */
  modifiedDimension?: InnovationDimension;
  modificationRationale?: string;
  /** Eligible accounts selected for the test. */
  eligibleAccountIds: string[];
  evaluationPeriodDays: number;
  trialNumber: number;
  /** Why this hypothesis reached this employee. */
  allocationReason: string;
  /** Innovation window: which dimensions the employee may modify. */
  innovationWindow: InnovationDimension[];
  /** Linked process-ownership mission, if this is a builder hypothesis. */
  processOwnershipId?: string;

  // ─── Workflow evidence chain ────────────────────────────────────
  // Each stage produces evidence that feeds the next. Skipping a stage
  // is allowed but degrades downstream attribution confidence.

  /** Stage 2 (Intel): research findings, confounders, adversarial challenge */
  intel?: WorkflowIntel;
  /** Stage 3 (Execution): the plan committed before field action */
  executionPlan?: WorkflowExecutionPlan;
  /** Stage 4 (Observation): what actually happened in the field */
  observationId?: string;
  /** Stage 5 (Attribution): causal analysis result */
  attributionId?: string;
  /** Timestamps for each stage transition — used for pacing analytics */
  stageTimestamps?: {
    accepted?: string;
    intelComplete?: string;
    executionStarted?: string;
    observed?: string;
    attributed?: string;
    finalized?: string;
  };
}

/** Intel gathered before execution. Each piece is evidence that shapes
 *  downstream attribution. More intel = higher confidence ceiling. */
export interface WorkflowIntel {
  /** Prior-art research findings (from /api/golden/llm action=research) */
  research?: {
    summary: string;
    sourceDomains: string[];
    adjacentSupport: string;
    runAt?: string;
  };
  /** Confounders identified (from /api/llm/infer confounder prompt) */
  confounders?: {
    items: string[];
    runAt?: string;
  };
  /** Adversarial challenge (from /api/llm/infer challenge prompt) */
  challenge?: {
    text: string;
    weakestPoint: string;
    falsificationCondition: string;
    runAt?: string;
  };
  /** How many intel steps were completed (0-3). Affects attribution confidence. */
  stepsCompleted: number;
  /** Whether the employee skipped intel to go straight to execution */
  skipped: boolean;
}

/** The plan committed before field execution. This is the "bet" —
 *  what you predict will happen, so observation can compare against it. */
export interface WorkflowExecutionPlan {
  /** Which accounts you'll test on */
  accountIds: string[];
  /** What modification you're making (if any) */
  modification?: {
    dimension: InnovationDimension;
    rationale: string;
  };
  /** What you predict will happen — the pre-registration */
  prediction: {
    metric: string;
    expectedDirection: "increase" | "decrease" | "no_change";
    expectedMagnitude: string;
    unit: string;
  };
  /** What would falsify this — your exit condition */
  falsificationCriteria: string;
  /** How many days you'll run before observing */
  evaluationDays: number;
  committedAt: string;
}

/** A measured outcome from executing a hypothesis assignment. */
export interface HypothesisOutcome {
  id: string;
  assignmentId: string;
  hypothesisId: string;
  employeeId: string;
  observedAt: string;
  successKind: SuccessKind;
  outcomeDescription: string;
  metrics: { metric: string; value: number; unit: string; baseline: number; higherIsBetter: boolean }[];
  /** Honest falsification is a valuable result, not a failure. */
  falsified: boolean;
  falsificationEvidence?: string;
  contextAtObservation: { externalFactors?: string[]; concurrentHypotheses?: string[] };
  attributionId?: string;
}

/** Causal attribution for a hypothesis outcome. */
export interface HypothesisAttribution {
  id: string;
  outcomeId: string;
  hypothesisId: string;
  employeeId: string;
  estimatedEffect: number; // -1..1 normalized effect
  attributionConfidence: number; // 0..1
  method: "matched_pairs" | "before_after" | "comparison_group" | "expert_judgment" | "unresolved";
  counterfactualEstimate: string;
  unexplainedVariance: number;
  /** Which component appears responsible (parent vs employee modification vs territory vs execution). */
  responsibleFactor: "parent_hypothesis" | "employee_modification" | "territory" | "execution_quality" | "external_change" | "unresolved";
  reasoning: string;
  attributedAt: string;
}

/** A derivative branching from a parent hypothesis. */
export interface HypothesisDerivative {
  id: string;
  parentHypothesisId: string;
  claim: string;
  modifiedDimension: InnovationDimension;
  origin: "derivative_human" | "derivative_llm" | "derivative_attribution";
  proposedByEmployeeId?: string;
  rationale: string;
  status: "proposed" | "testing" | "supported" | "falsified" | "superseded";
  createdAt: string;
  /** Generated from unexplained variance in attribution. */
  generatedFromUnexplainedVariance?: boolean;
}

/** A no-code process built in the System Builder laboratory. */
export type ProcessStepType = "trigger" | "condition" | "action" | "wait" | "measurement" | "stop";

export interface ProcessStep {
  id: string;
  type: ProcessStepType;
  label: string;
  /** For wait steps, hours to wait. */
  waitHours?: number;
  /** For condition steps, the predicate expression. */
  condition?: string;
  /** For measurement steps, which metrics to capture. */
  measures?: string[];
  /** Branch target step ids. */
  nextStepIds: string[];
}

export interface ProcessDefinition {
  id: string;
  name: string;
  objective: string;
  ownerEmployeeId: string;
  hypothesisId: string;
  steps: ProcessStep[];
  eligibilityRules: string[];
  humanInterventionPoints: string[];
  measurementDesign: string[];
  complianceBoundary: string;
  version: number;
  parentProcessId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A Golden Node: a hypothesis evolved beyond a tactic into a defensible capability. */
export interface GoldenNode {
  id: string;
  hypothesisId: string;
  originEmployeeId: string;
  originAssignmentId: string;
  stage: GoldenNodeStage;
  claim: string;
  observedResult: string;
  primaryMechanism: string;
  repContribution: string;
  derivativeId?: string;
  replicationCount: number;
  replicationTerritories: string[];
  measurableEffect: boolean;
  repeatability: boolean;
  portability: boolean;
  defensibleMechanism: boolean;
  reusableProcess: boolean;
  economicValue: number;
  economicValueConfidence: number;
  attributionLedgerId: string;
  candidateChannelName?: string;
  createdAt: string;
  promotedAt?: string;
}

/** Credit ledger that survives scaling so employee innovation is not renamed "best practice". */
export interface AttributionLedgerEntry {
  id: string;
  goldenNodeId: string;
  originalHypothesisSource: string;
  assignedEmployeeId: string;
  employeeModifications: string[];
  supportingCollaborators: string[];
  replicationTeams: string[];
  automationContributors: string[];
  crossFunctionalContributors: string[];
  attributionConfidence: number;
  economicValueCreated: number;
  recognition: string[];
  createdAt: string;
}

/** Per-employee ledger ensuring fair access to high-upside hypotheses. */
export interface DiscoveryOpportunityLedger {
  employeeId: string;
  highUpsideHypothesesReceived: number;
  builderMissionsReceived: number;
  experimentalRiskAssumed: number;
  successfulReplicationsCompleted: number;
  usefulFailuresGenerated: number;
  strategiesContributed: number;
  goldenNodeCreditEarned: number;
  updatedAt: string;
}

/** Research reliability unlocks what kind of experiment an employee can safely own. */
export type ResearchReliabilityLevel =
  | "participant"
  | "reliable_tester"
  | "replicator"
  | "hypothesis_modifier"
  | "process_builder"
  | "strategy_architect"
  | "golden_node_founder";

export interface ResearchReliability {
  employeeId: string;
  level: ResearchReliabilityLevel;
  executionFidelity: number; // 0..1
  evidenceQuality: number;
  ethicalJudgment: number;
  usefulOverrides: number;
  experimentCompletion: number;
  confounderDetection: number;
  derivativeQuality: number;
  collaboration: number;
  updatedAt: string;
}

/** Research competition achievement categories (not only sales outcomes). */
export type ResearchCompetitionCategory =
  | "best_validated_strategy"
  | "most_useful_falsification"
  | "highest_quality_replication"
  | "largest_efficiency_gain"
  | "strongest_process_derivative"
  | "best_new_channel_hypothesis"
  | "most_transferable_workflow"
  | "most_accurate_model_challenge";

export interface ResearchCompetitionEntry {
  id: string;
  category: ResearchCompetitionCategory;
  employeeId: string;
  hypothesisId: string;
  description: string;
  score: number;
  rankedAt: string;
}

/** Pharma boundary guard result. */
export interface ComplianceCheckResult {
  allowed: boolean;
  violations: string[];
  warnings: string[];
  checkedAt: string;
}

/** The full GOLDEN NODE engine state snapshot. */
export interface GoldenEngineState {
  hypotheses: HypothesisAnatomy[];
  priorArt: PriorArtRecord[];
  assignments: HypothesisAssignment[];
  outcomes: HypothesisOutcome[];
  attributions: HypothesisAttribution[];
  derivatives: HypothesisDerivative[];
  goldenNodes: GoldenNode[];
  attributionLedger: AttributionLedgerEntry[];
  discoveryLedger: DiscoveryOpportunityLedger[];
  researchReliability: ResearchReliability[];
  processes: ProcessDefinition[];
  competitions: ResearchCompetitionEntry[];
}

// ─── SPINOR: Scientific Performance & Innovation Network ────────────
// SPINOR refines the GOLDEN NODE engine into a living experimental
// ecosystem. The vocabulary is organic because the interface represents
// the actual epistemology of the product: hypotheses are seeds,
// experiments are stems, derivatives are branches, replications are
// roots, results are fruit, and validated methods become Golden Nodes.

/** Organic maturity stages a hypothesis passes through as evidence accumulates. */
export type SpinorMaturityStage =
  | "seed" // plausible but untested idea
  | "sprout" // tested once with an encouraging result
  | "branch" // derivative adapted to another context
  | "grove" // replicated by several participants
  | "golden_node" // high-value, repeatable, documented conditions of success
  | "infrastructure" // Golden Node integrated into the standard operating system
  | "spinout"; // method valuable enough to become a separate product/channel/business

/** Evidence badges distinguishing verified evidence from internal observation. */
export type SpinorEvidenceBadge =
  | "established" // multiple relevant studies or repeated organizational evidence
  | "supported" // some direct evidence, important limitations remain
  | "transferred" // evidence exists in another industry/population/channel
  | "plausible" // reasonable mechanism, direct evidence weak
  | "untested" // no meaningful direct test identified
  | "contradicted" // reliable evidence challenges the claim
  | "internal_signal"; // organization observed an effect, not independently validated

/** A single component of the Discovery Contribution Score. */
export interface DCSComponent {
  /** Component symbol: I, C, R, V, T, H */
  symbol: "I" | "C" | "R" | "V" | "T" | "H";
  /** Human-readable name. */
  name: string;
  /** Normalized value 0..1 (for H, 0 = no harm, 1 = severe harm). */
  value: number;
  /** Short justification grounded in observed data. */
  rationale: string;
}

/**
 * Discovery Contribution Score.
 *
 *   DCS = (I × C × R × V × T) / H
 *
 * Impact × Confidence × Replicability × Novelty × Transferability,
 * divided by a Harm penalty. A large conversion increase from a tiny
 * uncontrolled sample receives a limited score; a modest increase
 * reproduced across several reps and segments may score much higher.
 */
export interface DiscoveryContributionScore {
  components: DCSComponent[];
  /** Final score in [0, 100]. Zero when harm is maximal or evidence missing. */
  score: number;
  /** Confidence in the score itself (driven by sample size & replication). */
  scoreConfidence: number;
  /** Whether the score is provisional (awaiting replication) or settled. */
  provisional: boolean;
}

/** The role a node plays in the Hypothesis Organism canvas. */
export type SpinorNodeRole =
  | "core" // today's hypothesis at the center
  | "supporting_research" // evidence that supports
  | "contradicting" // evidence that challenges
  | "previous_attempt" // earlier trial of the same/parent hypothesis
  | "derivative" // branched hypothesis
  | "replication" // independent replication
  | "risk_signal" // compliance / harm / confounder
  | "expected_value" // projected business value
  | "golden_node" // validated, glowing junction
  | "compost"; // falsified result that informs future experiments

/** A single node in the Hypothesis Organism. */
export interface SpinorOrganismNode {
  id: string;
  role: SpinorNodeRole;
  label: string;
  detail: string;
  evidence: SpinorEvidenceBadge;
  maturity: SpinorMaturityStage;
  /** Color channel per the SPINOR color system. */
  color: "blue" | "violet" | "green" | "gold" | "red" | "gray";
  /** Polar coordinates for radial layout around the core. */
  angle: number; // radians
  radius: number; // 0 = core, increasing outward
  /** Optional link to a real entity id. */
  refId?: string;
  /** Whether new evidence has arrived since last view (drives pulse). */
  pulse?: boolean;
}

/** The full Hypothesis Organism served to a participant for today. */
export interface SpinorOrganism {
  employeeId: string;
  assignmentId: string;
  hypothesisId: string;
  claim: string;
  /** Why this hypothesis reached this participant. */
  allocationReason: string;
  maturity: SpinorMaturityStage;
  evidence: SpinorEvidenceBadge;
  dcs: DiscoveryContributionScore;
  /** Surrounding nodes forming the organism. */
  nodes: SpinorOrganismNode[];
  /** Signature actions available to the participant. */
  actions: SpinorSignatureAction[];
  /** Required sample / trial count for a defensible result. */
  requiredTrials: number;
  /** Trials completed to date across all participants on this hypothesis. */
  trialsCompleted: number;
  /** Time window for the experiment in days. */
  timeWindowDays: number;
  /** Compliance boundary text (pharma-safe). */
  complianceBoundary: string;
  /** What result would falsify the hypothesis. */
  falsificationCondition: string;
  generatedAt: string;
}

/** Signature SPINOR interactions (the participant never clicks "Complete Task"). */
export type SpinorSignatureAction =
  | "plant" // begin the experiment
  | "observe" // record an interim measurement
  | "record" // log a final outcome
  | "challenge" // dispute the hypothesis or its evidence
  | "replicate" // verify or falsify another participant's finding
  | "derive" // propose a derivative
  | "integrate" // promote a validated method into infrastructure
  | "spin_out"; // propose a constellation become a separate channel/business

/** A participant's multidimensional SPINOR profile (secondary scores). */
export interface SpinorParticipantProfile {
  employeeId: string;
  dimensions: {
    commercialImpact: number;
    experimentQuality: number;
    learningVelocity: number;
    replicationContribution: number;
    hypothesisCreativity: number;
    operationalEfficiency: number;
    knowledgeSharing: number;
    customerValue: number;
    complianceReliability: number;
    processBuildingAbility: number;
  };
  /** Current research streak (consecutive high-quality experiments). */
  researchStreak: number;
  /** Allocation mix actually received, for fairness auditing. */
  allocationMix: { exploitation: number; capability: number; exploration: number; wildcard: number };
}

// ─── SPINOR-RL: Palindromic Perpetual Research Game ──────────────────

/** The 10 mission classes that rotate to prevent fatigue. */
export type MissionClass =
  | "scout"          // search prior art, customer behavior, competitor methods
  | "field"          // perform a constrained real-world test
  | "builder"        // convert a tactic into automation or reusable system
  | "replication"    // test another employee's result in a different setting
  | "saboteur"       // attempt to falsify a successful organizational belief
  | "mutation"       // generate useful derivatives of an existing hypothesis
  | "translator"     // adapt a successful method for a different physician profile
  | "recovery"       // investigate why a high-effort employee or territory is underperforming
  | "channel"        // determine whether a validated process can become a separate business line
  | "palindrome";    // take a mature system backward, isolate assumptions, rebuild from first principles

/** A mission card delivered to an employee for the day. */
export interface MissionCard {
  id: string;
  employeeId: string;
  missionClass: MissionClass;
  hypothesisId?: string;
  assignmentId?: string;
  title: string;
  claim: string;
  priorEvidence: string;
  testedAlready: string;
  unknowns: string[];
  targetPopulation: string;
  experimentalAction: string;
  controlComparison: string;
  successMetric: string;
  failureCondition: string;
  riskBoundary: string;
  minimumEvidence: string;
  strategicValue: string;
  /** Why this mission reached this employee. */
  allocationReason: string;
  state: "assigned" | "accepted" | "executing" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string;
}

/** Physician technology-adaptation state (hypotheses, not permanent labels). */
export type PhysicianAdaptationState =
  | "automation_resistant"
  | "automation_tolerant"
  | "automation_curious"
  | "automation_proficient"
  | "llm_aware"
  | "system_building"
  | "human_relationship_dominant"
  | "administrative_delegation_dominant"
  | "evidence_intensive"
  | "time_compressed"
  | "technically_sophisticated_conservative";

/** Continuously updated physician interaction model. */
export interface PhysicianModel {
  physicianId: string;
  name: string;
  currentState: PhysicianAdaptationState;
  stateHistory: { state: PhysicianAdaptationState; observedAt: string; evidence: string }[];
  interactionSignals: {
    digitalResponsiveness: number;   // 0..1 observed
    preferredChannel: string;
    selfServiceCompletion: number;   // 0..1 observed
    staffDelegationPattern: "physician" | "staff" | "mixed";
    meetingPreference: "in_person" | "virtual" | "async" | "mixed";
    responseLatencyHours: number;
    contentDepthPreference: "brief" | "moderate" | "detailed";
    workflowComplexityTolerance: "low" | "medium" | "high";
    priorAutomationAdoption: number; // 0..1 observed
  };
  /** LLM-derived recommended communication approach. */
  recommendedApproach: string;
  /** What the system should test next with this physician. */
  nextTestHypothesis: string;
  updatedAt: string;
}

/** Forward + reverse palindromic learning pass after an experiment. */
export interface PalindromeUpdate {
  id: string;
  outcomeId: string;
  hypothesisId: string;
  employeeId: string;
  forward: {
    improvedOutcome: boolean;
    forWhom: string;
    conditions: string;
    repeatable: boolean;
    canBecomeSystem: boolean;
    llmAnalysis: string;
    llmUsed: boolean;
  };
  reverse: {
    assumptionGenerated: string;
    evidenceInterpretedCorrectly: boolean;
    alternativeMechanism: string;
    whereShouldFail: string;
    earlierDecisionToRevise: string;
    newResearchQuestion: string;
    llmAnalysis: string;
    llmUsed: boolean;
  };
  /** The learning record: prior belief → next hypothesis. */
  learningRecord: {
    priorBelief: string;
    selectedHypothesis: string;
    executedAction: string;
    observedResult: string;
    inferredMechanism: string;
    uncertaintyUpdate: string;
    rewardUpdate: string;
    policyUpdate: string;
    nextHypothesis: string;
  };
  createdAt: string;
}

/** RL state for the contextual multi-agent bandit. */
export interface RLAgentState {
  employeeId: string;
  capabilityProfile: Record<string, number>;
  recentEffort: number;
  historicalPerformance: number;
  researchQuality: number;
  priorHypothesisExposure: string[];
  experimentNovelty: number;
  operationalWorkload: number;
  confidenceInEvidence: number;
  unresolvedQuestions: string[];
}

/** RL action available to the allocation engine. */
export type RLAction =
  | "assign_hypothesis"
  | "increase_difficulty"
  | "reduce_difficulty"
  | "provide_prior_art"
  | "pair_with_collaborator"
  | "introduce_automation"
  | "request_derivative"
  | "move_to_segment"
  | "replicate_result"
  | "attack_result"
  | "promote_to_system"
  | "retire_hypothesis";

/** RL reward function components. */
export interface RLReward {
  validatedOutcomeValue: number;
  evidenceQuality: number;
  causalConfidence: number;
  novelty: number;
  reproducibility: number;
  usefulFailure: number;
  processImprovement: number;
  knowledgeTransferred: number;
  systemCreated: number;
  complianceRisk: number;
  customerHarm: number;
  evidenceContamination: number;
  metricManipulation: number;
  redundantExperimentation: number;
  /** Total reward = sum of positives − sum of negatives. */
  total: number;
}

/** Email-extracted competitive signal. */
export interface EmailSignal {
  id: string;
  emailId: string;
  employeeId: string;
  commitments: string[];
  objections: string[];
  unansweredQuestions: string[];
  timingPatterns: string;
  stakeholderRelationships: string[];
  technologyAdoptionSignals: string[];
  processBottlenecks: string[];
  unresolvedRequests: string[];
  emergingDemand: string[];
  conversionLanguage: string[];
  behavioralDeviations: string[];
  /** LLM-generated next-action recommendation. */
  recommendedNextAction: string;
  recommendedNextTest: string;
  untestedPossibility: string;
  beliefToChallenge: string;
  processToAutomate: string;
  bestEmployeeToInvestigate: string;
  llmUsed: boolean;
  extractedAt: string;
}

/** Anti-stagnation flag for repetitive tasks. */
export type StagnationTransformation =
  | "automate"
  | "eliminate"
  | "experiment"
  | "promote_to_system";

export interface StagnationFlag {
  id: string;
  taskDescription: string;
  employeeId: string;
  repetitionCount: number;
  predictabilityScore: number;  // 0..1, higher = more predictable
  recommendedTransformation: StagnationTransformation;
  rationale: string;
  automationPlan: string;
  llmUsed: boolean;
  detectedAt: string;
  resolvedAt?: string;
}

/** Sprouting derivative tree node. */
export interface SproutNode {
  id: string;
  hypothesisId: string;
  parentSproutId?: string;
  employeeId: string;
  claim: string;
  modifiedDimension: string;
  status: "proposed" | "testing" | "supported" | "falsified" | "superseded";
  depth: number;          // 0 = original, 1 = first derivative, 2 = second, etc.
  childrenIds: string[];
  /** Credit to the employee who proposed this sprout. */
  creditEmployeeId: string;
  /** Whether this sprout was validated by another employee. */
  validatedBy?: string;
  createdAt: string;
}

/** Staged diffusion state for a validated discovery. */
export type DiffusionStage =
  | "discovery"
  | "internal_replication"
  | "mechanism_isolation"
  | "segment_testing"
  | "adversarial_challenge"
  | "controlled_diffusion"
  | "operational_standard"
  | "continuous_retesting";

export interface DiffusionState {
  hypothesisId: string;
  stage: DiffusionStage;
  replicatingEmployees: string[];
  mutatingEmployees: string[];
  falsifyingEmployees: string[];
  failureTestEmployees: string[];
  standardAdoptedAt?: string;
  lastRetestAt: string;
  llmUsed: boolean;
  updatedAt: string;
}

/** Anti-gaming control check result. */
export interface AntiGamingCheck {
  id: string;
  experimentId: string;
  employeeId: string;
  preRegisteredConditions: boolean;
  controlPopulationUsed: boolean;
  holdoutTestingUsed: boolean;
  randomizedAssignment: boolean;
  outcomeDelayWindow: number;
  evidenceProvenance: string;
  anomalyDetected: boolean;
  duplicateExperiment: boolean;
  selectiveReportingPenalty: number;
  negativeFindingReported: boolean;
  passed: boolean;
  checkedAt: string;
}

/** The full SPINOR-RL engine state. */
export interface SpinorRLState {
  missions: MissionCard[];
  physicians: PhysicianModel[];
  palindromeUpdates: PalindromeUpdate[];
  rlAgentStates: RLAgentState[];
  rlRewards: RLReward[];
  emailSignals: EmailSignal[];
  stagnationFlags: StagnationFlag[];
  sproutTree: SproutNode[];
  diffusionStates: DiffusionState[];
  antiGamingChecks: AntiGamingCheck[];
}

// ─── ADMISSIBILITY ENGINE ──────────────────────────────────────────────

/** The five admissibility tiers. Lowest to highest evidentiary strength. */
export type AdmissibilityLevel =
  | "observation"
  | "internal_signal"
  | "controlled_experiment"
  | "valid_replication"
  | "golden_node_eligible";

/** A single failed or satisfied admissibility requirement. */
export interface AdmissibilityCheck {
  requirement: string;
  satisfied: boolean;
  detail: string;
}

/** The full admissibility decision for one experiment/SPIN record. */
export interface AdmissibilityDecision {
  recordId: string;
  level: AdmissibilityLevel;
  checks: AdmissibilityCheck[];
  admissible: boolean;
  /** Human-readable explanation of why the record landed at this level. */
  rationale: string;
  /** Confounders that remain unresolved and cap the attainable level. */
  blockingConfounders: string[];
  decidedAt: string;
  /** Configuration version used, for auditability. */
  configVersion: string;
}

/** Configurable thresholds for the admissibility engine. */
export interface AdmissibilityConfig {
  configVersion: string;
  minObservationsInternalSignal: number;
  executionFidelityThreshold: number; // 0..1
  minReplicationsGoldenNode: number;
  minExperimentsGoldenNode: number;
  attributionConfidenceThreshold: number; // 0..1
  requireFailureBoundaryForGoldenNode: boolean;
  requireTransferabilityForGoldenNode: boolean;
  requireComplianceClear: boolean;
}

// ─── ACTIVITY GENOME ───────────────────────────────────────────────────

/** The genome dimensions that describe a mission's conceptual fingerprint. */
export interface ActivityGenome {
  missionId: string;
  customerType: string;
  stakeholder: string;
  channel: string;
  taskStructure: string;
  location: string;
  cognitiveMode: string;
  researchQuestion: string;
  skillRequired: string;
  automationLevel: number; // 0..1
  socialInteraction: number; // 0..1
  timeHorizon: "immediate" | "short" | "medium" | "long";
  collaborationLevel: number; // 0..1
  uncertaintyLevel: number; // 0..1
}

/** Supported rotation modes to prevent fatigue. */
export type ActivityMode =
  | "execution"
  | "observation"
  | "experiment_design"
  | "customer_research"
  | "workflow_creation"
  | "automation"
  | "replication"
  | "adversarial_review"
  | "process_teaching"
  | "failure_analysis"
  | "cross_functional"
  | "business_model_exploration";

/** Result of comparing a candidate mission against recent history. */
export interface GenomeSimilarityResult {
  candidateId: string;
  mostSimilarMissionId: string | null;
  similarity: number; // 0..1
  exceedsFatigueThreshold: boolean;
  recommendedMode: ActivityMode;
  rationale: string;
}

// ─── RESEARCH GAUNTLET ─────────────────────────────────────────────────

/** The nine mandatory gauntlet stages. */
export type GauntletStage =
  | "claim_dissection"
  | "prior_art_sweep"
  | "evidence_integrity"
  | "novelty_extraction"
  | "confounder_attack"
  | "experimental_design"
  | "field_execution"
  | "causal_reveal"
  | "derivative_generation";

export type GauntletStageStatus = "pending" | "in_progress" | "passed" | "revision_required" | "rejected";

/** A structured testable claim from Stage 1. */
export interface DissectedClaim {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
  timePeriod: string;
  mechanism: string;
  risk: string;
  falsificationCondition: string;
}

/** Evidence integrity summary from Stage 3. */
export interface EvidenceIntegrityReport {
  baseline: number | null;
  observed: number | null;
  absoluteChange: number | null;
  relativeChange: number | null; // fraction, e.g. 0.3 for 30%
  sampleSize: number | null;
  confidenceInterval: [number, number] | null;
  controlMethod: string | null;
  population: string | null;
  timeWindow: string | null;
  replications: number;
  interventionCost: string | null;
  negativeOutcomes: string[];
  missingData: string[];
  knownLimitations: string[];
  complete: boolean;
}

/** A single confounder from Stage 5. */
export interface GauntletConfounder {
  description: string;
  status: "unresolved" | "controlled" | "measured" | "unlikely" | "confirmed";
  linkedExperiment: boolean;
}

/** Experimental design from Stage 6. */
export interface ExperimentalDesign {
  eligiblePopulation: string;
  exclusionCriteria: string[];
  treatmentCondition: string;
  comparisonCondition: string;
  assignmentMethod: string;
  sampleTarget: number;
  primaryMetric: string;
  secondaryMetrics: string[];
  stoppingConditions: string[];
  observationWindow: string;
  allowedDeviations: string[];
  complianceRestrictions: string[];
  attributionPlan: string;
  minimumInstrumentation: string[];
  failureEscalationRules: string[];
}

/** Causal reveal result from Stage 8. */
export type CausalClassification =
  | "rejected"
  | "inconclusive"
  | "promising"
  | "replicated"
  | "golden_node_candidate"
  | "golden_node"
  | "compliance_blocked";

export interface CausalReveal {
  classification: CausalClassification;
  observedResult: string;
  absoluteEffect: number | null;
  relativeEffect: number | null;
  likelyContributors: string[];
  counterfactualEstimate: number | null;
  confidence: number;
  confounders: GauntletConfounder[];
  portability: "low" | "medium" | "high";
  failureBoundaries: string[];
  cost: string;
  burden: string;
  customerValue: string;
  nextResearchQuestion: string;
}

/** A single stage's record within the gauntlet. */
export interface GauntletStageRecord {
  stage: GauntletStage;
  status: GauntletStageStatus;
  startedAt: string | null;
  completedAt: string | null;
  reviewer: string | null;
  notes: string;
  rejectionReason: string | null;
}

/** The full gauntlet run for one hypothesis. */
export interface GauntletRun {
  runId: string;
  hypothesisId: string;
  spinId: string | null;
  stages: GauntletStageRecord[];
  dissectedClaim: DissectedClaim | null;
  evidenceIntegrity: EvidenceIntegrityReport | null;
  confounders: GauntletConfounder[];
  design: ExperimentalDesign | null;
  causalReveal: CausalReveal | null;
  currentStage: GauntletStage;
  complete: boolean;
  /** Linked outcome once the gauntlet reaches field execution. */
  outcomeId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Voice-First Mission Execution ───────────────────────────────────

/** State machine for a voice session. */
export type VoiceSessionState =
  | "idle"
  | "capability_check"
  | "permission_request"
  | "ready"
  | "briefing"
  | "listening"
  | "processing"
  | "review"
  | "confirmed"
  | "persisted"
  | "completed"
  | "paused"
  | "permission_denied"
  | "unsupported"
  | "transcription_failed"
  | "validation_failed"
  | "compliance_hold"
  | "network_interrupted"
  | "expired_mission"
  | "cancelled";

/** Browser capability detection status. */
export type CapabilityStatus =
  | "checking"
  | "supported"
  | "permission_required"
  | "permission_denied"
  | "unsupported"
  | "temporarily_unavailable"
  | "recognition_failed"
  | "audio_device_missing";

/** How a transcript segment was captured. */
export type CaptureMode =
  | "browser_recognition"
  | "server_transcription"
  | "audio_recording_deferred"
  | "text_entry";

/** Confirmation state of a transcript segment. */
export type ConfirmationState = "unconfirmed" | "confirmed" | "corrected" | "discarded";

/** Classification of a spoken statement. */
export type StatementClassification =
  | "directly_observed_fact"
  | "customer_reported_statement"
  | "employee_interpretation"
  | "estimate"
  | "prediction"
  | "causal_claim"
  | "preference_inference"
  | "unresolved_uncertainty";

/** Type of evidence artifact extracted from speech. */
export type EvidenceArtifactType =
  | "observation"
  | "outcome"
  | "protocol_deviation"
  | "confounder"
  | "customer_preference_signal"
  | "execution_fidelity_event"
  | "negative_outcome"
  | "complaint"
  | "opt_out"
  | "adverse_event_indicator"
  | "follow_up_requirement"
  | "derivative_idea"
  | "unresolved_question"
  | "external_factor_report";

/** A single segment of transcript with provenance. */
export interface TranscriptSegment {
  segmentId: string;
  sessionId: string;
  experimentId?: string;
  speaker: string;
  startTime: number;
  endTime: number;
  transcriptText: string;
  confidence: number;
  recognitionProvider: string;
  language: string;
  correctionHistory: TranscriptCorrection[];
  confirmationState: ConfirmationState;
  sourceAudioRef?: string;
  redacted: boolean;
  createdAt: string;
}

/** A correction to a transcript segment. Original is never overwritten. */
export interface TranscriptCorrection {
  correctedText: string;
  correctedBy: string;
  correctedAt: string;
  reason?: string;
}

/** A source span within a transcript segment. */
export interface SourceSpan {
  segmentId: string;
  startChar: number;
  endChar: number;
  excerpt: string;
}

/** An extracted evidence artifact grounded in transcript spans. */
export interface EvidenceArtifact {
  artifactId: string;
  sessionId: string;
  artifactType: EvidenceArtifactType;
  sourceSpans: SourceSpan[];
  normalizedStatement: string;
  accountRef?: string;
  experimentRef?: string;
  eventTime?: string;
  confidence: number;
  uncertainty: string;
  evidenceStatus: "proposed" | "confirmed" | "rejected";
  requiredReview: boolean;
  complianceFlags: string[];
  /** Full compliance flag results, including escalation receipts. */
  complianceFlagResults?: ComplianceFlagResult[];
  humanConfirmationState: ConfirmationState;
  classification: StatementClassification;
  createdAt: string;
}

/** Browser voice capability detection result. */
export interface VoiceCapabilities {
  speechRecognition: CapabilityStatus;
  speechSynthesis: CapabilityStatus;
  microphonePermission: CapabilityStatus;
  availableVoices: number;
  selectedLanguage: string;
  secureContext: boolean;
  browser: string;
  isMobile: boolean;
  audioDeviceAvailable: boolean;
  detectedAt: string;
}

/** Immutable escalation receipt for a compliance-flagged voice artifact. */
export interface VoiceEscalationRecord {
  escalationId: string;
  sessionId: string;
  artifactId: string;
  artifactType: EvidenceArtifactType;
  flagType: "adverse_event" | "product_complaint" | "promotional_content" | "off_label";
  sourceSpans: SourceSpan[];
  transcriptExcerpt: string;
  normalizedStatement: string;
  escalatedAt: string;
  escalatedBy: string;
  status: "open" | "reviewed" | "closed";
  voiceSessionAuditEventId?: string;
}

/** A voice session connecting a mission to evidence capture. */
export interface VoiceSession {
  sessionId: string;
  organizationId: string;
  userId: string;
  dailySeedId?: string;
  experimentId?: string;
  missionId?: string;
  hypothesisId?: string;
  assignmentId?: string;
  state: VoiceSessionState;
  language: string;
  captureMode: CaptureMode;
  audioRetention: "none" | "session_only" | "persisted";
  capabilities?: VoiceCapabilities;
  complianceRequirements: string[];
  transcriptSegments: TranscriptSegment[];
  extractedArtifacts: EvidenceArtifact[];
  auditEvents: VoiceAuditEvent[];
  confirmationIdentity?: string;
  confirmedAt?: string;
  /** IDs of immutable escalation receipts generated for this session. */
  escalationReceiptIds?: string[];
  /** Outcome recorded from confirmed voice evidence. */
  outcomeId?: string;
  /** Causal attribution computed for the recorded outcome. */
  attributionId?: string;
  /** Admissibility decision for the voice evidence bundle. */
  admissibilityDecision?: AdmissibilityDecision;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Immutable audit event for a voice session. */
export interface VoiceAuditEvent {
  eventId: string;
  sessionId: string;
  eventType:
  | "voice.session_created"
  | "voice.permission_requested"
  | "voice.recording_started"
  | "voice.recording_paused"
  | "voice.recording_stopped"
  | "voice.transcript_received"
  | "voice.transcript_corrected"
  | "voice.artifacts_extracted"
  | "voice.artifacts_confirmed"
  | "voice.compliance_flagged"
  | "voice.session_completed"
  | "voice.session_cancelled";
  actor: string;
  experimentRef?: string;
  missionVersion?: string;
  provider?: string;
  language?: string;
  artifactHashes?: string[];
  timestamp: string;
  correctionHistory?: TranscriptCorrection[];
  confirmationState?: ConfirmationState;
  complianceResult?: string;
}

/** Input for creating a voice session. */
export interface CreateVoiceSessionInput {
  dailySeedId?: string;
  experimentId?: string;
  missionId?: string;
  hypothesisId?: string;
  assignmentId?: string;
  language?: string;
  captureMode?: CaptureMode;
  audioRetention?: "none" | "session_only" | "persisted";
}

/** A guided interview question. */
export interface InterviewQuestion {
  questionId: string;
  prompt: string;
  category: "what_happened" | "what_observed" | "protocol_change" | "who_acted" |
  "when_occurred" | "outcome_recorded" | "evidence_supports" |
  "alternative_explanations" | "safety_events" | "confidence" |
  "artifact_classification";
  required: boolean;
  asked: boolean;
  answered: boolean;
  answerSegmentId?: string;
}

/** Result of compliance checking on extracted artifacts. */
export interface ComplianceFlagResult {
  artifactId: string;
  flagged: boolean;
  flagType?: "adverse_event" | "product_complaint" | "promotional_content" | "off_label";
  escalationRequired: boolean;
  escalationReceiptId?: string;
  message: string;
}

// ─── SPINOR GODMODE ────────────────────────────────────────────────

export type ProofState =
  | 0 // Speculation
  | 1 // Eligible Seed
  | 2 // Local Signal
  | 3 // Replicated Effect
  | 4 // Mechanism Supported
  | 5 // Portable Strategy
  | 6 // Golden Node
  | 7 // Infrastructure
  | 8 // Autonomous System
  | 9; // Spinout Candidate

export interface SpinorOpportunity {
  id: string;
  question: string;
  description: string;
  expectedBusinessImpact: number;
  uncertaintyReduction: number;
  portability: number;
  strategicImportance: number;
  timeSensitivity: number;
  executionCost: number;
  complianceRisk: number;
  customerBurden: number;
  valueScore: number;
  status: "open" | "allocated" | "resolved" | "killed";
  createdAt: string;
}

export interface SpinorHypothesis {
  id: string;
  opportunityId: string;
  statement: string;
  rationale: string;
  competingHypothesisIds: string[];
  assignedTo?: string;
  status: "untested" | "testing" | "supported" | "refuted" | "inconclusive";
  proofState: ProofState;
  evidence: HypothesisEvidence[];
  createdAt: string;
}

export interface HypothesisEvidence {
  id: string;
  type: "experiment" | "observation" | "literature" | "expert" | "counterfactual";
  source: string;
  finding: string;
  supports: boolean;
  strength: number;
  date: string;
}

export interface MissionContract {
  id: string;
  opportunityId: string;
  hypothesisId: string;
  owner: string;
  objective: string;
  population: string;
  intervention: string;
  comparison: string;
  primaryOutcome: string;
  secondaryOutcomes: string[];
  permittedVariables: string[];
  lockedVariables: string[];
  stopConditions: string[];
  evidenceThreshold: string;
  replicationObligation: string;
  status: "draft" | "approved" | "executing" | "completed" | "failed" | "stopped";
  startDate: string;
  endDate?: string;
  results?: MissionResult;
}

export interface MissionResult {
  observedOutcome: number;
  expectedOutcome: number;
  absoluteLift: number;
  relativeLift: number;
  sampleSize: number;
  uncertaintyInterval: { lower: number; upper: number };
  confidence: "low" | "moderate" | "high";
  executionCost: number;
  confounders: string[];
  unexplainedVariance: number;
  replicationCount: number;
  limitations: string[];
}

export interface SPINGenome {
  id: string;
  opportunity: string;
  hypothesisVersion: string;
  humanContributor: string;
  modelContribution: string;
  customerContext: string;
  territoryState: string;
  eligibilityRule: string;
  assignmentMethod: string;
  channel: string;
  timing: string;
  workflow: string;
  approvedContent: string;
  executionFidelity: number;
  organizationalSupport: number;
  externalConditions: string;
  chanceFactor: number;
  result?: MissionResult;
  createdAt: string;
}

export interface ShadowWorld {
  missionId: string;
  method: "randomized" | "matched_control" | "staggered_rollout" | "historical_baseline" | "synthetic_control" | "interrupted_time_series";
  observedOutcome: number;
  expectedOutcomeWithoutIntervention: number;
  absoluteLift: number;
  relativeLift: number;
  sampleSize: number;
  uncertaintyInterval: { lower: number; upper: number };
  confidence: "low" | "moderate" | "high";
  executionCost: number;
  customerBurden: number;
  confounders: string[];
  unexplainedVariance: number;
  replicationCount: number;
  limitations: string[];
}

export interface SpinorGoldenNode {
  id: string;
  number: number;
  opportunity: string;
  validatedStrategy: string;
  applicableContexts: string[];
  failureBoundary: string;
  adjustedEffect: string;
  executionCost: string;
  complianceState: string;
  humanContributors: string[];
  automationState: string;
  humanControl: string;
  rollbackTrigger: string;
  reverseTestSchedule: string;
  proofState: ProofState;
  executableWorkflow: string;
  eligibilityRules: string[];
  evidencePackage: string[];
  knownFailureConditions: string[];
  contributionLedger: { contributor: string; contribution: string; date: string }[];
  monitoringThresholds: { metric: string; threshold: number; action: string }[];
  rollbackPolicy: string;
  falsificationSchedule: string;
  status: "confirmed" | "narrowed" | "mutated" | "merged" | "downgraded" | "suspended" | "destroyed";
  createdAt: string;
}

export interface DestructionMission {
  id: string;
  goldenNodeId: string;
  attackType: "remove_component" | "reverse_sequence" | "resistant_segment" | "different_employee" | "different_territory" | "human_vs_model" | "decay_test" | "hidden_burden" | "compliance_leakage" | "external_explanation" | "cheaper_alternative";
  description: string;
  status: "proposed" | "executing" | "completed";
  result?: "confirmed" | "narrowed" | "mutated" | "merged" | "downgraded" | "suspended" | "destroyed";
  evidence: string;
  executedAt?: string;
}

export type CapabilityType =
  | "reliable_execution"
  | "confounder_detection"
  | "workflow_construction"
  | "replication_leadership"
  | "model_correction"
  | "causal_interpretation"
  | "compliance_reliability"
  | "automation_design"
  | "adversarial_testing"
  | "cross_context_translation";

export interface Capability {
  type: CapabilityType;
  level: number;
  verifiedInstances: number;
  unlockedMissions: string[];
}

export type CareerStage =
  | "operator"
  | "investigator"
  | "replicator"
  | "modifier"
  | "builder"
  | "strategy_architect"
  | "system_governor"
  | "venture_founder"
  | "adversarial_reviewer";

export interface SpinorEmployee {
  id: string;
  name: string;
  role: RoleType;
  careerStage: CareerStage;
  capabilities: Capability[];
  opportunityBalanceSheet: {
    expectedValue: number;
    riskLevel: number;
    complexity: number;
    highUpsideSeeds: number;
    replicationBurden: number;
    builderMissions: number;
    territoryDifficulty: number;
    orgSupport: number;
    successProbability: number;
  };
  experimentsRun: number;
  honestNegatives: number;
  goldenNodesContributed: string[];
}

export interface EvidenceEconomyEntry {
  id: string;
  experimentId: string;
  outcomeValue: number;
  knowledgeValue: number;
  riskReductionValue: number;
  automationValue: number;
  transferValue: number;
  customerExperienceValue: number;
  strategicOptionValue: number;
  avoidedCost: number;
  executionCost: number;
  customerBurden: number;
  complianceExposure: number;
  analyticalCost: number;
  experimentROI: number;
  isUsefulFailure: boolean;
  createdAt: string;
}

// ─── WORKTELEPORT ──────────────────────────────────────────────────

export interface EvidenceCapsule {
  id: string;
  sourceType: "email" | "attachment" | "csv" | "spreadsheet" | "pdf" | "image" | "receipt" | "voice" | "calendar" | "crm" | "browser" | "database" | "erp" | "card_transaction" | "bank_transaction" | "expense_policy" | "field_observation" | "location" | "human_correction";
  sourceId: string;
  preservedOriginal: string;
  extractedClaims: { claim: string; source: string; confidence: number }[];
  sender: string;
  recipients: string[];
  timestamp: string;
  threadHistory?: string[];
  attachments?: string[];
  explicitRequests: string[];
  impliedCommitments: string[];
  deadlines: string[];
  entities: string[];
  amounts: number[];
  locations: string[];
  requiredFormats: string[];
  relevantPolicies: string[];
  uncertainty: string[];
  createdAt: string;
}

export interface AuthorityEnvelope {
  requester: string;
  requesterAuthority: "employee" | "manager" | "director" | "vp" | "executive" | "external";
  recipientRole: string;
  permitted: string[];
  approvalRequired: string[];
  prohibited: string[];
  monetaryLimit?: number;
  dataSensitivity: "public" | "internal" | "confidential" | "restricted";
  createdAt: string;
}

export interface TaskIR {
  id: string;
  evidenceCapsuleId: string;
  authorityEnvelopeId: string;
  objective: string;
  inputs: string[];
  deliverables: string[];
  constraints: string[];
  uncertainty: string[];
  createdAt: string;
}

export interface DeliverableNode {
  id: string;
  name: string;
  inputs: string[];
  outputs: string[];
  completionConditions: string[];
  permittedTools: string[];
  retryPolicy: string;
  evidenceRequirements: string[];
  failureBehavior: string;
  reversibility: "reversible" | "irreversible";
  dependencies: string[];
  status: "pending" | "executing" | "completed" | "failed";
}

export interface DeliverableGraph {
  taskId: string;
  nodes: DeliverableNode[];
  edges: { from: string; to: string }[];
}

export interface CapabilityManifest {
  tools: {
    name: string;
    type: "gmail" | "calendar" | "browser" | "search" | "document_parser" | "ocr" | "spreadsheet" | "python" | "crm_api" | "accounting_api" | "card_api" | "bank_api" | "expense_platform" | "mapping" | "route_optimizer" | "erp" | "database" | "llm" | "human_approval";
    authorized: boolean;
    reliability: number;
    cost: number;
    latency: number;
    reversibility: number;
    dataSensitivity: number;
    verificationStrength: number;
  }[];
  selectionScore: number;
}

export interface ExecutionDAG {
  id: string;
  deliverableGraphId: string;
  nodes: {
    id: string;
    type: "deterministic_code" | "api_call" | "browser_interaction" | "database_query" | "llm_reasoning" | "human_review" | "financial_approval" | "validation";
    label: string;
    status: "pending" | "running" | "completed" | "failed" | "awaiting_approval";
    inputs: string[];
    outputs: string[];
    startedAt?: string;
    completedAt?: string;
    result?: string;
  }[];
  edges: { from: string; to: string }[];
  parallelPaths: string[][];
  status: "pending" | "executing" | "completed" | "failed" | "awaiting_approval";
}

export interface VerificationContract {
  id: string;
  executionDagId: string;
  tests: {
    name: string;
    type: "schema" | "completeness" | "accuracy" | "compliance" | "reconciliation" | "format" | "policy";
    assertion: string;
    passed: boolean;
    result?: string;
  }[];
  allPassed: boolean;
  verifiedAt?: string;
}

export interface SkillGenome {
  id: string;
  trigger: string;
  inputs: string[];
  authorityRequirements: string[];
  taskIR: string;
  executionDAG: string;
  tools: string[];
  transformations: string[];
  validationRules: string[];
  humanInterventions: string[];
  timeMs: number;
  cost: number;
  errors: string[];
  corrections: string[];
  outcome: string;
  reuseConditions: string[];
  replicationCount: number;
  venturePotential: number;
  createdAt: string;
}

// ─── VENTUREFORGE ──────────────────────────────────────────────────

export interface VentureGenome {
  id: string;
  skillGenomeId: string;
  customer: string;
  pain: string;
  inputContract: string;
  executionSystem: string;
  verification: string;
  economicValue: number;
  transferability: number;
  defensibility: string;
  compliance: string;
  autonomy: number;
  demandFrequency: number;
  exceptionRate: number;
  identifiableBuyers: string[];
  differentiation: string;
  ventureScore: number;
  status: "candidate" | "validated" | "incubating" | "launched" | "killed";
  createdAt: string;
}

export interface VentureCandidate {
  id: string;
  ventureGenomeId: string;
  name: string;
  description: string;
  originWorkflow: string;
  progressionStage: "one_task" | "reusable_workflow" | "skill_genome" | "validated_experiment" | "internal_system" | "cross_team_service" | "externalizable_product" | "independent_business";
  evidence: string[];
  estimatedMarketSize: number;
  estimatedTimeToMarket: number;
  riskLevel: "low" | "moderate" | "high";
  recommendation: string;
  createdAt: string;
}

// ─── Execution Classes (WORKTELEPORT) ──────────────────────────────

export type ExecutionClass = "A" | "B" | "C" | "D";

export interface ExecutionClassDefinition {
  class: ExecutionClass;
  name: string;
  description: string;
  examples: string[];
  systemBehavior: string;
}

export * from "./city";
export * from "./membra";

// ─── Signal Intelligence ───────────────────────────────────────────

/** A unified communication event from any channel (email, phone, image). */
export interface SignalEvent {
  id: string;
  timestamp: string;
  channel: "email" | "phone" | "sms" | "image" | "meeting" | "document";
  direction: "inbound" | "outbound";
  actor: string;
  actorIdentifier: string;
  subject: string;
  content: string;
  durationSec?: number;
  metadata: Record<string, unknown>;
  /** ID of the source record this event was derived from */
  sourceId: string;
}

/** A correlation link between two events across channels. */
export interface SignalCorrelation {
  id: string;
  eventAId: string;
  eventBId: string;
  confidence: number;
  correlationType: "semantic" | "temporal" | "actor" | "subject" | "causal";
  explanation: string;
  /** LLM-generated reasoning for why these events are linked */
  reasoning?: string;
}

/** A unified timeline of correlated events across all channels. */
export interface UnifiedTimeline {
  actor: string;
  events: (SignalEvent & { correlations?: SignalCorrelation[] })[];
  totalEvents: number;
  channelsUsed: string[];
  spanStart: string;
  spanEnd: string;
}

/** Adversarial pattern detection result. */
export interface AdversarialPattern {
  id: string;
  type:
  | "social_engineering"
  | "phishing_cross_channel"
  | "manipulation_escalation"
  | "coordinated_pressure"
  | "impersonation"
  | "urgency_manipulation"
  | "authority_fabrication"
  | "information_harvesting";
  severity: "critical" | "high" | "medium" | "low";
  channels: string[];
  actor: string;
  description: string;
  evidence: string[];
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  recommendedAction: string;
}

/** Communication DNA profile for a contact/actor. */
export interface CommunicationDNA {
  actor: string;
  actorIdentifier: string;
  totalInteractions: number;
  channels: string[];
  // Behavioral metrics
  avgResponseTimeHours: number;
  responseTimeVariance: number;
  preferredChannel: string;
  channelSwitchFrequency: number;
  // Sentiment & tone
  sentimentTrend: "improving" | "stable" | "declining" | "volatile";
  sentimentScore: number;
  aggressionScore: number;
  cooperationScore: number;
  // Patterns
  escalationTriggers: string[];
  topicPreferences: string[];
  communicationStyle: "direct" | "indirect" | "formal" | "casual" | "evasive" | "assertive";
  // Predictive
  predictedNextAction: string;
  predictedNextActionConfidence: number;
  predictedChannel: string;
  predictedResponseTimeHours: number;
  // Risk
  manipulationRiskScore: number;
  // Timeline
  lastInteraction: string;
  interactionFrequency: number;
  // LLM-generated narrative
  profileNarrative?: string;
}

/** Autonomous response negotiation result. */
export interface NegotiationResponse {
  id: string;
  contextEventId: string;
  channel: "email" | "sms" | "phone";
  proposedResponse: string;
  tone: "diplomatic" | "firm" | "collaborative" | "deflecting" | "assertive";
  objectives: string[];
  guardrails: string[];
  riskAssessment: string;
  confidence: number;
  requiresApproval: boolean;
  alternatives: { response: string; tone: string; rationale: string }[];
  generatedAt: string;
  model: string;
}

/** Full Signal Intelligence report combining all four engines. */
export interface SignalIntelligenceReport {
  generatedAt: string;
  // Cross-Channel Correlation
  correlations: SignalCorrelation[];
  timelines: UnifiedTimeline[];
  correlationCount: number;
  // Adversarial Pattern Detection
  adversarialPatterns: AdversarialPattern[];
  criticalThreats: number;
  // Communication DNA
  dnaProfiles: CommunicationDNA[];
  // Negotiator (responses are generated on-demand, not in the report)
  totalEvents: number;
  totalActors: number;
  channelsCovered: string[];
}
