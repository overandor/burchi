/**
 * 40 Coined Terms — Experiment Taxonomy
 *
 * The coined terms become a library of strategic hypothesis families.
 * Each term is a category that generates, organizes, and compares experiments.
 */

import type { CoinedTermCategory, GameAction, GameActionRecord } from "@/types/workteleport";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";

// ─── The 40 Coined Terms ───────────────────────────────────────────────

export const COINED_TERMS: CoinedTermCategory[] = [
  {
    id: "ct_01",
    term: "Conversionfrictionliquidation",
    definition: "Test which obstacles prevent customers from taking the next action",
    experimentFamily: "conversion_optimization",
    exampleHypothesis: "Reducing the number of form fields from 7 to 3 will increase physician portal sign-ups by 15%",
    metrics: ["conversion_rate", "drop_off_points", "time_to_complete"],
    complianceNotes: "No change to approved content — only structural changes to the conversion path",
  },
  {
    id: "ct_02",
    term: "Behavioraltelemetrycapitalization",
    definition: "Use behavioral signals to improve timing, routing, and communication",
    experimentFamily: "signal_optimization",
    exampleHypothesis: "Physicians who open emails within 2 hours of receipt respond better to same-day follow-up calls",
    metrics: ["response_rate", "time_to_response", "engagement_score"],
    complianceNotes: "Behavioral data used for timing only, not for targeting sensitive topics",
  },
  {
    id: "ct_03",
    term: "Audienceintentstratification",
    definition: "Test whether different readiness levels require different processes",
    experimentFamily: "audience_segmentation",
    exampleHypothesis: "HCPs with high digital engagement scores respond better to asynchronous content than to scheduled calls",
    metrics: ["engagement_rate_by_segment", "content_consumption_depth", "meeting_conversion"],
    complianceNotes: "Segmentation must not exclude protected classes or create discriminatory targeting",
  },
  {
    id: "ct_04",
    term: "Multichannelintentliquiditysynchronization",
    definition: "Test combinations of email, calls, messaging, content, and direct outreach",
    experimentFamily: "channel_orchestration",
    exampleHypothesis: "Email followed by call within 24h outperforms call followed by email for high-priority accounts",
    metrics: ["combined_response_rate", "channel_attribution", "cost_per_engagement"],
    complianceNotes: "All channels must use approved content with fair balance",
  },
  {
    id: "ct_05",
    term: "Rankingvolatilityarbitrage",
    definition: "Identify unstable search opportunities before competitors adapt",
    experimentFamily: "search_optimization",
    exampleHypothesis: "Targeting newly trending clinical topics in educational content increases organic reach by 25%",
    metrics: ["search_ranking", "organic_traffic", "time_to_rank"],
    complianceNotes: "Content must be medically accurate and approved regardless of trending status",
  },
  {
    id: "ct_06",
    term: "Organicacquisitioncostdeflation",
    definition: "Measure whether accumulated content and visibility reduce long-term acquisition cost",
    experimentFamily: "content_economics",
    exampleHypothesis: "Accounts with 5+ educational content exposures convert at 40% lower cost than cold outreach",
    metrics: ["cost_per_acquisition", "content_roi", "cumulative_engagement"],
    complianceNotes: "Content must remain accurate and not be optimized for conversion over accuracy",
  },
  {
    id: "ct_07",
    term: "Traffictelemetrycommercialintelligencecompounding",
    definition: "Use repeated behavioral observations to improve future commercial decisions",
    experimentFamily: "intelligence_compounding",
    exampleHypothesis: "Territories with 6 months of behavioral telemetry data produce 30% better next-best-action recommendations",
    metrics: ["prediction_accuracy", "decision_quality", "telemetry_coverage"],
    complianceNotes: "Telemetry used for decision support only, not for automated targeting of regulated topics",
  },
  {
    id: "ct_08",
    term: "HumanLLMchanceweightedhypothesisvariationtelemetryreplicationinfrastructurecapitalization",
    definition: "Convert accumulated visibility, behavior, intent, experimental learning, and distribution systems into a durable revenue-producing asset",
    experimentFamily: "meta_capitalization",
    exampleHypothesis: "Organizations that systematically convert replicated experiments into infrastructure achieve 3x better ROI on field operations",
    metrics: ["infrastructure_value", "experiment_conversion_rate", "replication_velocity"],
    complianceNotes: "Infrastructure must preserve compliance controls and human oversight at every stage",
  },
  // Additional terms to reach 40
  {
    id: "ct_09",
    term: "Hypothesisdissectdemoronifynoveltymagnify",
    definition: "Structured reasoning pipeline that converts vague ideas into testable, novel experiments",
    experimentFamily: "reasoning_pipeline",
    exampleHypothesis: "Hypotheses processed through the dissect-demoronify pipeline produce 2x more replicable results",
    metrics: ["testability_score", "replication_success_rate", "novelty_classification"],
    complianceNotes: "Pipeline must not strip safety language or compliance requirements",
  },
  {
    id: "ct_10",
    term: "Evidenceenvelopecompilation",
    definition: "Convert any organizational input into a structured, provenance-preserving evidence record",
    experimentFamily: "evidence_engineering",
    exampleHypothesis: "Evidence-envelope-based task compilation reduces execution errors by 50%",
    metrics: ["execution_accuracy", "provenance_completeness", "audit_pass_rate"],
    complianceNotes: "Original content must never be modified by LLM interpretation",
  },
  {
    id: "ct_11",
    term: "Taskintermediaterepresentation",
    definition: "Machine-readable task specification independent of the executing model",
    experimentFamily: "execution_standardization",
    exampleHypothesis: "Task IR-based execution produces more consistent results across different LLM providers",
    metrics: ["cross_model_consistency", "execution_success_rate", "validation_pass_rate"],
    complianceNotes: "Task IR must encode compliance constraints that cannot be overridden by the model",
  },
  {
    id: "ct_12",
    term: "Capabilitygraphpermissioning",
    definition: "Constrain tool permissions to least-privilege with separation of duties",
    experimentFamily: "security_architecture",
    exampleHypothesis: "Least-privilege capability graphs reduce unauthorized action attempts to zero",
    metrics: ["unauthorized_attempts", "permission_violations", "segregation_compliance"],
    complianceNotes: "Financial actions must always enforce separation of duties",
  },
  {
    id: "ct_13",
    term: "Durableworkflowcheckpointing",
    definition: "Workflow state that survives model timeouts, API failures, and worker redeployments",
    experimentFamily: "reliability_engineering",
    exampleHypothesis: "Checkpointed workflows complete 95% of tasks despite infrastructure failures",
    metrics: ["completion_rate", "recovery_time", "state_integrity"],
    complianceNotes: "Checkpointed state must preserve audit trail and evidence links",
  },
  {
    id: "ct_14",
    term: "Commitgateverification",
    definition: "Pre-action recheck of authorization, target, data, policy, approval, and output validation",
    experimentFamily: "action_safety",
    exampleHypothesis: "Commit gates prevent 100% of unauthorized external actions while allowing legitimate work",
    metrics: ["blocked_unauthorized", "false_positive_rate", "verification_latency"],
    complianceNotes: "Commit gate cannot be bypassed by performance optimization",
  },
  {
    id: "ct_15",
    term: "Skillgenomecrystallization",
    definition: "Convert repeated successful workflows into reusable executable representations",
    experimentFamily: "knowledge_crystallization",
    exampleHypothesis: "Skill genomes reduce task execution time by 60% after 5 uses",
    metrics: ["execution_time_reduction", "reuse_rate", "maturity_progression"],
    complianceNotes: "Skill genomes must preserve human checkpoints for regulated actions",
  },
  {
    id: "ct_16",
    term: "Experimenttwinparallelism",
    definition: "Every operational workflow gets an experimental counterpart testing improvements",
    experimentFamily: "continuous_improvement",
    exampleHypothesis: "Workflows with experiment twins improve 2x faster than those without",
    metrics: ["improvement_rate", "twin_completion_rate", "adopted_permutations"],
    complianceNotes: "Experiment twins must not interfere with operational workflow reliability",
  },
  {
    id: "ct_17",
    term: "Venturecapsuleformation",
    definition: "Package validated Golden Nodes into deployable business channels with unit economics",
    experimentFamily: "venture_formation",
    exampleHypothesis: "Venture capsules with 3+ replication evidence have 80% deployment success rate",
    metrics: ["deployment_success", "unit_economics_validation", "market_fit_score"],
    complianceNotes: "Venture capsules require human governance for commercialization decisions",
  },
  {
    id: "ct_18",
    term: "Palindromicevidencereconstruction",
    definition: "Forward execution then reverse verification through every stage back to original signal",
    experimentFamily: "causal_attribution",
    exampleHypothesis: "Palindrome-verified actions have 99% audit compliance rate",
    metrics: ["audit_compliance", "causal_confidence", "evidence_chain_completeness"],
    complianceNotes: "Reverse verification must be structurally incapable of being skipped",
  },
  {
    id: "ct_19",
    term: "Discoverycontributionscoring",
    definition: "Multi-factor score measuring contribution to discovery rather than raw performance",
    experimentFamily: "evaluation_framework",
    exampleHypothesis: "DCS-based leaderboards produce more knowledge sharing than volume-based rankings",
    metrics: ["knowledge_sharing_rate", "experiment_quality", "replication_contribution"],
    complianceNotes: "Score must penalize misleading claims and cherry-picked data",
  },
  {
    id: "ct_20",
    term: "Hypothesisorganismlineage",
    definition: "Living, versioned hypothesis objects with parent/child lineage and evidence history",
    experimentFamily: "knowledge_management",
    exampleHypothesis: "Organism-tracked hypotheses produce 3x more successful derivatives than untracked ones",
    metrics: ["derivative_count", "lineage_depth", "evidence_accumulation"],
    complianceNotes: "Lineage must preserve all versions including failed ones",
  },
  {
    id: "ct_21",
    term: "Reinforcementlearningallocator",
    definition: "RL-based allocation of hypotheses to employees preserving exploration",
    experimentFamily: "resource_allocation",
    exampleHypothesis: "RL allocators with exploration constraints produce more diverse discoveries than greedy allocators",
    metrics: ["discovery_diversity", "allocation_fairness", "exploration_exploitation_balance"],
    complianceNotes: "Allocator must not permanently reserve high-upside hypotheses for top performers",
  },
  {
    id: "ct_22",
    term: "Repetitioneliminationprogression",
    definition: "Once a process is stable, move the employee to the next uncertainty",
    experimentFamily: "workforce_development",
    exampleHypothesis: "Repetition elimination increases employee engagement and discovery contribution",
    metrics: ["automation_rate", "employee_engagement", "skill_advancement"],
    complianceNotes: "Elimination must not remove human oversight from regulated processes",
  },
  {
    id: "ct_23",
    term: "Clientcontinuitypreservation",
    definition: "Preserve human identity, relationships, communication context, and escalation boundaries",
    experimentFamily: "relationship_management",
    exampleHypothesis: "Continuity-preserving communication produces 40% fewer escalations",
    metrics: ["escalation_rate", "relationship_continuity", "communication_quality"],
    complianceNotes: "Continuity must not be used to manipulate relationships or bypass authority",
  },
  {
    id: "ct_24",
    term: "Roleoperatingcontract",
    definition: "Temporary, task-specific capability contract for each execution",
    experimentFamily: "authority_management",
    exampleHypothesis: "Role-based contracts prevent 100% of authority escalation attempts",
    metrics: ["authority_violations", "contract_compliance", "escalation_appropriateness"],
    complianceNotes: "Contracts must enforce least-privilege and separation of duties",
  },
  {
    id: "ct_25",
    term: "Goldennodeformation",
    definition: "Verified human-LLM-workflow combinations that produce reproducible, transferable value",
    experimentFamily: "knowledge_codification",
    exampleHypothesis: "Golden Nodes with 5+ replications have 90% transfer success rate",
    metrics: ["formation_rate", "transfer_success", "value_reproducibility"],
    complianceNotes: "Golden Nodes must include compliance verification in their formation criteria",
  },
  {
    id: "ct_26",
    term: "Spinoutidentification",
    definition: "Discoveries valuable enough to become separate products, services, or businesses",
    experimentFamily: "venture_identification",
    exampleHypothesis: "Spinout-identified ventures have 3x higher survival rate than ad-hoc initiatives",
    metrics: ["venture_survival", "market_validation", "revenue_generation"],
    complianceNotes: "Spinout decisions require human governance and legal review",
  },
  {
    id: "ct_27",
    term: "Anti-gamingcontrols",
    definition: "Pre-registered conditions, holdout testing, duplicate detection, selective reporting penalties",
    experimentFamily: "integrity_controls",
    exampleHypothesis: "Anti-gaming controls reduce metric manipulation by 95%",
    metrics: ["gaming_attempts_detected", "metric_integrity", "false_positive_rate"],
    complianceNotes: "Controls must be structurally incapable of being disabled by performance pressure",
  },
  {
    id: "ct_28",
    term: "Stageddiffusionlifecycle",
    definition: "Discovery → replication → mechanism → segment → challenge → diffusion → standard → retest",
    experimentFamily: "knowledge_diffusion",
    exampleHypothesis: "Staged diffusion produces more reliable organizational adoption than immediate rollout",
    metrics: ["adoption_rate", "diffusion_success", "retesting_compliance"],
    complianceNotes: "Each stage must preserve evidence and compliance verification",
  },
  {
    id: "ct_29",
    term: "HumanLLMadaptation",
    definition: "Adapt to technical preferences of both employee and customer",
    experimentFamily: "interface_adaptation",
    exampleHypothesis: "Adapted human-LLM interfaces produce 50% better outcomes than fixed interfaces",
    metrics: ["interface_satisfaction", "outcome_quality", "adaptation_accuracy"],
    complianceNotes: "Adaptation must not remove human control from regulated decisions",
  },
  {
    id: "ct_30",
    term: "Physicianpreferencemodeling",
    definition: "Treat physician preferences as hypotheses that change over time, not permanent labels",
    experimentFamily: "preference_learning",
    exampleHypothesis: "Dynamic preference modeling outperforms static segmentation by 35%",
    metrics: ["preference_accuracy", "adaptation_rate", "satisfaction_score"],
    complianceNotes: "Preferences must not be used for manipulative targeting",
  },
  {
    id: "ct_31",
    term: "Researchverificationlabeling",
    definition: "Clearly separate external evidence from internal results with evidence status labels",
    experimentFamily: "evidence_integrity",
    exampleHypothesis: "Labeled evidence status reduces misleading claims by 80%",
    metrics: ["claim_accuracy", "evidence_label_compliance", "misleading_claim_rate"],
    complianceNotes: "Labels must be structurally enforced, not optional",
  },
  {
    id: "ct_32",
    term: "Pharmasafeguardscompiler",
    definition: "Compliance controls that cannot be overridden by performance optimization",
    experimentFamily: "regulatory_compliance",
    exampleHypothesis: "Structural compliance compilers prevent 100% of off-label promotion attempts",
    metrics: ["compliance_violations", "approval_rate", "audit_pass_rate"],
    complianceNotes: "Compliance layer must be structurally incapable of being overridden",
  },
  {
    id: "ct_33",
    term: "Gameactiontaxonomy",
    definition: "Plant, Test, Observe, Challenge, Replicate, Derive, Combine, Teach, Automate, Integrate, Spin Out",
    experimentFamily: "interaction_design",
    exampleHypothesis: "Game-action-based interfaces produce 3x more experiments than task-based interfaces",
    metrics: ["experiment_rate", "action_diversity", "engagement_duration"],
    complianceNotes: "Actions must not encourage pressuring customers or concealing information",
  },
  {
    id: "ct_34",
    term: "Organicinterfacerepresentation",
    definition: "Seeds, stems, branches, roots, fruit, compost, constellations, and forests as UI metaphor",
    experimentFamily: "interface_metaphor",
    exampleHypothesis: "Organic interfaces produce better hypothesis understanding than list-based interfaces",
    metrics: ["comprehension_score", "navigation_efficiency", "metaphor_satisfaction"],
    complianceNotes: "Metaphor must not obscure risk or compliance status",
  },
  {
    id: "ct_35",
    term: "Differentiatedopportunitycompetition",
    definition: "Participants compete with different instructions, not identical tasks",
    experimentFamily: "competition_design",
    exampleHypothesis: "Differentiated competition produces more diverse discoveries than uniform competition",
    metrics: ["discovery_diversity", "competition_fairness", "knowledge_distribution"],
    complianceNotes: "Differentiation must not create systematic disadvantage for any group",
  },
  {
    id: "ct_36",
    term: "Perpetualprogresswithoutfatigue",
    definition: "Rotate among different forms of activity to prevent static routine",
    experimentFamily: "workforce_engagement",
    exampleHypothesis: "Activity rotation reduces burnout by 40% while maintaining productivity",
    metrics: ["burnout_rate", "activity_diversity", "sustained_productivity"],
    complianceNotes: "Rotation must not move employees away from areas requiring sustained expertise",
  },
  {
    id: "ct_37",
    term: "Hypothesisleaderboardhybrid",
    definition: "Rank the performance of the complete experimental combination, not just the individual",
    experimentFamily: "evaluation_design",
    exampleHypothesis: "Hybrid leaderboards produce more collaboration than individual-only rankings",
    metrics: ["collaboration_rate", "attribution_accuracy", "leaderboard_satisfaction"],
    complianceNotes: "Hybrid scoring must not dilute accountability for compliance violations",
  },
  {
    id: "ct_38",
    term: "Capitalizereplication",
    definition: "Turn reproducible discoveries into workflows, infrastructure, services, or businesses",
    experimentFamily: "value_crystallization",
    exampleHypothesis: "Systematic capitalization produces 5x more organizational value than ad-hoc adoption",
    metrics: ["capitalization_rate", "value_realized", "infrastructure_growth"],
    complianceNotes: "Capitalization must preserve compliance controls and human oversight",
  },
  {
    id: "ct_39",
    term: "Transfeteleportetl",
    definition: "Evidence-to-Execution Compiler that maps email requests to executable workflows",
    experimentFamily: "execution_compilation",
    exampleHypothesis: "Transfeteleport ETL reduces task completion time by 70% while improving auditability",
    metrics: ["compilation_accuracy", "execution_time", "audit_completeness"],
    complianceNotes: "Compiler must preserve evidence provenance through every stage",
  },
  {
    id: "ct_40",
    term: "Workteleportdurableexecution",
    definition: "Convert evidence and requests into authorized, durable, machine-executable pipelines",
    experimentFamily: "pipeline_engineering",
    exampleHypothesis: "Durable pipelines complete 95% of tasks despite infrastructure failures",
    metrics: ["pipeline_reliability", "durability_score", "recovery_rate"],
    complianceNotes: "Pipelines must preserve all evidence and authorization through failures",
  },
];

