/**
 * VentureForge Factory — assesses venture potential from skill genomes,
 * generates venture candidates, and exposes scoring / criteria / progression
 * metadata for the venture pipeline.
 *
 * All functions are pure (no I/O) and deterministic aside from ID generation.
 * IDs are produced with nanoid so the factory can run in any runtime without a
 * database.  Every numeric field is validated and clamped to a sensible range.
 */

import { VentureGenome, VentureCandidate, SkillGenome } from "@/types";
import { nanoid } from "nanoid";

// ─── helpers ────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

const round = (v: number, digits = 4): number => {
  const f = Math.pow(10, digits);
  return Math.round((Number.isFinite(v) ? v : 0) * f) / f;
};

const nowISO = (): string => new Date().toISOString();

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

// ─── 1. assessVenturePotential ──────────────────────────────────────

/**
 * Assess venture potential from a skill genome.
 *
 * The assessment derives a VentureGenome from the reproducibility, cost,
 * error rate, and stated venturePotential of the skill.  Higher replication,
 * lower error rate, and lower cost all increase the venture score.
 */
export function assessVenturePotential(skill: SkillGenome): VentureGenome {
  const replicationFactor = clamp(skill.replicationCount / 20, 0, 1); // 20+ replications -> 1
  const errorPenalty = clamp(skill.errors.length / 10, 0, 1); // 10+ errors -> 1
  const costEfficiency = clamp(1 - skill.cost / 100, 0, 1); // cost in [0,100]
  const timeEfficiency = clamp(1 - skill.timeMs / 60_000, 0, 1); // 60s -> 0

  const economicValue = round(
    clamp(
      40 +
        replicationFactor * 30 +
        costEfficiency * 15 +
        timeEfficiency * 15 -
        errorPenalty * 20,
      0,
      100,
    ),
    2,
  );

  const transferability = round(
    clamp(
      0.3 +
        replicationFactor * 0.4 +
        (skill.reuseConditions.length > 0 ? 0.15 : 0) +
        (skill.humanInterventions.length === 0 ? 0.15 : 0),
      0,
      1,
    ),
    4,
  );

  const autonomy = round(
    clamp(
      1 -
        skill.humanInterventions.length / 10 -
        skill.authorityRequirements.length / 10,
      0,
      1,
    ),
    4,
  );

  const demandFrequency = round(
    clamp(
      0.4 + replicationFactor * 0.4 + (skill.reuseConditions.length / 10) * 0.2,
      0,
      1,
    ),
    4,
  );

  const exceptionRate = round(
    clamp(
      (skill.errors.length + skill.corrections.length) / 20,
      0,
      1,
    ),
    4,
  );

  const defensibility =
    skill.tools.length >= 3 && skill.validationRules.length >= 2
      ? "High — multi-tool pipeline with embedded validation creates switching cost"
      : skill.validationRules.length >= 1
        ? "Moderate — validation rules provide some moat"
        : "Low — easily replicated with standard tooling";

  const compliance =
    skill.authorityRequirements.length > 0
      ? "Requires authority-gated execution; compliance review mandatory before externalization"
      : "Standard compliance review sufficient";

  const identifiableBuyers = deriveBuyers(skill);

  const differentiation =
    skill.transformations.length >= 3
      ? "Multi-step transformation chain not available as a packaged product"
      : "Single-step transformation; differentiation depends on data access";

  const ventureScore = scoreVentureFromComponents({
    economicValue,
    transferability,
    autonomy,
    demandFrequency,
    exceptionRate,
    buyerCount: identifiableBuyers.length,
  });

  return {
    id: nanoid(),
    skillGenomeId: skill.id,
    customer: skill.trigger,
    pain: skill.outcome,
    inputContract: skill.inputs.join(", "),
    executionSystem: skill.executionDAG,
    verification: skill.validationRules.join("; ") || "outcome match against expected result",
    economicValue,
    transferability,
    defensibility,
    compliance,
    autonomy,
    demandFrequency,
    exceptionRate,
    identifiableBuyers,
    differentiation,
    ventureScore,
    status: "candidate" as const,
    createdAt: nowISO(),
  };
}

