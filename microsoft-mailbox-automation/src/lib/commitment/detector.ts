/**
 * Commitment Detector
 *
 * Scans processed email records for work requests and synthesizes
 * CommitmentContract instances that the execution engine can act on.
 * The detector is intentionally deterministic and keyword-driven so that
 * its behavior is auditable and reproducible without an LLM round-trip.
 */

import { nanoid } from "nanoid";
import {
  CommitmentContract,
  AutonomyClass,
  ProcessedEmailRecord,
  RoleType,
} from "@/types";

// ─── Keyword dictionaries ──────────────────────────────────────────

/** Phrases that signal a work request when present in subject or body. */
const REQUEST_KEYWORDS: readonly string[] = [
  "need",
  "please prepare",
  "by friday",
  "by monday",
  "send me",
  "review",
  "update",
  "analyze",
  "report",
  "summarize",
  "follow up",
  "schedule",
  "complete",
  "draft",
  "create",
];

/** Sender signals that indicate managerial authority. */
const AUTHORITY_SIGNALS: readonly string[] = [
  "manager",
  "director",
  "vp",
  "vice president",
  "head of",
  "lead",
  "supervisor",
  "principal",
];

/** Deadline phrases mapped to a relative offset in days from today. */
const DEADLINE_PHRASES: ReadonlyArray<{ phrase: RegExp; offsetDays: number | (() => number); label: string }> = [
  { phrase: /\basap\b/i, offsetDays: 1, label: "ASAP" },
  { phrase: /\burgent\b/i, offsetDays: 1, label: "urgent" },
  { phrase: /\btomorrow\b/i, offsetDays: 1, label: "tomorrow" },
  { phrase: /\bend of (the )?week\b/i, offsetDays: 5, label: "end of week" },
  { phrase: /\bby friday\b/i, offsetDays: () => nextWeekdayOffset(5), label: "by Friday" },
  { phrase: /\bby monday\b/i, offsetDays: () => nextWeekdayOffset(1), label: "by Monday" },
  { phrase: /\bby tuesday\b/i, offsetDays: () => nextWeekdayOffset(2), label: "by Tuesday" },
  { phrase: /\bby wednesday\b/i, offsetDays: () => nextWeekdayOffset(3), label: "by Wednesday" },
  { phrase: /\bby thursday\b/i, offsetDays: () => nextWeekdayOffset(4), label: "by Thursday" },
];

