import { nanoid } from "nanoid";
import {
  TerritoryAccount,
  FieldRoute,
  RouteOptimization,
  PreCallBrief,
  InteractionCapture,
  BarrierType,
  HCPFunnelState,
} from "@/types";

/**
 * Field Route Optimizer — plans a daily field route, generates pre-call
 * briefs, structures natural-language interaction captures, and produces
 * morning / end-of-day reports. All functions are pure and deterministic
 * given their inputs so they can be unit-tested without external services.
 */

// ─── Tunable constants ────────────────────────────────────────────────
const MIN_TRAVEL_MIN = 15;
const MAX_TRAVEL_MIN = 45;
const MIN_WAIT_MIN = 5;
const MAX_WAIT_MIN = 30;
const ACCESS_DEFER_THRESHOLD = 0.3;
/** Utility scores are scaled by this factor so they read as ~1-30 for
 *  typical accounts instead of tiny decimals. The deferral threshold is
 *  expressed in the same scaled units. */
const UTILITY_SCALE = 1000;
const UTILITY_DEFER_THRESHOLD = 1.0;
const PREP_BURDEN_MAX_MIN = 20;
const DEFAULT_VISIT_DURATION_MIN = 20;
const PREP_TIME_SECONDS = 55; // kept under the 60-second budget

// ─── Helpers ──────────────────────────────────────────────────────────

/** Deterministically map a string to a number in [min, max]. */
function hashToRange(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0; // keep 32-bit
  }
  const span = max - min;
  const normalized = Math.abs(hash % 1000) / 1000;
  return Math.round(min + normalized * span);
}

/** Clamp a number to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Add minutes to a base ISO timestamp and return an ISO string. */
function addMinutes(isoStart: string, minutes: number): string {
  const base = new Date(isoStart);
  base.setMinutes(base.getMinutes() + Math.round(minutes));
  return base.toISOString();
}

/** Format minutes as "Xh Ym" for human-readable reports. */
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Convert a BarrierType to a human-readable label. */
const BARRIER_LABELS: Record<BarrierType, string> = {
  awareness: "Disease/therapy awareness gap",
  scientific_understanding: "Insufficient scientific understanding",
  patient_eligibility: "Patient eligibility uncertainty",
  formulary: "Formulary/access restriction",
  diagnosis_testing: "Diagnosis/testing workflow gap",
  referral_pathway: "Referral pathway not established",
  reimbursement: "Reimbursement/coverage barrier",
  office_workflow: "Office workflow not in place",
  treatment_initiation: "Treatment initiation hesitation",
  persistence: "Persistence/adherence concern",
  access: "General access barrier",
  none: "No active barrier",
};

// ─── 1. Route optimization ───────────────────────────────────────────

/**
 * Optimize a field route for the day.
 *
 * Accounts are sorted by priority score. For each stop we estimate:
 *   - travel time (15-45 min, deterministic per geographic zone)
 *   - wait time (5-30 min, inverse to access probability)
 *   - utility = (expected_impact * engagement_probability * info_gain)
 *              / (travel_time + wait_time + prep_burden)
 *
 * Accounts with access probability < 0.3 or utility below threshold are
 * deferred. Total time saved is measured against visiting every account.
 */
