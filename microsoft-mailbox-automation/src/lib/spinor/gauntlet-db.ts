/**
 * SQLite persistence for gauntlet runs.
 *
 * Gauntlet runs were previously ephemeral — created in memory, returned
 * as JSON, never persisted. This module persists them to the gauntlet_runs
 * table so the full 9-stage audit trail survives across requests.
 */

import { getDb } from "@/lib/db";
import {
  GauntletRun,
  GauntletStage,
  GauntletStageRecord,
  GauntletStageStatus,
} from "@/types";

interface GauntletRow {
  run_id: string;
  hypothesis_id: string;
  spin_id: string | null;
  org_id: string;
  stages: string;
  dissected_claim: string | null;
  evidence_integrity: string | null;
  confounders: string;
  design: string | null;
  causal_reveal: string | null;
  current_stage: string;
  complete: number;
  outcome_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRun(row: GauntletRow): GauntletRun {
  return {
    runId: row.run_id,
    hypothesisId: row.hypothesis_id,
    spinId: row.spin_id || null,
    stages: JSON.parse(row.stages || "[]"),
    dissectedClaim: row.dissected_claim ? JSON.parse(row.dissected_claim) : null,
    evidenceIntegrity: row.evidence_integrity ? JSON.parse(row.evidence_integrity) : null,
    confounders: JSON.parse(row.confounders || "[]"),
    design: row.design ? JSON.parse(row.design) : null,
    causalReveal: row.causal_reveal ? JSON.parse(row.causal_reveal) : null,
    currentStage: row.current_stage as GauntletStage,
    complete: row.complete === 1,
    outcomeId: row.outcome_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as GauntletRun;
}

export function saveGauntletRun(run: GauntletRun, orgId: string = "foundry"): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO gauntlet_runs (
      run_id, hypothesis_id, spin_id, org_id,
      stages, dissected_claim, evidence_integrity, confounders,
      design, causal_reveal, current_stage, complete,
      outcome_id, updated_at
    ) VALUES (
      @run_id, @hypothesis_id, @spin_id, @org_id,
      @stages, @dissected_claim, @evidence_integrity, @confounders,
      @design, @causal_reveal, @current_stage, @complete,
      @outcome_id, datetime('now')
    )
  `).run({
    run_id: run.runId,
    hypothesis_id: run.hypothesisId,
    spin_id: (run as any).spinId || null,
    org_id: orgId,
    stages: JSON.stringify(run.stages || []),
    dissected_claim: run.dissectedClaim ? JSON.stringify(run.dissectedClaim) : null,
    evidence_integrity: run.evidenceIntegrity ? JSON.stringify(run.evidenceIntegrity) : null,
    confounders: JSON.stringify(run.confounders || []),
    design: run.design ? JSON.stringify(run.design) : null,
    causal_reveal: run.causalReveal ? JSON.stringify(run.causalReveal) : null,
    current_stage: run.currentStage,
    complete: run.complete ? 1 : 0,
    outcome_id: (run as any).outcomeId || null,
  });
}

export function loadGauntletRun(runId: string): GauntletRun | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM gauntlet_runs WHERE run_id = ?`).get(runId) as GauntletRow | undefined;
  return row ? rowToRun(row) : null;
}

export function loadGauntletRunForOutcome(outcomeId: string): GauntletRun | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM gauntlet_runs WHERE outcome_id = ?`).get(outcomeId) as GauntletRow | undefined;
  return row ? rowToRun(row) : null;
}

export function loadGauntletRunsForHypothesis(hypothesisId: string): GauntletRun[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM gauntlet_runs WHERE hypothesis_id = ? ORDER BY updated_at DESC`).all(hypothesisId) as GauntletRow[];
  return rows.map(rowToRun);
}

export function listAllGauntletRuns(limit: number = 50): GauntletRun[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM gauntlet_runs ORDER BY updated_at DESC LIMIT ?`).all(limit) as GauntletRow[];
  return rows.map(rowToRun);
}

export function linkGauntletToOutcome(runId: string, outcomeId: string): void {
  const db = getDb();
  db.prepare(`UPDATE gauntlet_runs SET outcome_id = ?, updated_at = datetime('now') WHERE run_id = ?`).run(outcomeId, runId);
}

export function getGauntletStats(): {
  total: number;
  complete: number;
  inProgress: number;
  rejected: number;
  byStage: Record<string, number>;
} {
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as c FROM gauntlet_runs`).get() as { c: number }).c;
  const complete = (db.prepare(`SELECT COUNT(*) as c FROM gauntlet_runs WHERE complete = 1`).get() as { c: number }).c;
  const rejected = (db.prepare(`SELECT COUNT(*) as c FROM gauntlet_runs WHERE current_stage = 'rejected'`).get() as { c: number }).c;

  const stageRows = db.prepare(`SELECT current_stage, COUNT(*) as c FROM gauntlet_runs GROUP BY current_stage`).all() as { current_stage: string; c: number }[];
  const byStage: Record<string, number> = {};
  for (const r of stageRows) byStage[r.current_stage] = r.c;

  return { total, complete, inProgress: total - complete - rejected, rejected, byStage };
}