function deriveBuyers(skill: SkillGenome): string[] {
  const buyers = new Set<string>();
  const text = `${skill.trigger} ${skill.outcome} ${skill.taskIR}`.toLowerCase();
  if (text.includes("formulary") || text.includes("access")) buyers.add("Market access teams");
  if (text.includes("medical") || text.includes("information")) buyers.add("Medical affairs");
  if (text.includes("field") || text.includes("rep")) buyers.add("Field force leadership");
  if (text.includes("compliance") || text.includes("review")) buyers.add("Compliance functions");
  if (text.includes("patient") || text.includes("persistence")) buyers.add("Patient support programs");
  if (text.includes("content") || text.includes("engagement")) buyers.add("Commercial content teams");
  if (buyers.size === 0) buyers.add("Commercial operations");
  return Array.from(buyers);
}

// ─── 2. generateVentureCandidate ────────────────────────────────────

export function generateVentureCandidate(
  genome: VentureGenome,
  skill: SkillGenome,
): VentureCandidate {
  const progressionStage = deriveProgressionStage(skill, genome);
  const estimatedMarketSize = estimateMarketSize(genome);
  const estimatedTimeToMarket = estimateTimeToMarket(genome, skill);
  const riskLevel = deriveRiskLevel(genome, skill);
  const recommendation = deriveRecommendation(genome, riskLevel);

  return {
    id: nanoid(),
    ventureGenomeId: genome.id,
    name: deriveName(genome, skill),
    description: `${genome.customer} → ${genome.pain}. ${genome.differentiation}.`,
    originWorkflow: skill.executionDAG,
    progressionStage,
    evidence: buildEvidence(genome, skill),
    estimatedMarketSize,
    estimatedTimeToMarket,
    riskLevel,
    recommendation,
    createdAt: nowISO(),
  };
}

function deriveProgressionStage(
  skill: SkillGenome,
  genome: VentureGenome,
): VentureCandidate["progressionStage"] {
  if (skill.replicationCount >= 50 && genome.autonomy >= 0.7) return "independent_business";
  if (skill.replicationCount >= 30 && genome.transferability >= 0.7) return "externalizable_product";
  if (skill.replicationCount >= 20) return "cross_team_service";
  if (skill.replicationCount >= 10) return "internal_system";
  if (skill.replicationCount >= 5) return "validated_experiment";
  if (skill.replicationCount >= 2) return "skill_genome";
  if (skill.replicationCount >= 1) return "reusable_workflow";
  return "one_task";
}

function estimateMarketSize(genome: VentureGenome): number {
  // Base on buyer count, economic value, and demand frequency.
  const base = 2_000_000; // $2M floor
  const buyerMultiplier = genome.identifiableBuyers.length * 1.5;
  const valueMultiplier = genome.economicValue / 50;
  const demandMultiplier = 0.5 + genome.demandFrequency;
  return Math.round(base * buyerMultiplier * valueMultiplier * demandMultiplier);
}

function estimateTimeToMarket(genome: VentureGenome, skill: SkillGenome): number {
  // Months.  More autonomy + replication -> faster; more exceptions -> slower.
  const base = 18;
  const speedup = genome.autonomy * 6 + (skill.replicationCount / 20) * 4;
  const slowdown = genome.exceptionRate * 6;
  return Math.max(3, Math.round(base - speedup + slowdown));
}

function deriveRiskLevel(
  genome: VentureGenome,
  skill: SkillGenome,
): VentureCandidate["riskLevel"] {
  const riskScore =
    genome.exceptionRate * 0.4 +
    (skill.errors.length / 10) * 0.3 +
    (1 - genome.transferability) * 0.3;
  if (riskScore < 0.3) return "low";
  if (riskScore < 0.6) return "moderate";
  return "high";
}