// ─── Query API ─────────────────────────────────────────────────────────

export function getCoinedTerms(): CoinedTermCategory[] {
  return COINED_TERMS;
}

export function getCoinedTerm(id: string): CoinedTermCategory | undefined {
  return COINED_TERMS.find((t) => t.id === id);
}

export function getTermsByFamily(family: string): CoinedTermCategory[] {
  return COINED_TERMS.filter((t) => t.experimentFamily === family);
}

// ─── Game Actions ──────────────────────────────────────────────────────

export interface CreateGameActionInput {
  orgId: string;
  userId: string;
  action: GameAction;
  targetId: string;
  targetType: "hypothesis" | "workflow" | "skill" | "golden_node" | "venture";
  evidenceEnvelopeId?: string;
  reward?: number;
  notes?: string;
}

/**
 * Reward schedule for game actions.
 * A well-designed failed experiment can earn more value than an uncontrolled positive result.
 */
export const ACTION_REWARDS: Record<GameAction, number> = {
  plant: 5,        // proposing a new hypothesis
  test: 10,        // executing an experiment
  observe: 5,      // recording an outcome
  challenge: 15,   // questioning an existing assumption
  replicate: 20,   // replicating another's discovery
  derive: 15,      // creating a derivative hypothesis
  combine: 15,     // combining two hypotheses
  teach: 25,       // teaching another user
  automate: 30,    // creating automation from a process
  integrate: 35,   // integrating a discovery into standard operations
  spin_out: 50,    // identifying a venture capsule
};