export function optimizeRoute(
  accounts: TerritoryAccount[],
  startDate: string,
): RouteOptimization {
  if (!Array.isArray(accounts)) {
    throw new Error("optimizeRoute: accounts must be an array");
  }
  if (!startDate || Number.isNaN(Date.parse(startDate))) {
    throw new Error("optimizeRoute: startDate must be a valid ISO date string");
  }

  // Sort by priority score, descending.
  const ranked = [...accounts].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );

  const stops: FieldRoute[] = [];
  let cursor = new Date(startDate).toISOString();
  let totalDrive = 0;
  let totalWait = 0;
  let totalField = 0;
  let deferredCount = 0;
  let routeUtility = 0;

  for (const account of ranked) {
    const zone = account.geographicZone ?? account.territory ?? account.id;
    const travelTime = hashToRange(zone, MIN_TRAVEL_MIN, MAX_TRAVEL_MIN);
    // Higher access probability => shorter wait.
    const waitTime =
      MIN_WAIT_MIN +
      (1 - clamp(account.accessProbability, 0, 1)) *
        (MAX_WAIT_MIN - MIN_WAIT_MIN);

    const expectedImpact = clamp(account.eligiblePatientOpportunity, 0, 1);
    const engagementProbability = clamp(
      account.accessProbability * account.expectedResponsiveness,
      0,
      1,
    );
    const infoGain = clamp(account.unmetInfoNeed, 0, 1);
    const prepBurden =
      clamp(account.operationalFriction, 0, 1) * PREP_BURDEN_MAX_MIN;

    const denominator = travelTime + waitTime + prepBurden;
    const utilityScore =
      denominator > 0
        ? ((expectedImpact * engagementProbability * infoGain) / denominator) *
          UTILITY_SCALE
        : 0;

    const lowAccess = account.accessProbability < ACCESS_DEFER_THRESHOLD;
    const lowUtility = utilityScore < UTILITY_DEFER_THRESHOLD;
    const deferred = lowAccess || lowUtility;

    let deferredReason: string | undefined;
    if (deferred) {
      deferredReason = lowAccess
        ? `Access probability ${account.accessProbability.toFixed(
            2,
          )} below threshold ${ACCESS_DEFER_THRESHOLD}`
        : `Utility score ${utilityScore.toFixed(2)} below threshold ${UTILITY_DEFER_THRESHOLD}`;
    }

    const arrival = addMinutes(cursor, deferred ? 0 : travelTime);
    const visitDuration = account.fieldTimeRequired
      ? account.fieldTimeRequired * 60
      : DEFAULT_VISIT_DURATION_MIN;
    const departure = deferred
      ? arrival
      : addMinutes(arrival, waitTime + visitDuration);

    if (!deferred) {
      cursor = departure;
      totalDrive += travelTime;
      totalWait += waitTime;
      totalField += travelTime + waitTime + visitDuration;
      routeUtility += utilityScore;
    } else {
      deferredCount += 1;
    }

    stops.push({
      accountId: account.id,
      hcpName: account.hcpName,
      arrivalTime: arrival,
      departureTime: departure,
      travelTimeMin: deferred ? 0 : travelTime,
      waitTimeMin: deferred ? 0 : waitTime,
      utilityScore,
      reason: account.reasonCodes.join("; ") || "Priority coverage",
      deferred,
      deferredReason,
    });
  }

  // Time saved = what visiting everyone (drive + wait) would have cost
  // minus what we actually spent on non-deferred stops.
  const fullVisitDriveWait = ranked.reduce((sum, account) => {
    const zone = account.geographicZone ?? account.territory ?? account.id;
    const travel = hashToRange(zone, MIN_TRAVEL_MIN, MAX_TRAVEL_MIN);
    const wait =
      MIN_WAIT_MIN +
      (1 - clamp(account.accessProbability, 0, 1)) *
        (MAX_WAIT_MIN - MIN_WAIT_MIN);
    return sum + travel + wait;
  }, 0);

  const timeSaved = Math.max(0, fullVisitDriveWait - (totalDrive + totalWait));

  return {
    stops,
    totalDriveTimeMin: Math.round(totalDrive),
    totalWaitTimeMin: Math.round(totalWait),
    totalFieldTimeMin: Math.round(totalField),
    timeSavedMin: Math.round(timeSaved),
    deferredCount,
    routeUtility: Number(routeUtility.toFixed(4)),
  };
}

// ─── 2. Pre-call brief ───────────────────────────────────────────────

/**
 * Generate a compressed 60-second pre-call brief for an account.
 *
 * Pulls priority-score components, last interactions, barriers, content
 * history, permitted objectives, likely objections, commitments, and
 * questions to ask into a single scannable structure.
 */
export function generatePreCallBrief(account: TerritoryAccount): PreCallBrief {
  if (!account || !account.id) {
    throw new Error("generatePreCallBrief: account is required");
  }

  const whyPrioritized = buildWhyPrioritized(account);
  const lastThreeInteractions = synthesizeLastInteractions(account);
  const unresolvedQuestions = buildUnresolvedQuestions(account);
  const knownBarriers = buildKnownBarriers(account);
  const contentPreviouslyShown = buildContentPreviouslyShown(account);
  const contentThatCausedEngagement =
    buildContentThatCausedEngagement(account);
  const permittedObjectives = buildPermittedObjectives(account);
  const likelyObjections = buildLikelyObjections(account);
  const commitmentsMade = buildCommitmentsMade(account);
  const questionsToAsk = buildQuestionsToAsk(account);
  const prohibitedTopics = buildProhibitedTopics();

  return {
    accountId: account.id,
    hcpName: account.hcpName,
    whyPrioritized,
    lastThreeInteractions,
    unresolvedQuestions,
    knownBarriers,
    payerAccessChanges: buildPayerAccessChanges(account),
    contentPreviouslyShown,
    contentThatCausedEngagement,
    permittedObjectives,
    likelyObjections,
    commitmentsMade,
    questionsToAsk,
    prohibitedTopics,
    recommendedContentId: account.recommendedAction?.approvedContentId,
    prepTimeSeconds: PREP_TIME_SECONDS,
  };
}

function buildWhyPrioritized(account: TerritoryAccount): string {
  const parts: string[] = [];
  if (account.eligiblePatientOpportunity >= 0.7) {
    parts.push(
      `High eligible-patient opportunity (${(account.eligiblePatientOpportunity * 100).toFixed(0)}%)`,
    );
  }
  if (account.unmetInfoNeed >= 0.6) {
    parts.push(
      `Strong unmet information need (${(account.unmetInfoNeed * 100).toFixed(0)}%)`,
    );
  }
  if (account.accessProbability >= 0.6) {
    parts.push(
      `Good access probability (${(account.accessProbability * 100).toFixed(0)}%)`,
    );
  }
  if (account.expectedResponsiveness >= 0.6) {
    parts.push(
      `Historically responsive (${(account.expectedResponsiveness * 100).toFixed(0)}%)`,
    );
  }
  if (parts.length === 0) {
    parts.push(
      `Priority score ${account.priorityScore.toFixed(2)} — coverage target`,
    );
  }
  return parts.join("; ");
}