/** Permitted tools keyed by recipient role. */
const ROLE_TOOLS: Record<RoleType, string[]> = {
  field_representative: [
    "crm_lookup",
    "territory_map",
    "route_planner",
    "call_planner",
    "internal_report_writer",
  ],
  regional_manager: [
    "crm_lookup",
    "performance_dashboard",
    "team_report_writer",
    "forecast_model",
    "internal_email_drafter",
  ],
  medical_affairs: [
    "evidence_search",
    "medical_information_writer",
    "literature_index",
    "internal_email_drafter",
  ],
  market_access: [
    "formulary_database",
    "payer_analyzer",
    "reimbursement_calculator",
    "internal_report_writer",
  ],
  compliance: [
    "policy_search",
    "audit_log_reader",
    "compliance_checklist_writer",
    "internal_email_drafter",
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Returns the number of days from today until the next occurrence of the
 * given weekday (0=Sunday ... 6=Saturday). If today is that weekday, the
 * deadline is treated as 7 days out to avoid zero-day deadlines.
 */
function nextWeekdayOffset(targetWeekday: number): number {
  const today = new Date();
  const todayWeekday = today.getDay();
  let offset = targetWeekday - todayWeekday;
  if (offset <= 0) offset += 7;
  return offset;
}

/** Format a Date as an ISO 8601 date string (YYYY-MM-DD). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Add a number of days to today and return the resulting ISO date. */
function daysFromNow(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toIsoDate(d);
}

/** Case-insensitive containment check. */
function contains(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

/** True when any of the phrases appear in the text. */
function containsAny(text: string, phrases: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p.toLowerCase()));
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Infer the recipient role from email subject and body content.
 *
 * The inference is keyword-driven and ordered from most specific to least
 * specific so that compliance and medical-affairs requests are not
 * misclassified as generic field-rep work.
 */
export function inferRole(subject: string, body: string): RoleType {
  const text = `${subject} ${body}`.toLowerCase();

  if (contains(text, "compliance") && contains(text, "review")) {
    return "compliance";
  }
  if (contains(text, "medical information") && contains(text, "evidence")) {
    return "medical_affairs";
  }
  if (contains(text, "formulary") && contains(text, "payer")) {
    return "market_access";
  }
  if (contains(text, "team") && contains(text, "performance")) {
    return "regional_manager";
  }
  if (contains(text, "territory")) {
    return "field_representative";
  }

  // Default to field representative for generic field-team requests.
  return "field_representative";
}

/**
 * Extract a deadline reference from free text and return it as an ISO date
 * string (YYYY-MM-DD). When no deadline is found, returns an empty string.
 *
 * Recognized forms:
 *  - Relative phrases: "ASAP", "urgent", "tomorrow", "end of week",
 *    "by Friday", "by Monday", ...
 *  - Absolute dates: "Aug 7", "August 7", "8/7", "2026-08-07".
 */
export function extractDeadline(text: string): string {
  if (!text) return "";

  // 1. Relative phrase matching.
  for (const { phrase, offsetDays } of DEADLINE_PHRASES) {
    if (phrase.test(text)) {
      const resolved = typeof offsetDays === "function" ? offsetDays() : offsetDays;
      return daysFromNow(resolved);
    }
  }

  // 2. ISO date: 2026-08-07
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }

  // 3. Numeric date: 8/7 or 08/07 (assume current year)
  const numericMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (numericMatch) {
    const [, monthStr, dayStr] = numericMatch;
    const month = monthStr.padStart(2, "0");
    const day = dayStr.padStart(2, "0");
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }

  // 4. Month-name date: "Aug 7" or "August 7"
  const monthNameMatch = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\b/i,
  );
  if (monthNameMatch) {
    const monthMap: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const monthKey = monthNameMatch[1].toLowerCase().slice(0, 3);
    const month = monthMap[monthKey];
    const day = monthNameMatch[2].padStart(2, "0");
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }

  return "";
}

/**
 * Classify the autonomy level for a requested outcome.
 *
 *  - Class 1: safe internal work (reports, summaries, reconciliation, routes)
 *  - Class 2: actions with external or system-of-record impact (external
 *    emails, CRM modifications, scheduling)
 *  - Class 3: actions requiring clinical, scientific, promotional, or
 *    financial judgment
 *  - Class 4: prohibited actions
 */
export function classifyAutonomy(
  requestedOutcome: string,
  externalSend: boolean,
): AutonomyClass {
  const text = requestedOutcome.toLowerCase();

  // Class 4: prohibited actions.
  const prohibited = [
    "off-label",
    "bribe",
    "kickback",
    "prescribe",
    "diagnose",
    "fabricate",
    "falsify",
  ];
  if (containsAny(text, prohibited)) {
    return 4;
  }

  // Class 3: clinical / scientific / promotional / financial judgment.
  const class3 = [
    "clinical",
    "scientific",
    "efficacy",
    "safety",
    "promotional claim",
    "claim",
    "financial authorization",
    "authorize payment",
    "budget approval",
    "medical judgment",
  ];
  if (containsAny(text, class3)) {
    return 3;
  }

  // Class 2: external send or CRM / scheduling impact.
  if (externalSend) {
    return 2;
  }
  const class2 = [
    "external email",
    "send to hcp",
    "contact hcp",
    "crm",
    "schedule meeting",
    "book meeting",
    "calendar invite",
    "modify crm",
  ];
  if (containsAny(text, class2)) {
    return 2;
  }

  // Class 1: safe internal work.
  const class1 = [
    "report",
    "summary",
    "summarize",
    "reconcile",
    "reconciliation",
    "route",
    "route calculation",
    "internal",
    "dashboard",
    "analysis",
    "analyze",
  ];
  if (containsAny(text, class1)) {
    return 1;
  }

  // Default: if external send is involved but no higher signal, Class 2.
  if (externalSend) return 2;

  // Conservative default for unrecognized outcomes.
  return 1;
}

/**
 * Determine whether the sender appears to hold managerial authority based on
 * their display name and the email subject.
 */
