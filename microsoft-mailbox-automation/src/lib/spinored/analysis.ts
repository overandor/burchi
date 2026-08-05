import { nanoid } from "nanoid";

import {
  SpinoredAnalysis,
  TerritoryAccount,
  OutcomeAttribution,
  ImprovementProposal,
  HCPFunnelState,
  BarrierType,
} from "@/types";

/**
 * Spine-Ordered Analysis (Spinored)
 *
 * Each account is examined through a fixed six-layer spine so that every
 * recommendation is grounded in verifiable reality before any causal or
 * interventional reasoning is applied. The layers are ordered from most
 * certain (observed events) to least certain (predicted learning), which
 * prevents higher-layer speculation from contaminating the factual base.
 */

// ─── Layer 1: Reality ────────────────────────────────────────────────

/**
 * Build the verifiable event log for an account. Only events that can be
 * corroborated by a system record (CRM timestamp, email metadata, content
 * exposure log, access change, or scheduled follow-up) are emitted.
 */
function buildRealityLayer(account: TerritoryAccount): SpinoredAnalysis["layer1_reality"] {
  const events: { type: string; date: string; detail: string }[] = [];

  if (account.lastInteraction) {
    events.push({
      type: "visit",
      date: account.lastInteraction,
      detail: `Last recorded interaction with ${account.hcpName} (${account.specialty}).`,
    });
  }

  if (account.lastContentShown) {
    events.push({
      type: "content_exposure",
      date: account.lastContentShown,
      detail: `Approved content last shown to HCP on this date.`,
    });
  }

  if (account.recommendedAction) {
    events.push({
      type: "follow_up",
      date: account.recommendedAction.expectedOutcome
        ? new Date().toISOString()
        : new Date().toISOString(),
      detail: `Pending next-best action: ${account.recommendedAction.action} (channel: ${account.recommendedAction.permittedChannel}).`,
    });
  }

  // Funnel-state transitions are system-recorded events.
  events.push({
    type: "funnel_state",
    date: account.lastInteraction || new Date().toISOString(),
    detail: `Account currently recorded in funnel state "${account.funnelState}".`,
  });

  // Barrier identification is a verifiable system classification.
  if (account.barrier !== "none") {
    events.push({
      type: "barrier_identified",
      date: account.lastInteraction || new Date().toISOString(),
      detail:
        account.barrierDetail ||
        `Barrier classified as "${account.barrier}".`,
    });
  }

  // Reason codes are verifiable tags attached to the account.
  for (const code of account.reasonCodes) {
    events.push({
      type: "reason_code",
      date: account.lastInteraction || new Date().toISOString(),
      detail: `Reason code recorded: ${code}.`,
    });
  }

  return { events };
}

// ─── Layer 2: State ──────────────────────────────────────────────────

const FUNNEL_STATE_DESCRIPTIONS: Record<HCPFunnelState, string> = {
  eligible: "HCP meets eligibility criteria but has not been screened into the relevant population yet.",
  relevant_population: "HCP is confirmed within the relevant patient population but no information gap has been surfaced.",
  info_gap: "A specific information gap has been identified; no access opportunity has been acted on yet.",
  access_opportunity: "An access opportunity exists but no engagement attempt has been recorded.",
  engagement_attempted: "At least one engagement attempt has been made but no meaningful interaction has occurred.",
  meaningful_interaction: "A meaningful interaction has occurred but approved content has not yet been consumed.",
  content_consumed: "Approved content has been consumed but no barrier has been formally identified.",
  barrier_identified: "A barrier has been identified but has not yet been addressed.",
  barrier_addressed: "The identified barrier has been addressed but treatment consideration has not begun.",
  treatment_consideration: "HCP is considering treatment but no patient has been initiated yet.",
  patient_initiation: "At least one patient has been initiated but persistence has not been confirmed.",
  persistence: "Patients are persisting on therapy; the account is in a maintenance state.",
};

function buildStateLayer(account: TerritoryAccount): SpinoredAnalysis["layer2_state"] {
  const evidence: string[] = [
    `Funnel state: ${account.funnelState}.`,
    `Primary barrier: ${account.barrier}.`,
    `Priority score: ${account.priorityScore.toFixed(2)}.`,
  ];

  if (account.barrierDetail) {
    evidence.push(`Barrier detail: ${account.barrierDetail}`);
  }
  if (account.lastInteraction) {
    evidence.push(`Last interaction: ${account.lastInteraction}`);
  }
  if (account.channelPreference) {
    evidence.push(`Channel preference: ${account.channelPreference}`);
  }

  return {
    currentState: FUNNEL_STATE_DESCRIPTIONS[account.funnelState],
    evidence,
  };
}

