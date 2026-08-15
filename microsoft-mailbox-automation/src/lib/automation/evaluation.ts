/**
 * Automation Evaluation Engine
 *
 * Calculates real NetSavings from measured outcomes — not hypothetical hours.
 * Manages the promotion ladder with degradation and rollback.
 *
 * NetSavings = HumanBaselineCost
 *            - AutomationOperatingCost
 *            - ReviewCost
 *            - CorrectionCost
 *            - ExceptionCost
 *
 * Plus quality deltas:
 *   ErrorDelta       (negative = improvement)
 *   ComplianceDelta  (negative = improvement)
 *   HumanMinutesDelta (negative = improvement)
 *
 * Promotion ladder:
 *   CANDIDATE → SHADOW → ASSISTED → SUPERVISED → VALIDATED → AUTONOMOUS
 *   with DEGRADED → ROLLBACK if measured performance falls.
 *
 * Each transition requires evidence:
 *   - SHADOW → ASSISTED: output quality ≥ 80% of human baseline
 *   - ASSISTED → SUPERVISED: net minutes saved > 0 over ≥ 10 invocations
 *   - SUPERVISED → VALIDATED: net positive over ≥ 30 invocations, error rate ≤ baseline
 *   - VALIDATED → AUTONOMOUS: net positive over ≥ 100 invocations, compliance incidents = 0
 *   - Any → DEGRADED: net savings turns negative or compliance incident occurs
 *   - DEGRADED → ROLLBACK: 3 consecutive negative outcomes
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import {
  AutomationCandidate,
  AutomationOutcome,
  AutomationStage,
  NetSavingsResult,
  AUTOMATION_CANDIDATES,
  getCandidate,
} from "./catalog";

// ─── DB Schema ─────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS automation_outcomes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  stage_at_measurement TEXT NOT NULL,
  human_minutes REAL NOT NULL,
  automation_minutes REAL NOT NULL,
  automation_operating_cost REAL NOT NULL DEFAULT 0,
  review_minutes REAL NOT NULL DEFAULT 0,
  correction_minutes REAL NOT NULL DEFAULT 0,
  exceptions INTEGER NOT NULL DEFAULT 0,
  exception_minutes REAL NOT NULL DEFAULT 0,
  output_errors INTEGER NOT NULL DEFAULT 0,
  compliance_incidents INTEGER NOT NULL DEFAULT 0,
  correct_result INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS automation_stage_history (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_outcomes_candidate
  ON automation_outcomes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_automation_stage_history_candidate
  ON automation_stage_history(candidate_id);
`;

let schemaInitialized = false;

function ensureSchema() {
  if (schemaInitialized) return;
  getDb().exec(SCHEMA);
  schemaInitialized = true;
}

// ─── Outcome Recording ─────────────────────────────────────────────────

export function recordOutcome(outcome: Omit<AutomationOutcome, "id">): AutomationOutcome {
  ensureSchema();
  const id = `ao_${nanoid(12)}`;
  getDb().prepare(`
    INSERT INTO automation_outcomes (
      id, candidate_id, recorded_at, stage_at_measurement,
      human_minutes, automation_minutes, automation_operating_cost,
      review_minutes, correction_minutes, exceptions, exception_minutes,
      output_errors, compliance_incidents, correct_result, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, outcome.candidateId, outcome.recordedAt, outcome.stageAtMeasurement,
    outcome.humanMinutes, outcome.automationMinutes, outcome.automationOperatingCost,
    outcome.reviewMinutes, outcome.correctionMinutes, outcome.exceptions, outcome.exceptionMinutes,
    outcome.outputErrors, outcome.complianceIncidents, outcome.correctResult ? 1 : 0,
    outcome.notes || null,
  );
  return { ...outcome, id };
}

export function getOutcomes(candidateId: string, limit = 100): AutomationOutcome[] {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT * FROM automation_outcomes
    WHERE candidate_id = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(candidateId, limit) as any[];
  return rows.map(rowToOutcome);
}

function rowToOutcome(row: any): AutomationOutcome {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    recordedAt: row.recorded_at,
    stageAtMeasurement: row.stage_at_measurement as AutomationStage,
    humanMinutes: row.human_minutes,
    automationMinutes: row.automation_minutes,
    automationOperatingCost: row.automation_operating_cost,
    reviewMinutes: row.review_minutes,
    correctionMinutes: row.correction_minutes,
    exceptions: row.exceptions,
    exceptionMinutes: row.exception_minutes,
    outputErrors: row.output_errors,
    complianceIncidents: row.compliance_incidents,
    correctResult: row.correct_result === 1,
    notes: row.notes || undefined,
  };
}

// ─── NetSavings Calculation ────────────────────────────────────────────

/**
 * Calculate NetSavings from measured outcomes.
 *
 * NetSavings = HumanBaselineMinutes
 *            - AutomationMinutes (compute time, not human time)
 *            - ReviewMinutes (human reviewing automation output)
 *            - CorrectionMinutes (human fixing automation errors)
 *            - ExceptionMinutes (human handling cases automation couldn't)
 *
 * This is the REAL time saved — not hypothetical.
 * It can be negative (automation costs more than it saves).
 */
