export type WorkStatus = "new" | "working" | "needs" | "completed" | "blocked";

export type ConfidenceLevel = "very_likely" | "likely" | "uncertain" | "blocked";

export interface ConfidenceBreakdown {
  onTimeProbability: number;
  dataCompleteness: number;
  automatedQACoverage: number;
  noRevisionProbability: number;
}

export interface WorkDeliverable {
  type: "exact" | "verified" | "enhanced" | "reusable";
  name: string;
  format: "report" | "presentation" | "spreadsheet" | "email_draft" | "action_queue" | "data_reconciliation" | "workflow";
  content: string;
  confidence: number;
  approved: boolean;
  recommended?: boolean;
  recommendationReason?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  requester: string;
  requesterEmail: string;
  deadline: string;
  status: WorkStatus;
  detectedAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  p50Completion?: string;
  p90Completion?: string;
  confidence?: ConfidenceBreakdown;
  primaryRisk?: string;
  mandatoryOutputs: string[];
  inferredOutputs: string[];
  assumptions: string[];
  dependencies: { description: string; blocksProbability: number }[];
  deliverables?: WorkDeliverable[];
  dataCoverage?: number;
  recommendationConfidence?: number;
  emailSubject: string;
  emailBody: string;
  emailAttachments: { name: string; type: string; size: string }[];
  auditEvents: { timestamp: string; event: string; detail: string }[];
  autonomyClass: 1 | 2 | 3 | 4;
  externalSendAllowed: boolean;
}

export interface ApprovalRequest {
  id: string;
  workItemId: string;
  title: string;
  reason: string;
  groundedInApprovedContent: boolean;
  recipientVerified: boolean;
  confidentialAttachments: boolean;
  estimatedReviewSeconds: number;
  draftContent: string;
  recipient: string;
  status: "pending" | "approved" | "rejected" | "edited";
}

export interface TerritoryStop {
  id: string;
  hcpName: string;
  arrivalTime: string;
  action: string;
  objective: string;
  whyNow: string;
  accessProbability: "High" | "Medium" | "Low";
  preparationSeconds: number;
  deferred: boolean;
  deferredReason?: string;
  travelTimeMin: number;
  timeSavedMin?: number;
}

export interface TerritorySummary {
  totalActions: number;
  lowValueVisitsRemoved: number;
  travelMinutesAvoided: number;
  stops: TerritoryStop[];
}

export interface PreCallBrief {
  hcpName: string;
  whyThisVisit: string;
  lastMeaningfulInteraction: string;
  primaryObjective: string;
  ask: string;
  approvedAsset: string;
  relevantSection: string;
  doNotDiscuss: string;
  openCommitment: string;
  prepTimeSeconds: number;
}

export interface SkillProposal {
  id: string;
  title: string;
  detectedFrom: string;
  occurrenceCount: number;
  estimatedWeeklyTimeSaved: string;
  shadowTestAccuracy: number;
  permissionsRequired: string[];
  status: "proposed" | "reviewing" | "approved" | "dismissed";
}

export interface Skill {
  id: string;
  title: string;
  description: string;
  trigger: string;
  weeklyTimeSaved: string;
  accuracy: number;
  lastUsed: string;
  timesUsed: number;
  permissions: string[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  category: "source" | "permission" | "assumption" | "action" | "model" | "quality";
  event: string;
  detail: string;
  workItemId?: string;
}

export interface RoleContract {
  role: string;
  title: string;
  scope: string;
  canCompleteAutomatically: string[];
  requiresApproval: string[];
  neverAutonomous: string[];
}

export interface ManagerSummary {
  fieldHoursRecovered: number;
  lowValueVisitsPrevented: number;
  commitmentsCompletedOnTime: number;
  requestsCompletedAutonomously: number;
  recommendationsOverridden: number;
  repeatedTerritoryBarriers: number;
}

export interface Notification {
  id: string;
  type: "completed" | "approval" | "blocked" | "skill";
  title: string;
  detail: string;
  timestamp: string;
  workItemId?: string;
  read: boolean;
}
