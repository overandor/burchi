export type ObservationStatus = "available" | "unavailable" | "error" | "mock";

export type ControlMode = "AUTO" | "APPROVAL" | "OBSERVE" | "PAUSED" | "EMERGENCY_STOP";

export type CapabilityKey =
  | "bio_mutation"
  | "messaging"
  | "visitor_engagement"
  | "photo_rotation"
  | "price_changes"
  | "content_generation"
  | "ai_optimization";

export interface TelemetryMetric {
  label: string;
  value: number | null;
  unit?: string;
  observation: ObservationStatus;
  trend?: "up" | "down" | "flat";
  change_pct?: number;
}

export interface BioVariant {
  id: string;
  label: string;
  bio_text: string;
  char_count: number;
  visitors: number | null;
  clicks: number | null;
  messages: number | null;
  reward: number;
  confidence: number;
  deployed_at: string | null;
  status: "deployed" | "testing" | "retired" | "candidate";
  observation: ObservationStatus;
}

export interface VisitorRecord {
  username: string;
  visit_count: number;
  last_seen: string;
  last_online: string | null;
  location: string | null;
  messaged: boolean;
  messaged_count: number;
  engagement_score: number;
  next_action: string;
  is_repeat: boolean;
}

export interface FunnelStage {
  stage: string;
  count: number | null;
  conversion_rate: number | null;
  observation: ObservationStatus;
}

export interface ReceiptEntry {
  id: string;
  timestamp: string;
  action: string;
  status: "pass" | "fail" | "blocked" | "unavailable" | "dry_run";
  observation: ObservationStatus;
  detail: Record<string, unknown>;
}

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  event_type: string;
  source: string;
  observation: ObservationStatus;
  detail: string;
}

export interface AIOperatorState {
  mode: ControlMode;
  current_bio: string;
  current_strategy: string;
  confidence: number;
  reward_history: { timestamp: string; reward: number }[];
  next_experiment: string;
  next_scheduled: string;
  capabilities: Record<CapabilityKey, boolean>;
}

export interface AutomationHealth {
  workflow: string;
  schedule: string;
  last_run: string | null;
  last_status: "pass" | "fail" | "unknown";
  observation: ObservationStatus;
}
