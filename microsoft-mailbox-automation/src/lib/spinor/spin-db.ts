/**
 * SQLite-backed persistence for SPINOR OS.
 *
 * Migrated from JSON file to SQLite for serverless compatibility.
 * The JSON file was lost on every cold start because the filesystem
 * was read-only or ephemeral on Fly.io. SQLite persists to the same
 * foundry.db that all other data uses.
 */

import { createHash } from "crypto";
import { getDb } from "@/lib/db";
import {
  SPIN,
  SPINState,
  AttributionClaim,
} from "./spin";

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

interface SpinRow {
  spin_id: string;
  hypothesis_id: string | null;
  employee_owner: string | null;
  state: string;
  prior_art: string;
  contributions: string;
  modifications: string;
  experiment_ids: string;
  mission_ids: string;
  claim_ids: string;
  strategy_id: string | null;
  golden_node_id: string | null;
  replication_count: number;
  replication_territories: string;
  reverse_test: string | null;
  automation_status: string;
  evidence_tier: string;
  snapshots: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToSpin(row: SpinRow): SPIN {
  const metadata = JSON.parse(row.metadata || "{}");
  return {
    spinId: row.spin_id,
    hypothesisId: row.hypothesis_id || "",
    employeeOwner: row.employee_owner || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state as SPINState,
    priorArt: JSON.parse(row.prior_art || "{}"),
    contributions: JSON.parse(row.contributions || "[]"),
    modifications: JSON.parse(row.modifications || "[]"),
    experimentIds: JSON.parse(row.experiment_ids || "[]"),
    missionIds: JSON.parse(row.mission_ids || "[]"),
    claimIds: JSON.parse(row.claim_ids || "[]"),
    strategyId: row.strategy_id,
    goldenNodeId: row.golden_node_id,
    replicationCount: row.replication_count || 0,
    requiredReplications: metadata.requiredReplications || 3,
    automationStatus: JSON.parse(row.automation_status || "{}"),
    automationLayerId: metadata.automationLayerId || null,
    reverseTest: row.reverse_test ? JSON.parse(row.reverse_test) : null,
    snapshots: JSON.parse(row.snapshots || "[]"),
    evidenceTier: row.evidence_tier as any,
    tags: metadata.tags || [],
    claim: metadata.claim || "",
    intervention: metadata.intervention || "",
    control: metadata.control || "",
    population: metadata.population || "",
    primaryUncertainty: metadata.primaryUncertainty || "",
    complianceBoundary: metadata.complianceBoundary || "",
  } as SPIN;
}

function spinToRow(spin: SPIN): Omit<SpinRow, "created_at" | "updated_at"> {
  const metadata: Record<string, unknown> = {
    requiredReplications: (spin as any).requiredReplications ?? 3,
    automationLayerId: (spin as any).automationLayerId ?? null,
    tags: (spin as any).tags || [],
    claim: (spin as any).claim || "",
    intervention: (spin as any).intervention || "",
    control: (spin as any).control || "",
    population: (spin as any).population || "",
    primaryUncertainty: (spin as any).primaryUncertainty || "",
    complianceBoundary: (spin as any).complianceBoundary || "",
  };
  return {
    spin_id: spin.spinId,
    hypothesis_id: spin.hypothesisId || null,
    employee_owner: spin.employeeOwner || null,
    state: spin.state,
    prior_art: JSON.stringify(spin.priorArt || {}),
    contributions: JSON.stringify(spin.contributions || []),
    modifications: JSON.stringify(spin.modifications || []),
    experiment_ids: JSON.stringify(spin.experimentIds || []),
    mission_ids: JSON.stringify(spin.missionIds || []),
    claim_ids: JSON.stringify(spin.claimIds || []),
    strategy_id: spin.strategyId || null,
    golden_node_id: spin.goldenNodeId || null,
    replication_count: spin.replicationCount || 0,
    replication_territories: JSON.stringify((spin as any).replicationTerritories || []),
    reverse_test: spin.reverseTest ? JSON.stringify(spin.reverseTest) : null,
    automation_status: JSON.stringify(spin.automationStatus || {}),
    evidence_tier: spin.evidenceTier || ("observation" as any),
    snapshots: JSON.stringify(spin.snapshots || []),
    metadata: JSON.stringify(metadata),
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function saveSpin(spin: SPIN): void {
  const row = spinToRow(spin);
  const db = getDb();

  // Check if the spin already exists — use UPDATE to avoid INSERT OR REPLACE
  // which DELETEs the row first and cascades to spin_claims (ON DELETE CASCADE),
  // wiping all stored claims.
  const existing = db.prepare(`SELECT 1 FROM spin_records WHERE spin_id = ?`).get(spin.spinId);
  if (existing) {
    db.prepare(`
      UPDATE spin_records SET
        hypothesis_id = @hypothesis_id,
        employee_owner = @employee_owner,
        state = @state,
        prior_art = @prior_art,
        contributions = @contributions,
        modifications = @modifications,
        experiment_ids = @experiment_ids,
        mission_ids = @mission_ids,
        claim_ids = @claim_ids,
        strategy_id = @strategy_id,
        golden_node_id = @golden_node_id,
        replication_count = @replication_count,
        replication_territories = @replication_territories,
        reverse_test = @reverse_test,
        automation_status = @automation_status,
        evidence_tier = @evidence_tier,
        snapshots = @snapshots,
        metadata = @metadata,
        updated_at = datetime('now')
      WHERE spin_id = @spin_id
    `).run(row as any);
  } else {
    db.prepare(`
      INSERT INTO spin_records (
        spin_id, hypothesis_id, employee_owner, state,
        prior_art, contributions, modifications, experiment_ids,
        mission_ids, claim_ids, strategy_id, golden_node_id,
        replication_count, replication_territories, reverse_test,
        automation_status, evidence_tier, snapshots, metadata,
        created_at, updated_at
      ) VALUES (
        @spin_id, @hypothesis_id, @employee_owner, @state,
        @prior_art, @contributions, @modifications, @experiment_ids,
        @mission_ids, @claim_ids, @strategy_id, @golden_node_id,
        @replication_count, @replication_territories, @reverse_test,
        @automation_status, @evidence_tier, @snapshots, @metadata,
        datetime('now'), datetime('now')
      )
    `).run(row as any);
  }
}

export function loadSpin(spinId: string): SPIN | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM spin_records WHERE spin_id = ?`).get(spinId) as SpinRow | undefined;
  return row ? rowToSpin(row) : null;
}

export function loadAllSpins(): SPIN[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM spin_records ORDER BY updated_at DESC`).all() as SpinRow[];
  return rows.map(rowToSpin);
}

export function loadSpinsByState(state: SPINState): SPIN[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM spin_records WHERE state = ? ORDER BY updated_at DESC`).all(state) as SpinRow[];
  return rows.map(rowToSpin);
}

export function loadSpinsByEmployee(employeeId: string): SPIN[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM spin_records WHERE employee_owner = ? ORDER BY updated_at DESC`).all(employeeId) as SpinRow[];
  return rows.map(rowToSpin);
}

