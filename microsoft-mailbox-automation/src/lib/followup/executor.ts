import {
  FollowUpAction,
  FollowUpRiskLevel,
  InteractionCapture,
  TerritoryAccount,
} from "@/types";

/**
 * Follow-up Executor
 *
 * Converts an `InteractionCapture` into a deterministic, compliance-classified
 * queue of `FollowUpAction` items. Every action is assigned a risk level and a
 * corresponding system behavior so downstream orchestration knows whether to
 * auto-record, draft-and-approve, route to compliance, or block-and-document.
 *
 * Design notes:
 * - No promotional claims are ever generated. Email drafts reference only the
 *   approved-material id recorded on the account/capture and remain
 *   fair-balanced.
 * - Risk classification is content-aware: the presence of claim-like language,
 *   off-label references, or unauthorized commitments escalates an action to
 *   `prohibited` regardless of its nominal type.
 * - All generated text is deterministic given the inputs; no external LLM call
 *   is required, which keeps the executor unit-testable and side-effect free.
 */

// ─── Internal helpers ────────────────────────────────────────────────

const RISK_TO_BEHAVIOR: Record<
  FollowUpRiskLevel,
  FollowUpAction["systemBehavior"]
> = {
  low: "auto_record",
  moderate: "draft_and_approve",
  high: "route_to_compliance",
  prohibited: "block_and_document",
};

/** Phrases that, if present in any generated or captured text, indicate
 *  promotional claims, off-label discussion, or unauthorized commitments and
 *  therefore force a `prohibited` classification. These patterns target
 *  *intent to provide or discuss* prohibited content, not mere instructional
 *  mentions (e.g. "do not discuss off-label"). */
const PROHIBITED_PATTERNS: RegExp[] = [
  // Intent to share/provide off-label or unapproved content.
  /\b(send|share|provide|discuss|email|forward)\b[^.]{0,40}\boff[- ]label\b/i,
  /\b(send|share|provide|discuss|email|forward)\b[^.]{0,40}\bunapproved\s+use\b/i,
  /\b(send|share|provide|discuss|email|forward)\b[^.]{0,40}\binvestigational\s+use\b/i,
  // Off-label content offered without an action verb but clearly as a deliverable.
  /\boff[- ]label\b[^.]{0,30}\b(information|materials?|data|literature|details)\b/i,
  // Promotional / unauthorized commitment language.
  /guarantee(d)?\s+(efficacy|outcome|result)/i,
  /promise\s+of\s+(efficacy|safety|cure)/i,
  /best\s+(drug|therapy|treatment)\s+for/i,
  /superior\s+to\s+(all|every|any)\s+(other|therapy|drug)/i,
  /no\s+side\s+effects/i,
  /\bcure(s|d)?\s+/i,
  /free\s+samples\s+for\s+off[- ]label/i,
  /will\s+(reimburse|cover)\s+any\s+off[- ]label/i,
];

/** Negation contexts that convert a would-be prohibited mention into an
 *  instructional/compliant one (e.g. "do not discuss off-label"). When the
 *  text around a flagged term matches one of these, the prohibited
 *  classification is suppressed. */
const NEGATION_GUARDS: RegExp[] = [
  /\b(do\s+not|don't|cannot|can't|never|must\s+not|should\s+not|outside\s+of|prohibited\s+from|not\s+permitted\s+to)\b[^.]{0,40}\boff[- ]label\b/i,
  /\boff[- ]label\b[^.]{0,30}\b(is|are)\s+(prohibited|not\s+(allowed|permitted|discussed))\b/i,
];

