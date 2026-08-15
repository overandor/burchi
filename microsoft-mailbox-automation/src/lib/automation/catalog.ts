/**
 * Automation Candidate Catalog
 *
 * Nine highest-priority automation hypotheses for recovering rep capacity.
 * Organized into three chains where downstream activities consume upstream output:
 *
 *   PRE-CALL:       #1 Profile → #41 Brief → #31 Route → #21 Schedule
 *   CALL-TO-RECORD: #191 Safety → #91 CallReport → #92 CRMMapping → #111 FollowUp
 *   LEARNING:       #211 TerritoryAnalytics → (feeds next pre-call cycle)
 *
 * The biggest economic unit is the post-call pipeline:
 *   Transcript → SafetyScan → CallReport → CRM → FollowUp
 * One captured interaction supplies four downstream jobs.
 *
 * Each candidate is an experiment — not a claim of saved hours.
 * Actual net savings are measured prospectively by SPINOR.
 *
 * Promotion ladder:
 *   CANDIDATE → SHADOW → ASSISTED → SUPERVISED → VALIDATED → AUTONOMOUS
 *   with DEGRADED → ROLLBACK if measured performance falls.
 */

// ─── Types ─────────────────────────────────────────────────────────────

export type AutomationChain = "pre_call" | "call_to_record" | "learning";

export type AutomationStage =
  | "candidate"    // defined but not yet running
  | "shadow"       // runs alongside human, output not used
  | "assisted"     // human uses output as draft, reviews before acting
  | "supervised"   // human approves each action before execution
  | "validated"    // proven across N replications, human spot-checks only
  | "autonomous"   // runs without human intervention, monitored
  | "degraded"     // performance fell below threshold, under review
  | "rolled_back"; // removed from production, reverted to human-only

export type CostUnit = "minutes" | "dollars" | "errors" | "latency_hours" | "compliance_incidents";

export interface AutomationCandidate {
  /** Stable ID (matches the original activity number from the 300 list) */
  id: string;
  /** Activity number from the 300-item catalog */
  activityNumber: number;
  name: string;
  description: string;
  chain: AutomationChain;
  /** Position within the chain (0-indexed) */
  chainPosition: number;
  /** IDs of candidates whose output this one consumes */
  consumesFrom?: string[];
  /** IDs of candidates that consume this one's output */
  feedsInto?: string[];
  /** What the human does today (the baseline we measure against) */
  humanBaseline: {
    description: string;
    /** Minutes per invocation under human execution */
    minutesPerInvocation: number;
    /** Estimated invocations per rep per day */
    invocationsPerDay: number;
    /** Error rate under human execution (0-1) */
    errorRate: number;
  };
  /** What the automation does */
  automation: {
    description: string;
    /** Whether this candidate is currently implemented (stub vs live) */
    implemented: boolean;
    /** What signals indicate the automation succeeded */
    successSignals: string[];
    /** What signals indicate the automation failed or degraded */
    failureSignals: string[];
  };
  /** Current stage in the promotion ladder */
  stage: AutomationStage;
  /** When the candidate was created */
  createdAt: string;
  /** When the stage was last changed */
  stageChangedAt: string;
  /** Reason for the last stage change */
  stageChangeReason?: string;
}

export interface AutomationOutcome {
  id: string;
  candidateId: string;
  /** When this outcome was recorded */
  recordedAt: string;
  /** Which stage was running when this outcome was measured */
  stageAtMeasurement: AutomationStage;
  /** Actual minutes spent by human (including review/correction) */
  humanMinutes: number;
  /** Actual minutes spent by automation (compute time) */
  automationMinutes: number;
  /** Cost of automation compute in dollars */
  automationOperatingCost: number;
  /** Minutes spent reviewing automation output */
  reviewMinutes: number;
  /** Minutes spent correcting automation errors */
  correctionMinutes: number;
  /** Number of exceptions (cases automation couldn't handle) */
  exceptions: number;
  /** Minutes spent handling exceptions */
  exceptionMinutes: number;
  /** Errors in the final output (0 = perfect, higher = worse) */
  outputErrors: number;
  /** Compliance incidents (0 = clean, higher = worse) */
  complianceIncidents: number;
  /** Did the automation produce the correct result? */
  correctResult: boolean;
  /** Free-text notes from the rep or reviewer */
  notes?: string;
}

export interface NetSavingsResult {
  candidateId: string;
  /** Number of outcomes measured */
  sampleSize: number;
  /** Average human baseline cost in minutes */
  humanBaselineMinutes: number;
  /** Average automation operating cost in minutes (compute) */
  automationOperatingMinutes: number;
  /** Average review time in minutes */
  reviewMinutes: number;
  /** Average correction time in minutes */
  correctionMinutes: number;
  /** Average exception handling time in minutes */
  exceptionMinutes: number;
  /** Net minutes saved per invocation (can be negative) */
  netMinutesSaved: number;
  /** Net minutes saved per day (accounting for invocation frequency) */
  netMinutesSavedPerDay: number;
  /** Change in error rate (negative = improvement) */
  errorDelta: number;
  /** Change in compliance incidents (negative = improvement) */
  complianceDelta: number;
  /** Whether the automation is currently net-positive */
  isNetPositive: boolean;
  /** Whether the sample is sufficient for a promotion decision */
  sufficientSample: boolean;
}

