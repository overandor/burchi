import type {
  TelemetryMetric,
  BioVariant,
  VisitorRecord,
  FunnelStage,
  ReceiptEntry,
  TelemetryEvent,
  AIOperatorState,
  AutomationHealth,
  ControlMode,
  CapabilityKey,
} from "./types";

export const telemetryRibbon: TelemetryMetric[] = [
  { label: "Profile Views", value: 1247, observation: "available", trend: "up", change_pct: 12.3 },
  { label: "Unique Visitors", value: 89, observation: "available", trend: "up", change_pct: 8.1 },
  { label: "Repeat Visitors", value: 34, observation: "available", trend: "flat", change_pct: 0.5 },
  { label: "Clicks (Rebrandly)", value: 156, observation: "available", trend: "up", change_pct: 22.7 },
  { label: "Messages Sent", value: 42, observation: "available", trend: "up", change_pct: 15.0 },
  { label: "Inquiries", value: 7, observation: "available", trend: "down", change_pct: -3.2 },
  { label: "Bookings", value: null, observation: "unavailable" },
  { label: "Est. Revenue", value: null, observation: "unavailable" },
];

export const aiOperator: AIOperatorState = {
  mode: "AUTO",
  current_bio: "controlled_wolf_v2",
  current_strategy: "RL-guided bio rotation with GA price optimization",
  confidence: 0.72,
  reward_history: [
    { timestamp: "2026-07-30T08:00:00Z", reward: 12.4 },
    { timestamp: "2026-07-30T09:00:00Z", reward: 15.1 },
    { timestamp: "2026-07-30T10:00:00Z", reward: 14.8 },
    { timestamp: "2026-07-30T11:00:00Z", reward: 18.3 },
    { timestamp: "2026-07-30T12:00:00Z", reward: 16.9 },
    { timestamp: "2026-07-30T13:00:00Z", reward: 21.2 },
    { timestamp: "2026-07-30T14:00:00Z", reward: 19.7 },
    { timestamp: "2026-07-30T15:00:00Z", reward: 23.5 },
    { timestamp: "2026-07-30T16:00:00Z", reward: 22.1 },
    { timestamp: "2026-07-30T17:00:00Z", reward: 25.8 },
    { timestamp: "2026-07-30T18:00:00Z", reward: 24.3 },
    { timestamp: "2026-07-30T19:00:00Z", reward: 28.6 },
    { timestamp: "2026-07-30T20:00:00Z", reward: 27.2 },
  ],
  next_experiment: "Bio variant 'confident_fox_v1' — higher CTA aggressiveness, lower price anchor",
  next_scheduled: "2026-07-31T00:42:00Z — Engagement Engine full cycle",
  capabilities: {
    bio_mutation: true,
    messaging: true,
    visitor_engagement: true,
    photo_rotation: false,
    price_changes: false,
    content_generation: true,
    ai_optimization: true,
  },
};

export const bioVariants: BioVariant[] = [
  {
    id: "controlled_wolf_v2",
    label: "Controlled Wolf v2",
    bio_text: "Certified deep tissue specialist with 8+ years experience. Intuitive, strong hands. Your stress ends here. Available evenings & weekends. Text preferred.",
    char_count: 184,
    visitors: 89,
    clicks: 42,
    messages: 12,
    reward: 28.6,
    confidence: 0.72,
    deployed_at: "2026-07-29T18:00:00Z",
    status: "deployed",
    observation: "available",
  },
  {
    id: "confident_fox_v1",
    label: "Confident Fox v1",
    bio_text: "Elite bodywork for discerning clients. Trained in Swedish, deep tissue, and sports recovery. Private studio. Same-day appointments. You deserve quality.",
    char_count: 176,
    visitors: 67,
    clicks: 31,
    messages: 8,
    reward: 19.3,
    confidence: 0.58,
    deployed_at: "2026-07-28T06:00:00Z",
    status: "testing",
    observation: "available",
  },
  {
    id: "gentle_bear_v3",
    label: "Gentle Bear v3",
    bio_text: "Warm, intuitive massage in a safe, welcoming space. LGBTQ+ friendly. 6 years experience. Relax, breathe, let go. Outcalls available in Manhattan.",
    char_count: 152,
    visitors: 45,
    clicks: 18,
    messages: 4,
    reward: 11.2,
    confidence: 0.41,
    deployed_at: null,
    status: "candidate",
    observation: "available",
  },
  {
    id: "swift_eagle_v1",
    label: "Swift Eagle v1",
    bio_text: "Sports massage and recovery specialist. Marathon runners, weightlifters, weekend warriors. Clinical precision, therapeutic pressure. Book online.",
    char_count: 168,
    visitors: null,
    clicks: null,
    messages: null,
    reward: 0,
    confidence: 0,
    deployed_at: null,
    status: "candidate",
    observation: "unavailable",
  },
];