export function deleteSpin(spinId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM spin_records WHERE spin_id = ?`).run(spinId);
  db.prepare(`DELETE FROM spin_claims WHERE spin_id = ?`).run(spinId);
}

export function getSpinCount(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM spin_records`).get() as { count: number };
  return row.count;
}

export function getStateDistribution(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(`SELECT state, COUNT(*) as count FROM spin_records GROUP BY state`).all() as { state: string; count: number }[];
  const result: Record<string, number> = {};
  for (const r of rows) result[r.state] = r.count;
  return result;
}

// ---------------------------------------------------------------------------
// Claim operations
// ---------------------------------------------------------------------------

export function saveClaim(spinId: string, claim: AttributionClaim): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO spin_claims (spin_id, claim_id, claim_data)
    VALUES (?, ?, ?)
  `).run(spinId, claim.claimId, JSON.stringify(claim));

  // Update claim_ids on the spin record
  const spin = loadSpin(spinId);
  if (spin) {
    if (!spin.claimIds.includes(claim.claimId)) {
      spin.claimIds.push(claim.claimId);
    }
    saveSpin(spin);
  }
}

export function loadClaims(spinId: string): AttributionClaim[] {
  const db = getDb();
  const rows = db.prepare(`SELECT claim_data FROM spin_claims WHERE spin_id = ?`).all(spinId) as { claim_data: string }[];
  return rows.map((r) => JSON.parse(r.claim_data) as AttributionClaim);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function dbHealth(): { ok: boolean; path: string; spinCount: number; claimCount: number } {
  try {
    const spinCount = getSpinCount();
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as count FROM spin_claims`).get() as { count: number };
    return { ok: true, path: "sqlite:foundry.db", spinCount, claimCount: row.count };
  } catch (e) {
    return { ok: false, path: "sqlite:foundry.db", spinCount: 0, claimCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetDB(): void {
  const db = getDb();
  db.prepare(`DELETE FROM spin_records`).run();
  db.prepare(`DELETE FROM spin_claims`).run();
}
