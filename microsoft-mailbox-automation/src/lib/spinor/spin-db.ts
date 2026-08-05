/**
 * SQLite persistence layer for SPINOR OS.
 *
 * Stores SPINs, their snapshots, contributions, modifications, and
 * attribution claims in a local SQLite database. Provides load/save
 * operations and a query API for the UI.
 */

// Conditional import — better-sqlite3 is a native module not available in
// serverless environments. Use a lazy require so the build doesn't fail
// when the package is absent.
let Database: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Database = require("better-sqlite3");
} catch {
  Database = null;
}
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import {
  SPIN,
  SPINState,
  SPINSnapshot,
  ContributionEntry,
  HumanModification,
  PriorArtState,
  ReverseTestSpec,
  AttributionClaim,
  AutomationStatus,
  EvidenceTier,
  ContributionRole,
} from "./spin";

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const DB_PATH = process.env.SPINOR_DB_PATH || join(tmpdir(), "spinor-os.db");

let _db: any = null;

function getDB(): any {
  if (_db) return _db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS spins (
      spin_id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL,
      employee_owner TEXT NOT NULL,
      state TEXT NOT NULL,
      evidence_tier TEXT NOT NULL,
      automation_status TEXT NOT NULL,
      replication_count INTEGER DEFAULT 0,
      required_replications INTEGER DEFAULT 3,
      strategy_id TEXT,
      golden_node_id TEXT,
      automation_layer_id TEXT,
      claim TEXT,
      intervention TEXT,
      control TEXT,
      population TEXT,
      primary_uncertainty TEXT,
      compliance_boundary TEXT,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spin_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      spin_id TEXT NOT NULL,
      state TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      reason TEXT NOT NULL,
      previous_digest TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (spin_id) REFERENCES spins(spin_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spin_claims (
      claim_id TEXT PRIMARY KEY,
      spin_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      hypothesis_id TEXT NOT NULL,
      outcome_metric TEXT,
      outcome_value REAL,
      counterfactual_estimate REAL,
      causal_effect REAL,
      confidence REAL,
      method TEXT,
      falsification_survived INTEGER,
      significance_level REAL,
      segments TEXT,
      territories TEXT,
      tested_by TEXT,
      evidence TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (spin_id) REFERENCES spins(spin_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_spins_state ON spins(state);
    CREATE INDEX IF NOT EXISTS idx_spins_hypothesis ON spins(hypothesis_id);
    CREATE INDEX IF NOT EXISTS idx_spins_employee ON spins(employee_owner);
    CREATE INDEX IF NOT EXISTS idx_snapshots_spin ON spin_snapshots(spin_id);
    CREATE INDEX IF NOT EXISTS idx_claims_spin ON spin_claims(spin_id);
  `);

  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeSpin(spin: SPIN): string {
  return JSON.stringify(spin);
}

function deserializeSpin(data: string): SPIN {
  return JSON.parse(data) as SPIN;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function saveSpin(spin: SPIN): void {
  const db = getDB();
  const data = serializeSpin(spin);

  db.prepare(`
    INSERT OR REPLACE INTO spins
      (spin_id, hypothesis_id, employee_owner, state, evidence_tier,
       automation_status, replication_count, required_replications,
       strategy_id, golden_node_id, automation_layer_id,
       claim, intervention, control, population, primary_uncertainty,
       compliance_boundary, tags, created_at, updated_at, data)
    VALUES
      (@spinId, @hypothesisId, @employeeOwner, @state, @evidenceTier,
       @automationStatus, @replicationCount, @requiredReplications,
       @strategyId, @goldenNodeId, @automationLayerId,
       @claim, @intervention, @control, @population, @primaryUncertainty,
       @complianceBoundary, @tags, @createdAt, @updatedAt, @data)
  `).run({
    spinId: spin.spinId,
    hypothesisId: spin.hypothesisId,
    employeeOwner: spin.employeeOwner,
    state: spin.state,
    evidenceTier: spin.evidenceTier,
    automationStatus: spin.automationStatus,
    replicationCount: spin.replicationCount,
    requiredReplications: spin.requiredReplications,
    strategyId: spin.strategyId,
    goldenNodeId: spin.goldenNodeId,
    automationLayerId: spin.automationLayerId,
    claim: spin.claim,
    intervention: spin.intervention,
    control: spin.control,
    population: spin.population,
    primaryUncertainty: spin.primaryUncertainty,
    complianceBoundary: spin.complianceBoundary,
    tags: JSON.stringify(spin.tags),
    createdAt: spin.createdAt,
    updatedAt: spin.updatedAt,
    data,
  });

  // Save snapshots
  const snapStmt = db.prepare(`
    INSERT OR REPLACE INTO spin_snapshots
      (snapshot_id, spin_id, state, timestamp, actor_id, actor_role,
       reason, previous_digest, content_digest, metadata)
    VALUES
      (@snapshotId, @spinId, @state, @timestamp, @actorId, @actorRole,
       @reason, @previousDigest, @contentDigest, @metadata)
  `);
  for (const snap of spin.snapshots) {
    snapStmt.run({
      snapshotId: snap.snapshotId,
      spinId: spin.spinId,
      state: snap.state,
      timestamp: snap.timestamp,
      actorId: snap.actorId,
      actorRole: snap.actorRole,
      reason: snap.reason,
      previousDigest: snap.previousDigest,
      contentDigest: snap.contentDigest,
      metadata: JSON.stringify(snap.metadata),
    });
  }
}

export function loadSpin(spinId: string): SPIN | null {
  const db = getDB();
  const row = db.prepare("SELECT data FROM spins WHERE spin_id = ?").get(spinId) as { data: string } | undefined;
  if (!row) return null;
  return deserializeSpin(row.data);
}

export function loadAllSpins(): SPIN[] {
  const db = getDB();
  const rows = db.prepare("SELECT data FROM spins ORDER BY updated_at DESC").all() as { data: string }[];
  return rows.map((r) => deserializeSpin(r.data));
}

export function loadSpinsByState(state: SPINState): SPIN[] {
  const db = getDB();
  const rows = db.prepare("SELECT data FROM spins WHERE state = ? ORDER BY updated_at DESC").all(state) as { data: string }[];
  return rows.map((r) => deserializeSpin(r.data));
}

export function loadSpinsByEmployee(employeeId: string): SPIN[] {
  const db = getDB();
  const rows = db.prepare("SELECT data FROM spins WHERE employee_owner = ? ORDER BY updated_at DESC").all(employeeId) as { data: string }[];
  return rows.map((r) => deserializeSpin(r.data));
}

export function deleteSpin(spinId: string): void {
  const db = getDB();
  db.prepare("DELETE FROM spins WHERE spin_id = ?").run(spinId);
}

export function getSpinCount(): number {
  const db = getDB();
  const row = db.prepare("SELECT COUNT(*) as count FROM spins").get() as { count: number };
  return row.count;
}

export function getStateDistribution(): Record<string, number> {
  const db = getDB();
  const rows = db.prepare("SELECT state, COUNT(*) as count FROM spins GROUP BY state").all() as { state: string; count: number }[];
  const result: Record<string, number> = {};
  for (const r of rows) result[r.state] = r.count;
  return result;
}

// ---------------------------------------------------------------------------
// Claim operations
// ---------------------------------------------------------------------------

export function saveClaim(spinId: string, claim: AttributionClaim): void {
  const db = getDB();
  db.prepare(`
    INSERT OR REPLACE INTO spin_claims
      (claim_id, spin_id, experiment_id, hypothesis_id, outcome_metric,
       outcome_value, counterfactual_estimate, causal_effect, confidence,
       method, falsification_survived, significance_level,
       segments, territories, tested_by, evidence, created_at)
    VALUES
      (@claimId, @spinId, @experimentId, @hypothesisId, @outcomeMetric,
       @outcomeValue, @counterfactualEstimate, @causalEffect, @confidence,
       @method, @falsificationSurvived, @significanceLevel,
       @segments, @territories, @testedBy, @evidence, @createdAt)
  `).run({
    claimId: claim.claimId,
    spinId,
    experimentId: claim.experimentId,
    hypothesisId: claim.hypothesisId,
    outcomeMetric: claim.outcomeMetric,
    outcomeValue: claim.outcomeValue,
    counterfactualEstimate: claim.counterfactualEstimate,
    causalEffect: claim.causalEffect,
    confidence: claim.confidence,
    method: claim.method,
    falsificationSurvived: claim.falsificationSurvived ? 1 : 0,
    significanceLevel: claim.significanceLevel,
    segments: JSON.stringify(claim.segments),
    territories: JSON.stringify(claim.territories),
    testedBy: JSON.stringify(claim.testedBy),
    evidence: JSON.stringify(claim.evidence),
    createdAt: new Date().toISOString(),
  });
}

export function loadClaims(spinId: string): AttributionClaim[] {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM spin_claims WHERE spin_id = ? ORDER BY created_at").all(spinId) as Record<string, unknown>[];
  return rows.map((r) => ({
    claimId: r.claim_id as string,
    experimentId: r.experiment_id as string,
    hypothesisId: r.hypothesis_id as string,
    outcomeMetric: r.outcome_metric as string,
    outcomeValue: r.outcome_value as number | null,
    counterfactualEstimate: r.counterfactual_estimate as number | null,
    causalEffect: r.causal_effect as number | null,
    confidence: r.confidence as number,
    method: r.method as AttributionClaim["method"],
    falsificationSurvived: !!r.falsification_survived,
    significanceLevel: r.significance_level as number,
    segments: JSON.parse(r.segments as string),
    territories: JSON.parse(r.territories as string),
    testedBy: JSON.parse(r.tested_by as string),
    evidence: JSON.parse(r.evidence as string),
  }));
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function dbHealth(): { ok: boolean; path: string; spinCount: number; claimCount: number } {
  try {
    const db = getDB();
    const spinCount = (db.prepare("SELECT COUNT(*) as c FROM spins").get() as { c: number }).c;
    const claimCount = (db.prepare("SELECT COUNT(*) as c FROM spin_claims").get() as { c: number }).c;
    return { ok: true, path: DB_PATH, spinCount, claimCount };
  } catch (e) {
    return { ok: false, path: DB_PATH, spinCount: 0, claimCount: 0 };
  }
}