/** Phrases that elevate risk to `high` (route to compliance) without being
 *  outright prohibited — e.g. medical-information requests, escalations, or
 *  content that may imply a clinical claim. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /medical\s+information/i,
  /adverse\s+event/i,
  /product\s+complaint/i,
  /escalat(e|ion)/i,
  /efficacy\s+claim/i,
  /safety\s+profile\s+claim/i,
  /comparative\s+claim/i,
  /unsolicited\s+request\s+for\s+(off[- ]label|unapproved)/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function containsProhibitedContent(text: string): boolean {
  if (!matchesAny(text, PROHIBITED_PATTERNS)) {
    return false;
  }
  // A prohibited pattern matched, but if the surrounding context is a
  // negation/instructional guard (e.g. "do not discuss off-label"), treat the
  // text as compliant. We only suppress when *every* prohibited match is
  // covered by a negation guard.
  const prohibitedMatches = PROHIBITED_PATTERNS.filter((p) => p.test(text));
  const guarded = prohibitedMatches.every((p) => {
    const m = text.match(p);
    if (!m || m.index === undefined) return false;
    const window = text.slice(
      Math.max(0, m.index - 30),
      Math.min(text.length, m.index + m[0].length + 30)
    );
    return NEGATION_GUARDS.some((g) => g.test(window));
  });
  return !guarded;
}

function containsHighRiskContent(text: string): boolean {
  return matchesAny(text, HIGH_RISK_PATTERNS);
}

function deadlineFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function safeText(value: string | undefined): string {
  return (value ?? "").trim();
}

// ─── Risk classification ─────────────────────────────────────────────

/**
 * Classify the risk level of a follow-up action based on its type and content.
 *
 * Baseline risk by type:
 *  - crm_note / reminder / action_plan  -> low
 *  - email / meeting_request            -> moderate
 *  - med_info_request / escalation /
 *    evidence_request / internal_referral -> high
 *
 * Content overrides: prohibited language forces `prohibited`; high-risk
 * language forces at least `high`. The result is always the *most restrictive*
 * of the type baseline and the content-derived level.
 */
export function classifyRisk(action: FollowUpAction): FollowUpRiskLevel {
  const haystack = [
    action.description,
    action.draftContent ?? "",
    action.recipient ?? "",
  ].join("\n");

  // Prohibited content always wins, regardless of action type.
  if (containsProhibitedContent(haystack)) {
    return "prohibited";
  }

  const contentHighRisk = containsHighRiskContent(haystack);

  let baseline: FollowUpRiskLevel;
  switch (action.type) {
    case "crm_note":
    case "reminder":
    case "action_plan":
      baseline = "low";
      break;
    case "email":
    case "meeting_request":
      baseline = "moderate";
      break;
    case "med_info_request":
    case "escalation":
    case "evidence_request":
    case "internal_referral":
      baseline = "high";
      break;
    default:
      // Unknown types are treated conservatively.
      baseline = "high";
      break;
  }

  if (contentHighRisk && baseline === "low") {
    baseline = "high";
  } else if (contentHighRisk && baseline === "moderate") {
    baseline = "high";
  }

  return baseline;
}

// ─── Email drafting ──────────────────────────────────────────────────

/**
 * Draft a compliant follow-up email based on the interaction.
 *
 * Constraints enforced by construction:
 *  - References only the approved-material id (if any) carried on the account
 *    or capture; never invents content.
 *  - Makes no promotional claims; presents only the fact that approved
 *    materials exist and offers to share them through approved channels.
 *  - Is fair-balanced: acknowledges that the HCP should consult the full
 *    prescribing information and that the representative cannot provide
 *    medical advice.
 *  - Contains no off-label references.
 */
export function draftEmail(
  capture: InteractionCapture,
  account: TerritoryAccount
): string {
  const hcpName = safeText(capture.hcpName) || "Doctor";
  const knowledge = safeText(capture.knowledgeState);
  const requested = safeText(capture.requestedFollowUp);
  const barrier = capture.primaryBarrier;
  const approvedMaterialId =
    account.recommendedAction?.approvedContentId ?? undefined;

  const subject = `Following up on our recent discussion`;

  const lines: string[] = [];
  lines.push(`Dear Dr. ${hcpName},`);
  lines.push("");
  lines.push(
    `Thank you for taking the time to meet with me on ${capture.structuredAt}. I appreciate the opportunity to continue our professional dialogue.`
  );
  lines.push("");

  if (knowledge) {
    lines.push(
      `To recap our conversation, you noted that your current understanding of the topic is: ${knowledge}.`
    );
    lines.push("");
  }

  if (barrier && barrier !== "none") {
    lines.push(
      `We discussed a consideration related to ${barrier.replace(/_/g, " ")} that may be relevant to your practice.`
    );
    lines.push("");
  }

  if (approvedMaterialId) {
    lines.push(
      `As discussed, I can share the approved, on-label materials referenced in our conversation (reference: ${approvedMaterialId}) through an approved channel at your convenience. These materials have been reviewed by our Medical, Legal, and Regulatory review process and reflect the FDA-approved labeling for the product.`
    );
    lines.push("");
  } else {
    lines.push(
      `If you would like additional information, I can route a formal medical-information request to our Medical Affairs team, who can address clinical or scientific questions within their established review process.`
    );
    lines.push("");
  }

  if (requested) {
    lines.push(
      `Regarding your specific request (${requested}): I want to ensure any response is fully compliant with our review process. I will follow up with the appropriate approved materials or route your question to Medical Affairs as needed.`
    );
    lines.push("");
  }

  // Fair-balance statement.
  lines.push(
    `Please note that I am a field representative and cannot provide medical advice or information outside of the approved labeling. For any clinical or scientific questions, including those that may fall outside the approved indication, please contact our Medical Affairs team, who can provide a fair-balanced, evidence-based response.`
  );
  lines.push("");

  lines.push(`I look forward to our next conversation.`);
  lines.push("");
  lines.push(`Best regards,`);
  lines.push(`Field Representative`);
  lines.push(`Territory: ${safeText(account.territory)}`);

  return `${subject}\n\n${lines.join("\n")}`;
}

