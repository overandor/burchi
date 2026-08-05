/**
 * Territory Scorer — priority scoring, barrier classification, and
 * next-best-action generation for a Gilead field territory.
 *
 * Implements the priority formula:
 *   P_i = (E_i * N_i * A_i * R_i * C_i) / (T_i + F_i + U_i)
 *
 * where:
 *   E = eligiblePatientOpportunity   N = unmetInfoNeed
 *   A = accessProbability            R = expectedResponsiveness
 *   C = evidenceConfidence           T = fieldTimeRequired (hours)
 *   F = operationalFriction          U = uncertaintyRisk
 *
 * The raw score is normalized to a 0–100 scale via a soft-saturation
 * function so that the output is bounded and comparable across accounts.
 */

import { nanoid } from "nanoid";
import {
  TerritoryAccount,
  TerritoryOpportunityMap,
  HCPFunnelState,
  BarrierType,
  NextBestAction,
} from "@/types";

// ─── Constants ──────────────────────────────────────────────────────

/** Accounts with a priority score at or above this threshold are "high priority". */
const HIGH_PRIORITY_THRESHOLD = 50;

/** Accounts whose funnel state has not advanced past this set are "stalled". */
const STALLED_STATES: ReadonlySet<HCPFunnelState> = new Set([
  "eligible",
  "relevant_population",
  "info_gap",
  "access_opportunity",
  "barrier_identified",
]);

/** Minimum denominator to avoid division-by-zero. */
const MIN_DENOMINATOR = 0.01;

/**
 * Scaling constant applied before the soft-saturation normalization.
 *
 * The raw numerator is a product of five 0–1 probabilities, so it is
 * inherently small (typically 0.01–0.30). This constant widens the
 * practical range so that strong accounts land in the 50–80 band and
 * weak accounts stay in single digits, making the 0–100 scale useful
 * for prioritization and thresholding.
 */
const SCORE_SCALE = 10;

// ─── 1. Priority Score ──────────────────────────────────────────────

/**
 * Calculate the normalized priority score (0–100) for a single account.
 *
 * Uses P_i = (E * N * A * R * C) / (T + F + U) then maps the raw value
 * through a soft-saturation function `100 * x / (1 + x)` so the result
 * is always bounded in [0, 100).
 */
export function calculatePriorityScore(account: TerritoryAccount): number {
  const {
    eligiblePatientOpportunity: E,
    unmetInfoNeed: N,
    accessProbability: A,
    expectedResponsiveness: R,
    evidenceConfidence: C,
    fieldTimeRequired: T,
    operationalFriction: F,
    uncertaintyRisk: U,
  } = account;

  const numerator = E * N * A * R * C;
  const denominator = Math.max(T + F + U, MIN_DENOMINATOR);
  const raw = numerator / denominator;

  // Soft-saturation normalization: maps [0, ∞) → [0, 100).
  // The SCORE_SCALE constant widens the practical range (see comment above).
  const scaled = raw * SCORE_SCALE;
  const normalized = (100 * scaled) / (1 + scaled);

  // Clamp to guarantee a valid 0–100 range even with edge-case inputs.
  return Math.max(0, Math.min(100, Number(normalized.toFixed(2))));
}

// ─── 2. Barrier Classification ──────────────────────────────────────

/**
 * Classify the limiting barrier for an account based on its funnel state
 * and scoring components.
 *
 * If the account already carries a non-"none" barrier that is consistent
 * with its funnel position, that barrier is respected. Otherwise the
 * barrier is inferred from the funnel state and the weakest scoring
 * dimension.
 */