// ─── The 9 Candidates ──────────────────────────────────────────────────

export const AUTOMATION_CANDIDATES: AutomationCandidate[] = [
  // ─── CHAIN 1: PRE-CALL ───────────────────────────────────────────
  {
    id: "auto_001",
    activityNumber: 1,
    name: "Auto-compile HCP profile",
    description: "Compile HCP profile from CRM, claims, and digital engagement data before each call.",
    chain: "pre_call",
    chainPosition: 0,
    feedsInto: ["auto_041"],
    humanBaseline: {
      description: "Rep manually searches CRM, claims data, and engagement history, then assembles a profile.",
      minutesPerInvocation: 15,
      invocationsPerDay: 8,
      errorRate: 0.12,
    },
    automation: {
      description: "Query CRM + claims + engagement APIs, merge into structured profile.",
      implemented: false,
      successSignals: ["profile contains all required fields", "data is current within 7 days", "rep confirms profile is useful"],
      failureSignals: ["missing data fields", "stale data older than 30 days", "rep ignores profile and does manual lookup"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_041",
    activityNumber: 41,
    name: "Auto-generate pre-call brief",
    description: "Generate pre-call brief with key messages from HCP profile and call history.",
    chain: "pre_call",
    chainPosition: 1,
    consumesFrom: ["auto_001"],
    feedsInto: ["auto_031"],
    humanBaseline: {
      description: "Rep reviews profile and manually writes talking points and objectives.",
      minutesPerInvocation: 12,
      invocationsPerDay: 8,
      errorRate: 0.08,
    },
    automation: {
      description: "Use profile + call history to generate brief with key messages, objectives, and likely objections.",
      implemented: false,
      successSignals: ["brief covers relevant products", "objectives align with quarterly goals", "rep uses brief during call"],
      failureSignals: ["generic brief not tailored to HCP", "wrong product focus", "rep discards brief"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_031",
    activityNumber: 31,
    name: "Auto-build daily call route",
    description: "Build daily call route to minimize drive time across scheduled calls.",
    chain: "pre_call",
    chainPosition: 2,
    consumesFrom: ["auto_041"],
    feedsInto: ["auto_021"],
    humanBaseline: {
      description: "Rep manually sequences calls based on geography and appointment times.",
      minutesPerInvocation: 20,
      invocationsPerDay: 1,
      errorRate: 0.15,
    },
    automation: {
      description: "Optimize route using TSP solver with time windows, traffic, and proximity constraints.",
      implemented: false,
      successSignals: ["route reduces drive time vs rep's own plan", "all appointments met", "rep follows suggested route"],
      failureSignals: ["route misses appointments", "longer drive time than rep's plan", "rep overrides route"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_021",
    activityNumber: 21,
    name: "Auto-schedule HCP meetings",
    description: "Schedule HCP meetings based on optimal time windows for rep and HCP.",
    chain: "pre_call",
    chainPosition: 3,
    consumesFrom: ["auto_031"],
    humanBaseline: {
      description: "Rep or office staff coordinates meeting times via phone/email with HCP office.",
      minutesPerInvocation: 25,
      invocationsPerDay: 3,
      errorRate: 0.20,
    },
    automation: {
      description: "Propose meeting slots synced to rep and HCP calendars, send invites, handle confirmations.",
      implemented: false,
      successSignals: ["meeting confirmed without rep intervention", "no calendar conflicts", "HCP accepts proposed slot"],
      failureSignals: ["proposed slots don't match HCP availability", "calendar conflicts", "HCP ignores automated invite"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },

  // ─── CHAIN 2: CALL-TO-RECORD ─────────────────────────────────────
  {
    id: "auto_191",
    activityNumber: 191,
    name: "Auto-detect adverse events in calls",
    description: "Detect adverse event mentions in call transcripts and route to safety team.",
    chain: "call_to_record",
    chainPosition: 0,
    feedsInto: ["auto_091"],
    humanBaseline: {
      description: "Rep manually identifies AE mentions during call and submits safety report after.",
      minutesPerInvocation: 5,
      invocationsPerDay: 8,
      errorRate: 0.25, // high — reps miss AEs in conversation
    },
    automation: {
      description: "Scan transcript for AE indicators, classify seriousness, route to safety within 24h.",
      implemented: false,
      successSignals: ["AE detected that rep missed", "correct seriousness classification", "routed to safety within 24h"],
      failureSignals: ["false positive (non-AE flagged)", "false negative (AE missed)", "wrong seriousness classification"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_091",
    activityNumber: 91,
    name: "Auto-generate compliant call report",
    description: "Generate compliant call report from call transcript.",
    chain: "call_to_record",
    chainPosition: 1,
    consumesFrom: ["auto_191"],
    feedsInto: ["auto_092"],
    humanBaseline: {
      description: "Rep manually writes call report after each call, mapping conversation to CRM fields.",
      minutesPerInvocation: 18,
      invocationsPerDay: 8,
      errorRate: 0.10,
    },
    automation: {
      description: "Parse transcript into structured call report with products, messages, reactions, outcome.",
      implemented: false,
      successSignals: ["report contains all required fields", "compliant with OPDP rules", "rep approves with minimal edits"],
      failureSignals: ["missing required fields", "off-label content in report", "rep rewrites report from scratch"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_092",
    activityNumber: 92,
    name: "Auto-map notes to CRM fields",
    description: "Map free-text call notes to structured CRM call report fields.",
    chain: "call_to_record",
    chainPosition: 2,
    consumesFrom: ["auto_091"],
    feedsInto: ["auto_111"],
    humanBaseline: {
      description: "Rep manually selects CRM field values from dropdowns and maps conversation content.",
      minutesPerInvocation: 12,
      invocationsPerDay: 8,
      errorRate: 0.14,
    },
    automation: {
      description: "Extract entities from call report and populate CRM fields (attendees, products, messages, outcome).",
      implemented: false,
      successSignals: ["CRM fields correctly populated", "no manual correction needed", "data passes CRM validation"],
      failureSignals: ["wrong field values", "data fails CRM validation", "rep manually re-enters all fields"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
  {
    id: "auto_111",
    activityNumber: 111,
    name: "Auto-generate follow-up email",
    description: "Generate personalized follow-up email after call based on call content.",
    chain: "call_to_record",
    chainPosition: 3,
    consumesFrom: ["auto_092"],
    humanBaseline: {
      description: "Rep manually drafts follow-up email referencing call topics and next steps.",
      minutesPerInvocation: 14,
      invocationsPerDay: 6,
      errorRate: 0.06,
    },
    automation: {
      description: "Use call report + CRM data to draft compliant follow-up email with relevant content.",
      implemented: false,
      successSignals: ["email references correct call topics", "compliant with approved content rules", "HCP responds or engages"],
      failureSignals: ["generic email not personalized", "non-compliant content", "HCP does not respond"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },

  // ─── CHAIN 3: LEARNING ───────────────────────────────────────────
  {
    id: "auto_211",
    activityNumber: 211,
    name: "Auto-generate territory analytics",
    description: "Generate territory performance dashboards from call, claims, and engagement data.",
    chain: "learning",
    chainPosition: 0,
    feedsInto: ["auto_001"], // feeds next pre-call cycle
    humanBaseline: {
      description: "Rep or manager manually compiles weekly territory report from CRM and spreadsheets.",
      minutesPerInvocation: 180,
      invocationsPerDay: 0.2, // ~1 per week
      errorRate: 0.05,
    },
    automation: {
      description: "Aggregate call data, claims trends, and engagement metrics into territory dashboard.",
      implemented: false,
      successSignals: ["dashboard contains all KPIs", "data matches CRM source of truth", "manager uses dashboard for decisions"],
      failureSignals: ["missing KPIs", "data discrepancies with CRM", "manager ignores dashboard"],
    },
    stage: "candidate",
    createdAt: new Date().toISOString(),
    stageChangedAt: new Date().toISOString(),
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────

export function getCandidate(id: string): AutomationCandidate | undefined {
  return AUTOMATION_CANDIDATES.find(c => c.id === id);
}

export function getCandidatesByChain(chain: AutomationChain): AutomationCandidate[] {
  return AUTOMATION_CANDIDATES.filter(c => c.chain === chain).sort((a, b) => a.chainPosition - b.chainPosition);
}

export function getChainPipeline(chain: AutomationChain): AutomationCandidate[] {
  return getCandidatesByChain(chain);
}

/**
 * The post-call pipeline is the biggest economic unit:
 * Transcript → Safety → CallReport → CRM → FollowUp
 * One captured interaction supplies four downstream jobs.
 */
export function getPostCallPipeline(): AutomationCandidate[] {
  return getCandidatesByChain("call_to_record");
}

/**
 * Get the upstream dependencies of a candidate (transitive).
 */
export function getUpstream(candidateId: string): AutomationCandidate[] {
  const candidate = getCandidate(candidateId);
  if (!candidate || !candidate.consumesFrom) return [];
  const upstream: AutomationCandidate[] = [];
  for (const depId of candidate.consumesFrom) {
    const dep = getCandidate(depId);
    if (dep) {
      upstream.push(dep);
      upstream.push(...getUpstream(depId));
    }
  }
  return upstream;
}