function deriveRecommendation(
  genome: VentureGenome,
  riskLevel: VentureCandidate["riskLevel"],
): string {
  if (genome.ventureScore >= 75 && riskLevel !== "high") {
    return "Strong candidate — proceed to incubation with a dedicated owner and a 90-day validation sprint.";
  }
  if (genome.ventureScore >= 55) {
    return "Promising — run a paid pilot with one identifiable buyer before committing resources.";
  }
  if (genome.ventureScore >= 35) {
    return "Watch — increase replication count and reduce exception rate before externalization.";
  }
  return "Hold — keep as internal capability; venture economics not yet attractive.";
}

function deriveName(genome: VentureGenome, skill: SkillGenome): string {
  const trigger = genome.customer.split(/\s+/).slice(0, 3).join(" ");
  const outcome = genome.pain.split(/\s+/).slice(0, 2).join(" ");
  return `${trigger} → ${outcome}`.replace(/[^a-zA-Z0-9\u2192\s-]/g, "").trim() || "Venture Candidate";
}

function buildEvidence(genome: VentureGenome, skill: SkillGenome): string[] {
  return [
    `Replication count: ${skill.replicationCount}`,
    `Economic value score: ${genome.economicValue}/100`,
    `Transferability: ${round(genome.transferability * 100, 1)}%`,
    `Autonomy: ${round(genome.autonomy * 100, 1)}%`,
    `Exception rate: ${round(genome.exceptionRate * 100, 1)}%`,
    `Identifiable buyers: ${genome.identifiableBuyers.join(", ")}`,
    `Defensibility: ${genome.defensibility}`,
    `Compliance: ${genome.compliance}`,
  ];
}

// ─── 3. getVentureProgressionStages ─────────────────────────────────

export function getVentureProgressionStages(): { stage: string; description: string }[] {
  return [
    {
      stage: "one_task",
      description:
        "A single task is executed once. No reuse yet; the workflow is tacit and person-dependent.",
    },
    {
      stage: "reusable_workflow",
      description:
        "The task is encoded as a repeatable workflow that can be run again with different inputs.",
    },
    {
      stage: "skill_genome",
      description:
        "The workflow is abstracted into a skill genome with defined inputs, transformations, and validation rules.",
    },
    {
      stage: "validated_experiment",
      description:
        "The skill is tested against a counterfactual and produces a measurable, replicated effect.",
    },
    {
      stage: "internal_system",
      description:
        "The validated skill is embedded in an internal system used routinely by one team.",
    },
    {
      stage: "cross_team_service",
      description:
        "The system is offered as a service across multiple teams with consistent behavior.",
    },
    {
      stage: "externalizable_product",
      description:
        "The service is packaged for external buyers with a defined contract, pricing, and support model.",
    },
    {
      stage: "independent_business",
      description:
        "The product operates as an independent business with its own revenue, customers, and P&L.",
    },
  ];
}

// ─── 4. scoreVenture ────────────────────────────────────────────────

/**
 * Score a venture genome on a 0-100 scale using weighted criteria.
 */
export function scoreVenture(genome: VentureGenome): number {
  return scoreVentureFromComponents({
    economicValue: genome.economicValue,
    transferability: genome.transferability,
    autonomy: genome.autonomy,
    demandFrequency: genome.demandFrequency,
    exceptionRate: genome.exceptionRate,
    buyerCount: genome.identifiableBuyers.length,
  });
}

function scoreVentureFromComponents(c: {
  economicValue: number;
  transferability: number;
  autonomy: number;
  demandFrequency: number;
  exceptionRate: number;
  buyerCount: number;
}): number {
  const economic = clamp(c.economicValue / 100, 0, 1) * 30;
  const transfer = clamp(c.transferability, 0, 1) * 20;
  const autonomy = clamp(c.autonomy, 0, 1) * 15;
  const demand = clamp(c.demandFrequency, 0, 1) * 15;
  const buyers = clamp(c.buyerCount / 5, 0, 1) * 10;
  const exceptionPenalty = clamp(c.exceptionRate, 0, 1) * 10;
  // Replication depth is already baked into economicValue via the assessment,
  // so the score is fully derivable from genome fields alone.
  const raw = economic + transfer + autonomy + demand + buyers - exceptionPenalty;

  return round(clamp(raw, 0, 100), 2);
}