// ─── Layer 3: Cause ──────────────────────────────────────────────────

const BARRIER_ROOT_CAUSES: Record<BarrierType, string> = {
  awareness: "HCP is unaware of the therapy or its indication for the relevant patient population.",
  scientific_understanding: "HCP lacks the scientific or clinical data required to evaluate the therapy.",
  patient_eligibility: "Eligible patients are not being identified or screened by the practice.",
  formulary: "Formulary or payer access restrictions prevent prescribing.",
  diagnosis_testing: "Required diagnosis or testing workflows are not in place to confirm eligibility.",
  referral_pathway: "No established referral pathway exists between the HCP and the required specialist.",
  reimbursement: "Reimbursement uncertainty is deterring the practice from initiating therapy.",
  office_workflow: "Office workflow does not support the administrative steps required for initiation.",
  treatment_initiation: "HCP is willing but has not initiated any patients yet.",
  persistence: "Patients are initiating but not persisting on therapy beyond the early treatment phase.",
  access: "Physical or system access to the HCP or decision-maker is blocked.",
  none: "No barrier has been identified; the account is progressing as expected.",
};

function buildCauseLayer(account: TerritoryAccount): SpinoredAnalysis["layer3_cause"] {
  const contributingFactors: string[] = [];

  if (account.unmetInfoNeed > 0.5) {
    contributingFactors.push(
      `High unmet information need (N_i=${account.unmetInfoNeed.toFixed(2)}) is amplifying the barrier.`,
    );
  }
  if (account.accessProbability < 0.4) {
    contributingFactors.push(
      `Low access probability (A_i=${account.accessProbability.toFixed(2)}) limits the ability to address the barrier directly.`,
    );
  }
  if (account.operationalFriction > 0.5) {
    contributingFactors.push(
      `High operational friction (F_i=${account.operationalFriction.toFixed(2)}) is slowing barrier resolution.`,
    );
  }
  if (account.uncertaintyRisk > 0.5) {
    contributingFactors.push(
      `Elevated uncertainty risk (U_i=${account.uncertaintyRisk.toFixed(2)}) means the root cause may be incompletely understood.`,
    );
  }
  if (account.expectedResponsiveness < 0.4) {
    contributingFactors.push(
      `Low expected responsiveness (R_i=${account.expectedResponsiveness.toFixed(2)}) reduces the likelihood that outreach will surface the true cause.`,
    );
  }
  if (contributingFactors.length === 0) {
    contributingFactors.push("No compounding factors detected; the barrier is the dominant cause of the current state.");
  }

  return {
    rootCause: BARRIER_ROOT_CAUSES[account.barrier],
    contributingFactors,
  };
}

// ─── Layer 4: Intervention ───────────────────────────────────────────

/**
 * Determine the smallest permitted action likely to change the account state.
 * The action is drawn from the account's recommended next-best action when
 * available, otherwise derived from the barrier and funnel state.
 */
function buildInterventionLayer(account: TerritoryAccount): SpinoredAnalysis["layer4_intervention"] {
  const alternatives: string[] = [];

  if (account.recommendedAction) {
    const nba = account.recommendedAction;
    alternatives.push(
      `Larger action: ${nba.action} via ${nba.permittedChannel} (~${nba.estimatedTimeMin} min, autonomy class ${nba.autonomyClass}).`,
    );
    alternatives.push(
      `Disprove-evidence check: ${nba.evidenceThatWouldDisprove}`,
    );

    return {
      smallestAction: nba.action,
      permitted: nba.autonomyClass <= 2,
      alternatives,
    };
  }

  // Derive a minimal action from the barrier when no NBA is recorded.
  const derived = deriveMinimalAction(account);
  alternatives.push("Schedule a brief in-person visit to re-confirm the barrier classification.");
  alternatives.push("Send approved summary content via the HCP's preferred channel.");

  return {
    smallestAction: derived.action,
    permitted: derived.permitted,
    alternatives,
  };
}

function deriveMinimalAction(
  account: TerritoryAccount,
): { action: string; permitted: boolean } {
  switch (account.barrier) {
    case "awareness":
      return { action: "Share approved one-page therapy summary.", permitted: true };
    case "scientific_understanding":
      return { action: "Deliver approved efficacy/safety data slide.", permitted: true };
    case "patient_eligibility":
      return { action: "Provide eligible-patient screening checklist.", permitted: true };
    case "formulary":
      return { action: "Share current formulary status and payer pathway summary.", permitted: true };
    case "diagnosis_testing":
      return { action: "Share approved diagnostic/testing workflow reference.", permitted: true };
    case "referral_pathway":
      return { action: "Map and share the established referral pathway.", permitted: true };
    case "reimbursement":
      return { action: "Share reimbursement support program summary.", permitted: true };
    case "office_workflow":
      return { action: "Share office workflow template for initiation.", permitted: true };
    case "treatment_initiation":
      return { action: "Review initiation steps and offer first-patient support.", permitted: true };
    case "persistence":
      return { action: "Share persistence data and adherence support resources.", permitted: true };
    case "access":
      return { action: "Request access through alternate stakeholder or channel.", permitted: false };
    case "none":
    default:
      return { action: "Confirm continued progress and schedule routine follow-up.", permitted: true };
  }
}

