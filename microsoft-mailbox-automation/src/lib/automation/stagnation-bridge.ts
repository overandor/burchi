/**
 * SPINOR-RL Stagnation Bridge
 *
 * Connects the SPINOR-RL stagnation detector to the automation catalog.
 * When a task is flagged for automation, match it to the closest candidate
 * in the catalog, track whether automation was attempted, and measure the outcome.
 *
 * This closes the loop:
 *   1. SPINOR-RL detects a repetitive task (stagnation flag)
 *   2. Bridge matches it to an automation candidate
 *   3. If the candidate is in SHADOW or higher stage, run it
 *   4. Record the outcome (human minutes, automation minutes, errors, compliance)
 *   5. Evaluation engine calculates NetSavings
 *   6. Promotion ladder decides whether to promote, degrade, or rollback
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { AUTOMATION_CANDIDATES, getCandidate, AutomationCandidate } from "./catalog";
import { recordOutcome, calculateNetSavings, evaluatePromotion, transitionStage } from "./evaluation";

// ─── DB Schema ─────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stagnation_automation_links (
  id TEXT PRIMARY KEY,
  stagnation_flag_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  match_score REAL NOT NULL,
  match_reason TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  outcome_recorded INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stagnation_links_flag
  ON stagnation_automation_links(stagnation_flag_id);
CREATE INDEX IF NOT EXISTS idx_stagnation_links_candidate
  ON stagnation_automation_links(candidate_id);
`;

let schemaInitialized = false;

function ensureSchema() {
  if (schemaInitialized) return;
  getDb().exec(SCHEMA);
  schemaInitialized = true;
}

// ─── Matching ──────────────────────────────────────────────────────────

/**
 * Match a stagnation flag's task description to the closest automation candidate.
 * Uses keyword overlap scoring — not LLM.
 */
export function matchStagnationToCandidate(
  taskDescription: string,
): { candidate: AutomationCandidate; score: number; reason: string } | null {
  const lower = taskDescription.toLowerCase();
  let bestMatch: { candidate: AutomationCandidate; score: number; reason: string } | null = null;

  for (const candidate of AUTOMATION_CANDIDATES) {
    const score = scoreMatch(lower, candidate);
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        candidate,
        score,
        reason: `Keyword match: ${getMatchReason(lower, candidate)}`,
      };
    }
  }

  return bestMatch;
}

function scoreMatch(taskLower: string, candidate: AutomationCandidate): number {
  const keywords = extractKeywords(candidate);
  let matches = 0;
  for (const kw of keywords) {
    if (taskLower.includes(kw)) matches++;
  }
  return matches / keywords.length;
}

function extractKeywords(candidate: AutomationCandidate): string[] {
  const text = `${candidate.name} ${candidate.description} ${candidate.humanBaseline.description}`.toLowerCase();
  // Extract meaningful words (skip stopwords)
  const stopwords = new Set(["the", "a", "an", "to", "from", "and", "or", "in", "out", "for", "with", "by", "of", "is", "are", "was", "were", "be", "been", "each", "call", "after", "before", "into", "then"]);
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  return [...new Set(words.filter(w => !stopwords.has(w)))].slice(0, 15);
}

function getMatchReason(taskLower: string, candidate: AutomationCandidate): string {
  const keywords = extractKeywords(candidate);
  const matched = keywords.filter(kw => taskLower.includes(kw));
  return matched.slice(0, 5).join(", ");
}

// ─── Link Recording ────────────────────────────────────────────────────

export function linkStagnationToCandidate(
  stagnationFlagId: string,
  candidateId: string,
  score: number,
  reason: string,
): void {
  ensureSchema();
  getDb().prepare(`
    INSERT OR REPLACE INTO stagnation_automation_links (id, stagnation_flag_id, candidate_id, match_score, match_reason, linked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`sal_${nanoid(12)}`, stagnationFlagId, candidateId, score, reason, new Date().toISOString());
}

export function getLinksForCandidate(candidateId: string): any[] {
  ensureSchema();
  return getDb().prepare(`
    SELECT * FROM stagnation_automation_links
    WHERE candidate_id = ?
    ORDER BY linked_at DESC
  `).all(candidateId) as any[];
}

// ─── Outcome Recording from Stagnation ─────────────────────────────────

/**
 * Record an automation outcome when a stagnation-flagged task is automated.
 *
 * This is the closed loop:
 *   - humanMinutes: how long the human actually spent (review + correction + exceptions)
 *   - automationMinutes: compute time
 *   - correctResult: did the automation produce the right output?
 *   - complianceIncidents: any compliance issues?
 *
 * The evaluation engine will then calculate NetSavings and decide promotion.
 */
export function recordAutomationOutcome(
  candidateId: string,
  measurement: {
    humanMinutes: number;
    automationMinutes: number;
    automationOperatingCost?: number;
    reviewMinutes: number;
    correctionMinutes: number;
    exceptions: number;
    exceptionMinutes: number;
    outputErrors: number;
    complianceIncidents: number;
    correctResult: boolean;
    notes?: string;
  },
): { outcomeId: string; netSavings: ReturnType<typeof calculateNetSavings>; promotion: ReturnType<typeof evaluatePromotion> } {
  const candidate = getCandidate(candidateId);
  if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

  const outcome = recordOutcome({
    candidateId,
    recordedAt: new Date().toISOString(),
    stageAtMeasurement: candidate.stage,
    humanMinutes: measurement.humanMinutes,
    automationMinutes: measurement.automationMinutes,
    automationOperatingCost: measurement.automationOperatingCost || 0,
    reviewMinutes: measurement.reviewMinutes,
    correctionMinutes: measurement.correctionMinutes,
    exceptions: measurement.exceptions,
    exceptionMinutes: measurement.exceptionMinutes,
    outputErrors: measurement.outputErrors,
    complianceIncidents: measurement.complianceIncidents,
    correctResult: measurement.correctResult,
    notes: measurement.notes,
  });

  const netSavings = calculateNetSavings(candidateId);
  const promotion = evaluatePromotion(candidateId);

  // Auto-execute promotion if thresholds are met
  if (promotion.shouldTransition) {
    transitionStage(
      candidateId,
      promotion.recommendedStage,
      promotion.reason,
      JSON.stringify(promotion.evidence),
    );
  }

  return { outcomeId: outcome.id, netSavings, promotion };
}