// ─── 5. generateSampleVentures ──────────────────────────────────────

interface SampleSkillSeed {
  trigger: string;
  outcome: string;
  taskIR: string;
  inputs: string[];
  tools: string[];
  transformations: string[];
  validationRules: string[];
  humanInterventions: string[];
  authorityRequirements: string[];
  timeMs: number;
  cost: number;
  errors: string[];
  corrections: string[];
  replicationCount: number;
  reuseConditions: string[];
}

const SAMPLE_SKILL_SEEDS: SampleSkillSeed[] = [
  {
    trigger: "Formulary pathway briefing request from oncology account",
    outcome: "Increased new-patient initiation rate",
    taskIR: "Generate a compliant 5-minute formulary pathway briefing tailored to the account's formulary status.",
    inputs: ["account_id", "formulary_status", "indication", "product_matrix"],
    tools: ["formulary_db", "content_library", "compliance_checker", "slide_renderer"],
    transformations: [
      "lookup formulary status",
      "select approved content modules",
      "compose briefing flow",
      "render slides",
    ],
    validationRules: [
      "all content modules are approved",
      "no off-label claims",
      "formulary status matches db",
    ],
    humanInterventions: [],
    authorityRequirements: [],
    timeMs: 12_000,
    cost: 8,
    errors: [],
    corrections: [],
    replicationCount: 42,
    reuseConditions: ["account has formulary data", "indication is approved"],
  },
  {
    trigger: "HCP inbox-open window detected",
    outcome: "Higher content engagement and click-through",
    taskIR: "Select and dispatch the optimal approved content piece within the detected open window.",
    inputs: ["hcp_id", "open_window", "prior_engagement", "content_library"],
    tools: ["engagement_tracker", "content_library", "scheduler", "dispatch_api"],
    transformations: [
      "score content relevance",
      "pick top content",
      "schedule dispatch",
      "send",
    ],
    validationRules: ["content is approved", "dispatch within window", "frequency cap respected"],
    humanInterventions: [],
    authorityRequirements: [],
    timeMs: 3_500,
    cost: 2,
    errors: ["window missed once"],
    corrections: ["added retry with fallback window"],
    replicationCount: 60,
    reuseConditions: ["hcp has engagement history", "content library has approved items"],
  },
  {
    trigger: "Specialty patient day-30 persistence check",
    outcome: "Improved 90-day persistence via peer-comparison nudge",
    taskIR: "Generate a compliant peer-comparison persistence reminder and send to the patient.",
    inputs: ["patient_id", "cohort_persistence_data", "consent_state"],
    tools: ["persistence_db", "consent_manager", "content_library", "messaging_api"],
    transformations: [
      "compute peer benchmark",
      "select compliant framing",
      "render reminder",
      "send",
    ],
    validationRules: [
      "consent verified",
      "peer comparison is de-identified",
      "no promotional claim",
    ],
    humanInterventions: ["compliance sign-off on framing template"],
    authorityRequirements: ["consent_manager.read"],
    timeMs: 8_000,
    cost: 5,
    errors: [],
    corrections: [],
    replicationCount: 28,
    reuseConditions: ["patient has consent", "cohort size >= 50 for benchmark"],
  },
  {
    trigger: "Medical information request received",
    outcome: "Faster response time without accuracy loss",
    taskIR: "Triage the medical information request into an SLA tier and route to the right responder.",
    inputs: ["request_text", "requester_type", "topic"],
    tools: ["classifier", "knowledge_base", "sla_tracker", "routing_api"],
    transformations: [
      "classify topic and urgency",
      "assign SLA tier",
      "select responder",
      "route",
    ],
    validationRules: ["classification confidence >= 0.8", "responder has required expertise"],
    humanInterventions: ["low-confidence classification escalates to human"],
    authorityRequirements: ["knowledge_base.read"],
    timeMs: 5_000,
    cost: 3,
    errors: ["one misclassification"],
    corrections: ["added confidence threshold escalation"],
    replicationCount: 35,
    reuseConditions: ["topic within knowledge base coverage", "responder pool available"],
  },
  {
    trigger: "Territory visit sequence planning request",
    outcome: "Higher meaningful-interaction rate per field hour",
    taskIR: "Compute a predictive priority sequence for HCP visits in a territory.",
    inputs: ["territory_id", "hcp_list", "funnel_states", "historical_interactions"],
    tools: ["priority_model", "funnel_db", "route_optimizer", "calendar_api"],
    transformations: [
      "score HCP priority",
      "apply access constraints",
      "optimize route",
      "publish sequence",
    ],
    validationRules: [
      "no access-blocked accounts prioritized without barrier plan",
      "route within field capacity",
    ],
    humanInterventions: ["rep can override sequence with reason code"],
    authorityRequirements: ["funnel_db.read"],
    timeMs: 15_000,
    cost: 6,
    errors: [],
    corrections: [],
    replicationCount: 22,
    reuseConditions: ["territory has funnel data", "field capacity > 0"],
  },
];