// ─── Action plan generation ──────────────────────────────────────────

/**
 * Generate an account action plan with prioritized next steps.
 *
 * Prioritization is driven by the capture's primary/secondary barriers and the
 * account's funnel state. Steps are ordered by urgency (barrier resolution and
 * compliance-sensitive items first) and each step references only approved
 * channels and content.
 */
export function generateActionPlan(
  capture: InteractionCapture,
  account: TerritoryAccount
): string {
  const hcpName = safeText(capture.hcpName) || "the account";
  const primary = capture.primaryBarrier;
  const secondary = capture.secondaryBarrier;
  const funnel = account.funnelState;
  const nba = safeText(capture.nextBestAction);
  const requested = safeText(capture.requestedFollowUp);
  const approvedMaterialId =
    account.recommendedAction?.approvedContentId ?? undefined;

  const sections: string[] = [];
  sections.push(`Account Action Plan: ${hcpName}`);
  sections.push(`========================================`);
  sections.push(`Account ID: ${account.id}`);
  sections.push(`Territory: ${safeText(account.territory)}`);
  sections.push(`Specialty: ${safeText(account.specialty)}`);
  sections.push(`Funnel State: ${funnel}`);
  sections.push(`Primary Barrier: ${primary}`);
  if (secondary) {
    sections.push(`Secondary Barrier: ${secondary}`);
  }
  sections.push(`Priority Score: ${account.priorityScore.toFixed(2)}`);
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push("");

  const steps: { priority: string; step: string }[] = [];

  // 1. Compliance-sensitive requested follow-up first.
  if (requested) {
    if (containsProhibitedContent(requested)) {
      steps.push({
        priority: "P0 — BLOCKED",
        step: `The HCP request ("${requested}") references content that cannot be fulfilled by field representatives. Document the request, do not act, and route to Compliance for review.`,
      });
    } else if (containsHighRiskContent(requested)) {
      steps.push({
        priority: "P1 — Compliance",
        step: `Route the HCP request ("${requested}") to Medical Affairs / Compliance for an approved, fair-balanced response. Do not respond directly with clinical claims.`,
      });
    } else {
      steps.push({
        priority: "P2",
        step: `Fulfill the HCP request ("${requested}") using only approved materials and channels. Draft for approval before sending.`,
      });
    }
  }

  // 2. Primary barrier resolution.
  if (primary && primary !== "none") {
    steps.push({
      priority: "P1",
      step: `Address the primary barrier (${primary.replace(/_/g, " ")}): ${barrierResolutionGuidance(primary, approvedMaterialId)}`,
    });
  }

  // 3. Secondary barrier (lower priority).
  if (secondary && secondary !== "none") {
    steps.push({
      priority: "P3",
      step: `Monitor the secondary barrier (${secondary.replace(/_/g, " ")}): ${barrierResolutionGuidance(secondary, approvedMaterialId)}`,
    });
  }

  // 4. Next best action from the capture.
  if (nba) {
    steps.push({
      priority: "P2",
      step: `Execute the next best action: ${nba}. Confirm permitted channel and approved content before acting.`,
    });
  }

  // 5. Funnel advancement.
  steps.push({
    priority: "P3",
    step: `Advance the account from "${funnel}" toward the next funnel state. Schedule the next meaningful interaction within 14 days, respecting the HCP's channel preference (${account.channelPreference ?? "unspecified"}).`,
  });

  // 6. CRM hygiene.
  steps.push({
    priority: "P4",
    step: `Record this interaction, barrier updates, and any new stakeholders (${safeText(capture.newStakeholder) || "none"}) in CRM within 24 hours.`,
  });

  sections.push(`Prioritized Next Steps`);
  sections.push(`----------------------------------------`);
  steps.forEach((s, i) => {
    sections.push(`${i + 1}. [${s.priority}] ${s.step}`);
  });
  sections.push("");

  sections.push(`Compliance Reminders`);
  sections.push(`----------------------------------------`);
  sections.push(
    `- Only share materials bearing a valid approved-content ID. Current approved material: ${approvedMaterialId ?? "none on file"}.`
  );
  sections.push(
    `- Do not discuss off-label uses, make promotional claims, or commit to unauthorized actions.`
  );
  sections.push(
    `- Route all clinical/scientific questions to Medical Affairs for a fair-balanced response.`
  );
  sections.push(
    `- All external communications require draft-and-approve before sending.`
  );

  return sections.join("\n");
}