export function calculateNetSavings(candidateId: string): NetSavingsResult | null {
  const candidate = getCandidate(candidateId);
  if (!candidate) return null;

  const outcomes = getOutcomes(candidateId, 200);
  if (outcomes.length === 0) {
    return {
      candidateId,
      sampleSize: 0,
      humanBaselineMinutes: candidate.humanBaseline.minutesPerInvocation,
      automationOperatingMinutes: 0,
      reviewMinutes: 0,
      correctionMinutes: 0,
      exceptionMinutes: 0,
      netMinutesSaved: 0,
      netMinutesSavedPerDay: 0,
      errorDelta: 0,
      complianceDelta: 0,
      isNetPositive: false,
      sufficientSample: false,
    };
  }

  const n = outcomes.length;
  const avgHumanBaseline = candidate.humanBaseline.minutesPerInvocation;
  const avgAutomationMinutes = outcomes.reduce((s, o) => s + o.automationMinutes, 0) / n;
  const avgReviewMinutes = outcomes.reduce((s, o) => s + o.reviewMinutes, 0) / n;
  const avgCorrectionMinutes = outcomes.reduce((s, o) => s + o.correctionMinutes, 0) / n;
  const avgExceptionMinutes = outcomes.reduce((s, o) => s + o.exceptionMinutes, 0) / n;

  // Net minutes saved = what human would have spent - what human actually spent
  // Human actual = review + correction + exception handling
  // (automationMinutes is compute time, not human time — but we track it for cost)
  const humanActualMinutes = avgReviewMinutes + avgCorrectionMinutes + avgExceptionMinutes;
  const netMinutesSaved = avgHumanBaseline - humanActualMinutes;
  const netMinutesSavedPerDay = netMinutesSaved * candidate.humanBaseline.invocationsPerDay;

  // Error delta: automation error rate vs human baseline error rate
  const automationErrorRate = outcomes.filter(o => !o.correctResult).length / n;
  const errorDelta = automationErrorRate - candidate.humanBaseline.errorRate;

  // Compliance delta: incidents per invocation vs baseline (0)
  const complianceIncidentRate = outcomes.reduce((s, o) => s + o.complianceIncidents, 0) / n;
  const complianceDelta = complianceIncidentRate; // baseline is 0

  // Sufficient sample for promotion decisions
  const sufficientSample = n >= 10;

  return {
    candidateId,
    sampleSize: n,
    humanBaselineMinutes: avgHumanBaseline,
    automationOperatingMinutes: avgAutomationMinutes,
    reviewMinutes: avgReviewMinutes,
    correctionMinutes: avgCorrectionMinutes,
    exceptionMinutes: avgExceptionMinutes,
    netMinutesSaved: Math.round(netMinutesSaved * 100) / 100,
    netMinutesSavedPerDay: Math.round(netMinutesSavedPerDay * 100) / 100,
    errorDelta: Math.round(errorDelta * 1000) / 1000,
    complianceDelta: Math.round(complianceDelta * 1000) / 1000,
    isNetPositive: netMinutesSaved > 0,
    sufficientSample,
  };
}

// ─── Promotion Ladder ──────────────────────────────────────────────────

export const PROMOTION_LADDER: AutomationStage[] = [
  "candidate", "shadow", "assisted", "supervised", "validated", "autonomous",
];