export function classifyBarrier(account: TerritoryAccount): BarrierType {
  const { funnelState, barrier, barrierDetail } = account;

  // Respect an explicitly-set barrier when it is informative.
  if (barrier && barrier !== "none") {
    return barrier;
  }

  // Infer from funnel state.
  switch (funnelState) {
    case "eligible":
    case "relevant_population":
      // Very early — the HCP may not even be aware of the therapy area.
      return "awareness";

    case "info_gap":
      // The HCP is in the relevant population but lacks disease/therapy
      // knowledge. Check whether the gap is about testing/diagnosis or
      // general scientific understanding.
      if (
        barrierDetail &&
        /test|diagnos|screen|biomarker/i.test(barrierDetail)
      ) {
        return "diagnosis_testing";
      }
      return "scientific_understanding";

    case "access_opportunity":
      // Access is the explicit blocker at this stage.
      return "access";

    case "engagement_attempted":
      // We tried to engage but did not get a meaningful interaction.
      // The limiting factor is usually office workflow or access.
      if (account.accessProbability < 0.4) {
        return "access";
      }
      return "office_workflow";

    case "meaningful_interaction":
    case "content_consumed":
      // We have engaged; the remaining barrier is usually patient
      // eligibility or referral pathway.
      if (
        barrierDetail &&
        /referr|pathway|network|specialist/i.test(barrierDetail)
      ) {
        return "referral_pathway";
      }
      return "patient_eligibility";

    case "barrier_identified":
      // A barrier was explicitly identified — use the detail to classify.
      if (barrierDetail) {
        if (/formular|payer|cover|tier/i.test(barrierDetail)) {
          return "formulary";
        }
        if (/reimburs|cost|copay|financial/i.test(barrierDetail)) {
          return "reimbursement";
        }
        if (/workflow|staff|time|schedule/i.test(barrierDetail)) {
          return "office_workflow";
        }
        if (/test|diagnos|screen|biomarker/i.test(barrierDetail)) {
          return "diagnosis_testing";
        }
        if (/referr|pathway|network/i.test(barrierDetail)) {
          return "referral_pathway";
        }
      }
      return "office_workflow";

    case "barrier_addressed":
      // Barrier addressed but not yet prescribing — likely formulary or
      // reimbursement at the point of initiation.
      if (account.eligiblePatientOpportunity > 0.6) {
        return "formulary";
      }
      return "reimbursement";

    case "treatment_consideration":
      // HCP is considering the therapy — initiation is the hurdle.
      return "treatment_initiation";

    case "patient_initiation":
      // Patients are being started — persistence is the next risk.
      return "persistence";

    case "persistence":
      return "persistence";

    default:
      return "none";
  }
}

// ─── 3. Next-Best-Action Generation ─────────────────────────────────

/**
 * Generate the smallest permitted next-best action for an account.
 *
 * The action is chosen based on the account's funnel state and classified
 * barrier. Each action includes a rationale, the responsible field role,
 * the permitted channel, an estimated time, the expected outcome, a
 * confidence level, evidence that would disprove the recommendation, and
 * an autonomy class (1 = fully autonomous, 4 = human-only).
 */
export function generateNextBestAction(
  account: TerritoryAccount,
): NextBestAction {
  const barrier = classifyBarrier(account);
  const score = calculatePriorityScore(account);

  return nbaForState(account, barrier, score);
}

/**
 * Internal: map (funnelState, barrier, score) → a concrete NextBestAction.
 */
