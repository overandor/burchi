/**
 * Venture Capsule — Golden Node → Business Channel
 *
 * A Golden Node may become a Venture Capsule when it is potentially
 * valuable beyond the original department.
 *
 * The capsule contains everything needed to evaluate and deploy the
 * discovery as a new product, service, channel, team, or business.
 *
 * The system may identify and package the opportunity. It must NOT
 * autonomously create a legal entity, enter contracts, spend capital,
 * or commercialize regulated data without authorized human governance.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  VentureCapsule,
  VentureStatus,
  VentureUnitEconomics,
  VentureOwnershipEntry,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface VentureRow {
  id: string;
  org_id: string;
  golden_node_id: string | null;
  skill_genome_id: string | null;
  name: string;
  problem_solved: string;
  target_users: string;
  triggering_evidence: string;
  validated_workflow_id: string | null;
  required_integrations: string;
  compliance_requirements: string;
  outcome_evidence: string;
  replication_evidence: string;
  unit_economics: string;
  market_alternatives: string;
  deployment_package: string;
  ownership_lineage: string;
  commercialization_hypothesis: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToVenture(row: VentureRow): VentureCapsule {
  return {
    id: row.id,
    orgId: row.org_id,
    goldenNodeId: row.golden_node_id ?? undefined,
    skillGenomeId: row.skill_genome_id ?? undefined,
    name: row.name,
    problemSolved: row.problem_solved,
    targetUsers: JSON.parse(row.target_users),
    triggeringEvidence: JSON.parse(row.triggering_evidence),
    validatedWorkflowId: row.validated_workflow_id ?? undefined,
    requiredIntegrations: JSON.parse(row.required_integrations),
    complianceRequirements: JSON.parse(row.compliance_requirements),
    outcomeEvidence: JSON.parse(row.outcome_evidence),
    replicationEvidence: JSON.parse(row.replication_evidence),
    unitEconomics: JSON.parse(row.unit_economics),
    marketAlternatives: JSON.parse(row.market_alternatives),
    deploymentPackage: row.deployment_package,
    ownershipLineage: JSON.parse(row.ownership_lineage),
    commercializationHypothesis: row.commercialization_hypothesis,
    status: row.status as VentureStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CreateVentureInput {
  orgId: string;
  goldenNodeId?: string;
  skillGenomeId?: string;
  name: string;
  problemSolved: string;
  targetUsers?: string[];
  triggeringEvidence?: string[];
  validatedWorkflowId?: string;
  requiredIntegrations?: string[];
  complianceRequirements?: string[];
  outcomeEvidence?: string[];
  replicationEvidence?: string[];
  unitEconomics?: VentureUnitEconomics;
  marketAlternatives?: string[];
  deploymentPackage?: string;
  ownershipLineage?: VentureOwnershipEntry[];
  commercializationHypothesis: string;
}

export function createVentureCapsule(input: CreateVentureInput): VentureCapsule {
  const id = `vent_${nanoid(12)}`;
  const now = new Date().toISOString();

  const venture: VentureCapsule = {
    id,
    orgId: input.orgId,
    goldenNodeId: input.goldenNodeId,
    skillGenomeId: input.skillGenomeId,
    name: input.name,
    problemSolved: input.problemSolved,
    targetUsers: input.targetUsers || [],
    triggeringEvidence: input.triggeringEvidence || [],
    validatedWorkflowId: input.validatedWorkflowId,
    requiredIntegrations: input.requiredIntegrations || [],
    complianceRequirements: input.complianceRequirements || [],
    outcomeEvidence: input.outcomeEvidence || [],
    replicationEvidence: input.replicationEvidence || [],
    unitEconomics: input.unitEconomics || {
      operatingCost: 0,
      revenuePotential: 0,
      margin: 0,
      breakEvenUnits: 0,
      notes: "",
    },
    marketAlternatives: input.marketAlternatives || [],
    deploymentPackage: input.deploymentPackage || "{}",
    ownershipLineage: input.ownershipLineage || [],
    commercializationHypothesis: input.commercializationHypothesis,
    status: "identified",
    createdAt: now,
    updatedAt: now,
  };

  getDb()
    .prepare(
      `INSERT INTO venture_capsules (
        id, org_id, golden_node_id, skill_genome_id, name,
        problem_solved, target_users, triggering_evidence,
        validated_workflow_id, required_integrations,
        compliance_requirements, outcome_evidence,
        replication_evidence, unit_economics, market_alternatives,
        deployment_package, ownership_lineage,
        commercialization_hypothesis, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      venture.id,
      venture.orgId,
      venture.goldenNodeId || null,
      venture.skillGenomeId || null,
      venture.name,
      venture.problemSolved,
      JSON.stringify(venture.targetUsers),
      JSON.stringify(venture.triggeringEvidence),
      venture.validatedWorkflowId || null,
      JSON.stringify(venture.requiredIntegrations),
      JSON.stringify(venture.complianceRequirements),
      JSON.stringify(venture.outcomeEvidence),
      JSON.stringify(venture.replicationEvidence),
      JSON.stringify(venture.unitEconomics),
      JSON.stringify(venture.marketAlternatives),
      venture.deploymentPackage,
      JSON.stringify(venture.ownershipLineage),
      venture.commercializationHypothesis,
      venture.status,
    );

  return venture;
}

/**
 * Update venture status.
 */
export function updateVentureStatus(
  orgId: string,
  ventureId: string,
  status: VentureStatus,
): VentureCapsule {
  const venture = getVenture(orgId, ventureId);
  if (!venture) throw new Error(`Venture capsule not found: ${ventureId}`);

  venture.status = status;
  venture.updatedAt = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE venture_capsules SET status = ?, updated_at = datetime('now')
       WHERE org_id = ? AND id = ?`,
    )
    .run(status, orgId, ventureId);

  return venture;
}

/**
 * Add an ownership entry to a venture capsule.
 */
export function addOwnershipEntry(
  orgId: string,
  ventureId: string,
  entry: VentureOwnershipEntry,
): VentureCapsule {
  const venture = getVenture(orgId, ventureId);
  if (!venture) throw new Error(`Venture capsule not found: ${ventureId}`);

  venture.ownershipLineage.push(entry);
  getDb()
    .prepare(
      `UPDATE venture_capsules SET ownership_lineage = ?, updated_at = datetime('now')
       WHERE org_id = ? AND id = ?`,
    )
    .run(JSON.stringify(venture.ownershipLineage), orgId, ventureId);

  return venture;
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getVenture(orgId: string, id: string): VentureCapsule | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM venture_capsules WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as VentureRow | undefined;
  return row ? rowToVenture(row) : undefined;
}

export function listVentures(orgId: string, status?: VentureStatus): VentureCapsule[] {
  const sql = status
    ? `SELECT * FROM venture_capsules WHERE org_id = ? AND status = ? ORDER BY created_at DESC`
    : `SELECT * FROM venture_capsules WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`;
  const params = status ? [orgId, status] : [orgId];
  const rows = getDb().prepare(sql).all(...params) as VentureRow[];
  return rows.map(rowToVenture);
}

export function countVentures(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM venture_capsules WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}