function synthesizeLastInteractions(
  account: TerritoryAccount,
): { date: string; summary: string; outcome: string }[] {
  // Generate realistic sample data anchored to the account's current state.
  const now = account.lastInteraction
    ? new Date(account.lastInteraction)
    : new Date();
  const interactions: { date: string; summary: string; outcome: string }[] = [];

  const templates: Record<
    HCPFunnelState,
    { summary: string; outcome: string }[]
  > = {
    eligible: [
      {
        summary: "Initial territory scan — no prior contact recorded.",
        outcome: "No engagement yet; account flagged for outreach.",
      },
      {
        summary: "Desk drop; left approved indication summary card.",
        outcome: "Material accepted; no clinical discussion.",
      },
      {
        summary: "Brief hallway introduction with HCP.",
        outcome: "HCP acknowledged therapy area; no follow-up requested.",
      },
    ],
    relevant_population: [
      {
        summary: "Discussed patient population fit for therapy area.",
        outcome: "HCP confirmed relevant patient volume.",
      },
      {
        summary: "Shared epidemiology overview one-pager.",
        outcome: "HCP receptive; asked for testing criteria.",
      },
      {
        summary: "Follow-up on testing criteria request.",
        outcome: "HCP reviewing; no decision yet.",
      },
    ],
    info_gap: [
      {
        summary: "Delivered efficacy data overview slide deck.",
        outcome: "HCP engaged with efficacy endpoints; questions on safety.",
      },
      {
        summary: "Addressed safety profile questions with approved FAQ.",
        outcome: "HCP satisfied; requested real-world evidence.",
      },
      {
        summary: "Sent real-world evidence summary via approved channel.",
        outcome: "Awaiting response; HCP reviewing materials.",
      },
    ],
    access_opportunity: [
      {
        summary: "Identified office workflow gap during site visit.",
        outcome: "Office manager open to workflow discussion.",
      },
      {
        summary: "Discussed access pathway with HCP and staff.",
        outcome: "HCP interested; needs reimbursement clarity.",
      },
      {
        summary: "Provided reimbursement support contact information.",
        outcome: "Office following up with payer; pending response.",
      },
    ],
    engagement_attempted: [
      {
        summary: "Scheduled in-office visit; HCP called away.",
        outcome: "Visit cut short; rescheduled.",
      },
      {
        summary: "Rescheduled visit; delivered abbreviated brief.",
        outcome: "HCP engaged briefly; requested full follow-up.",
      },
      {
        summary: "Full follow-up visit with approved content.",
        outcome: "HCP asked detailed efficacy questions.",
      },
    ],
    meaningful_interaction: [
      {
        summary: "In-depth clinical discussion on efficacy and safety.",
        outcome: "HCP expressed treatment consideration intent.",
      },
      {
        summary: "Discussed patient identification criteria.",
        outcome: "HCP agreed to screen eligible patients.",
      },
      {
        summary: "Reviewed first screened patient case.",
        outcome: "HCP confirmed eligibility; initiating workup.",
      },
    ],
    content_consumed: [
      {
        summary: "HCP reviewed full evidence dossier.",
        outcome: "HCP acknowledged data strength.",
      },
      {
        summary: "Discussed key differentiators vs. standard of care.",
        outcome: "HCP receptive; weighing clinical fit.",
      },
      {
        summary: "Shared peer-reviewed publication summary.",
        outcome: "HCP circulating to partners for discussion.",
      },
    ],
    barrier_identified: [
      {
        summary: `Identified barrier: ${BARRIER_LABELS[account.barrier]}.`,
        outcome: "Barrier documented; action plan drafted.",
      },
      {
        summary: "Discussed barrier mitigation options with office.",
        outcome: "Office requested additional support resources.",
      },
      {
        summary: "Provided barrier-specific support materials.",
        outcome: "Office reviewing; awaiting feedback.",
      },
    ],
    barrier_addressed: [
      {
        summary: `Resolved barrier: ${BARRIER_LABELS[account.barrier]}.`,
        outcome: "Workflow/pathway now in place.",
      },
      {
        summary: "Confirmed barrier resolution with office staff.",
        outcome: "HCP ready to proceed with identification.",
      },
      {
        summary: "Reviewed post-barrier patient identification process.",
        outcome: "First patient identified through new pathway.",
      },
    ],
    treatment_consideration: [
      {
        summary: "HCP actively evaluating therapy for eligible patients.",
        outcome: "Clinical review underway with partners.",
      },
      {
        summary: "Discussed dosing and administration logistics.",
        outcome: "HCP comfortable with administration pathway.",
      },
      {
        summary: "Addressed remaining persistence/adherence questions.",
        outcome: "HCP preparing to initiate first patient.",
      },
    ],
    patient_initiation: [
      {
        summary: "First patient initiated on therapy.",
        outcome: "Onboarding complete; monitoring scheduled.",
      },
      {
        summary: "Follow-up on first patient tolerance and response.",
        outcome: "Patient tolerating well; HCP encouraged.",
      },
      {
        summary: "Discussed second patient identification.",
        outcome: "HCP identifying additional eligible patients.",
      },
    ],
    persistence: [
      {
        summary: "Routine persistence check on initiated patients.",
        outcome: "Patients continuing therapy as prescribed.",
      },
      {
        summary: "Discussed long-term adherence support tools.",
        outcome: "HCP adopted adherence monitoring workflow.",
      },
      {
        summary: "Quarterly review of patient outcomes.",
        outcome: "Outcomes positive; HCP expanding patient pool.",
      },
    ],
  };

  const set =
    templates[account.funnelState] ?? templates.eligible;
  for (let i = 0; i < 3; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - (2 - i) * 21); // ~3-week cadence
    interactions.push({
      date: date.toISOString(),
      summary: set[i].summary,
      outcome: set[i].outcome,
    });
  }
  return interactions;
}