export const DEGRADATION_STAGES: AutomationStage[] = ["degraded", "rolled_back"];

/**
 * Minimum sample sizes and thresholds for each promotion.
 */
export const PROMOTION_THRESHOLDS: Record<string, {
  minSample: number;
  minNetSavings: number; // minutes per invocation
  maxErrorDelta: number; // must be ≤ this (negative = better than human)
  maxComplianceIncidents: number;
  minCorrectRate: number; // fraction of outcomes with correctResult
}> = {
  "shadow→assisted": {
    minSample: 10,
    minNetSavings: -100, // don't require net positive yet, just measuring
    maxErrorDelta: 0.20, // can be worse than human but not terrible
    maxComplianceIncidents: 0,
    minCorrectRate: 0.80, // 80% of outputs must be correct
  },
  "assisted→supervised": {
    minSample: 10,
    minNetSavings: 1, // must save at least 1 minute per invocation
    maxErrorDelta: 0.05,
    maxComplianceIncidents: 0,
    minCorrectRate: 0.90,
  },
  "supervised→validated": {
    minSample: 30,
    minNetSavings: 2, // must save at least 2 minutes per invocation
    maxErrorDelta: 0, // must be at least as good as human
    maxComplianceIncidents: 0,
    minCorrectRate: 0.95,
  },
  "validated→autonomous": {
    minSample: 100,
    minNetSavings: 5, // must save at least 5 minutes per invocation
    maxErrorDelta: -0.02, // must be better than human
    maxComplianceIncidents: 0,
    minCorrectRate: 0.98,
  },
};

/**
 * Evaluate whether a candidate should be promoted, degraded, or rolled back.
 * Returns the recommended stage transition with evidence.
 */