function barrierResolutionGuidance(
  barrier: string,
  approvedMaterialId?: string
): string {
  const materialNote = approvedMaterialId
    ? ` Use approved material ${approvedMaterialId} as the primary reference.`
    : ` Route to Medical Affairs for approved supporting information.`;

  const guidance: Record<string, string> = {
    awareness: `Provide on-label disease-state education through an approved channel.${materialNote}`,
    scientific_understanding: `Share approved scientific materials that address the knowledge gap.${materialNote}`,
    patient_eligibility: `Clarify approved-indication eligibility criteria using on-label materials only.${materialNote}`,
    formulary: `Connect the HCP with the access team for formulary status questions; do not speculate on coverage.${materialNote}`,
    diagnosis_testing: `Provide approved diagnostic-criteria materials; refer clinical questions to Medical Affairs.${materialNote}`,
    referral_pathway: `Share approved referral-pathway information; coordinate with the access team if needed.${materialNote}`,
    reimbursement: `Route reimbursement questions to the access/reimbursement support team.${materialNote}`,
    office_workflow: `Offer approved workflow-support resources; schedule a follow-up to confirm adoption.${materialNote}`,
    treatment_initiation: `Provide approved initiation materials; ensure all claims are on-label.${materialNote}`,
    persistence: `Share approved persistence-support materials; schedule a check-in.${materialNote}`,
    access: `Engage the internal access team to resolve access barriers.${materialNote}`,
    none: `No active barrier; maintain engagement cadence.`,
  };

  return guidance[barrier] ?? `Review and address the barrier using approved materials.${materialNote}`;
}

// ─── Follow-up generation ─────────────────────────────────────────────

/**
 * After an interaction capture, generate all needed follow-up actions.
 *
 * The set of actions is derived deterministically from:
 *  - `requestedFollowUp` (HCP's explicit ask)
 *  - `primaryBarrier` / `secondaryBarrier` (what is blocking advancement)
 *  - `nextBestAction` (the system's recommended next step)
 *
 * Each action is classified by risk and assigned the matching system behavior.
 * If any captured text contains prohibited language, a `block_and_document`
 * action is emitted and no externally-facing action is generated for that
 * request.
 */
