/**
 * Skill Genome — Reusable Executable Representation
 *
 * A Skill Genome is the reusable executable representation of completed work.
 * When a similar request arrives, the system retrieves the closest Skill
 * Genome rather than planning from zero.
 *
 * Maturity progression:
 *   first_occurrence → model_assisted → workflow_assisted → deterministic → reopened_experiment
 *
 * Repetition is progressively absorbed by the machine. The employee moves
 * upward into exception handling, research, mechanism discovery, system
 * improvement, and new-channel development.
 */

import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import type {
  SkillGenome,
  SkillMaturity,
  SkillTrigger,
  DagNode,
  SkillPerformance,
} from "@/types/workteleport";

// ─── Schema helpers ────────────────────────────────────────────────────

interface SkillRow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  trigger: string;
  input_schema: string;
  task_ir_template: string;
  tool_requirements: string;
  authorization_requirements: string;
  execution_dag: string;
  validation_tests: string;
  known_failure_modes: string;
  human_checkpoints: string;
  output_schema: string;
  performance_history: string;
  experiment_history: string;
  model_contribution: string;
  human_contribution: string;
  version: number;
  parent_skill_id: string | null;
  maturity: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSkill(row: SkillRow): SkillGenome {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    trigger: JSON.parse(row.trigger),
    inputSchema: JSON.parse(row.input_schema),
    taskIRTemplate: JSON.parse(row.task_ir_template),
    toolRequirements: JSON.parse(row.tool_requirements),
    authorizationRequirements: JSON.parse(row.authorization_requirements),
    executionDag: JSON.parse(row.execution_dag),
    validationTests: JSON.parse(row.validation_tests),
    knownFailureModes: JSON.parse(row.known_failure_modes),
    humanCheckpoints: JSON.parse(row.human_checkpoints),
    outputSchema: JSON.parse(row.output_schema),
    performanceHistory: JSON.parse(row.performance_history),
    experimentHistory: JSON.parse(row.experiment_history),
    modelContribution: row.model_contribution,
    humanContribution: row.human_contribution,
    version: row.version,
    parentSkillId: row.parent_skill_id || undefined,
    maturity: row.maturity as SkillMaturity,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface CreateSkillInput {
  orgId: string;
  name: string;
  description: string;
  trigger: SkillTrigger;
  inputSchema?: Record<string, unknown>;
  taskIRTemplate?: Partial<Record<string, unknown>>;
  toolRequirements?: string[];
  authorizationRequirements?: string[];
  executionDag?: DagNode[];
  validationTests?: string[];
  knownFailureModes?: string[];
  humanCheckpoints?: string[];
  outputSchema?: Record<string, unknown>;
  modelContribution?: string;
  humanContribution?: string;
  parentSkillId?: string;
}

export function createSkill(input: CreateSkillInput): SkillGenome {
  const id = `skill_${nanoid(12)}`;
  const now = new Date().toISOString();

  const skill: SkillGenome = {
    id,
    orgId: input.orgId,
    name: input.name,
    description: input.description,
    trigger: input.trigger,
    inputSchema: input.inputSchema || {},
    taskIRTemplate: input.taskIRTemplate || {},
    toolRequirements: input.toolRequirements || [],
    authorizationRequirements: input.authorizationRequirements || [],
    executionDag: input.executionDag || [],
    validationTests: input.validationTests || [],
    knownFailureModes: input.knownFailureModes || [],
    humanCheckpoints: input.humanCheckpoints || [],
    outputSchema: input.outputSchema || {},
    performanceHistory: [],
    experimentHistory: [],
    modelContribution: input.modelContribution || "",
    humanContribution: input.humanContribution || "",
    version: 1,
    parentSkillId: input.parentSkillId,
    maturity: "first_occurrence",
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  persistSkill(skill);
  return skill;
}

function persistSkill(skill: SkillGenome): void {
  getDb()
    .prepare(
      `INSERT INTO skill_genomes (
        id, org_id, name, description, trigger, input_schema,
        task_ir_template, tool_requirements, authorization_requirements,
        execution_dag, validation_tests, known_failure_modes,
        human_checkpoints, output_schema, performance_history,
        experiment_history, model_contribution, human_contribution,
        version, parent_skill_id, maturity, usage_count, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      skill.id,
      skill.orgId,
      skill.name,
      skill.description,
      JSON.stringify(skill.trigger),
      JSON.stringify(skill.inputSchema),
      JSON.stringify(skill.taskIRTemplate),
      JSON.stringify(skill.toolRequirements),
      JSON.stringify(skill.authorizationRequirements),
      JSON.stringify(skill.executionDag),
      JSON.stringify(skill.validationTests),
      JSON.stringify(skill.knownFailureModes),
      JSON.stringify(skill.humanCheckpoints),
      JSON.stringify(skill.outputSchema),
      JSON.stringify(skill.performanceHistory),
      JSON.stringify(skill.experimentHistory),
      skill.modelContribution,
      skill.humanContribution,
      skill.version,
      skill.parentSkillId || null,
      skill.maturity,
      skill.usageCount,
      skill.lastUsedAt || null,
    );
}

function updateSkill(skill: SkillGenome): void {
  getDb()
    .prepare(
      `UPDATE skill_genomes SET
        name = ?, description = ?, trigger = ?, input_schema = ?,
        task_ir_template = ?, tool_requirements = ?, authorization_requirements = ?,
        execution_dag = ?, validation_tests = ?, known_failure_modes = ?,
        human_checkpoints = ?, output_schema = ?, performance_history = ?,
        experiment_history = ?, model_contribution = ?, human_contribution = ?,
        version = ?, maturity = ?, usage_count = ?, last_used_at = ?,
        updated_at = datetime('now')
      WHERE org_id = ? AND id = ?`,
    )
    .run(
      skill.name,
      skill.description,
      JSON.stringify(skill.trigger),
      JSON.stringify(skill.inputSchema),
      JSON.stringify(skill.taskIRTemplate),
      JSON.stringify(skill.toolRequirements),
      JSON.stringify(skill.authorizationRequirements),
      JSON.stringify(skill.executionDag),
      JSON.stringify(skill.validationTests),
      JSON.stringify(skill.knownFailureModes),
      JSON.stringify(skill.humanCheckpoints),
      JSON.stringify(skill.outputSchema),
      JSON.stringify(skill.performanceHistory),
      JSON.stringify(skill.experimentHistory),
      skill.modelContribution,
      skill.humanContribution,
      skill.version,
      skill.maturity,
      skill.usageCount,
      skill.lastUsedAt || null,
      skill.orgId,
      skill.id,
    );
}

// ─── Skill Matching ────────────────────────────────────────────────────

/**
 * Find the closest matching Skill Genome for a given input.
 * Matches by trigger type and pattern.
 */
export function findMatchingSkill(
  orgId: string,
  inputType: string,
  inputContent: string,
): SkillGenome | undefined {
  const skills = listSkills(orgId);
  const lowerContent = inputContent.toLowerCase();

  // Score each skill by how well its trigger matches
  let bestMatch: SkillGenome | undefined;
  let bestScore = 0;

  for (const skill of skills) {
    let score = 0;
    if (skill.trigger.type === "email_pattern" && inputType === "email") {
      const pattern = new RegExp(skill.trigger.pattern, "i");
      if (pattern.test(lowerContent)) {
        score = 10 + skill.trigger.priority;
      }
    } else if (skill.trigger.type === "keyword") {
      if (lowerContent.includes(skill.trigger.pattern.toLowerCase())) {
        score = 5 + skill.trigger.priority;
      }
    } else if (skill.trigger.type === "attachment_type" && inputType === "attachment") {
      if (lowerContent.includes(skill.trigger.pattern.toLowerCase())) {
        score = 8 + skill.trigger.priority;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = skill;
    }
  }

  return bestMatch;
}

// ─── Maturity Progression ──────────────────────────────────────────────

/**
 * Record a performance event and potentially advance the skill's maturity.
 *
 * Maturity transitions:
 *   first_occurrence → model_assisted (after 1 use)
 *   model_assisted → workflow_assisted (after 3 uses, all successful)
 *   workflow_assisted → deterministic (after 10 uses, all successful, no human intervention)
 *   Any → reopened_experiment (if a failure occurs or conditions change)
 */
export function recordPerformance(
  orgId: string,
  skillId: string,
  performance: SkillPerformance,
): SkillGenome {
  const skill = getSkill(orgId, skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);

  skill.performanceHistory.push(performance);
  skill.performanceHistory = skill.performanceHistory.slice(-100); // keep last 100
  skill.usageCount++;
  skill.lastUsedAt = performance.executedAt;

  // Check for maturity advancement
  const recentSuccessful = skill.performanceHistory
    .slice(-10)
    .filter((p) => p.success);
  const recentHumanIntervention = skill.performanceHistory
    .slice(-10)
    .filter((p) => p.humanInterventionRequired);

  if (skill.maturity === "first_occurrence" && skill.usageCount >= 1) {
    skill.maturity = "model_assisted";
  } else if (
    skill.maturity === "model_assisted" &&
    skill.usageCount >= 3 &&
    recentSuccessful.length >= 3
  ) {
    skill.maturity = "workflow_assisted";
  } else if (
    skill.maturity === "workflow_assisted" &&
    skill.usageCount >= 10 &&
    recentSuccessful.length >= 10 &&
    recentHumanIntervention.length === 0
  ) {
    skill.maturity = "deterministic";
  } else if (!performance.success && skill.maturity === "deterministic") {
    // A failure in deterministic mode reopens as experiment
    skill.maturity = "reopened_experiment";
  }

  updateSkill(skill);
  return skill;
}

// ─── Query API ─────────────────────────────────────────────────────────

export function getSkill(orgId: string, id: string): SkillGenome | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM skill_genomes WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as SkillRow | undefined;
  return row ? rowToSkill(row) : undefined;
}

export function listSkills(orgId: string, maturity?: SkillMaturity): SkillGenome[] {
  const sql = maturity
    ? `SELECT * FROM skill_genomes WHERE org_id = ? AND maturity = ? ORDER BY usage_count DESC`
    : `SELECT * FROM skill_genomes WHERE org_id = ? ORDER BY usage_count DESC`;
  const params = maturity ? [orgId, maturity] : [orgId];
  const rows = getDb().prepare(sql).all(...params) as SkillRow[];
  return rows.map(rowToSkill);
}

export function countSkills(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM skill_genomes WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}

/**
 * Get maturity distribution for dashboard.
 */
export function getMaturityDistribution(orgId: string): Record<SkillMaturity, number> {
  const rows = getDb()
    .prepare(
      `SELECT maturity, count(*) as c FROM skill_genomes WHERE org_id = ? GROUP BY maturity`,
    )
    .all(orgId) as { maturity: string; c: number }[];
  const dist: Record<SkillMaturity, number> = {
    first_occurrence: 0,
    model_assisted: 0,
    workflow_assisted: 0,
    deterministic: 0,
    reopened_experiment: 0,
  };
  for (const row of rows) {
    dist[row.maturity as SkillMaturity] = row.c;
  }
  return dist;
}