export const visitors: VisitorRecord[] = [
  { username: "NYCExplorer", visit_count: 8, last_seen: "2026-07-30T19:45:00Z", last_online: "online now", location: "Manhattan, NY", messaged: true, messaged_count: 2, engagement_score: 0.85, next_action: "Follow up — high intent", is_repeat: true },
  { username: "RelaxSeeker", visit_count: 5, last_seen: "2026-07-30T18:20:00Z", last_online: "2h ago", location: "Brooklyn, NY", messaged: true, messaged_count: 1, engagement_score: 0.72, next_action: "Awaiting response", is_repeat: true },
  { username: "DeepTissueFan", visit_count: 4, last_seen: "2026-07-30T17:10:00Z", last_online: "3h ago", location: "Queens, NY", messaged: false, messaged_count: 0, engagement_score: 0.61, next_action: "Message — above threshold", is_repeat: true },
  { username: "FirstTimer2026", visit_count: 1, last_seen: "2026-07-30T16:30:00Z", last_online: "4h ago", location: "Bronx, NY", messaged: false, messaged_count: 0, engagement_score: 0.22, next_action: "Observe", is_repeat: false },
  { username: "MuscleRelief", visit_count: 3, last_seen: "2026-07-30T15:00:00Z", last_online: "5h ago", location: "Jersey City, NJ", messaged: true, messaged_count: 1, engagement_score: 0.54, next_action: "Responded — nurture", is_repeat: true },
  { username: "WeekendWarrior", visit_count: 6, last_seen: "2026-07-30T14:15:00Z", last_online: "6h ago", location: "Hoboken, NJ", messaged: false, messaged_count: 0, engagement_score: 0.68, next_action: "Message — above threshold", is_repeat: true },
  { username: "QuietClient", visit_count: 2, last_seen: "2026-07-30T12:00:00Z", last_online: "8h ago", location: null, messaged: false, messaged_count: 0, engagement_score: 0.34, next_action: "Observe", is_repeat: true },
  { username: "BookedBefore", visit_count: 12, last_seen: "2026-07-30T11:30:00Z", last_online: "9h ago", location: "Manhattan, NY", messaged: true, messaged_count: 4, engagement_score: 0.94, next_action: "VIP — direct outreach", is_repeat: true },
];

export const funnelStages: FunnelStage[] = [
  { stage: "Profile Impression", count: 1247, conversion_rate: null, observation: "available" },
  { stage: "Profile Visit", count: 89, conversion_rate: 7.1, observation: "available" },
  { stage: "Repeat Visitor", count: 34, conversion_rate: 38.2, observation: "available" },
  { stage: "Click/Contact", count: 42, conversion_rate: 47.2, observation: "available" },
  { stage: "Conversation", count: 18, conversion_rate: 42.9, observation: "available" },
  { stage: "Booking", count: null, conversion_rate: null, observation: "unavailable" },
  { stage: "Revenue", count: null, conversion_rate: null, observation: "unavailable" },
];

export const receipts: ReceiptEntry[] = [
  { id: "r_001", timestamp: "2026-07-30T20:08:00Z", action: "engagement: visit-back cycle", status: "pass", observation: "available", detail: { visitors_found: 12, visited: 10, blocked: 0, messages_sent: 3 } },
  { id: "r_002", timestamp: "2026-07-30T19:17:00Z", action: "pipeline-24-7: hourly cycle", status: "pass", observation: "available", detail: { availability_enforced: true, kpi_processed: true, rl_reward: 27.2, ga_optimized: true } },
  { id: "r_003", timestamp: "2026-07-30T19:48:00Z", action: "engagement: full cycle", status: "pass", observation: "available", detail: { visitors_found: 15, visited: 14, messages_sent: 5 } },
  { id: "r_004", timestamp: "2026-07-30T17:21:00Z", action: "pipeline-24-7: hourly cycle", status: "pass", observation: "available", detail: { availability_enforced: true, kpi_processed: true, rl_reward: 25.8 } },
  { id: "r_005", timestamp: "2026-07-30T16:45:00Z", action: "engagement: visit-back", status: "pass", observation: "available", detail: { visitors_found: 8, visited: 7 } },
  { id: "r_006", timestamp: "2026-07-30T15:56:00Z", action: "pipeline-24-7: hourly cycle", status: "pass", observation: "available", detail: { availability_enforced: true, rl_reward: 23.5 } },
  { id: "r_007", timestamp: "2026-07-30T14:55:00Z", action: "engagement: visit-back", status: "blocked", observation: "unavailable", detail: { reason: "CrowdSec rate limit", visitors_found: null } },
  { id: "r_008", timestamp: "2026-07-30T13:54:00Z", action: "pipeline-24-7: hourly cycle", status: "pass", observation: "available", detail: { availability_enforced: true, rl_reward: 22.1 } },
];