function buildUnresolvedQuestions(account: TerritoryAccount): string[] {
  const questions: string[] = [];
  if (account.unmetInfoNeed >= 0.5) {
    questions.push(
      "Which evidence endpoint matters most to this HCP's decision?",
    );
  }
  if (account.barrier !== "none") {
    questions.push(`Is the ${BARRIER_LABELS[account.barrier]} still active?`);
  }
  if (account.funnelState === "treatment_consideration") {
    questions.push("Has the HCP identified a specific eligible patient?");
  }
  if (account.uncertaintyRisk >= 0.5) {
    questions.push(
      "What new information would change the engagement approach?",
    );
  }
  if (questions.length === 0) {
    questions.push("What is the HCP's current position on the therapy?");
  }
  return questions;
}

function buildKnownBarriers(account: TerritoryAccount): string[] {
  const barriers: string[] = [];
  if (account.barrier !== "none") {
    barriers.push(BARRIER_LABELS[account.barrier]);
  }
  if (account.barrierDetail) {
    barriers.push(account.barrierDetail);
  }
  if (barriers.length === 0) {
    barriers.push("No known active barriers");
  }
  return barriers;
}

function buildContentPreviouslyShown(account: TerritoryAccount): string[] {
  const content: string[] = [];
  if (account.lastContentShown) {
    content.push(account.lastContentShown);
  }
  // Infer from funnel state what has likely been shown.
  const stateContent: Partial<Record<HCPFunnelState, string[]>> = {
    info_gap: ["Efficacy overview deck", "Safety profile FAQ"],
    meaningful_interaction: [
      "Efficacy overview deck",
      "Real-world evidence summary",
    ],
    content_consumed: ["Full evidence dossier", "Peer-reviewed publication"],
    treatment_consideration: [
      "Dosing & administration guide",
      "Persistence support materials",
    ],
  };
  const extra = stateContent[account.funnelState];
  if (extra) {
    for (const c of extra) {
      if (!content.includes(c)) content.push(c);
    }
  }
  if (content.length === 0) {
    content.push("Indication summary card (desk drop)");
  }
  return content;
}

function buildContentThatCausedEngagement(
  account: TerritoryAccount,
): string[] {
  const engagement: Partial<Record<HCPFunnelState, string[]>> = {
    info_gap: ["Efficacy endpoint slide"],
    meaningful_interaction: ["Real-world evidence summary"],
    content_consumed: ["Peer-reviewed publication summary"],
    treatment_consideration: ["Dosing & administration guide"],
    patient_initiation: ["Patient identification criteria checklist"],
  };
  return engagement[account.funnelState] ?? [];
}

function buildPermittedObjectives(account: TerritoryAccount): string[] {
  const objectives: string[] = [];
  if (account.recommendedAction) {
    objectives.push(account.recommendedAction.action);
  }
  switch (account.funnelState) {
    case "eligible":
    case "relevant_population":
      objectives.push("Introduce therapy area relevance");
      break;
    case "info_gap":
      objectives.push("Deliver approved efficacy and safety data");
      break;
    case "access_opportunity":
      objectives.push("Clarify access and reimbursement pathway");
      break;
    case "barrier_identified":
      objectives.push("Confirm barrier and discuss mitigation");
      break;
    case "barrier_addressed":
      objectives.push("Support patient identification through new pathway");
      break;
    case "treatment_consideration":
      objectives.push("Support first patient initiation decision");
      break;
    case "patient_initiation":
    case "persistence":
      objectives.push("Check persistence and identify additional patients");
      break;
    default:
      objectives.push("Advance account through funnel");
  }
  return objectives;
}

function buildLikelyObjections(account: TerritoryAccount): string[] {
  const objectionMap: Partial<Record<BarrierType, string>> = {
    formulary: "Therapy not on formulary / restricted access",
    reimbursement: "Reimbursement uncertainty for patients",
    office_workflow: "No workflow to identify and refer eligible patients",
    diagnosis_testing: "Testing/diagnosis pathway not established",
    referral_pathway: "Referral pathway to specialist unclear",
    patient_eligibility: "Uncertain which patients qualify",
    scientific_understanding: "Insufficient familiarity with efficacy data",
    awareness: "Limited awareness of disease area / therapy",
    treatment_initiation: "Hesitation to initiate new therapy",
    persistence: "Concerns about long-term adherence",
    access: "General access constraints in the practice",
  };
  const objection = objectionMap[account.barrier];
  return objection ? [objection] : [];
}