function nbaForState(
  account: TerritoryAccount,
  barrier: BarrierType,
  score: number,
): NextBestAction {
  const { funnelState, hcpName, specialty } = account;

  // ── Early funnel: build awareness / close info gaps ───────────────
  if (
    funnelState === "eligible" ||
    funnelState === "relevant_population"
  ) {
    return {
      action: "Send approved disease-awareness one-pager via email",
      rationale: `${hcpName} (${specialty}) is in the eligible population but has no recorded engagement. The smallest permitted step is a low-risk email with approved awareness content to test responsiveness.`,
      fieldRole: "field_representative",
      permittedChannel: "email",
      estimatedTimeMin: 10,
      expectedOutcome:
        "HCP opens the content or replies, moving the account to info_gap or engagement_attempted.",
      confidenceLevel: 0.55,
      evidenceThatWouldDisprove:
        "HCP explicitly opts out of communications or the email bounces, indicating wrong contact details.",
      autonomyClass: 2,
    };
  }

  if (funnelState === "info_gap") {
    if (barrier === "diagnosis_testing") {
      return {
        action:
          "Share approved diagnostic-criteria reference card and offer a remote call to walk through testing protocol",
        rationale: `${hcpName} has an information gap centered on diagnosis/testing. Providing the approved diagnostic reference is the smallest step that directly addresses the barrier.`,
        fieldRole: "field_representative",
        permittedChannel: "email",
        estimatedTimeMin: 15,
        expectedOutcome:
          "HCP acknowledges the testing criteria or requests a deeper scientific discussion, advancing to access_opportunity or meaningful_interaction.",
        confidenceLevel: 0.6,
        evidenceThatWouldDisprove:
          "HCP reports they already follow the referenced testing protocol, meaning the gap is elsewhere.",
        autonomyClass: 2,
      };
    }
    return {
      action:
        "Send approved scientific monograph covering the unmet information need",
      rationale: `${hcpName} is in the relevant population with a scientific-understanding gap. An approved monograph is the smallest permitted content delivery.`,
      fieldRole: "field_representative",
      permittedChannel: "email",
      estimatedTimeMin: 12,
      expectedOutcome:
        "HCP consumes the content and moves to content_consumed or requests a discussion.",
      confidenceLevel: 0.58,
      evidenceThatWouldDisprove:
        "HCP reports they are already familiar with the monograph content, indicating the info gap is misclassified.",
      autonomyClass: 2,
    };
  }

  if (funnelState === "access_opportunity" || barrier === "access") {
    return {
      action: "Request an in-person appointment through the office manager",
      rationale: `${hcpName} has an access barrier (accessProbability=${account.accessProbability.toFixed(
        2,
      )}). The smallest step that can resolve access is a scheduled in-person visit; remote channels have already proven insufficient.`,
      fieldRole: "field_representative",
      permittedChannel: "in_person",
      estimatedTimeMin: 45,
      expectedOutcome:
        "An in-person meeting is granted, moving the account to engagement_attempted or meaningful_interaction.",
      confidenceLevel: 0.45,
      evidenceThatWouldDisprove:
        "The office confirms a no-see policy for all representatives, meaning the access barrier is structural and not solvable by scheduling.",
      autonomyClass: 3,
    };
  }

  if (funnelState === "engagement_attempted") {
    if (barrier === "office_workflow") {
      return {
        action:
          "Call the office to identify the best contact person and preferred communication window",
        rationale: `Prior engagement attempts with ${hcpName} did not yield a meaningful interaction. The barrier appears to be office workflow. Identifying the right contact and timing is the smallest diagnostic step.`,
        fieldRole: "field_representative",
        permittedChannel: "phone",
        estimatedTimeMin: 15,
        expectedOutcome:
          "A workflow-compatible contact or time slot is identified, enabling a successful engagement.",
        confidenceLevel: 0.5,
        evidenceThatWouldDisprove:
          "The office states the HCP has no interest in the therapy area, indicating an awareness barrier rather than workflow.",
        autonomyClass: 2,
      };
    }
    return {
      action:
        "Send a concise, personalized email referencing the prior touchpoint and offering a 15-minute remote discussion",
      rationale: `${hcpName} was engaged but without a meaningful interaction. A low-friction remote offer is the smallest re-engagement step.`,
      fieldRole: "field_representative",
      permittedChannel: "email",
      estimatedTimeMin: 15,
      expectedOutcome:
        "HCP accepts the remote discussion, advancing to meaningful_interaction.",
      confidenceLevel: 0.48,
      evidenceThatWouldDisprove:
        "HCP does not respond within 10 business days, suggesting the channel or messaging is ineffective.",
      autonomyClass: 2,
    };
  }

  if (funnelState === "meaningful_interaction") {
    return {
      action:
        "Send a follow-up email with approved content tailored to the topic discussed",
      rationale: `${hcpName} had a meaningful interaction. Reinforcing the discussion with approved content is the smallest step to move toward content_consumed.`,
      fieldRole: "field_representative",
      permittedChannel: "email",
      estimatedTimeMin: 15,
      expectedOutcome:
        "HCP consumes the follow-up content and advances to content_consumed or treatment_consideration.",
      confidenceLevel: 0.62,
      evidenceThatWouldDisprove:
        "HCP reports the follow-up content contradicts what was discussed, indicating a capture error.",
      autonomyClass: 2,
    };
  }

  if (funnelState === "content_consumed") {
    return {
      action:
        "Schedule a remote call to discuss patient eligibility criteria and referral pathway",
      rationale: `${hcpName} has consumed content. The next smallest step is a focused remote discussion on eligibility and referral to move toward treatment consideration.`,
      fieldRole: "field_representative",
      permittedChannel: "phone",
      estimatedTimeMin: 30,
      expectedOutcome:
        "HCP agrees on eligibility criteria and a referral pathway, advancing to barrier_addressed or treatment_consideration.",
      confidenceLevel: 0.55,
      evidenceThatWouldDisprove:
        "HCP states they have no eligible patients, meaning the eligiblePatientOpportunity score is overstated.",
      autonomyClass: 3,
    };
  }

  if (funnelState === "barrier_identified") {
    switch (barrier) {
      case "formulary":
        return {
          action:
            "Route a market-access inquiry to the Market Access team to confirm formulary status and provide HCP with coverage details",
          rationale: `${hcpName}'s barrier is formulary/coverage. The smallest permitted step is an internal escalation to Market Access to obtain accurate coverage information before re-engaging.`,
          fieldRole: "market_access",
          permittedChannel: "internal",
          estimatedTimeMin: 20,
          expectedOutcome:
            "Market Access confirms formulary status and provides approved coverage talking points, enabling a barrier_addressed transition.",
          confidenceLevel: 0.65,
          evidenceThatWouldDisprove:
            "Market Access reports the product is on formulary with no restrictions, meaning the barrier is misclassified.",
          autonomyClass: 2,
        };
      case "reimbursement":
        return {
          action:
            "Send approved patient-assistance program information to the HCP's office",
          rationale: `${hcpName}'s barrier is reimbursement. Providing approved patient-assistance information is the smallest permitted step.`,
          fieldRole: "field_representative",
          permittedChannel: "email",
          estimatedTimeMin: 15,
          expectedOutcome:
            "HCP's office acknowledges the assistance program and moves to barrier_addressed.",
          confidenceLevel: 0.58,
          evidenceThatWouldDisprove:
            "The office reports patients are fully insured with no copay concerns, meaning reimbursement is not the true barrier.",
          autonomyClass: 2,
        };
      case "referral_pathway":
        return {
          action:
            "Offer an in-person meeting to map the referral pathway and identify key stakeholders",
          rationale: `${hcpName}'s barrier is the referral pathway. This requires a stakeholder-mapping discussion that is best conducted in person.`,
          fieldRole: "field_representative",
          permittedChannel: "in_person",
          estimatedTimeMin: 45,
          expectedOutcome:
            "A referral pathway is mapped and agreed, moving the account to barrier_addressed.",
          confidenceLevel: 0.5,
          evidenceThatWouldDisprove:
            "HCP reports referrals are not relevant to their practice model, meaning the barrier is misclassified.",
          autonomyClass: 3,
        };
      default:
        return {
          action:
            "Schedule an in-person visit to discuss and resolve the identified barrier",
          rationale: `${hcpName} has an identified barrier (${barrier}). An in-person discussion is the smallest step that can directly address a non-access barrier.`,
          fieldRole: "field_representative",
          permittedChannel: "in_person",
          estimatedTimeMin: 45,
          expectedOutcome:
            "The barrier is resolved or narrowed, advancing to barrier_addressed.",
          confidenceLevel: 0.5,
          evidenceThatWouldDisprove:
            "HCP states the barrier no longer applies, indicating the funnel state is stale.",
          autonomyClass: 3,
        };
    }
  }

  if (funnelState === "barrier_addressed") {
    return {
      action:
        "Schedule an in-person clinical discussion to support treatment consideration",
      rationale: `${hcpName}'s barrier has been addressed. The next step is a clinical discussion to move toward treatment consideration — this requires in-person engagement given the therapeutic complexity.`,
      fieldRole: "field_representative",
      permittedChannel: "in_person",
      estimatedTimeMin: 60,
      expectedOutcome:
        "HCP moves to treatment_consideration and begins evaluating patients for initiation.",
      confidenceLevel: 0.55,
      evidenceThatWouldDisprove:
        "HCP states they are not interested in the therapy class, meaning the account should be deprioritized.",
      autonomyClass: 4,
    };
  }

  if (funnelState === "treatment_consideration") {
    return {
      action:
        "Provide approved patient-initiation resources and offer to support the first patient evaluation",
      rationale: `${hcpName} is considering treatment. The smallest permitted step is providing initiation resources and offering support for the first patient, reducing initiation friction.`,
      fieldRole: "field_representative",
      permittedChannel: "in_person",
      estimatedTimeMin: 45,
      expectedOutcome:
        "HCP initiates the first patient, advancing to patient_initiation.",
      confidenceLevel: 0.6,
      evidenceThatWouldDisprove:
        "HCP reports no eligible patients are currently under consideration, meaning the opportunity score is overstated.",
      autonomyClass: 3,
    };
  }

  if (funnelState === "patient_initiation") {
    return {
      action:
        "Send a persistence-support email with approved adherence resources and schedule a 30-day follow-up call",
      rationale: `${hcpName} has initiated patients. The smallest step to protect persistence is approved adherence resources plus a scheduled follow-up.`,
      fieldRole: "field_representative",
      permittedChannel: "email",
      estimatedTimeMin: 15,
      expectedOutcome:
        "Patients remain on therapy at 30 days and the account sustains persistence.",
      confidenceLevel: 0.62,
      evidenceThatWouldDisprove:
        "HCP reports all initiated patients discontinued within 30 days, indicating a persistence barrier requiring deeper intervention.",
      autonomyClass: 2,
    };
  }

  if (funnelState === "persistence") {
    return {
      action:
        "Schedule a quarterly persistence review call to monitor adherence and address any emerging barriers",
      rationale: `${hcpName} is in the persistence stage. A scheduled persistence review is the smallest step to sustain outcomes and detect early discontinuation signals.`,
      fieldRole: "field_representative",
      permittedChannel: "phone",
      estimatedTimeMin: 30,
      expectedOutcome:
        "Persistence is maintained or emerging barriers are detected early and addressed.",
      confidenceLevel: 0.6,
      evidenceThatWouldDisprove:
        "HCP reports no patients are currently on therapy, meaning the account has regressed and should be reclassified.",
      autonomyClass: 2,
    };
  }

  // Fallback — should never be reached given exhaustive funnel coverage.
  return {
    action: "Review account in CRM and update funnel state",
    rationale: `The funnel state for ${hcpName} could not be mapped to a specific action. A manual CRM review is the safest smallest step.`,
    fieldRole: "field_representative",
    permittedChannel: "internal",
    estimatedTimeMin: 10,
    expectedOutcome: "Account funnel state is corrected and a new NBA is generated.",
    confidenceLevel: 0.3,
    evidenceThatWouldDisprove:
      "The funnel state is found to be correct and the account simply needs deferral.",
    autonomyClass: 1,
  };
}