export function generateFollowUps(
  capture: InteractionCapture,
  account: TerritoryAccount
): FollowUpAction[] {
  const actions: FollowUpAction[] = [];
  const requested = safeText(capture.requestedFollowUp);
  const primary = capture.primaryBarrier;
  const secondary = capture.secondaryBarrier;
  const nba = safeText(capture.nextBestAction);
  const approvedMaterialId =
    account.recommendedAction?.approvedContentId ?? undefined;

  // ── CRM note (always) ──────────────────────────────────────────────
  actions.push({
    type: "crm_note",
    description: `Record interaction with ${capture.hcpName}: knowledge state "${safeText(capture.knowledgeState)}", primary barrier ${primary}, next best action "${nba}".`,
    riskLevel: "low",
    systemBehavior: "auto_record",
    deadline: deadlineFromNow(1),
  });

  // ── Reminder (always, if a next best action exists) ─────────────────
  if (nba) {
    actions.push({
      type: "reminder",
      description: `Follow up on next best action: ${nba}. Confirm permitted channel before executing.`,
      riskLevel: "low",
      systemBehavior: "auto_record",
      deadline: deadlineFromNow(7),
    });
  }

  // ── New stakeholder CRM update ──────────────────────────────────────
  const stakeholder = safeText(capture.newStakeholder);
  if (stakeholder) {
    actions.push({
      type: "crm_note",
      description: `Add new stakeholder "${stakeholder}" to account ${account.id} (${account.hcpName}).`,
      riskLevel: "low",
      systemBehavior: "auto_record",
      deadline: deadlineFromNow(1),
    });
  }

  // ── Requested follow-up ─────────────────────────────────────────────
  if (requested) {
    if (containsProhibitedContent(requested)) {
      // Prohibited: block and document, do not generate any external action.
      actions.push({
        type: "escalation",
        description: `BLOCKED: HCP requested content that is prohibited for field discussion ("${requested}"). Document the request and route to Compliance.`,
        riskLevel: "prohibited",
        systemBehavior: "block_and_document",
        recipient: "compliance",
        deadline: deadlineFromNow(1),
      });
    } else if (containsHighRiskContent(requested)) {
      // Medical-information / adverse-event / escalation language.
      actions.push({
        type: "med_info_request",
        description: `Route HCP request to Medical Affairs for an approved, fair-balanced response: "${requested}".`,
        riskLevel: "high",
        systemBehavior: "route_to_compliance",
        recipient: "medical_affairs",
        deadline: deadlineFromNow(3),
      });
    } else if (/meeting|appointment|schedule|visit/i.test(requested)) {
      actions.push({
        type: "meeting_request",
        description: `Schedule a follow-up meeting per HCP request: "${requested}".`,
        riskLevel: "moderate",
        systemBehavior: "draft_and_approve",
        recipient: capture.hcpName,
        deadline: deadlineFromNow(5),
      });
    } else if (/material|content|literature|information|brochure|slide/i.test(requested)) {
      actions.push({
        type: "email",
        description: `Send approved materials to HCP per request: "${requested}".`,
        riskLevel: "moderate",
        systemBehavior: "draft_and_approve",
        recipient: capture.hcpName,
        approvedMaterialId,
        draftContent: draftEmail(capture, account),
        deadline: deadlineFromNow(3),
      });
    } else {
      // Generic request: draft an email that does not commit to anything
      // outside approved content.
      actions.push({
        type: "email",
        description: `Follow up with HCP regarding their request: "${requested}".`,
        riskLevel: "moderate",
        systemBehavior: "draft_and_approve",
        recipient: capture.hcpName,
        approvedMaterialId,
        draftContent: draftEmail(capture, account),
        deadline: deadlineFromNow(5),
      });
    }
  }

  // ── Primary barrier actions ─────────────────────────────────────────
  if (primary && primary !== "none") {
    if (primary === "access" || primary === "formulary" || primary === "reimbursement") {
      actions.push({
        type: "internal_referral",
        description: `Refer account to internal access team to address ${primary} barrier for ${account.hcpName}.`,
        riskLevel: "high",
        systemBehavior: "route_to_compliance",
        recipient: "access_team",
        deadline: deadlineFromNow(5),
      });
    } else {
      actions.push({
        type: "evidence_request",
        description: `Request approved evidence/materials to address the ${primary} barrier for ${account.hcpName}.`,
        riskLevel: "high",
        systemBehavior: "route_to_compliance",
        recipient: "medical_affairs",
        approvedMaterialId,
        deadline: deadlineFromNow(7),
      });
    }
  }

  // ── Secondary barrier (lower urgency) ───────────────────────────────
  if (secondary && secondary !== "none") {
    actions.push({
      type: "evidence_request",
      description: `Identify approved materials to monitor the secondary ${secondary} barrier for ${account.hcpName}.`,
      riskLevel: "high",
      systemBehavior: "route_to_compliance",
      recipient: "medical_affairs",
      deadline: deadlineFromNow(14),
    });
  }

  // ── Account action plan (always) ────────────────────────────────────
  actions.push({
    type: "action_plan",
    description: `Generate account action plan for ${account.hcpName} based on the latest interaction.`,
    riskLevel: "low",
    systemBehavior: "auto_record",
    draftContent: generateActionPlan(capture, account),
    deadline: deadlineFromNow(2),
  });

  // ── Escalation if human confirmation is required ────────────────────
  if (capture.humanConfirmationRequired) {
    actions.push({
      type: "escalation",
      description: `Human confirmation required for interaction with ${account.hcpName}. Confidence: ${capture.confidence.toFixed(2)}. Review before any external action.`,
      riskLevel: "high",
      systemBehavior: "route_to_compliance",
      recipient: "field_manager",
      deadline: deadlineFromNow(1),
    });
  }

  // ── Re-classify every action to ensure consistency ──────────────────
  // The constructors above set sensible defaults, but content may warrant a
  // higher level. classifyRisk is the single source of truth.
  return actions.map((a) => {
    const level = classifyRisk(a);
    return { ...a, riskLevel: level, systemBehavior: RISK_TO_BEHAVIOR[level] };
  });
}

export default generateFollowUps;