// ─── Layer 5: Expected Value ─────────────────────────────────────────

function buildExpectedValueLayer(account: TerritoryAccount): SpinoredAnalysis["layer5_expectedValue"] {
  const fieldHours = account.fieldTimeRequired;
  const opportunity = account.eligiblePatientOpportunity;
  const confidence = account.evidenceConfidence;

  // A simple expected-value heuristic: opportunity weighted by confidence,
  // divided by field time. Higher is better.
  const evPerHour = fieldHours > 0 ? (opportunity * confidence) / fieldHours : opportunity * confidence;

  const worthFieldTime = evPerHour > 0.15;

  const vsAlternatives = worthFieldTime
    ? `This account's expected value per field hour (${evPerHour.toFixed(3)}) exceeds the deferral threshold; prioritize over lower-EV accounts.`
    : `This account's expected value per field hour (${evPerHour.toFixed(3)}) is below the deferral threshold; consider remote channel or defer.`;

  const estimatedROI = `Opportunity ${opportunity.toFixed(2)} × confidence ${confidence.toFixed(2)} ÷ ${fieldHours.toFixed(1)} h = ${evPerHour.toFixed(3)} EV/hour.`;

  return {
    worthFieldTime,
    vsAlternatives,
    estimatedROI,
  };
}

// ─── Layer 6: Learning ───────────────────────────────────────────────