// ─── 4. Territory Opportunity Map ───────────────────────────────────

/**
 * Aggregate all accounts into a territory-level opportunity map.
 *
 * Counts stalled and high-priority accounts, recommends a coverage split
 * (in-person / remote / defer), identifies the top barriers, and generates
 * a human-readable territory summary.
 */
export function generateOpportunityMap(
  accounts: TerritoryAccount[],
): TerritoryOpportunityMap {
  const totalAccounts = accounts.length;

  // Score every account (immutably) so the map reflects current data.
  const scored = accounts.map((a) => ({
    ...a,
    priorityScore: calculatePriorityScore(a),
    barrier: classifyBarrier(a),
  }));

  const stalledAccounts = scored.filter((a) =>
    STALLED_STATES.has(a.funnelState),
  ).length;

  const highPriorityAccounts = scored.filter(
    (a) => a.priorityScore >= HIGH_PRIORITY_THRESHOLD,
  ).length;

  // Coverage split recommendation.
  const coverage = recommendCoverageSplit(scored);

  // Top barriers by frequency.
  const barrierCounts = new Map<BarrierType, number>();
  for (const a of scored) {
    barrierCounts.set(a.barrier, (barrierCounts.get(a.barrier) ?? 0) + 1);
  }
  const topBarriers = [...barrierCounts.entries()]
    .filter(([b]) => b !== "none")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([barrier, count]) => ({ barrier, count }));

  const territorySummary = buildTerritorySummary(
    scored,
    stalledAccounts,
    highPriorityAccounts,
    coverage,
    topBarriers,
  );

  return {
    accounts: scored,
    totalAccounts,
    stalledAccounts,
    highPriorityAccounts,
    recommendedCoverage: coverage,
    topBarriers,
    territorySummary,
  };
}

