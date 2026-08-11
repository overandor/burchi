/**
 * Experiment Twin — Every Workflow Gets an Experimental Counterpart
 *
 * The operational workflow produces the required work.
 * The Experiment Twin asks:
 *   - Could this be completed with fewer steps?
 *   - Could a different tool perform it more reliably?
 *   - Could another employee improve the method?
 *   - Which part produces the measurable outcome?
 *   - Which steps are unnecessary historical residue?
 *   - Can a controlled permutation outperform the current process?
 *   - Can the process be externalized as a service?
 *
 * The operational workflow protects continuity.
 * The Experiment Twin attacks stagnation.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  ExperimentTwin,
  ExperimentTwinStatus,
  ExperimentTwinResult,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface TwinRow {
  id: string;
  org_id: string;
  workflow_id: string;
  skill_genome_id: string | null;
  research_question: string;
  hypothesis: string;
  permutation_type: string;
  permutation_description: string;
  control_workflow_id: string;
  experimental_workflow_id: string | null;
  success_metrics: string;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToTwin(row: TwinRow): ExperimentTwin {
  return {
    id: row.id,
    orgId: row.org_id,
    workflowId: row.workflow_id,
    skillGenomeId: row.skill_genome_id || undefined,
    researchQuestion: row.research_question,
    hypothesis: row.hypothesis,
    permutationType: row.permutation_type as ExperimentTwin["permutationType"],
    permutationDescription: row.permutation_description,
    controlWorkflowId: row.control_workflow_id,
    experimentalWorkflowId: row.experimental_workflow_id || undefined,
    successMetrics: JSON.parse(row.success_metrics),
    status: row.status as ExperimentTwinStatus,
    result: row.result ? JSON.parse(row.result) : undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CreateTwinInput {
  orgId: string;
  workflowId: string;
  skillGenomeId?: string;
  researchQuestion: string;
  hypothesis: string;
  permutationType: ExperimentTwin["permutationType"];
  permutationDescription: string;
  controlWorkflowId: string;
  successMetrics?: string[];
}

export function createExperimentTwin(input: CreateTwinInput): ExperimentTwin {
  const id = `twin_${nanoid(12)}`;
  const now = new Date().toISOString();

  const twin: ExperimentTwin = {
    id,
    orgId: input.orgId,
    workflowId: input.workflowId,
    skillGenomeId: input.skillGenomeId,
    researchQuestion: input.researchQuestion,
    hypothesis: input.hypothesis,
    permutationType: input.permutationType,
    permutationDescription: input.permutationDescription,
    controlWorkflowId: input.controlWorkflowId,
    successMetrics: input.successMetrics || ["completion_time", "success_rate", "cost"],
    status: "proposed",
    createdAt: now,
  };

  getDb()
    .prepare(
      `INSERT INTO experiment_twins (
        id, org_id, workflow_id, skill_genome_id,
        research_question, hypothesis, permutation_type,
        permutation_description, control_workflow_id,
        success_metrics, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      twin.id,
      twin.orgId,
      twin.workflowId,
      twin.skillGenomeId || null,
      twin.researchQuestion,
      twin.hypothesis,
      twin.permutationType,
      twin.permutationDescription,
      twin.controlWorkflowId,
      JSON.stringify(twin.successMetrics),
      twin.status,
    );

  return twin;
}

/**
 * Record the result of an experiment twin.
 */
export function recordTwinResult(
  orgId: string,
  twinId: string,
  result: ExperimentTwinResult,
): ExperimentTwin {
  const twin = getTwin(orgId, twinId);
  if (!twin) throw new Error(`Experiment twin not found: ${twinId}`);

  twin.result = result;
  twin.status =
    result.recommendation === "adopt" ? "validated"
    : result.recommendation === "reject" ? "falsified"
    : result.recommendation === "replicate" ? "completed"
    : "completed";
  twin.completedAt = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE experiment_twins SET
        result = ?, status = ?, completed_at = ?
      WHERE org_id = ? AND id = ?`,
    )
    .run(
      JSON.stringify(result),
      twin.status,
      twin.completedAt,
      orgId,
      twinId,
    );

  return twin;
}

// ─── Auto-generation ───────────────────────────────────────────────────

/**
 * Automatically generate experiment twin candidates for a workflow.
 * Proposes permutations based on the workflow's steps.
 */
export function proposeTwinCandidates(
  orgId: string,
  workflowId: string,
  stepCount: number,
): { permutationType: ExperimentTwin["permutationType"]; hypothesis: string; description: string }[] {
  const candidates: { permutationType: ExperimentTwin["permutationType"]; hypothesis: string; description: string }[] = [];

  if (stepCount > 3) {
    candidates.push({
      permutationType: "fewer_steps",
      hypothesis: "The workflow can be completed with fewer steps without losing quality",
      description: "Remove the least impactful step and measure if outcomes remain equivalent",
    });
  }

  candidates.push({
    permutationType: "different_tool",
    hypothesis: "A different tool configuration could complete the same step more reliably",
    description: "Swap the execution method for the most failure-prone step",
  });

  candidates.push({
    permutationType: "removed_step",
    hypothesis: "One step may be unnecessary historical residue",
    description: "Skip a step that may not contribute to the final outcome",
  });

  if (stepCount > 2) {
    candidates.push({
      permutationType: "new_combination",
      hypothesis: "Combining two steps into one could reduce execution time",
      description: "Merge consecutive steps that operate on the same data",
    });
  }

  return candidates;
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getTwin(orgId: string, id: string): ExperimentTwin | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM experiment_twins WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as TwinRow | undefined;
  return row ? rowToTwin(row) : undefined;
}

export function listTwins(
  orgId: string,
  status?: ExperimentTwinStatus,
): ExperimentTwin[] {
  const sql = status
    ? `SELECT * FROM experiment_twins WHERE org_id = ? AND status = ? ORDER BY created_at DESC`
    : `SELECT * FROM experiment_twins WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`;
  const params = status ? [orgId, status] : [orgId];
  const rows = getDb().prepare(sql).all(...params) as TwinRow[];
  return rows.map(rowToTwin);
}

export function countTwins(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM experiment_twins WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}