function isAuthoritySender(sender: string, subject: string): boolean {
  return containsAny(sender, AUTHORITY_SIGNALS) || containsAny(subject, AUTHORITY_SIGNALS);
}

/**
 * Extract a concise requested-outcome description from the subject and body.
 * Prefers the subject when it is descriptive; otherwise pulls the first
 * sentence of the body that contains a request keyword.
 */
function extractRequestedOutcome(subject: string, body: string): string {
  const subjectTrimmed = subject.trim();
  if (subjectTrimmed.length > 0 && containsAny(subjectTrimmed, REQUEST_KEYWORDS)) {
    return subjectTrimmed;
  }

  const firstSentence = body.split(/[.\n!]/)[0]?.trim() ?? "";
  if (firstSentence.length > 0) {
    return firstSentence.slice(0, 240);
  }

  return subjectTrimmed || "Unspecified work request";
}

function extractEmailAddress(sender: string): string {
  if (!sender) return "";
  const match = sender.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? "";
}

/**
 * Infer mandatory outputs from the request text. These are the deliverables
 * the requester explicitly expects.
 */
function inferMandatoryOutputs(text: string): string[] {
  const lower = text.toLowerCase();
  const outputs: string[] = [];

  if (contains(lower, "report")) outputs.push("Written report");
  if (contains(lower, "summary") || contains(lower, "summarize")) outputs.push("Executive summary");
  if (contains(lower, "analysis") || contains(lower, "analyze")) outputs.push("Analysis document");
  if (contains(lower, "brief") || contains(lower, "pre-call")) outputs.push("Pre-call brief");
  if (contains(lower, "draft")) outputs.push("Draft document");
  if (contains(lower, "schedule")) outputs.push("Scheduled meeting invite");
  if (contains(lower, "review")) outputs.push("Review checklist");
  if (contains(lower, "update")) outputs.push("Updated record/document");
  if (contains(lower, "route") || contains(lower, "plan")) outputs.push("Route/plan document");
  if (contains(lower, "formulary")) outputs.push("Formulary analysis");
  if (contains(lower, "compliance")) outputs.push("Compliance review memo");

  if (outputs.length === 0) outputs.push("Response to request");
  return outputs;
}

/**
 * Infer additional useful deliverables that go beyond the explicit ask but
 * remain within the recipient's permitted scope.
 */
function inferAdditionalOutputs(text: string, role: RoleType): string[] {
  const lower = text.toLowerCase();
  const extras: string[] = [];

  if (role === "field_representative") {
    extras.push("Recommended next-best-action for territory");
    if (contains(lower, "territory")) extras.push("Territory coverage map");
  }
  if (role === "regional_manager") {
    extras.push("Team performance snapshot");
  }
  if (role === "medical_affairs") {
    extras.push("Evidence quality assessment");
  }
  if (role === "market_access") {
    extras.push("Payer landscape summary");
  }
  if (role === "compliance") {
    extras.push("Risk mitigation recommendations");
  }

  if (contains(lower, "deadline") || contains(lower, "by ")) {
    extras.push("Timeline with milestones");
  }

  return extras;
}

/**
 * Infer blocking dependencies that could reduce completion probability.
 */
function inferDependencies(text: string): { description: string; blocksProbability: number }[] {
  const lower = text.toLowerCase();
  const deps: { description: string; blocksProbability: number }[] = [];

  if (contains(lower, "attachment") || contains(lower, "attached")) {
    deps.push({ description: "Attachment must be parsed and validated", blocksProbability: 0.2 });
  }
  if (contains(lower, "approval") || contains(lower, "approve")) {
    deps.push({ description: "Manager approval required before execution", blocksProbability: 0.35 });
  }
  if (contains(lower, "data") || contains(lower, "crm")) {
    deps.push({ description: "CRM/data source availability", blocksProbability: 0.15 });
  }
  if (contains(lower, "compliance")) {
    deps.push({ description: "Compliance review gate", blocksProbability: 0.3 });
  }

  return deps;
}

/**
 * Estimate completion probability (0.7-0.95) based on complexity signals.
 */