/**
 * Recommend an in-person / remote / defer coverage split based on
 * per-account priority scores and channel requirements.
 */
function recommendCoverageSplit(
  accounts: TerritoryAccount[],
): { inPerson: number; remote: number; defer: number } {
  let inPerson = 0;
  let remote = 0;
  let defer = 0;

  for (const a of accounts) {
    const nba = generateNextBestAction(a);
    const channel = nba.permittedChannel;

    if (a.priorityScore < 20 && !STALLED_STATES.has(a.funnelState)) {
      // Low priority and not stalled — defer.
      defer++;
    } else if (channel === "in_person") {
      inPerson++;
    } else if (
      channel === "email" ||
      channel === "phone" ||
      channel === "remote"
    ) {
      remote++;
    } else if (channel === "internal") {
      // Internal actions are lightweight — count as remote (no field visit).
      remote++;
    } else {
      // Unknown channel — defer conservatively.
      defer++;
    }
  }

  return { inPerson, remote, defer };
}

/**
 * Build a concise, human-readable territory summary.
 */
function buildTerritorySummary(
  accounts: TerritoryAccount[],
  stalled: number,
  highPriority: number,
  coverage: { inPerson: number; remote: number; defer: number },
  topBarriers: { barrier: BarrierType; count: number }[],
): string {
  const total = accounts.length;
  const avgScore =
    total > 0
      ? (
          accounts.reduce((s, a) => s + a.priorityScore, 0) / total
        ).toFixed(1)
      : "0";

  const barrierText =
    topBarriers.length > 0
      ? topBarriers
          .map((b) => `${b.barrier.replace(/_/g, " ")} (${b.count})`)
          .join(", ")
      : "no dominant barriers";

  const territory =
    accounts[0]?.territory ?? "unassigned";

  return [
    `Territory "${territory}" contains ${total} account(s).`,
    `Average priority score: ${avgScore}/100.`,
    `${highPriority} account(s) are high priority (≥${HIGH_PRIORITY_THRESHOLD}).`,
    `${stalled} account(s) are stalled in early funnel stages.`,
    `Recommended coverage: ${coverage.inPerson} in-person, ${coverage.remote} remote, ${coverage.defer} defer.`,
    `Top barriers: ${barrierText}.`,
  ].join(" ");
}