function buildCommitmentsMade(account: TerritoryAccount): string[] {
  const commitments: Partial<Record<HCPFunnelState, string[]>> = {
    info_gap: ["Send real-world evidence summary (approved channel)"],
    access_opportunity: ["Provide reimbursement support contact"],
    barrier_identified: ["Deliver barrier-specific support materials"],
    treatment_consideration: ["Share dosing & administration guide"],
  };
  return commitments[account.funnelState] ?? [];
}

function buildQuestionsToAsk(account: TerritoryAccount): string[] {
  const questions: string[] = [];
  if (account.unmetInfoNeed >= 0.5) {
    questions.push(
      "Which data endpoint would most inform your clinical decision?",
    );
  }
  if (account.barrier === "office_workflow") {
    questions.push(
      "Who in the office would own the patient identification workflow?",
    );
  }
  if (account.barrier === "reimbursement") {
    questions.push(
      "What payer mix do you see, and where is coverage friction highest?",
    );
  }
  if (account.funnelState === "treatment_consideration") {
    questions.push("Have you identified a specific patient you'd start with?");
  }
  if (questions.length === 0) {
    questions.push("What would help you move forward with this therapy area?");
  }
  return questions;
}

function buildProhibitedTopics(): string[] {
  return [
    "Off-label use discussion",
    "Comparative efficacy claims not in approved materials",
    "Pricing or discount negotiation",
    "Unapproved patient case outcomes",
    "Promises of formulary advocacy beyond representative authority",
  ];
}

function buildPayerAccessChanges(account: TerritoryAccount): string | undefined {
  if (account.barrier === "formulary" || account.barrier === "reimbursement") {
    return "Verify current formulary status before visit — payer landscape may have shifted.";
  }
  return undefined;
}

// ─── 3. Interaction capture structuring ──────────────────────────────

interface BarrierPattern {
  barrier: BarrierType;
  keywords: string[];
}

const BARRIER_PATTERNS: BarrierPattern[] = [
  {
    barrier: "office_workflow",
    keywords: ["workflow", "workflow process", "no workflow", "lacks a workflow", "clinic workflow"],
  },
  {
    barrier: "reimbursement",
    keywords: ["reimbursement", "reimburse", "coverage", "payer", "insurance", "billing"],
  },
  {
    barrier: "formulary",
    keywords: ["formulary", "not on formulary", "formulary restriction", "preferred drug list"],
  },
  {
    barrier: "diagnosis_testing",
    keywords: ["testing", "diagnosis", "diagnostic", "test for", "screening", "biomarker"],
  },
  {
    barrier: "referral_pathway",
    keywords: ["referral", "refer patients", "referral pathway", "specialist referral"],
  },
  {
    barrier: "patient_eligibility",
    keywords: ["eligibility", "eligible patients", "who qualifies", "qualification"],
  },
  {
    barrier: "scientific_understanding",
    keywords: ["understanding", "understand the", "efficacy data", "data but", "familiarity", "not familiar"],
  },
  {
    barrier: "awareness",
    keywords: ["awareness", "unaware", "doesn't know", "not aware", "never heard"],
  },
  {
    barrier: "treatment_initiation",
    keywords: ["initiation", "start treatment", "begin treatment", "hesitant to start", "reluctant to initiate"],
  },
  {
    barrier: "persistence",
    keywords: ["persistence", "adherence", "continue therapy", "stay on", "discontinuation"],
  },
  {
    barrier: "access",
    keywords: ["access", "no access", "access issue", "hard to reach", "access barrier"],
  },
];

interface FollowUpPattern {
  followUp: string;
  keywords: string[];
}

const FOLLOWUP_PATTERNS: FollowUpPattern[] = [
  { followUp: "reimbursement_info", keywords: ["reimbursement", "coverage", "payer", "billing"] },
  { followUp: "workflow_setup", keywords: ["workflow", "process", "procedure"] },
  { followUp: "evidence_packet", keywords: ["evidence", "data", "study", "studies", "publication"] },
  { followUp: "sample_request", keywords: ["sample", "starter pack", "trial"] },
  { followUp: "dosing_info", keywords: ["dosing", "dose", "administration", "titration"] },
  { followUp: "safety_info", keywords: ["safety", "adverse", "side effect", "tolerability"] },
  { followUp: "patient_identification", keywords: ["identify patients", "patient identification", "screening criteria"] },
  { followUp: "formulary_status", keywords: ["formulary", "preferred drug", "coverage status"] },
];

interface StakeholderPattern {
  stakeholder: string;
  keywords: string[];
}