export function evaluatePromotion(candidateId: string): {
  currentStage: AutomationStage;
  recommendedStage: AutomationStage;
  shouldTransition: boolean;
  reason: string;
  evidence: NetSavingsResult | null;
} {
  const candidate = getCandidate(candidateId);
  if (!candidate) {
    return {
      currentStage: "candidate",
      recommendedStage: "candidate",
      shouldTransition: false,
      reason: "Candidate not found",
      evidence: null,
    };
  }

  const savings = calculateNetSavings(candidateId);
  const outcomes = getOutcomes(candidateId, 200);
  const currentStage = candidate.stage;

  // ─── Check for degradation ─────────────────────────────────────
  if (savings && outcomes.length >= 3) {
    // Check last 3 outcomes for consecutive negative net savings
    const last3 = outcomes.slice(0, 3);
    const allNegative = last3.every(o => {
      const humanActual = o.reviewMinutes + o.correctionMinutes + o.exceptionMinutes;
      return candidate.humanBaseline.minutesPerInvocation - humanActual < 0;
    });

    // Compliance incident → immediate degradation
    const hasComplianceIncident = outcomes.some(o => o.complianceIncidents > 0);
    if (hasComplianceIncident && !DEGRADATION_STAGES.includes(currentStage)) {
      return {
        currentStage,
        recommendedStage: "degraded",
        shouldTransition: true,
        reason: "Compliance incident detected — automatic degradation for safety review.",
        evidence: savings,
      };
    }

    // 3 consecutive negative outcomes → degrade
    if (allNegative && currentStage !== "degraded" && currentStage !== "rolled_back") {
      return {
        currentStage,
        recommendedStage: "degraded",
        shouldTransition: true,
        reason: "3 consecutive negative net-savings outcomes — performance degraded.",
        evidence: savings,
      };
    }

    // Already degraded → check for rollback
    if (currentStage === "degraded") {
      if (allNegative) {
        return {
          currentStage,
          recommendedStage: "rolled_back",
          shouldTransition: true,
          reason: "Continued negative outcomes while degraded — rolling back to human-only.",
          evidence: savings,
        };
      }
      // Recovered — can go back to previous stage
      if (savings.isNetPositive && savings.sufficientSample) {
        return {
          currentStage,
          recommendedStage: "supervised",
          shouldTransition: true,
          reason: "Performance recovered — returning to supervised stage.",
          evidence: savings,
        };
      }
    }
  }

  // ─── Check for promotion ───────────────────────────────────────
  if (!savings || !savings.sufficientSample) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Insufficient sample (${savings?.sampleSize || 0} outcomes, need ≥ 10).`,
      evidence: savings,
    };
  }

  const correctRate = outcomes.filter(o => o.correctResult).length / outcomes.length;
  const currentIdx = PROMOTION_LADDER.indexOf(currentStage);
  const nextStage = PROMOTION_LADDER[currentIdx + 1];

  if (!nextStage) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: "Already at highest stage (autonomous).",
      evidence: savings,
    };
  }

  const thresholdKey = `${currentStage}→${nextStage}`;
  const threshold = PROMOTION_THRESHOLDS[thresholdKey];

  if (!threshold) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `No promotion threshold defined for ${thresholdKey}.`,
      evidence: savings,
    };
  }

  if (savings.sampleSize < threshold.minSample) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Need ${threshold.minSample} outcomes, have ${savings.sampleSize}.`,
      evidence: savings,
    };
  }

  if (savings.netMinutesSaved < threshold.minNetSavings) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Net savings ${savings.netMinutesSaved}min < required ${threshold.minNetSavings}min.`,
      evidence: savings,
    };
  }

  if (savings.errorDelta > threshold.maxErrorDelta) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Error delta ${savings.errorDelta} > threshold ${threshold.maxErrorDelta}.`,
      evidence: savings,
    };
  }

  if (savings.complianceDelta > threshold.maxComplianceIncidents) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Compliance incidents ${savings.complianceDelta} > threshold ${threshold.maxComplianceIncidents}.`,
      evidence: savings,
    };
  }

  if (correctRate < threshold.minCorrectRate) {
    return {
      currentStage,
      recommendedStage: currentStage,
      shouldTransition: false,
      reason: `Correct rate ${(correctRate * 100).toFixed(0)}% < required ${(threshold.minCorrectRate * 100).toFixed(0)}%.`,
      evidence: savings,
    };
  }

  return {
    currentStage,
    recommendedStage: nextStage,
    shouldTransition: true,
    reason: `Meets all thresholds for ${thresholdKey}: ${savings.sampleSize} outcomes, ${savings.netMinutesSaved}min net savings, ${(correctRate * 100).toFixed(0)}% correct rate.`,
    evidence: savings,
  };
}

/**
 * Execute a stage transition and log it.
 */
export function transitionStage(
  candidateId: string,
  toStage: AutomationStage,
  reason: string,
  evidenceSummary?: string,
): void {
  ensureSchema();
  const candidate = getCandidate(candidateId);
  if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

  const fromStage = candidate.stage;
  getDb().prepare(`
    INSERT INTO automation_stage_history (id, candidate_id, from_stage, to_stage, changed_at, reason, evidence_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `ash_${nanoid(12)}`,
    candidateId,
    fromStage,
    toStage,
    new Date().toISOString(),
    reason,
    evidenceSummary || null,
  );

  // Update candidate stage in memory (catalog is the source of truth)
  candidate.stage = toStage;
  candidate.stageChangedAt = new Date().toISOString();
  candidate.stageChangeReason = reason;
}

export function getStageHistory(candidateId: string): {
  id: string;
  fromStage: string;
  toStage: string;
  changedAt: string;
  reason: string;
  evidenceSummary?: string;
}[] {
  ensureSchema();
  return getDb().prepare(`
    SELECT * FROM automation_stage_history
    WHERE candidate_id = ?
    ORDER BY changed_at DESC
  `).all(candidateId) as any[];
}

// ─── Full Catalog Evaluation ───────────────────────────────────────────

export interface CatalogEvaluation {
  candidateId: string;
  candidateName: string;
  chain: string;
  stage: AutomationStage;
  outcomes: number;
  netSavings: NetSavingsResult | null;
  promotion: ReturnType<typeof evaluatePromotion>;
}

export function evaluateAllCandidates(): CatalogEvaluation[] {
  return AUTOMATION_CANDIDATES.map(c => {
    const outcomes = getOutcomes(c.id, 200);
    const netSavings = calculateNetSavings(c.id);
    const promotion = evaluatePromotion(c.id);
    return {
      candidateId: c.id,
      candidateName: c.name,
      chain: c.chain,
      stage: c.stage,
      outcomes: outcomes.length,
      netSavings,
      promotion,
    };
  });
}