// ─── 5. Sample Accounts ─────────────────────────────────────────────

/**
 * Generate 12 realistic sample accounts for a Gilead field territory.
 *
 * Includes a spread of specialties (Infectious Disease, Hepatology, HIV,
 * Oncology), funnel states, barriers, and scoring components so that the
 * territory map demonstrates the full range of the scoring engine.
 */
export function generateSampleAccounts(): TerritoryAccount[] {
  const territory = "NorCal-HIV-Liver-2025";

  const raw: Omit<TerritoryAccount, "id">[] = [
    // 1 — High-priority ID physician near treatment consideration.
    {
      hcpName: "Dr. Sarah Chen",
      specialty: "Infectious Disease",
      accountAffiliation: "UCSF Medical Center",
      territory,
      funnelState: "treatment_consideration",
      barrier: "treatment_initiation",
      barrierDetail:
        "HCP interested but hesitant to initiate first patient without hands-on support.",
      eligiblePatientOpportunity: 0.85,
      unmetInfoNeed: 0.6,
      accessProbability: 0.7,
      expectedResponsiveness: 0.75,
      evidenceConfidence: 0.8,
      fieldTimeRequired: 1.5,
      operationalFriction: 0.3,
      uncertaintyRisk: 0.2,
      priorityScore: 0, // computed below
      lastInteraction: "2025-07-15",
      lastContentShown: "Initiation protocol monograph v3",
      channelPreference: "in_person",
      geographicZone: "San Francisco",
      reasonCodes: ["high-volume-ID", "academic-center", "treatment-ready"],
    },
    // 2 — Hepatologist with a formulary barrier.
    {
      hcpName: "Dr. Michael Rodriguez",
      specialty: "Hepatology",
      accountAffiliation: "Stanford Health Care",
      territory,
      funnelState: "barrier_identified",
      barrier: "formulary",
      barrierDetail:
        "Product not on preferred formulary tier; HCP concerned about patient cost.",
      eligiblePatientOpportunity: 0.78,
      unmetInfoNeed: 0.45,
      accessProbability: 0.65,
      expectedResponsiveness: 0.6,
      evidenceConfidence: 0.7,
      fieldTimeRequired: 1.0,
      operationalFriction: 0.5,
      uncertaintyRisk: 0.35,
      priorityScore: 0,
      lastInteraction: "2025-07-02",
      lastContentShown: "Formulary overview deck",
      channelPreference: "email",
      geographicZone: "Palo Alto",
      reasonCodes: ["formulary-blocked", "high-HCV-volume"],
    },
    // 3 — HIV specialist, early funnel, awareness gap.
    {
      hcpName: "Dr. Jennifer Park",
      specialty: "HIV",
      accountAffiliation: "San Francisco General Hospital",
      territory,
      funnelState: "relevant_population",
      barrier: "awareness",
      barrierDetail: "No prior engagement; new to territory list.",
      eligiblePatientOpportunity: 0.72,
      unmetInfoNeed: 0.8,
      accessProbability: 0.5,
      expectedResponsiveness: 0.4,
      evidenceConfidence: 0.5,
      fieldTimeRequired: 0.5,
      operationalFriction: 0.2,
      uncertaintyRisk: 0.6,
      priorityScore: 0,
      lastInteraction: undefined,
      lastContentShown: undefined,
      channelPreference: "email",
      geographicZone: "San Francisco",
      reasonCodes: ["new-account", "high-HIV-prevalence"],
    },
    // 4 — Oncologist with an info gap on diagnosis/testing.
    {
      hcpName: "Dr. David Kim",
      specialty: "Oncology",
      accountAffiliation: "California Pacific Medical Center",
      territory,
      funnelState: "info_gap",
      barrier: "diagnosis_testing",
      barrierDetail:
        "HCP unsure about biomarker testing requirements for patient selection.",
      eligiblePatientOpportunity: 0.6,
      unmetInfoNeed: 0.85,
      accessProbability: 0.55,
      expectedResponsiveness: 0.65,
      evidenceConfidence: 0.6,
      fieldTimeRequired: 0.75,
      operationalFriction: 0.25,
      uncertaintyRisk: 0.4,
      priorityScore: 0,
      lastInteraction: "2025-06-28",
      lastContentShown: "Disease overview one-pager",
      channelPreference: "phone",
      geographicZone: "San Francisco",
      reasonCodes: ["oncology", "biomarker-gap"],
    },
    // 5 — ID physician, engagement attempted but office workflow barrier.
    {
      hcpName: "Dr. Emily Watson",
      specialty: "Infectious Disease",
      accountAffiliation: "Kaiser Permanente SF",
      territory,
      funnelState: "engagement_attempted",
      barrier: "office_workflow",
      barrierDetail:
        "Office manager difficult to reach; no standard rep visit window.",
      eligiblePatientOpportunity: 0.68,
      unmetInfoNeed: 0.5,
      accessProbability: 0.35,
      expectedResponsiveness: 0.45,
      evidenceConfidence: 0.55,
      fieldTimeRequired: 2.0,
      operationalFriction: 0.7,
      uncertaintyRisk: 0.5,
      priorityScore: 0,
      lastInteraction: "2025-07-10",
      lastContentShown: "Email follow-up after dropped call",
      channelPreference: "phone",
      geographicZone: "San Francisco",
      reasonCodes: ["workflow-friction", "managed-care"],
    },
    // 6 — Hepatologist, meaningful interaction achieved, follow-up needed.
    {
      hcpName: "Dr. Robert Liu",
      specialty: "Hepatology",
      accountAffiliation: "Sutter Health",
      territory,
      funnelState: "meaningful_interaction",
      barrier: "patient_eligibility",
      barrierDetail:
        "Discussed therapy; HCP unclear on which patients qualify.",
      eligiblePatientOpportunity: 0.7,
      unmetInfoNeed: 0.55,
      accessProbability: 0.72,
      expectedResponsiveness: 0.7,
      evidenceConfidence: 0.75,
      fieldTimeRequired: 1.0,
      operationalFriction: 0.3,
      uncertaintyRisk: 0.25,
      priorityScore: 0,
      lastInteraction: "2025-07-18",
      lastContentShown: "Efficacy data slide deck",
      channelPreference: "in_person",
      geographicZone: "Sacramento",
      reasonCodes: ["engaged", "eligibility-gap"],
    },
    // 7 — HIV specialist, content consumed, referral pathway barrier.
    {
      hcpName: "Dr. Maria Gonzalez",
      specialty: "HIV",
      accountAffiliation: "Community Health Partnership",
      territory,
      funnelState: "content_consumed",
      barrier: "referral_pathway",
      barrierDetail:
        "HCP consumed content but lacks a clear referral pathway to specialists.",
      eligiblePatientOpportunity: 0.65,
      unmetInfoNeed: 0.4,
      accessProbability: 0.6,
      expectedResponsiveness: 0.68,
      evidenceConfidence: 0.65,
      fieldTimeRequired: 1.25,
      operationalFriction: 0.4,
      uncertaintyRisk: 0.35,
      priorityScore: 0,
      lastInteraction: "2025-07-05",
      lastContentShown: "Patient case study video",
      channelPreference: "phone",
      geographicZone: "San Jose",
      reasonCodes: ["content-engaged", "referral-needed"],
    },
    // 8 — Oncologist, barrier addressed, ready for clinical discussion.
    {
      hcpName: "Dr. James Thompson",
      specialty: "Oncology",
      accountAffiliation: "UC Davis Medical Center",
      territory,
      funnelState: "barrier_addressed",
      barrier: "reimbursement",
      barrierDetail:
        "Prior reimbursement concern resolved via patient-assistance program.",
      eligiblePatientOpportunity: 0.55,
      unmetInfoNeed: 0.35,
      accessProbability: 0.68,
      expectedResponsiveness: 0.72,
      evidenceConfidence: 0.7,
      fieldTimeRequired: 1.5,
      operationalFriction: 0.3,
      uncertaintyRisk: 0.2,
      priorityScore: 0,
      lastInteraction: "2025-07-12",
      lastContentShown: "Reimbursement support guide",
      channelPreference: "in_person",
      geographicZone: "Sacramento",
      reasonCodes: ["barrier-cleared", "clinical-ready"],
    },
    // 9 — ID physician, patient initiation stage, persistence focus.
    {
      hcpName: "Dr. Linda Patel",
      specialty: "Infectious Disease",
      accountAffiliation: "Alameda Health System",
      territory,
      funnelState: "patient_initiation",
      barrier: "persistence",
      barrierDetail:
        "Two patients initiated; monitoring 30-day persistence.",
      eligiblePatientOpportunity: 0.5,
      unmetInfoNeed: 0.3,
      accessProbability: 0.75,
      expectedResponsiveness: 0.78,
      evidenceConfidence: 0.8,
      fieldTimeRequired: 0.5,
      operationalFriction: 0.2,
      uncertaintyRisk: 0.15,
      priorityScore: 0,
      lastInteraction: "2025-07-20",
      lastContentShown: "Adherence tracker brochure",
      channelPreference: "email",
      geographicZone: "Oakland",
      reasonCodes: ["patients-on-therapy", "persistence-risk"],
    },
    // 10 — Hepatologist, access opportunity, hard to reach.
    {
      hcpName: "Dr. Kevin O'Brien",
      specialty: "Hepatology",
      accountAffiliation: "John Muir Health",
      territory,
      funnelState: "access_opportunity",
      barrier: "access",
      barrierDetail: "No-see HCP; office declines unscheduled visits.",
      eligiblePatientOpportunity: 0.62,
      unmetInfoNeed: 0.6,
      accessProbability: 0.2,
      expectedResponsiveness: 0.3,
      evidenceConfidence: 0.45,
      fieldTimeRequired: 3.0,
      operationalFriction: 0.8,
      uncertaintyRisk: 0.65,
      priorityScore: 0,
      lastInteraction: "2025-05-30",
      lastContentShown: undefined,
      channelPreference: "email",
      geographicZone: "Walnut Creek",
      reasonCodes: ["no-see", "access-blocked"],
    },
    // 11 — HIV specialist, persistence stage, stable account.
    {
      hcpName: "Dr. Aisha Bello",
      specialty: "HIV",
      accountAffiliation: "East Bay AIDS Center",
      territory,
      funnelState: "persistence",
      barrier: "none",
      barrierDetail: undefined,
      eligiblePatientOpportunity: 0.45,
      unmetInfoNeed: 0.2,
      accessProbability: 0.8,
      expectedResponsiveness: 0.82,
      evidenceConfidence: 0.85,
      fieldTimeRequired: 0.5,
      operationalFriction: 0.15,
      uncertaintyRisk: 0.1,
      priorityScore: 0,
      lastInteraction: "2025-07-22",
      lastContentShown: "Quarterly persistence report",
      channelPreference: "phone",
      geographicZone: "Oakland",
      reasonCodes: ["stable", "high-persistence"],
    },
    // 12 — Oncologist, eligible but very early, low confidence.
    {
      hcpName: "Dr. Thomas Nguyen",
      specialty: "Oncology",
      accountAffiliation: "Fresno Community Medical",
      territory,
      funnelState: "eligible",
      barrier: "awareness",
      barrierDetail:
        "Newly identified account; no data on awareness or interest.",
      eligiblePatientOpportunity: 0.4,
      unmetInfoNeed: 0.7,
      accessProbability: 0.3,
      expectedResponsiveness: 0.25,
      evidenceConfidence: 0.35,
      fieldTimeRequired: 2.5,
      operationalFriction: 0.6,
      uncertaintyRisk: 0.75,
      priorityScore: 0,
      lastInteraction: undefined,
      lastContentShown: undefined,
      channelPreference: "email",
      geographicZone: "Fresno",
      reasonCodes: ["new-account", "low-confidence", "rural"],
    },
  ];

  // Assign IDs, compute scores, classify barriers, and generate NBAs.
  return raw.map((account) => {
    const id = nanoid(12);
    const base: TerritoryAccount = {
      ...account,
      id,
      priorityScore: 0,
    };
    const priorityScore = calculatePriorityScore(base);
    const barrier = classifyBarrier(base);
    const scoredAccount: TerritoryAccount = {
      ...base,
      priorityScore,
      barrier,
    };
    scoredAccount.recommendedAction = generateNextBestAction(scoredAccount);
    return scoredAccount;
  });
}