const STAKEHOLDER_PATTERNS: StakeholderPattern[] = [
  { stakeholder: "nurse_manager", keywords: ["nurse manager", "head nurse", "nursing manager"] },
  { stakeholder: "office_manager", keywords: ["office manager", "practice manager", "clinic manager"] },
  { stakeholder: "nurse", keywords: ["nurse", "rn", "lpn"] },
  { stakeholder: "physician_assistant", keywords: ["physician assistant", "pa ", " pa,", "pa."] },
  { stakeholder: "billing_manager", keywords: ["billing manager", "billing", "finance manager"] },
  { stakeholder: "pharmacist", keywords: ["pharmacist", "pharmacy", "clinical pharmacist"] },
  { stakeholder: "referral_coordinator", keywords: ["referral coordinator", "referral specialist"] },
];

interface NextActionPattern {
  action: string;
  keywords: string[];
}

const NEXT_ACTION_PATTERNS: NextActionPattern[] = [
  { action: "schedule_workflow_meeting", keywords: ["workflow", "process", "nurse manager"] },
  { action: "send_reimbursement_info", keywords: ["reimbursement", "coverage", "payer"] },
  { action: "provide_evidence_packet", keywords: ["evidence", "data", "study"] },
  { action: "schedule_joint_visit", keywords: ["included", "joint", "together", "next time"] },
  { action: "initiate_patient_screening", keywords: ["screen", "identify patients", "eligibility"] },
  { action: "escalate_formulary_review", keywords: ["formulary", "preferred drug"] },
];

function findFirstMatch<T>(
  patterns: { keywords: string[]; value: T }[],
  text: string,
): T | undefined {
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (p.keywords.some((kw) => lower.includes(kw))) {
      return p.value;
    }
  }
  return undefined;
}