function estimateCompletionProbability(text: string, autonomyClass: AutonomyClass): number {
  const lower = text.toLowerCase();
  let probability = 0.9;

  // Complexity reducers.
  if (contains(lower, "complex") || contains(lower, "detailed")) probability -= 0.08;
  if (contains(lower, "multiple") || contains(lower, "all")) probability -= 0.05;
  if (contains(lower, "approval") || contains(lower, "approve")) probability -= 0.07;
  if (contains(lower, "compliance")) probability -= 0.06;

  // Higher autonomy classes carry more uncertainty.
  if (autonomyClass >= 3) probability -= 0.05;
  if (autonomyClass === 4) probability -= 0.05;

  // Clamp to the required band.
  return Math.max(0.7, Math.min(0.95, Number(probability.toFixed(2))));
}

/**
 * Scan processed email records for work requests and return a list of
 * CommitmentContract instances, one per detected request.
 */
export function detectCommitments(records: ProcessedEmailRecord[]): CommitmentContract[] {
  const commitments: CommitmentContract[] = [];

  for (const record of records) {
    const subject = record.subject ?? "";
    const body = record.extractedData?.summary ?? "";
    const combinedText = `${subject} ${body}`;

    // Skip records that do not contain any request signal.
    if (!containsAny(combinedText, REQUEST_KEYWORDS)) {
      continue;
    }

    const role = inferRole(subject, body);
    const outcome = extractRequestedOutcome(subject, body);
    const externalSend = false;
    const autonomyClass = classifyAutonomy(outcome, externalSend);
    const deadline = extractDeadline(combinedText) || daysFromNow(3);
    const mandatoryOutputs = inferMandatoryOutputs(combinedText);
    const inferredOutputs = inferAdditionalOutputs(combinedText, role);
    const dependencies = inferDependencies(combinedText);
    const completionProbability = estimateCompletionProbability(combinedText, autonomyClass);
    const authority = isAuthoritySender(record.sender, subject);

    const now = new Date().toISOString();

    const contract: CommitmentContract = {
      id: nanoid(),
      emailId: record.emailId,
      emailSubject: subject,
      requester: record.sender,
      requesterEmail: record.senderEmail || extractEmailAddress(record.sender) || "",
      recipientRole: role,
      authorityVerified: authority,
      requestedOutcome: outcome,
      deadline,
      mandatoryOutputs,
      inferredOutputs,
      permittedTools: ROLE_TOOLS[role],
      externalSendAllowed: externalSend,
      autonomyClass,
      completionProbability,
      dependencies,
      assumptions: [
        "Request is directed at the inferred recipient role.",
        "Standard content library and policy package apply.",
        "No off-label or promotional claims are permitted.",
      ],
      status: "detected",
      auditEvents: [
        {
          timestamp: now,
          event: "detected",
          detail: `Commitment detected from email "${subject}" with autonomy class ${autonomyClass}.`,
        },
      ],
      detectedAt: now,
    };

    commitments.push(contract);
  }

  return commitments;
}

// ─── Sample data ───────────────────────────────────────────────────

/**
 * Generate five realistic sample commitments for a Gilead field team.
 * These mirror the kinds of requests a field representative, regional
 * manager, medical affairs, market access, and compliance role would
 * receive, and are useful for demos, tests, and seeding the UI.
 */