export const telemetryEvents: TelemetryEvent[] = [
  { id: "e_001", timestamp: "2026-07-30T20:08:32Z", event_type: "visitor_sighting", source: "engagement_engine", observation: "available", detail: "NYCExplorer visited profile (8th visit)" },
  { id: "e_002", timestamp: "2026-07-30T20:08:28Z", event_type: "visitor_sighting", source: "engagement_engine", observation: "available", detail: "RelaxSeeker visited profile (5th visit)" },
  { id: "e_003", timestamp: "2026-07-30T20:07:15Z", event_type: "message_sent", source: "engagement_engine", observation: "available", detail: "Sent to DeepTissueFan (trigger: 4 visits, threshold=3)" },
  { id: "e_004", timestamp: "2026-07-30T20:05:00Z", event_type: "profile_visit", source: "engagement_engine", observation: "available", detail: "Visited MuscleRelief profile (reciprocal)" },
  { id: "e_005", timestamp: "2026-07-30T19:17:56Z", event_type: "rl_feedback", source: "pipeline-24-7", observation: "available", detail: "Reward=27.2, bio=controlled_wolf_v2, no rotation (age=1d, threshold=3d)" },
  { id: "e_006", timestamp: "2026-07-30T19:17:30Z", event_type: "kpi_snapshot", source: "pipeline-24-7", observation: "available", detail: "Views=1247, Visitors=89, Clicks=156, Messages=42" },
  { id: "e_007", timestamp: "2026-07-30T19:17:10Z", event_type: "availability_check", source: "pipeline-24-7", observation: "available", detail: "Availability confirmed: active" },
  { id: "e_008", timestamp: "2026-07-30T14:55:04Z", event_type: "scrape_blocked", source: "engagement_engine", observation: "unavailable", detail: "CrowdSec rate limit — visitor scrape returned NO_OBSERVATION" },
  { id: "e_009", timestamp: "2026-07-30T13:54:22Z", event_type: "ga_optimization", source: "pipeline-24-7", observation: "available", detail: "Generation 5 complete, best_fitness=0.71, best_revenue=$340" },
  { id: "e_010", timestamp: "2026-07-30T12:00:00Z", event_type: "bio_generated", source: "content_generator", observation: "available", detail: "Generated 3 bios via Groq LLM (confident_fox_v1, gentle_bear_v3, swift_eagle_v1)" },
];

export const automationHealth: AutomationHealth[] = [
  { workflow: "Pipeline 24/7", schedule: "Hourly", last_run: "2026-07-30T19:17:00Z", last_status: "pass", observation: "available" },
  { workflow: "Engagement Engine", schedule: "Every 3h + 6h", last_run: "2026-07-30T20:08:00Z", last_status: "pass", observation: "available" },
  { workflow: "Master Rotator", schedule: "Every 3h", last_run: "2026-07-30T17:00:00Z", last_status: "pass", observation: "available" },
  { workflow: "Auto Bio Updater", schedule: "2×/day", last_run: "2026-07-30T12:30:00Z", last_status: "pass", observation: "available" },
  { workflow: "RM Bio Loop", schedule: "3×/day", last_run: "2026-07-30T18:00:00Z", last_status: "pass", observation: "available" },
  { workflow: "Photo Rotation", schedule: "2×/day", last_run: "2026-07-30T12:00:00Z", last_status: "pass", observation: "available" },
  { workflow: "Daily Content", schedule: "2×/day", last_run: "2026-07-30T18:00:00Z", last_status: "pass", observation: "available" },
  { workflow: "Daily Ops", schedule: "2×/day", last_run: null, last_status: "unknown", observation: "unavailable" },
  { workflow: "Demo Agent", schedule: "Every 8h", last_run: "2026-07-30T16:45:00Z", last_status: "pass", observation: "available" },
  { workflow: "HF Deploy", schedule: "Every 6h", last_run: "2026-07-30T18:00:00Z", last_status: "pass", observation: "available" },
  { workflow: "Weekly Report", schedule: "Monday 10am", last_run: "2026-07-29T10:00:00Z", last_status: "pass", observation: "available" },
];

export const controlModeLabels: Record<ControlMode, { label: string; color: string; description: string }> = {
  AUTO: { label: "AUTO", color: "text-emerald-400", description: "AI operates autonomously within safety bounds" },
  APPROVAL: { label: "APPROVAL", color: "text-amber-400", description: "AI proposes, human approves before mutation" },
  OBSERVE: { label: "OBSERVE", color: "text-blue-400", description: "AI observes and recommends, no mutations" },
  PAUSED: { label: "PAUSED", color: "text-orange-400", description: "All automation suspended" },
  EMERGENCY_STOP: { label: "EMERGENCY STOP", color: "text-red-400", description: "All automation halted, manual override only" },
};

export const capabilityLabels: Record<CapabilityKey, string> = {
  bio_mutation: "Bio Mutation",
  messaging: "Messaging",
  visitor_engagement: "Visitor Engagement",
  photo_rotation: "Photo Rotation",
  price_changes: "Price Changes",
  content_generation: "Content Generation",
  ai_optimization: "AI Optimization",
};