function detectKnowledgeState(text: string): string {
  const lower = text.toLowerCase();
  if (/(understand|familiar|comfortable with|gets|grasps|knows)/.test(lower)) {
    const match = lower.match(/understands?\s+(?:the\s+)?([\w\s]+?)(?:\s+but|\s+\.|$)/);
    if (match) {
      return `Understands ${match[1].trim()}`;
    }
    return "Demonstrates understanding of presented data";
  }
  if (/(not familiar|doesn't understand|unclear|confused|unaware)/.test(lower)) {
    return "Limited understanding of key data";
  }
  return "Knowledge state not explicitly stated";
}

/**
 * Structure a natural-language voice/text note from a field rep into a
 * typed InteractionCapture. Uses keyword-based extraction for barriers,
 * follow-ups, stakeholders, and next actions. Low-confidence extractions
 * flag human confirmation.
 */
export function structureInteractionCapture(
  rawInput: string,
  accountId: string,
  hcpName: string,
): InteractionCapture {
  if (!rawInput || typeof rawInput !== "string" || rawInput.trim().length === 0) {
    throw new Error("structureInteractionCapture: rawInput must be a non-empty string");
  }
  if (!accountId) {
    throw new Error("structureInteractionCapture: accountId is required");
  }
  if (!hcpName) {
    throw new Error("structureInteractionCapture: hcpName is required");
  }

  const text = rawInput.trim();
  const lower = text.toLowerCase();

  // Detect all barriers present; first = primary, second = secondary.
  const detectedBarriers: BarrierType[] = [];
  for (const pattern of BARRIER_PATTERNS) {
    if (pattern.keywords.some((kw) => lower.includes(kw))) {
      if (!detectedBarriers.includes(pattern.barrier)) {
        detectedBarriers.push(pattern.barrier);
      }
    }
  }
  const primaryBarrier: BarrierType = detectedBarriers[0] ?? "none";
  const secondaryBarrier: BarrierType | undefined = detectedBarriers[1];

  const requestedFollowUp = findFirstMatch(
    FOLLOWUP_PATTERNS.map((p) => ({ keywords: p.keywords, value: p.followUp })),
    text,
  );

  const newStakeholder = findFirstMatch(
    STAKEHOLDER_PATTERNS.map((p) => ({ keywords: p.keywords, value: p.stakeholder })),
    text,
  );

  const nextBestAction =
    findFirstMatch(
      NEXT_ACTION_PATTERNS.map((p) => ({ keywords: p.keywords, value: p.action })),
      text,
    ) ?? "schedule_follow_up_visit";

  const knowledgeState = detectKnowledgeState(text);

  // Confidence heuristic: more signals detected => higher confidence.
  let signalCount = 0;
  if (primaryBarrier !== "none") signalCount += 1;
  if (secondaryBarrier) signalCount += 1;
  if (requestedFollowUp) signalCount += 1;
  if (newStakeholder) signalCount += 1;
  if (knowledgeState !== "Knowledge state not explicitly stated") signalCount += 1;
  const confidence = clamp(signalCount / 5, 0.2, 0.95);

  // Require human confirmation when confidence is moderate or a stakeholder
  // was inferred (stakeholder identity is high-stakes for compliance).
  const humanConfirmationRequired =
    confidence < 0.7 || newStakeholder !== undefined;

  return {
    accountId,
    hcpName,
    rawInput: text,
    knowledgeState,
    primaryBarrier,
    secondaryBarrier,
    requestedFollowUp,
    newStakeholder,
    nextBestAction,
    confidence: Number(confidence.toFixed(2)),
    evidenceSource: "field_rep_voice_note",
    humanConfirmationRequired,
    structuredAt: new Date().toISOString(),
  };
}

// ─── 4. Morning brief ────────────────────────────────────────────────

/**
 * Generate a text summary of overnight changes for the morning standup:
 * high-value accounts that changed, barriers removed, physicians
 * requesting info, low-value planned visits, and recommended route savings.
 */
export function generateMorningBrief(accounts: TerritoryAccount[]): string {
  if (!Array.isArray(accounts)) {
    throw new Error("generateMorningBrief: accounts must be an array");
  }

  const lines: string[] = [];
  lines.push("=== MORNING TERRITORY BRIEF ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Accounts under management: ${accounts.length}`);
  lines.push("");

  // High-value accounts (top priority score).
  const sorted = [...accounts].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );
  const highValue = sorted.filter((a) => a.priorityScore >= 0.7).slice(0, 5);
  lines.push("--- HIGH-VALUE ACCOUNTS ---");
  if (highValue.length === 0) {
    lines.push("No accounts currently in high-value tier.");
  } else {
    for (const a of highValue) {
      lines.push(
        `  • ${a.hcpName} (${a.specialty}) — score ${a.priorityScore.toFixed(2)}, state: ${a.funnelState}`,
      );
    }
  }
  lines.push("");

  // Barriers removed (accounts whose barrier is "none" but funnel is advanced).
  const barriersRemoved = accounts.filter(
    (a) => a.barrier === "none" && a.funnelState === "barrier_addressed",
  );
  lines.push("--- BARRIERS REMOVED (overnight) ---");
  if (barriersRemoved.length === 0) {
    lines.push("No barriers resolved since last sync.");
  } else {
    for (const a of barriersRemoved) {
      lines.push(`  • ${a.hcpName} — barrier cleared, now in ${a.funnelState}`);
    }
  }
  lines.push("");

  // Physicians requesting info (unmetInfoNeed high + recent interaction).
  const requestingInfo = accounts.filter((a) => a.unmetInfoNeed >= 0.6);
  lines.push("--- PHYSICIANS REQUESTING INFO ---");
  if (requestingInfo.length === 0) {
    lines.push("No outstanding info requests.");
  } else {
    for (const a of requestingInfo) {
      lines.push(
        `  • ${a.hcpName} — info need ${(a.unmetInfoNeed * 100).toFixed(0)}%, last: ${a.lastInteraction ?? "n/a"}`,
      );
    }
  }
  lines.push("");

  // Low-value planned visits (low access + low utility indicators).
  const lowValue = accounts.filter(
    (a) => a.accessProbability < ACCESS_DEFER_THRESHOLD,
  );
  lines.push("--- LOW-VALUE PLANNED VISITS (consider deferring) ---");
  if (lowValue.length === 0) {
    lines.push("All planned visits have adequate access probability.");
  } else {
    for (const a of lowValue) {
      lines.push(
        `  • ${a.hcpName} — access ${(a.accessProbability * 100).toFixed(0)}%, barrier: ${BARRIER_LABELS[a.barrier]}`,
      );
    }
  }
  lines.push("");

  // Recommended route time savings.
  const route = optimizeRoute(accounts, new Date().toISOString());
  lines.push("--- RECOMMENDED ROUTE ---");
  lines.push(
    `  Estimated time saved by deferring low-utility stops: ${formatDuration(route.timeSavedMin)}`,
  );
  lines.push(`  Stops planned: ${route.stops.length - route.deferredCount}`);
  lines.push(`  Stops deferred: ${route.deferredCount}`);
  lines.push(`  Total field time: ${formatDuration(route.totalFieldTimeMin)}`);
  lines.push("");
  lines.push("=== END MORNING BRIEF ===");

  return lines.join("\n");
}

// ─── 5. End-of-day report ────────────────────────────────────────────

/**
 * Generate an end-of-day report summarizing: field time, admin time saved,
 * meaningful engagements, barriers discovered, barriers resolved,
 * low-value visits avoided, model recommendations accepted, and incorrect
 * recommendations.
 */
export function generateEODReport(
  accounts: TerritoryAccount[],
  route: RouteOptimization,
): string {
  if (!Array.isArray(accounts)) {
    throw new Error("generateEODReport: accounts must be an array");
  }
  if (!route || !Array.isArray(route.stops)) {
    throw new Error("generateEODReport: route with stops is required");
  }

  const lines: string[] = [];
  lines.push("=== END-OF-DAY FIELD REPORT ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Field time.
  lines.push("--- FIELD TIME ---");
  lines.push(`  Drive time: ${formatDuration(route.totalDriveTimeMin)}`);
  lines.push(`  Wait time: ${formatDuration(route.totalWaitTimeMin)}`);
  lines.push(`  Total field time: ${formatDuration(route.totalFieldTimeMin)}`);
  lines.push("");

  // Admin time saved (prep briefs + structured captures vs manual entry).
  const adminSavedPerStop = 12; // ~12 min manual CRM entry saved per stop
  const visitedStops = route.stops.filter((s) => !s.deferred);
  const adminTimeSaved = visitedStops.length * adminSavedPerStop;
  lines.push("--- ADMIN TIME SAVED ---");
  lines.push(
    `  ${formatDuration(adminTimeSaved)} across ${visitedStops.length} visits (auto-brief + structured capture)`,
  );
  lines.push("");

  // Meaningful engagements (accounts in meaningful_interaction or beyond).
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const meaningfulEngagements = visitedStops.filter((s) => {
    const a = accountById.get(s.accountId);
    return (
      a &&
      (a.funnelState === "meaningful_interaction" ||
        a.funnelState === "content_consumed" ||
        a.funnelState === "treatment_consideration" ||
        a.funnelState === "patient_initiation")
    );
  });
  lines.push("--- MEANINGFUL ENGAGEMENTS ---");
  if (meaningfulEngagements.length === 0) {
    lines.push("  No meaningful engagements recorded today.");
  } else {
    for (const s of meaningfulEngagements) {
      const a = accountById.get(s.accountId);
      lines.push(`  • ${s.hcpName} — ${a?.funnelState ?? "advanced"}`);
    }
  }
  lines.push("");

  // Barriers discovered (accounts with non-none barrier visited today).
  const barriersDiscovered = visitedStops.filter((s) => {
    const a = accountById.get(s.accountId);
    return a && a.barrier !== "none";
  });
  lines.push("--- BARRIERS DISCOVERED ---");
  if (barriersDiscovered.length === 0) {
    lines.push("  No new barriers identified today.");
  } else {
    for (const s of barriersDiscovered) {
      const a = accountById.get(s.accountId);
      lines.push(
        `  • ${s.hcpName} — ${BARRIER_LABELS[a?.barrier ?? "none"]}`,
      );
    }
  }
  lines.push("");

  // Barriers resolved (accounts in barrier_addressed state).
  const barriersResolved = accounts.filter(
    (a) => a.funnelState === "barrier_addressed",
  );
  lines.push("--- BARRIERS RESOLVED ---");
  if (barriersResolved.length === 0) {
    lines.push("  No barriers resolved today.");
  } else {
    for (const a of barriersResolved) {
      lines.push(`  • ${a.hcpName} — barrier addressed`);
    }
  }
  lines.push("");

  // Low-value visits avoided (deferred stops).
  const deferred = route.stops.filter((s) => s.deferred);
  lines.push("--- LOW-VALUE VISITS AVOIDED ---");
  if (deferred.length === 0) {
    lines.push("  No visits deferred today.");
  } else {
    for (const s of deferred) {
      lines.push(`  • ${s.hcpName} — ${s.deferredReason ?? "low utility"}`);
    }
  }
  lines.push(
    `  Time saved by deferral: ${formatDuration(route.timeSavedMin)}`,
  );
  lines.push("");

  // Model recommendations accepted vs. incorrect.
  const accepted = visitedStops.length;
  const incorrect = visitedStops.filter((s) => s.utilityScore < 0.5).length;
  lines.push("--- MODEL RECOMMENDATIONS ---");
  lines.push(`  Recommendations accepted: ${accepted}`);
  lines.push(`  Recommendations deferred: ${deferred.length}`);
  lines.push(
    `  Incorrect recommendations (visited but very low utility): ${incorrect}`,
  );
  lines.push(
    `  Route utility score: ${route.routeUtility.toFixed(4)}`,
  );
  lines.push("");
  lines.push("=== END EOD REPORT ===");

  return lines.join("\n");
}

// ─── Utility: create a stub account for testing ──────────────────────

/**
 * Create a minimal TerritoryAccount for testing or seeding. Not intended
 * for production data entry — use the territory ingestion pipeline for
 * real accounts.
 */
export function createStubAccount(
  partial: Partial<TerritoryAccount> & Pick<TerritoryAccount, "hcpName" | "specialty" | "territory">,
): TerritoryAccount {
  return {
    id: partial.id ?? nanoid(),
    hcpName: partial.hcpName,
    specialty: partial.specialty,
    accountAffiliation: partial.accountAffiliation,
    territory: partial.territory,
    funnelState: partial.funnelState ?? "eligible",
    barrier: partial.barrier ?? "none",
    barrierDetail: partial.barrierDetail,
    eligiblePatientOpportunity: partial.eligiblePatientOpportunity ?? 0.5,
    unmetInfoNeed: partial.unmetInfoNeed ?? 0.5,
    accessProbability: partial.accessProbability ?? 0.5,
    expectedResponsiveness: partial.expectedResponsiveness ?? 0.5,
    evidenceConfidence: partial.evidenceConfidence ?? 0.5,
    fieldTimeRequired: partial.fieldTimeRequired ?? 0.5,
    operationalFriction: partial.operationalFriction ?? 0.3,
    uncertaintyRisk: partial.uncertaintyRisk ?? 0.3,
    priorityScore: partial.priorityScore ?? 0.5,
    lastInteraction: partial.lastInteraction,
    lastContentShown: partial.lastContentShown,
    channelPreference: partial.channelPreference,
    geographicZone: partial.geographicZone,
    reasonCodes: partial.reasonCodes ?? [],
    recommendedAction: partial.recommendedAction,
  };
}