function buildSkillFromSeed(seed: SampleSkillSeed): SkillGenome {
  return {
    id: nanoid(),
    trigger: seed.trigger,
    inputs: seed.inputs,
    authorityRequirements: seed.authorityRequirements,
    taskIR: seed.taskIR,
    executionDAG: `${seed.tools.join(" -> ")} | ${seed.transformations.join(" -> ")}`,
    tools: seed.tools,
    transformations: seed.transformations,
    validationRules: seed.validationRules,
    humanInterventions: seed.humanInterventions,
    timeMs: seed.timeMs,
    cost: seed.cost,
    errors: seed.errors,
    corrections: seed.corrections,
    outcome: seed.outcome,
    reuseConditions: seed.reuseConditions,
    replicationCount: seed.replicationCount,
    venturePotential: 0, // will be derived by assessVenturePotential
    createdAt: nowISO(),
  };
}

export function generateSampleVentures(): VentureCandidate[] {
  return SAMPLE_SKILL_SEEDS.map((seed) => {
    const skill = buildSkillFromSeed(seed);
    const genome = assessVenturePotential(skill);
    return generateVentureCandidate(genome, skill);
  });
}

// ─── 6. getVentureCriteria ──────────────────────────────────────────

export function getVentureCriteria(): {
  criterion: string;
  description: string;
  weight: number;
}[] {
  return [
    {
      criterion: "Economic Value",
      description:
        "Quantified value created per execution, net of cost. Measured on a 0-100 scale from replication, cost efficiency, and time efficiency.",
      weight: 30,
    },
    {
      criterion: "Transferability",
      description:
        "Degree to which the skill generalizes across customers, territories, and contexts without re-engineering.",
      weight: 20,
    },
    {
      criterion: "Autonomy",
      description:
        "Fraction of the workflow that executes without human intervention, gated by authority requirements and intervention count.",
      weight: 15,
    },
    {
      criterion: "Demand Frequency",
      description:
        "How often the triggering condition occurs in the target market, driving recurring revenue potential.",
      weight: 15,
    },
    {
      criterion: "Identifiable Buyers",
      description:
        "Number and clarity of buyer personas who can purchase the externalized product.",
      weight: 10,
    },
    {
      criterion: "Replication Depth",
      description:
        "Number of independent successful replications, evidencing that the effect is real and not chance.",
      weight: 10,
    },
    {
      criterion: "Exception Rate",
      description:
        "Fraction of executions that deviate from the happy path, increasing support cost and risk. Penalizes the score.",
      weight: 10,
    },
    {
      criterion: "Defensibility",
      description:
        "Structural moat — multi-tool pipelines, embedded validation, and data access create switching costs for competitors.",
      weight: 8,
    },
    {
      criterion: "Compliance Posture",
      description:
        "Regulatory readiness for externalization: authority gating, consent management, and auditability.",
      weight: 7,
    },
    {
      criterion: "Time to Market",
      description:
        "Estimated months from candidate to externalized product, driven by autonomy and replication depth.",
      weight: 5,
    },
  ];
}
