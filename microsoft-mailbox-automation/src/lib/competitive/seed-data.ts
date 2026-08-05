import { nanoid } from "nanoid";
import {
  CompetitiveEngineState,
  EmployeeProfile,
  ExperimentContract,
  StrategyLearning,
  ActionOutcome,
  PersonalChallenge,
  AntiGamingFlag,
  ActionRecommendation,
  BarrierType,
  HCPFunnelState,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

// ─── Employees ──────────────────────────────────────────────────────

export const SEED_EMPLOYEES: EmployeeProfile[] = [
  {
    id: "emp-001",
    name: "Joseph Martinez",
    role: "field_representative",
    territory: "NE Manhattan",
    tenureMonths: 18,
    territoryMaturity: "growing",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A", "Product B"],
    experienceLevel: "intermediate",
    consentExperimental: true,
    cohortTags: ["urban", "growing_territory", "intermediate", "product_a_b"],
  },
  {
    id: "emp-002",
    name: "Sarah Chen",
    role: "field_representative",
    territory: "NW Manhattan",
    tenureMonths: 36,
    territoryMaturity: "mature",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A", "Product B"],
    experienceLevel: "expert",
    consentExperimental: true,
    cohortTags: ["urban", "mature_territory", "expert", "product_a_b"],
  },
  {
    id: "emp-003",
    name: "Michael O'Brien",
    role: "field_representative",
    territory: "Bronx East",
    tenureMonths: 6,
    territoryMaturity: "early",
    marketRestrictions: ["no_off_label", "mlr_required", "restricted_access"],
    productFocus: ["Product A"],
    experienceLevel: "new",
    consentExperimental: false,
    cohortTags: ["urban", "early_territory", "new", "product_a"],
  },
  {
    id: "emp-004",
    name: "Emily Rodriguez",
    role: "field_representative",
    territory: "Brooklyn Central",
    tenureMonths: 48,
    territoryMaturity: "mature",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A", "Product B", "Product C"],
    experienceLevel: "elite",
    consentExperimental: true,
    cohortTags: ["urban", "mature_territory", "elite", "product_a_b_c"],
  },
  {
    id: "emp-005",
    name: "David Kim",
    role: "field_representative",
    territory: "Staten Island",
    tenureMonths: 24,
    territoryMaturity: "growing",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A", "Product B"],
    experienceLevel: "intermediate",
    consentExperimental: true,
    cohortTags: ["suburban", "growing_territory", "intermediate", "product_a_b"],
  },
  {
    id: "emp-006",
    name: "Lisa Thompson",
    role: "field_representative",
    territory: "Queens North",
    tenureMonths: 12,
    territoryMaturity: "growing",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A"],
    experienceLevel: "intermediate",
    consentExperimental: true,
    cohortTags: ["urban", "growing_territory", "intermediate", "product_a"],
  },
  {
    id: "emp-007",
    name: "Robert Garcia",
    role: "regional_manager",
    territory: "NYC Metro",
    tenureMonths: 60,
    territoryMaturity: "mature",
    marketRestrictions: ["no_off_label", "mlr_required"],
    productFocus: ["Product A", "Product B", "Product C"],
    experienceLevel: "elite",
    consentExperimental: false,
    cohortTags: ["manager", "metro"],
  },
];

// ─── Experiments ────────────────────────────────────────────────────

export const SEED_EXPERIMENTS: ExperimentContract[] = [
  {
    id: "exp-001",
    hypothesis:
      "A secondary-stakeholder-first approach improves progression in workflow-blocked accounts.",
    description:
      "Test whether engaging office workflow stakeholders before the primary HCP increases account-state progression compared to standard HCP-first engagement.",
    eligibleCriteria: [
      "Representatives with at least 10 qualifying accounts",
      "Accounts with barrier type 'office_workflow'",
      "Territory maturity 'growing' or 'mature'",
    ],
    excludedCriteria: [
      "New hires (< 3 months tenure)",
      "Accounts with active medical escalation",
      "Territories with conflicting local restrictions",
    ],
    primaryOutcome: "Account-state progression within 30 days",
    secondaryOutcomes: [
      "Response rate",
      "Time required",
      "Follow-up completion",
      "Representative acceptance",
    ],
    guardrails: [
      "Approved materials only",
      "No altered claims",
      "No additional contact frequency above policy",
      "No patient-level targeting",
    ],
    stopConditions: [
      "Compliance exception",
      "Negative outcome threshold (-10% progression vs control)",
      "Insufficient sample quality (< 20 accounts per variant)",
    ],
    variants: [
      {
        role: "control",
        description: "Standard follow-up timing — HCP-first engagement",
        assignedCount: 30,
        progressionRate: 0.22,
        responseRate: 0.45,
        followUpCompletion: 0.68,
        representativeAcceptance: 0.91,
      },
      {
        role: "variant_a",
        description: "Follow up within 24 hours of initial contact",
        assignedCount: 30,
        progressionRate: 0.31,
        responseRate: 0.52,
        followUpCompletion: 0.74,
        representativeAcceptance: 0.85,
      },
      {
        role: "variant_b",
        description: "Follow up after 48-72 hours",
        assignedCount: 30,
        progressionRate: 0.19,
        responseRate: 0.38,
        followUpCompletion: 0.61,
        representativeAcceptance: 0.78,
      },
      {
        role: "variant_c",
        description: "Engage secondary stakeholder before primary HCP",
        assignedCount: 30,
        progressionRate: 0.39,
        responseRate: 0.58,
        followUpCompletion: 0.81,
        representativeAcceptance: 0.82,
      },
    ],
    status: "running",
    durationDays: 14,
    startDate: daysAgo(8),
    totalAssigned: 120,
    complianceValidated: true,
    createdAt: daysAgo(10),
  },
  {
    id: "exp-002",
    hypothesis:
      "Two-stage account follow-up (clinical resource then workflow discussion within 72h) produces better progression than sending both resources together.",
    description:
      "Compare sequenced content delivery against simultaneous delivery for accounts in treatment_consideration state.",
    eligibleCriteria: [
      "Accounts in 'treatment_consideration' or 'content_consumed' state",
      "Representatives with consentExperimental = true",
    ],
    excludedCriteria: [
      "Accounts with active barrier 'formulary'",
      "Territories with pending formulary changes",
    ],
    primaryOutcome: "Account-state progression within 30 days",
    secondaryOutcomes: [
      "Content engagement depth",
      "Time to next interaction",
      "Follow-up completion",
    ],
    guardrails: [
      "Approved clinical and workflow materials only",
      "No off-label discussion",
      "Standard contact frequency maintained",
    ],
    stopConditions: [
      "Compliance exception",
      "Insufficient sample (< 15 per variant)",
    ],
    variants: [
      {
        role: "control",
        description: "Send both clinical and workflow resources together",
        assignedCount: 20,
        progressionRate: 0.25,
        responseRate: 0.40,
        followUpCompletion: 0.65,
        representativeAcceptance: 0.88,
      },
      {
        role: "variant_a",
        description: "Stage 1: approved clinical resource, Stage 2: workflow discussion within 72h",
        assignedCount: 20,
        progressionRate: 0.35,
        responseRate: 0.55,
        followUpCompletion: 0.78,
        representativeAcceptance: 0.80,
      },
    ],
    status: "running",
    durationDays: 14,
    startDate: daysAgo(5),
    totalAssigned: 40,
    complianceValidated: true,
    createdAt: daysAgo(7),
  },
  {
    id: "exp-003",
    hypothesis:
      "Remote follow-up within 48 hours after a workflow barrier is identified improves progression in mature urban territories.",
    description:
      "Compare remote follow-up vs in-person follow-up after barrier identification in mature territories.",
    eligibleCriteria: [
      "Mature territory maturity",
      "Accounts with barrier identified in last 7 days",
    ],
    excludedCriteria: [
      "Low-access territories",
      "Accounts requiring in-person compliance verification",
    ],
    primaryOutcome: "Barrier resolution within 21 days",
    secondaryOutcomes: ["Time to resolution", "Follow-up completion", "Cost efficiency"],
    guardrails: ["Approved materials only", "Standard contact rules"],
    stopConditions: ["Compliance exception", "Negative outcome threshold"],
    variants: [
      {
        role: "control",
        description: "Standard in-person follow-up",
        assignedCount: 25,
        progressionRate: 0.28,
        responseRate: 0.50,
        followUpCompletion: 0.70,
        representativeAcceptance: 0.92,
      },
      {
        role: "variant_a",
        description: "Remote follow-up within 48 hours",
        assignedCount: 25,
        progressionRate: 0.42,
        responseRate: 0.60,
        followUpCompletion: 0.85,
        representativeAcceptance: 0.87,
      },
    ],
    status: "completed",
    durationDays: 21,
    startDate: daysAgo(35),
    endDate: daysAgo(14),
    totalAssigned: 50,
    complianceValidated: true,
    createdAt: daysAgo(40),
    analyzedAt: daysAgo(12),
    winningVariant: "variant_a",
    effectSize: 0.14,
    confidenceLevel: 0.89,
  },
  {
    id: "exp-004",
    hypothesis:
      "Stakeholder-network expansion performs better than increasing visit frequency in low-access rural territories.",
    description: "Compare network expansion vs frequency increase for low-access accounts.",
    eligibleCriteria: ["Low-access territories", "Accounts stalled for > 60 days"],
    excludedCriteria: ["Accounts with recent stakeholder engagement"],
    primaryOutcome: "Meaningful interaction within 30 days",
    secondaryOutcomes: ["Stakeholder diversity", "Follow-up completion"],
    guardrails: ["Approved materials only", "No exceeding contact frequency policy"],
    stopConditions: ["Compliance exception", "Insufficient sample"],
    variants: [
      {
        role: "control",
        description: "Increase visit frequency by 50%",
        assignedCount: 15,
        progressionRate: 0.13,
        responseRate: 0.30,
        followUpCompletion: 0.55,
        representativeAcceptance: 0.70,
      },
      {
        role: "variant_a",
        description: "Expand stakeholder network — identify and engage 2+ secondary stakeholders",
        assignedCount: 15,
        progressionRate: 0.27,
        responseRate: 0.48,
        followUpCompletion: 0.72,
        representativeAcceptance: 0.83,
      },
    ],
    status: "completed",
    durationDays: 30,
    startDate: daysAgo(60),
    endDate: daysAgo(30),
    totalAssigned: 30,
    complianceValidated: true,
    createdAt: daysAgo(65),
    analyzedAt: daysAgo(28),
    winningVariant: "variant_a",
    effectSize: 0.14,
    confidenceLevel: 0.76,
  },
  {
    id: "exp-005",
    hypothesis:
      "Automated commitment tracking produces the largest performance improvement for representatives with strong engagement but weak documentation.",
    description:
      "Test automated commitment queue vs manual tracking for reps with documentation gaps.",
    eligibleCriteria: [
      "Follow-up completion below peer average",
      "CRM data quality score below 70",
    ],
    excludedCriteria: ["Representatives already using automated tracking"],
    primaryOutcome: "Follow-up completion rate improvement over 4 weeks",
    secondaryOutcomes: ["CRM data quality", "Commitment on-time rate"],
    guardrails: ["No external communications without approval", "Standard CRM permissions"],
    stopConditions: ["Insufficient sample", "Manual stop"],
    variants: [
      {
        role: "control",
        description: "Manual commitment tracking via CRM",
        assignedCount: 18,
        progressionRate: 0.20,
        responseRate: 0.42,
        followUpCompletion: 0.60,
        representativeAcceptance: 0.90,
      },
      {
        role: "variant_a",
        description: "Automated commitment queue with reminders and draft preparation",
        assignedCount: 18,
        progressionRate: 0.34,
        responseRate: 0.50,
        followUpCompletion: 0.82,
        representativeAcceptance: 0.85,
      },
    ],
    status: "stopped",
    durationDays: 28,
    startDate: daysAgo(20),
    endDate: daysAgo(5),
    totalAssigned: 36,
    complianceValidated: true,
    createdAt: daysAgo(25),
    analyzedAt: daysAgo(3),
    winningVariant: "variant_a",
    effectSize: 0.14,
    confidenceLevel: 0.82,
    stopReason: "sufficient_evidence",
    stopDetail: "Effect size exceeded threshold after 2 weeks of data",
  },
];

// ─── Strategy Learnings ─────────────────────────────────────────────

export const SEED_STRATEGIES: StrategyLearning[] = [
  {
    id: nanoid(),
    context: {
      territoryMaturity: "mature",
      barrierType: "office_workflow",
      accountState: "barrier_identified",
      channel: "remote",
    },
    action: "Remote follow-up within 48 hours after workflow barrier identified",
    observedOutcome: "42% barrier resolution vs 28% for in-person",
    effectSize: 0.14,
    confidence: 0.89,
    sampleSize: 50,
    lifecycleState: "validated",
    discoveredAt: daysAgo(30),
    lastValidatedAt: daysAgo(12),
    patternDescription:
      "In mature urban territories, remote follow-up within 48 hours works best after a workflow barrier is identified.",
  },
  {
    id: nanoid(),
    context: {
      territoryMaturity: "early",
      barrierType: "access",
      accountState: "access_opportunity",
      channel: "in_person",
    },
    action: "Stakeholder-network expansion — engage 2+ secondary stakeholders",
    observedOutcome: "27% meaningful interaction vs 13% for frequency increase",
    effectSize: 0.14,
    confidence: 0.76,
    sampleSize: 30,
    lifecycleState: "validated",
    discoveredAt: daysAgo(45),
    lastValidatedAt: daysAgo(28),
    patternDescription:
      "In low-access rural territories, stakeholder-network expansion performs better than increasing visit frequency.",
  },
  {
    id: nanoid(),
    context: {
      employeeExperience: "intermediate",
      barrierType: "office_workflow",
      accountState: "barrier_identified",
    },
    action: "Automated commitment tracking with reminders and draft preparation",
    observedOutcome: "+14 percentage points follow-up completion over 4 weeks",
    effectSize: 0.14,
    confidence: 0.82,
    sampleSize: 36,
    lifecycleState: "scaled",
    discoveredAt: daysAgo(20),
    lastValidatedAt: daysAgo(3),
    patternDescription:
      "For representatives with strong engagement but weak documentation, automated commitment tracking produces the largest performance improvement.",
  },
  {
    id: nanoid(),
    context: {
      territoryMaturity: "growing",
      barrierType: "office_workflow",
      accountState: "barrier_identified",
    },
    action: "Secondary-stakeholder-first engagement sequence",
    observedOutcome: "39% progression vs 22% for HCP-first (preliminary)",
    effectSize: 0.17,
    confidence: 0.61,
    sampleSize: 30,
    lifecycleState: "limited_experiment",
    discoveredAt: daysAgo(8),
    lastValidatedAt: daysAgo(1),
    patternDescription:
      "Engaging office workflow stakeholders before the primary HCP shows promising progression improvement in workflow-blocked accounts.",
  },
  {
    id: nanoid(),
    context: {
      territoryMaturity: "mature",
      accountState: "treatment_consideration",
      channel: "email",
    },
    action: "Two-stage content sequencing: clinical resource then workflow discussion within 72h",
    observedOutcome: "35% progression vs 25% for simultaneous delivery (preliminary)",
    effectSize: 0.10,
    confidence: 0.58,
    sampleSize: 20,
    lifecycleState: "limited_experiment",
    discoveredAt: daysAgo(5),
    lastValidatedAt: daysAgo(1),
    patternDescription:
      "Sequencing clinical and workflow content with a 72-hour gap may produce better progression than sending both together.",
  },
  {
    id: nanoid(),
    context: {
      territoryMaturity: "mature",
      barrierType: "awareness",
      accountState: "info_gap",
    },
    action: "Nurse-manager engagement for testing-workflow barriers",
    observedOutcome: "2.1x more likely to progress after nurse-manager engagement",
    effectSize: 0.35,
    confidence: 0.91,
    sampleSize: 120,
    lifecycleState: "scaled",
    discoveredAt: daysAgo(90),
    lastValidatedAt: daysAgo(15),
    patternDescription:
      "Accounts with unresolved testing-workflow barriers progressed 2.1x more often after nurse-manager engagement than after standard HCP visits.",
  },
  {
    id: nanoid(),
    context: {
      employeeExperience: "expert",
      territoryMaturity: "mature",
    },
    action: "Replace afternoon office visits with remote follow-ups when remote completion rate is above peer average",
    observedOutcome: "68 minutes saved per visit with no progression loss",
    effectSize: 0.12,
    confidence: 0.84,
    sampleSize: 85,
    lifecycleState: "validated",
    discoveredAt: daysAgo(60),
    lastValidatedAt: daysAgo(10),
    patternDescription:
      "Representatives with above-average remote follow-up completion can replace low-access afternoon visits without losing account progression.",
  },
  {
    id: nanoid(),
    context: {
      barrierType: "reimbursement",
      accountState: "barrier_identified",
    },
    action: "Prepare approved reimbursement follow-up within 19 hours of commitment",
    observedOutcome: "High-performing peers complete comparable commitments within 19 hours avg",
    effectSize: 0.22,
    confidence: 0.87,
    sampleSize: 200,
    lifecycleState: "scaled",
    discoveredAt: daysAgo(120),
    lastValidatedAt: daysAgo(7),
    patternDescription:
      "Unfulfilled reimbursement commitments degrade account trust. Peers who complete within 19 hours maintain 22% higher progression rates.",
  },
];

// ─── Outcomes ───────────────────────────────────────────────────────

export const SEED_OUTCOMES: ActionOutcome[] = [
  {
    id: nanoid(),
    actionId: "act-seed-001",
    employeeId: "emp-001",
    experimentId: "exp-003",
    variant: "variant_a",
    actionTaken: "Remote follow-up within 48h after workflow barrier identified",
    outcome: "barrier_resolved",
    timeToOutcomeHours: 36,
    capturedAt: daysAgo(10),
    context: { territoryMaturity: "mature", barrierType: "office_workflow", channel: "remote" },
  },
  {
    id: nanoid(),
    actionId: "act-seed-002",
    employeeId: "emp-002",
    experimentId: "exp-003",
    variant: "control",
    actionTaken: "Standard in-person follow-up",
    outcome: "account_progressed",
    timeToOutcomeHours: 72,
    capturedAt: daysAgo(12),
    context: { territoryMaturity: "mature", barrierType: "office_workflow", channel: "in_person" },
  },
  {
    id: nanoid(),
    actionId: "act-seed-003",
    employeeId: "emp-001",
    actionTaken: "Nurse-manager engagement for testing-workflow barrier",
    outcome: "barrier_resolved",
    timeToOutcomeHours: 48,
    capturedAt: daysAgo(5),
    context: { territoryMaturity: "growing", barrierType: "office_workflow", accountState: "barrier_identified" },
  },
  {
    id: nanoid(),
    actionId: "act-seed-004",
    employeeId: "emp-004",
    actionTaken: "Reimbursement follow-up within 19 hours",
    outcome: "follow_up_completed",
    timeToOutcomeHours: 16,
    capturedAt: daysAgo(3),
    context: { barrierType: "reimbursement" },
  },
  {
    id: nanoid(),
    actionId: "act-seed-005",
    employeeId: "emp-001",
    experimentId: "exp-001",
    variant: "variant_c",
    actionTaken: "Secondary-stakeholder-first engagement",
    outcome: "meaningful_response",
    timeToOutcomeHours: 52,
    capturedAt: daysAgo(2),
    context: { territoryMaturity: "growing", barrierType: "office_workflow", accountState: "barrier_identified" },
  },
];

// ─── Personal Challenges ────────────────────────────────────────────

export const SEED_CHALLENGES: PersonalChallenge[] = [
  {
    id: nanoid(),
    employeeId: "emp-001",
    objective: "Close six unresolved commitments",
    currentRate: 0.68,
    topQuartileRate: 0.86,
    targetRate: 0.82,
    potentialEffect:
      "Move account-progression performance from the 47th to approximately the 65th percentile.",
    weekOf: daysAgo(2),
    progress: 0.33,
    status: "active",
  },
  {
    id: nanoid(),
    employeeId: "emp-002",
    objective: "Expand stakeholder coverage in 3 priority accounts",
    currentRate: 0.45,
    topQuartileRate: 0.75,
    targetRate: 0.65,
    potentialEffect:
      "Improve stakeholder diversity score from 58 to 70, moving from 55th to 72nd percentile.",
    weekOf: daysAgo(2),
    progress: 0.0,
    status: "active",
  },
];

// ─── Anti-Gaming Flags ──────────────────────────────────────────────

export const SEED_ANTI_GAMING_FLAGS: AntiGamingFlag[] = [
  {
    type: "delayed_data_entry",
    employeeId: "emp-003",
    detail:
      "CRM entries consistently logged 3+ days after interaction. 12 entries in the last 2 weeks showed delayed entry patterns.",
    severity: "low",
    detectedAt: daysAgo(4),
  },
];

// ─── Action History ─────────────────────────────────────────────────

export const SEED_ACTION_HISTORY: ActionRecommendation[] = [
  {
    id: "act-seed-001",
    lane: "proven",
    title: "Contact the nurse manager at Account 241",
    description:
      "Engage the nurse manager to resolve the testing-workflow barrier blocking Account 241.",
    competitiveReason:
      "Accounts with an unresolved testing-workflow barrier progressed 2.1x more often after nurse-manager engagement.",
    whyThisAction:
      "Similar accounts progressed 28% more often after workflow engagement than after another standard visit.",
    expectedEffortMin: 35,
    expectedUpside: "high",
    confidence: 0.91,
    strategyStatus: "scaled",
    accountId: "acc-241",
    hcpName: "Dr. Patricia Lee",
    permittedChannel: "in_person",
    riskLevel: "low",
    status: "completed",
    assignedAt: daysAgo(7),
    completedAt: daysAgo(5),
  },
  {
    id: "act-seed-003",
    lane: "proven",
    title: "Nurse-manager engagement for Account 318",
    description: "Schedule a workflow discussion with the nurse manager at Account 318.",
    competitiveReason:
      "This account has high patient opportunity but remains blocked by testing operations rather than product awareness.",
    whyThisAction:
      "Similar accounts progressed 28% more often after workflow engagement than after another standard visit.",
    expectedEffortMin: 35,
    expectedUpside: "high",
    confidence: 0.84,
    strategyStatus: "validated",
    accountId: "acc-318",
    hcpName: "Dr. James Wilson",
    permittedChannel: "in_person",
    riskLevel: "low",
    status: "completed",
    assignedAt: daysAgo(6),
    completedAt: daysAgo(5),
  },
  {
    id: "act-seed-004",
    lane: "proven",
    title: "Prepare approved reimbursement follow-up for Account 402",
    description: "Complete the reimbursement resource commitment made to Account 402.",
    competitiveReason:
      "Unfulfilled external commitment detected. High-performing peers complete comparable commitments within 19 hours.",
    whyThisAction:
      "Commitment was made 31 hours ago. Peer benchmark is 19 hours. Delay degrades account trust.",
    expectedEffortMin: 20,
    expectedUpside: "high",
    confidence: 0.87,
    strategyStatus: "scaled",
    accountId: "acc-402",
    hcpName: "Dr. Susan Chang",
    permittedChannel: "email",
    approvedContentId: "content-reimb-001",
    riskLevel: "low",
    status: "completed",
    assignedAt: daysAgo(4),
    completedAt: daysAgo(3),
  },
];

// ─── Full Seed State ────────────────────────────────────────────────

export function createSeedState(): CompetitiveEngineState {
  return {
    employees: SEED_EMPLOYEES,
    experiments: SEED_EXPERIMENTS,
    strategies: SEED_STRATEGIES,
    outcomes: SEED_OUTCOMES,
    challenges: SEED_CHALLENGES,
    antiGamingFlags: SEED_ANTI_GAMING_FLAGS,
    actionHistory: SEED_ACTION_HISTORY,
  };
}