export function generateSampleCommitments(): CommitmentContract[] {
  const now = new Date().toISOString();
  const baseAssumptions = [
    "Request is directed at the inferred recipient role.",
    "Standard content library and policy package apply.",
    "No off-label or promotional claims are permitted.",
  ];

  const makeAudit = (subject: string, autonomyClass: AutonomyClass) => [
    {
      timestamp: now,
      event: "detected",
      detail: `Sample commitment generated for "${subject}" with autonomy class ${autonomyClass}.`,
    },
  ];

  // 1. Territory review request (field representative)
  const territoryOutcome = "Prepare territory review report for Northern California this week";
  const territoryRole: RoleType = "field_representative";
  const territoryAutonomy = classifyAutonomy(territoryOutcome, false);

  // 2. Pre-call brief request (field representative)
  const briefOutcome = "Draft pre-call brief for Dr. Chen cardiology visit";
  const briefRole: RoleType = "field_representative";
  const briefAutonomy = classifyAutonomy(briefOutcome, false);

  // 3. Formulary analysis request (market access)
  const formularyOutcome = "Analyze formulary status for Biktarvy across top regional payers";
  const formularyRole: RoleType = "market_access";
  const formularyAutonomy = classifyAutonomy(formularyOutcome, false);

  // 4. Medical information response (medical affairs)
  const medInfoOutcome = "Prepare medical information response with evidence summary on Descovy";
  const medInfoRole: RoleType = "medical_affairs";
  const medInfoAutonomy = classifyAutonomy(medInfoOutcome, false);

  // 5. Compliance review (compliance)
  const complianceOutcome = "Compliance review of proposed HCP engagement materials";
  const complianceRole: RoleType = "compliance";
  const complianceAutonomy = classifyAutonomy(complianceOutcome, false);

  const samples: Array<{
    subject: string;
    sender: string;
    outcome: string;
    role: RoleType;
    autonomy: AutonomyClass;
    deadline: string;
    mandatory: string[];
    inferred: string[];
    dependencies: { description: string; blocksProbability: number }[];
    probability: number;
  }> = [
    {
      subject: "Territory review needed by Friday",
      sender: "Sarah Martinez, Regional Manager",
      outcome: territoryOutcome,
      role: territoryRole,
      autonomy: territoryAutonomy,
      deadline: daysFromNow(nextWeekdayOffset(5)),
      mandatory: ["Written report", "Territory coverage map"],
      inferred: ["Recommended next-best-action for territory", "Timeline with milestones"],
      dependencies: [
        { description: "CRM/data source availability", blocksProbability: 0.15 },
      ],
      probability: 0.9,
    },
    {
      subject: "Please prepare pre-call brief for Dr. Chen",
      sender: "James Park, Field Lead",
      outcome: briefOutcome,
      role: briefRole,
      autonomy: briefAutonomy,
      deadline: daysFromNow(2),
      mandatory: ["Pre-call brief"],
      inferred: ["Recommended next-best-action for territory"],
      dependencies: [],
      probability: 0.92,
    },
    {
      subject: "Formulary analysis request - Biktarvy payer coverage",
      sender: "Dana Whitfield, Market Access Director",
      outcome: formularyOutcome,
      role: formularyRole,
      autonomy: formularyAutonomy,
      deadline: daysFromNow(5),
      mandatory: ["Formulary analysis", "Analysis document"],
      inferred: ["Payer landscape summary"],
      dependencies: [
        { description: "Formulary database availability", blocksProbability: 0.2 },
      ],
      probability: 0.85,
    },
    {
      subject: "Medical information response needed - Descovy evidence",
      sender: "Dr. Priya Nair, Medical Affairs Lead",
      outcome: medInfoOutcome,
      role: medInfoRole,
      autonomy: medInfoAutonomy,
      deadline: daysFromNow(3),
      mandatory: ["Medical information response", "Evidence quality assessment"],
      inferred: ["Evidence quality assessment"],
      dependencies: [
        { description: "Literature index availability", blocksProbability: 0.15 },
      ],
      probability: 0.88,
    },
    {
      subject: "Compliance review of HCP engagement materials",
      sender: "Robert Osei, Compliance Director",
      outcome: complianceOutcome,
      role: complianceRole,
      autonomy: complianceAutonomy,
      deadline: daysFromNow(4),
      mandatory: ["Compliance review memo", "Review checklist"],
      inferred: ["Risk mitigation recommendations"],
      dependencies: [
        { description: "Compliance review gate", blocksProbability: 0.3 },
      ],
      probability: 0.82,
    },
  ];

  return samples.map((s) => ({
    id: nanoid(),
    emailId: nanoid(),
    emailSubject: s.subject,
    requester: s.sender,
    requesterEmail: s.sender,
    recipientRole: s.role,
    authorityVerified: isAuthoritySender(s.sender, s.subject),
    requestedOutcome: s.outcome,
    deadline: s.deadline,
    mandatoryOutputs: s.mandatory,
    inferredOutputs: s.inferred,
    permittedTools: ROLE_TOOLS[s.role],
    externalSendAllowed: false,
    autonomyClass: s.autonomy,
    completionProbability: s.probability,
    dependencies: s.dependencies,
    assumptions: baseAssumptions,
    status: "detected" as const,
    auditEvents: makeAudit(s.subject, s.autonomy),
    detectedAt: now,
  }));
}