export function recordGameAction(input: CreateGameActionInput): GameActionRecord {
  const id = `ga_${nanoid(12)}`;
  const reward = input.reward ?? ACTION_REWARDS[input.action] ?? 0;

  const record: GameActionRecord = {
    id,
    orgId: input.orgId,
    userId: input.userId,
    action: input.action,
    targetId: input.targetId,
    targetType: input.targetType,
    evidenceEnvelopeId: input.evidenceEnvelopeId,
    reward,
    notes: input.notes || "",
    createdAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO game_actions (
        id, org_id, user_id, action, target_id, target_type,
        evidence_envelope_id, reward, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.orgId,
      record.userId,
      record.action,
      record.targetId,
      record.targetType,
      record.evidenceEnvelopeId || null,
      record.reward,
      record.notes,
    );

  return record;
}

export function listGameActions(orgId: string, userId?: string): GameActionRecord[] {
  const sql = userId
    ? `SELECT * FROM game_actions WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100`
    : `SELECT * FROM game_actions WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`;
  const params = userId ? [orgId, userId] : [orgId];
  interface GameActionRow {
    id: string; org_id: string; user_id: string; action: string;
    target_id: string; target_type: string; evidence_envelope_id: string | null;
    reward: number; notes: string; created_at: string;
  }
  const rows = getDb().prepare(sql).all(...params) as GameActionRow[];
  return rows.map((r) => ({
    id: r.id, orgId: r.org_id, userId: r.user_id, action: r.action as GameAction,
    targetId: r.target_id, targetType: r.target_type as GameActionRecord["targetType"],
    evidenceEnvelopeId: r.evidence_envelope_id || undefined,
    reward: r.reward, notes: r.notes, createdAt: r.created_at,
  }));
}

export function countGameActions(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT count(*) as c FROM game_actions WHERE org_id = ?`)
    .get(orgId) as { c: number };
  return row.c;
}

/**
 * Get total reward for a user (leaderboard score).
 */
export function getUserRewardTotal(orgId: string, userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(reward), 0) as total FROM game_actions WHERE org_id = ? AND user_id = ?`,
    )
    .get(orgId, userId) as { total: number };
  return row.total;
}