function buildLearningLayer(): SpinoredAnalysis["layer6_learning"] {
  // Learning is unknown until the intervention is executed and the outcome
  // is attributed. We record the prediction explicitly so it can be tested.
  return {
    didActionChangeAccount: false,
    predictionCorrect: false,
    whatWeLearned:
      "Pending: learning will be recorded once the intervention is executed and the outcome is attributed via attributeOutcome().",
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run the full six-layer spine-ordered analysis for a single account.
 */
export function runSpinoredAnalysis(account: TerritoryAccount): SpinoredAnalysis {
  if (!account || !account.id) {
    throw new Error("runSpinoredAnalysis: a valid account with an id is required.");
  }

  return {
    accountId: account.id,
    hcpName: account.hcpName,
    layer1_reality: buildRealityLayer(account),
    layer2_state: buildStateLayer(account),
    layer3_cause: buildCauseLayer(account),
    layer4_intervention: buildInterventionLayer(account),
    layer5_expectedValue: buildExpectedValueLayer(account),
    layer6_learning: buildLearningLayer(),
  };
}

/**
 * Run the six-layer analysis for every account in a batch.
 */
export function runSpinoredBatch(accounts: TerritoryAccount[]): SpinoredAnalysis[] {
  if (!Array.isArray(accounts)) {
    throw new Error("runSpinoredBatch: accounts must be an array.");
  }
  return accounts.map((account) => runSpinoredAnalysis(account));
}

// ─── Outcome Attribution ─────────────────────────────────────────────

/**
 * Classify the observable effect of a recommendation after it was acted upon.
 * The classification is derived from the free-text action/response/state change
 * fields using keyword signals, then mapped to a model update.
 */
function classifyObservableEffect(
  actionTaken: string,
  hcpResponse: string,
  accountStateChange: string,
): OutcomeAttribution["observableEffect"] {
  const text = `${actionTaken} ${hcpResponse} ${accountStateChange}`.toLowerCase();

  if (text.includes("incorrect") || text.includes("wrong recommendation") || text.includes("not applicable")) {
    return "recommendation_incorrect";
  }
  if (text.includes("no effect") || text.includes("no change") || text.includes("no response") || text.includes("unresponsive")) {
    return "no_effect";
  }
  if (text.includes("referral") && (text.includes("established") || text.includes("created") || text.includes("sent"))) {
    return "referral_established";
  }
  if (text.includes("workflow") && (text.includes("started") || text.includes("implemented") || text.includes("set up"))) {
    return "workflow_started";
  }
  if (text.includes("barrier") && (text.includes("resolved") || text.includes("addressed") || text.includes("removed") || text.includes("cleared"))) {
    return "barrier_resolved";
  }
  if (text.includes("progress") || text.includes("advanced") || text.includes("moved forward") || text.includes("funnel")) {
    return "account_progressed";
  }
  if (text.includes("engaged") || text.includes("meeting") || text.includes("conversation") || text.includes("agreed")) {
    return "engaged";
  }
  if (text.includes("info") && (text.includes("delivered") || text.includes("shared") || text.includes("sent") || text.includes("provided"))) {
    return "info_delivered";
  }

  return "no_effect";
}

/**
 * Produce a bounded model update from an observed effect. The update is
 * intentionally conservative: confidence deltas are small and the adjustment
 * is described in human-auditable terms rather than applied automatically.
 */
function buildModelUpdate(
  effect: OutcomeAttribution["observableEffect"],
  feature: string,
): OutcomeAttribution["modelUpdate"] {
  const POSITIVE_DELTA = 0.05;
  const NEGATIVE_DELTA = -0.05;
  const NEUTRAL_DELTA = 0;

  const positiveEffects: OutcomeAttribution["observableEffect"][] = [
    "engaged",
    "info_delivered",
    "barrier_resolved",
    "referral_established",
    "workflow_started",
    "account_progressed",
  ];

  const isPositive = positiveEffects.includes(effect);
  const isIncorrect = effect === "recommendation_incorrect";

  const confidenceDelta = isIncorrect
    ? NEGATIVE_DELTA
    : isPositive
      ? POSITIVE_DELTA
      : NEUTRAL_DELTA;

  const adjustment = isIncorrect
    ? `Decrease weight on "${feature}" — the recommendation did not match observed reality.`
    : isPositive
      ? `Increase weight on "${feature}" — the recommendation produced the predicted observable effect (${effect}).`
      : `Hold weight on "${feature}" — no observable effect; insufficient signal to adjust.`;

  return {
    feature,
    adjustment,
    confidenceDelta,
  };
}

/**
 * Track what happened after a recommendation was acted upon and produce a
 * conservative, auditable model update.
 */
export function attributeOutcome(
  recommendationId: string,
  actionTaken: string,
  hcpResponse: string,
  accountStateChange: string,
): OutcomeAttribution {
  if (!recommendationId || recommendationId.trim().length === 0) {
    throw new Error("attributeOutcome: recommendationId is required.");
  }
  if (!actionTaken || actionTaken.trim().length === 0) {
    throw new Error("attributeOutcome: actionTaken is required.");
  }

  const effect = classifyObservableEffect(actionTaken, hcpResponse, accountStateChange);
  const feature = `recommendation:${recommendationId}`;
  const modelUpdate = buildModelUpdate(effect, feature);

  return {
    recommendationId,
    actionTaken,
    hcpResponse: hcpResponse || undefined,
    accountStateChange: accountStateChange || undefined,
    observableEffect: effect,
    modelUpdate,
    capturedAt: new Date().toISOString(),
  };
}

// ─── Self-Improvement Proposal ───────────────────────────────────────

/**
 * The ordered pipeline every bounded self-improvement proposal must traverse
 * before it can reach a rollback-capable release. This sequence is recorded on
 * the proposal so reviewers can confirm no stage was skipped.
 */
export const IMPROVEMENT_PIPELINE: readonly string[] = [
  "observation",
  "hypothesis",
  "offline_simulation",
  "compliance_validation",
  "controlled_experiment",
  "measured_outcome",
  "human_approval",
  "limited_deployment",
  "rollback_capable_release",
] as const;

/**
 * Create a bounded self-improvement proposal. The proposal begins in the
 * "proposed" state with compliance and human approval explicitly unset. It is
 * rollback-capable by construction so that any downstream deployment can be
 * reverted without data loss.
 */
export function proposeImprovement(
  feature: string,
  currentBehavior: string,
  proposedChange: string,
  evidence: string,
): ImprovementProposal {
  if (!feature || feature.trim().length === 0) {
    throw new Error("proposeImprovement: feature is required.");
  }
  if (!currentBehavior || currentBehavior.trim().length === 0) {
    throw new Error("proposeImprovement: currentBehavior is required.");
  }
  if (!proposedChange || proposedChange.trim().length === 0) {
    throw new Error("proposeImprovement: proposedChange is required.");
  }
  if (!evidence || evidence.trim().length === 0) {
    throw new Error("proposeImprovement: evidence is required.");
  }

  return {
    id: nanoid(),
    feature,
    currentBehavior,
    proposedChange,
    evidence,
    simulationResult: undefined,
    complianceValidated: false,
    experimentResult: undefined,
    humanApproved: false,
    status: "proposed",
    rollbackCapable: true,
    proposedAt: new Date().toISOString(),
  };
}
