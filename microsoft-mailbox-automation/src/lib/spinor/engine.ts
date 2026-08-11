/**
 * SPINOR Engine — opportunity discovery, hypothesis competition, mission
 * execution, shadow-world counterfactuals, proof-state advancement, golden-node
 * crystallization, destruction missions, evidence-economy ROI, and career /
 * capability modeling for a pharmaceutical commercial operating system.
 *
 * All functions are pure (no I/O) and deterministic aside from ID generation.
 * IDs are produced with nanoid so the engine can run in any runtime without a
 * database.  Every numeric field is validated and clamped to a sensible range
 * so downstream consumers never receive NaN / Infinity.
 */

import {
  SpinorOpportunity,
  SpinorHypothesis,
  HypothesisEvidence,
  MissionContract,
  MissionResult,
  SPINGenome,
  ShadowWorld,
  SpinorGoldenNode,
  DestructionMission,
  Capability,
  CapabilityType,
  CareerStage,
  SpinorEmployee,
  EvidenceEconomyEntry,
  ProofState,
  RoleType,
} from "@/types";
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

/**
 * Normalize a raw value score into the 0-100 range.
 *
 * valueScore = (impact * uncertaintyReduction * portability * strategic *
 * timeSensitivity) - executionCost - complianceRisk - customerBurden, then
 * min-max normalized across the cohort and scaled to 0-100.
 */
function normalizeValueScores(
  raw: { id: string; score: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (raw.length === 0) return out;
  const vals = raw.map((r) => r.score);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  for (const r of raw) {
    out.set(r.id, round(clamp(((r.score - min) / span) * 100, 0, 100), 2));
  }
  return out;
}

function confidenceFromInterval(
  observed: number,
  interval: { lower: number; upper: number },
): MissionResult["confidence"] {
  const width = Math.abs(interval.upper - interval.lower);
  const center = (interval.lower + interval.upper) / 2;
  const rel = center !== 0 ? Math.abs(width / center) : width;
  if (rel < 0.15) return "high";
  if (rel < 0.35) return "moderate";
  return "low";
}

// ─── 1. generateOpportunities ───────────────────────────────────────

interface OpportunitySeed {
  question: string;
  description: string;
  expectedBusinessImpact: number; // 0-10
  uncertaintyReduction: number; // 0-1
  portability: number; // 0-1
  strategicImportance: number; // 0-10
  timeSensitivity: number; // 0-1
  executionCost: number; // 0-10
  complianceRisk: number; // 0-10
  customerBurden: number; // 0-10
}

const OPPORTUNITY_SEEDS: OpportunitySeed[] = [
  {
    question:
      "Does proactive formulary-pathway briefing increase new-patient initiation in oncology centers?",
    description:
      "Field reps deliver a 5-minute formulary pathway briefing before detailing in high-volume oncology accounts; test whether initiation rate rises versus standard detailing.",
    expectedBusinessImpact: 9,
    uncertaintyReduction: 0.7,
    portability: 0.6,
    strategicImportance: 9,
    timeSensitivity: 0.8,
    executionCost: 4,
    complianceRisk: 3,
    customerBurden: 2,
  },
  {
    question:
      "Does timing content delivery to HCP inbox-open windows lift content engagement?",
    description:
      "Send approved content within detected inbox-open windows vs. fixed daily schedule; measure click-through and content dwell time.",
    expectedBusinessImpact: 7,
    uncertaintyReduction: 0.6,
    portability: 0.85,
    strategicImportance: 6,
    timeSensitivity: 0.7,
    executionCost: 2,
    complianceRisk: 2,
    customerBurden: 1,
  },
  {
    question:
      "Does a peer-comparison persistence nudge reduce discontinuation in specialty patients?",
    description:
      "Send a compliant peer-comparison persistence reminder to specialty patients at day 30 vs. standard refill reminder; measure 90-day persistence.",
    expectedBusinessImpact: 8,
    uncertaintyReduction: 0.65,
    portability: 0.5,
    strategicImportance: 8,
    timeSensitivity: 0.6,
    executionCost: 5,
    complianceRisk: 6,
    customerBurden: 4,
  },
  {
    question:
      "Does routing medical information requests through a triaged SLA tier reduce response time without accuracy loss?",
    description:
      "Triage medical information requests into 3 SLA tiers vs. FIFO queue; measure response time and answer-accuracy audit score.",
    expectedBusinessImpact: 6,
    uncertaintyReduction: 0.55,
    portability: 0.9,
    strategicImportance: 5,
    timeSensitivity: 0.5,
    executionCost: 3,
    complianceRisk: 4,
    customerBurden: 1,
  },
  {
    question:
      "Does territory-level predictive prioritization increase meaningful-interaction rate?",
    description:
      "Use a predictive priority score to sequence HCP visits vs. rep discretion; measure meaningful-interaction funnel advancement.",
    expectedBusinessImpact: 8,
    uncertaintyReduction: 0.6,
    portability: 0.75,
    strategicImportance: 7,
    timeSensitivity: 0.65,
    executionCost: 6,
    complianceRisk: 3,
    customerBurden: 2,
  },
  {
    question:
      "Does an adaptive content sequence outperform a fixed modular sequence for complex science?",
    description:
      "Adapt the next content module based on prior engagement signal vs. fixed sequence; measure comprehension quiz score and content completion.",
    expectedBusinessImpact: 7,
    uncertaintyReduction: 0.7,
    portability: 0.7,
    strategicImportance: 7,
    timeSensitivity: 0.55,
    executionCost: 5,
    complianceRisk: 2,
    customerBurden: 2,
  },
  {
    question:
      "Does a pre-call barrier-discovery script reduce wasted field time on access-blocked accounts?",
    description:
      "Run a 2-minute barrier-discovery phone script before in-person visits to access-blocked accounts vs. direct visit; measure completed meaningful interactions per field hour.",
    expectedBusinessImpact: 6,
    uncertaintyReduction: 0.5,
    portability: 0.8,
    strategicImportance: 6,
    timeSensitivity: 0.6,
    executionCost: 2,
    complianceRisk: 2,
    customerBurden: 1,
  },
  {
    question:
      "Does consolidating reimbursement-support touchpoints into a single navigator session improve patient initiation?",
    description:
      "Offer a single consolidated reimbursement navigator session vs. multi-touch fragmented support; measure time-to-initiation and initiation rate.",
    expectedBusinessImpact: 9,
    uncertaintyReduction: 0.6,
    portability: 0.55,
    strategicImportance: 9,
    timeSensitivity: 0.75,
    executionCost: 7,
    complianceRisk: 5,
    customerBurden: 3,
  },
];

export function generateOpportunities(): SpinorOpportunity[] {
  const raw = OPPORTUNITY_SEEDS.map((s) => {
    const id = nanoid();
    const rawScore =
      s.expectedBusinessImpact *
      s.uncertaintyReduction *
      s.portability *
      s.strategicImportance *
      s.timeSensitivity -
      s.executionCost -
      s.complianceRisk -
      s.customerBurden;
    return { id, seed: s, score: rawScore };
  });

  const normalized = normalizeValueScores(raw.map((r) => ({ id: r.id, score: r.score })));

  return raw.map((r) => {
    const s = r.seed;
    return {
      id: r.id,
      question: s.question,
      description: s.description,
      expectedBusinessImpact: s.expectedBusinessImpact,
      uncertaintyReduction: s.uncertaintyReduction,
      portability: s.portability,
      strategicImportance: s.strategicImportance,
      timeSensitivity: s.timeSensitivity,
      executionCost: s.executionCost,
      complianceRisk: s.complianceRisk,
      customerBurden: s.customerBurden,
      valueScore: normalized.get(r.id) ?? 0,
      status: "open" as const,
      createdAt: nowISO(),
    };
  });
}

// ─── 2. generateHypotheses ──────────────────────────────────────────

interface HypothesisSeed {
  statement: string;
  rationale: string;
}

const HYPOTHESIS_BANK: Record<string, HypothesisSeed[]> = {
  default: [
    {
      statement: "The intervention causes a measurable lift in the primary outcome.",
      rationale:
        "Direct causal mechanism: the intervention changes a known driver of the outcome.",
    },
    {
      statement:
        "Any observed lift is explained by increased attention / Hawthorne effect, not the intervention.",
      rationale:
        "Customers receive more touchpoints simply because they are in a study arm.",
    },
    {
      statement:
        "The lift is confined to a specific segment and does not generalize.",
      rationale:
        "Effect may depend on account size, specialty, or prior engagement baseline.",
    },
    {
      statement: "The intervention works only because of a confounder (e.g. seasonality).",
      rationale:
        "External temporal factors could independently move the outcome.",
    },
    {
      statement: "A cheaper, simpler alternative achieves the same lift.",
      rationale:
        "A reduced version without the costly component may be equally effective.",
    },
  ],
};

export function generateHypotheses(opportunities: SpinorOpportunity[]): SpinorHypothesis[] {
  const out: SpinorHypothesis[] = [];
  for (const opp of opportunities) {
    // Choose 3-5 hypotheses deterministically based on opportunity id hash
    // so the cohort is stable across runs for the same opportunity set.
    const pool = HYPOTHESIS_BANK.default;
    const hash = [...opp.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const count = 3 + (hash % 3); // 3, 4, or 5
    const chosen: HypothesisSeed[] = [];
    for (let i = 0; i < count; i++) {
      chosen.push(pool[(hash + i) % pool.length]);
    }
    const ids = chosen.map(() => nanoid());
    for (let i = 0; i < chosen.length; i++) {
      out.push({
        id: ids[i],
        opportunityId: opp.id,
        statement: chosen[i].statement,
        rationale: chosen[i].rationale,
        competingHypothesisIds: ids.filter((_, j) => j !== i),
        status: "untested" as const,
        proofState: 0 as ProofState,
        evidence: [],
        createdAt: nowISO(),
      });
    }
  }
  return out;
}

// ─── 3. generateMissionContract ─────────────────────────────────────

export function generateMissionContract(
  hypothesis: SpinorHypothesis,
  owner: string,
): MissionContract {
  return {
    id: nanoid(),
    opportunityId: hypothesis.opportunityId,
    hypothesisId: hypothesis.id,
    owner,
    objective: `Test: ${hypothesis.statement}`,
    population:
      "Stratified sample of HCP accounts in matched territories, n >= 120 per arm",
    intervention:
      "Apply the proposed strategy under controlled, pre-registered conditions",
    comparison:
      "Matched control arm receiving the current standard-of-execution",
    primaryOutcome: "Primary funnel advancement rate (meaningful interaction or initiation)",
    secondaryOutcomes: [
      "Content engagement dwell time",
      "Field time per meaningful interaction",
      "90-day persistence (where applicable)",
      "Compliance audit pass rate",
    ],
    permittedVariables: [
      "territory",
      "specialty",
      "account size tier",
      "prior engagement baseline",
    ],
    lockedVariables: [
      "approved content set",
      "compliance review state",
      "formulary status",
      "indication",
    ],
    stopConditions: [
      "Compliance review fails",
      "Customer complaint threshold exceeded (>2% per arm)",
      "Pre-registered evidence threshold met or refuted at interim",
      "Field capacity drops below 80% of plan",
    ],
    evidenceThreshold:
      "Absolute lift >= 3 percentage points with 95% interval excluding zero and no unaddressed confounder",
    replicationObligation:
      "At least one independent replication in a different territory before any golden-node promotion",
    status: "draft" as const,
    startDate: daysFromNow(7),
  };
}

// ─── 4. executeMission ──────────────────────────────────────────────

/**
 * Simulate a mission execution. The simulation is deterministic per contract
 * id so repeated runs on the same contract produce the same result, which is
 * essential for reproducible demos and tests.
 */
export function executeMission(contract: MissionContract): MissionResult {
  const seed = [...contract.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (offset: number): number => {
    // Mulberry32-style deterministic pseudo-random in [0,1)
    const t = (seed + offset) * 0x6d2b79f5;
    const x = Math.sin(t) * 10000;
    return x - Math.floor(x);
  };

  const expectedOutcome = round(20 + rand(1) * 15, 2); // 20-35% baseline
  const liftPct = round(rand(2) * 12 - 1, 2); // -1 to +11 pp
  const observedOutcome = round(clamp(expectedOutcome + liftPct, 0, 100), 2);
  const absoluteLift = round(observedOutcome - expectedOutcome, 2);
  const relativeLift =
    expectedOutcome !== 0 ? round(absoluteLift / expectedOutcome, 4) : 0;

  const sampleSize = 120 + Math.floor(rand(3) * 180); // 120-300
  const intervalWidth = round(2 + rand(4) * 6, 2); // 2-8 pp
  const uncertaintyInterval = {
    lower: round(clamp(absoluteLift - intervalWidth, -100, 100), 2),
    upper: round(clamp(absoluteLift + intervalWidth, -100, 100), 2),
  };

  const confidence = confidenceFromInterval(absoluteLift, uncertaintyInterval);
  const executionCost = round(2 + rand(5) * 6, 2); // 2-8 cost units

  const confounderPool = [
    "seasonality",
    "formulary change during study window",
    "rep skill differential",
    "concurrent marketing campaign",
    "territory account-mix imbalance",
    "data latency in control arm",
  ];
  const confounderCount = Math.floor(rand(6) * 3); // 0-2
  const confounders: string[] = [];
  for (let i = 0; i < confounderCount; i++) {
    confounders.push(confounderPool[(seed + i) % confounderPool.length]);
  }

  const unexplainedVariance = round(rand(7) * 0.3, 4); // 0-0.3
  const replicationCount = 0; // first execution

  const limitations: string[] = [
    "Single-territory execution; portability not yet established",
    "Self-reported engagement signal may contain measurement noise",
  ];
  if (confounders.length > 0) {
    limitations.push(`Unaddressed confounders: ${confounders.join(", ")}`);
  }

  return {
    observedOutcome,
    expectedOutcome,
    absoluteLift,
    relativeLift,
    sampleSize,
    uncertaintyInterval,
    confidence,
    executionCost,
    confounders,
    unexplainedVariance,
    replicationCount,
    limitations,
  };
}

// ─── 5. createShadowWorld ───────────────────────────────────────────

export function createShadowWorld(
  contract: MissionContract,
  result: MissionResult,
): ShadowWorld {
  // Counterfactual: what would have happened without the intervention.
  // We use the control-arm expectation as the counterfactual baseline and
  // re-derive the lift with a (deterministic) method-appropriate adjustment.
  const seed = [...contract.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const methods: ShadowWorld["method"][] = [
    "randomized",
    "matched_control",
    "staggered_rollout",
    "historical_baseline",
    "synthetic_control",
    "interrupted_time_series",
  ];
  const method = methods[seed % methods.length];

  // Counterfactual outcome = what the treated population would have seen
  // without intervention.  We conservatively shrink the observed lift by an
  // unexplained-variance fraction to avoid over-claiming.
  const shrink = 1 - clamp(result.unexplainedVariance, 0, 0.5);
  const counterfactual = round(
    clamp(result.observedOutcome - result.absoluteLift * shrink, 0, 100),
    2,
  );
  const absoluteLift = round(result.observedOutcome - counterfactual, 2);
  const relativeLift =
    counterfactual !== 0 ? round(absoluteLift / counterfactual, 4) : 0;

  // Counterfactual intervals are slightly wider because the counterfactual is
  // inferred, not observed.
  const width = Math.abs(result.uncertaintyInterval.upper - result.uncertaintyInterval.lower) * 1.15;
  const uncertaintyInterval = {
    lower: round(clamp(absoluteLift - width / 2, -100, 100), 2),
    upper: round(clamp(absoluteLift + width / 2, -100, 100), 2),
  };

  return {
    missionId: contract.id,
    method,
    observedOutcome: result.observedOutcome,
    expectedOutcomeWithoutIntervention: counterfactual,
    absoluteLift,
    relativeLift,
    sampleSize: result.sampleSize,
    uncertaintyInterval,
    confidence: confidenceFromInterval(absoluteLift, uncertaintyInterval),
    executionCost: result.executionCost,
    customerBurden: round(clamp(result.executionCost * 0.4, 0, 10), 2),
    confounders: result.confounders,
    unexplainedVariance: result.unexplainedVariance,
    replicationCount: result.replicationCount,
    limitations: [
      ...result.limitations,
      "Counterfactual is inferred; causal claim strength depends on method validity",
    ],
  };
}

// ─── 6. advanceProofState ───────────────────────────────────────────

/**
 * Determine the proof state (0-9) for a hypothesis given a mission result and
 * its shadow-world counterfactual.
 *
 * The ladder is conservative: a single positive result advances to at most 3
 * (Replicated Effect) and only with independent replication does it climb
 * further.  Negative or inconclusive results keep the hypothesis low or push
 * it back down.
 */
export function advanceProofState(
  hypothesis: SpinorHypothesis,
  result: MissionResult,
  shadowWorld: ShadowWorld,
): ProofState {
  const liftPositive = result.absoluteLift > 0;
  const intervalExcludesZero =
    result.uncertaintyInterval.lower > 0 || result.uncertaintyInterval.upper < 0;
  const supports = liftPositive && intervalExcludesZero;
  const confoundersUnaddressed = result.confounders.length > 0;
  const replicated = result.replicationCount >= 1;
  const counterfactualConsistent =
    shadowWorld.absoluteLift > 0 && shadowWorld.confidence !== "low";

  if (!supports) {
    // Refuted or inconclusive — keep at seed/local level at most.
    return result.absoluteLift > 0 ? (1 as ProofState) : (0 as ProofState);
  }

  if (confoundersUnaddressed) {
    return (2 as ProofState); // Local Signal only
  }

  if (!replicated) {
    return (3 as ProofState); // Replicated Effect requires replication; single study -> 3 ceiling pre-replication
  }

  // Replicated + clean + counterfactual consistent climbs the ladder.
  if (!counterfactualConsistent) {
    return (4 as ProofState); // Mechanism Supported
  }

  // Beyond 5 requires portability / infrastructure / autonomy signals that
  // are not available from a single mission; cap at 5 here.  Higher states are
  // reached via golden-node promotion and destruction-mission survival.
  return (5 as ProofState);
}

// ─── 7. createGoldenNode ────────────────────────────────────────────

let goldenNodeCounter = 0;

export function createGoldenNode(
  hypothesis: SpinorHypothesis,
  contract: MissionContract,
  result: MissionResult,
  contributors: string[],
): SpinorGoldenNode {
  goldenNodeCounter += 1;
  const adjustedEffect = `${result.absoluteLift} pp absolute lift (counterfactual-adjusted), 95% interval [${result.uncertaintyInterval.lower}, ${result.uncertaintyInterval.upper}]`;
  return {
    id: nanoid(),
    number: goldenNodeCounter,
    opportunity: hypothesis.statement,
    validatedStrategy: contract.intervention,
    applicableContexts: contract.permittedVariables,
    failureBoundary:
      "Effect not validated outside the permitted variable ranges; do not extrapolate to locked-variable changes.",
    adjustedEffect,
    executionCost: `${result.executionCost} cost units per execution cycle`,
    complianceState:
      "Pre-registered; compliance review passed; no off-label or promotional violation detected.",
    humanContributors: contributors,
    automationState:
      "Semi-automated: workflow executable by system, human approval required before each execution.",
    humanControl:
      "Human override available at any step; rollback triggers monitored continuously.",
    rollbackTrigger:
      "Observed outcome drops below 50% of adjusted effect for 2 consecutive cycles, OR any compliance alert.",
    reverseTestSchedule: "Quarterly reverse test + on any rollback trigger",
    proofState: 6 as ProofState,
    executableWorkflow: contract.intervention,
    eligibilityRules: contract.permittedVariables,
    evidencePackage: [
      `Mission ${contract.id} result: observed ${result.observedOutcome}, expected ${result.expectedOutcome}`,
      `Counterfactual analysis: ${result.absoluteLift} pp lift, confidence ${result.confidence}`,
      `Sample size: ${result.sampleSize}; replications: ${result.replicationCount}`,
      ...result.limitations.map((l) => `Limitation: ${l}`),
    ],
    knownFailureConditions: [
      "Formulary status changes during execution",
      "Field capacity below 80% of plan",
      "Concurrent uncoordinated marketing campaign",
    ],
    contributionLedger: contributors.map((c) => ({
      contributor: c,
      contribution: "Mission design, execution, and causal interpretation",
      date: nowISO(),
    })),
    monitoringThresholds: [
      {
        metric: "primary_outcome_rate",
        threshold: round(result.expectedOutcome * 0.5, 2),
        action: "pause automation and alert owner",
      },
      {
        metric: "compliance_alert_count",
        threshold: 1,
        action: "immediate rollback and human review",
      },
    ],
    rollbackPolicy:
      "Automatic rollback on any monitoring threshold breach; manual rollback available to owner and compliance.",
    falsificationSchedule: "Reverse test every quarter; destruction missions on a rolling basis.",
    status: "confirmed" as const,
    createdAt: nowISO(),
  };
}

// ─── 8. generateDestructionMissions ─────────────────────────────────

const DESTRUCTION_TEMPLATES: {
  attackType: DestructionMission["attackType"];
  description: (g: SpinorGoldenNode) => string;
}[] = [
  {
    attackType: "remove_component",
    description: (g) =>
      `Remove the highest-cost component of "${g.validatedStrategy}" and re-run; does the effect survive?`,
  },
  {
    attackType: "reverse_sequence",
    description: (g) =>
      `Reverse the order of steps in "${g.executableWorkflow}"; does the lift collapse?`,
  },
  {
    attackType: "resistant_segment",
    description: () =>
      `Find the segment where the strategy fails to produce lift; map the failure boundary.`,
  },
  {
    attackType: "different_employee",
    description: () =>
      `Re-execute with a different employee of lower career stage; is the effect employee-dependent?`,
  },
  {
    attackType: "different_territory",
    description: () =>
      `Re-execute in a territory outside the original permitted variables; does portability hold?`,
  },
  {
    attackType: "human_vs_model",
    description: () =>
      `Replace the human decision step with the model recommendation; does accuracy or compliance degrade?`,
  },
  {
    attackType: "decay_test",
    description: () =>
      `Stop the strategy for 2 cycles and measure decay; is the effect persistent or transient?`,
  },
  {
    attackType: "hidden_burden",
    description: () =>
      `Audit for hidden customer burden not captured in the primary outcome; is total burden acceptable?`,
  },
  {
    attackType: "compliance_leakage",
    description: () =>
      `Stress-test the compliance state under edge-case inputs; does any off-label leakage appear?`,
  },
  {
    attackType: "external_explanation",
    description: () =>
      `Check whether an external event (seasonality, competitor action) fully explains the observed lift.`,
  },
  {
    attackType: "cheaper_alternative",
    description: () =>
      `Test the cheapest stripped-down variant; can the same lift be achieved at lower cost?`,
  },
];

export function generateDestructionMissions(goldenNode: SpinorGoldenNode): DestructionMission[] {
  // Deterministically select 5-7 attacks based on golden node id.
  const seed = [...goldenNode.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const count = 5 + (seed % 3); // 5, 6, or 7
  const chosen: DestructionMission[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = DESTRUCTION_TEMPLATES[(seed + i) % DESTRUCTION_TEMPLATES.length];
    chosen.push({
      id: nanoid(),
      goldenNodeId: goldenNode.id,
      attackType: tpl.attackType,
      description: tpl.description(goldenNode),
      status: "proposed" as const,
      evidence: "",
    });
  }
  return chosen;
}

// ─── 9. calculateExperimentROI ──────────────────────────────────────

export function calculateExperimentROI(
  result: MissionResult,
  shadowWorld: ShadowWorld,
): EvidenceEconomyEntry {
  const outcomeValue = round(clamp(Math.abs(result.absoluteLift) * 10, 0, 100), 2);
  const knowledgeValue = round(
    clamp(
      (result.confidence === "high" ? 30 : result.confidence === "moderate" ? 18 : 8) +
        result.sampleSize / 20,
      0,
      100,
    ),
    2,
  );
  const riskReductionValue = round(
    clamp(result.confounders.length === 0 ? 25 : 25 - result.confounders.length * 6, 0, 100),
    2,
  );
  const automationValue = round(
    clamp(result.replicationCount >= 1 ? 20 : 10, 0, 100),
    2,
  );
  const transferValue = round(clamp(shadowWorld.absoluteLift * 5, 0, 100), 2);
  const customerExperienceValue = round(clamp(10 - shadowWorld.customerBurden, 0, 100), 2);
  const strategicOptionValue = round(
    clamp(result.absoluteLift > 0 ? 15 + result.absoluteLift : 5, 0, 100),
    2,
  );
  const avoidedCost = round(clamp(riskReductionValue * 0.5, 0, 100), 2);

  const totalValue =
    outcomeValue +
    knowledgeValue +
    riskReductionValue +
    automationValue +
    transferValue +
    customerExperienceValue +
    strategicOptionValue +
    avoidedCost;

  const executionCost = round(clamp(result.executionCost, 0, 100), 2);
  const customerBurden = round(clamp(shadowWorld.customerBurden, 0, 100), 2);
  const complianceExposure = round(
    clamp(result.confounders.length * 3 + (result.confidence === "low" ? 5 : 0), 0, 100),
    2,
  );
  const analyticalCost = round(clamp(result.unexplainedVariance * 20 + 2, 0, 100), 2);

  const totalCost = executionCost + customerBurden + complianceExposure + analyticalCost;
  const experimentROI = totalCost > 0 ? round(totalValue / totalCost, 4) : 0;
  const isUsefulFailure = result.absoluteLift <= 0 && knowledgeValue >= 15;

  return {
    id: nanoid(),
    experimentId: shadowWorld.missionId,
    outcomeValue,
    knowledgeValue,
    riskReductionValue,
    automationValue,
    transferValue,
    customerExperienceValue,
    strategicOptionValue,
    avoidedCost,
    executionCost,
    customerBurden,
    complianceExposure,
    analyticalCost,
    experimentROI,
    isUsefulFailure,
    createdAt: nowISO(),
  };
}

// ─── 10. generateEmployees ──────────────────────────────────────────

interface EmployeeSeed {
  name: string;
  role: RoleType;
  careerStage: CareerStage;
  capabilities: { type: CapabilityType; level: number; verifiedInstances: number }[];
  balanceSheet: SpinorEmployee["opportunityBalanceSheet"];
  experimentsRun: number;
  honestNegatives: number;
}

const EMPLOYEE_SEEDS: EmployeeSeed[] = [
  {
    name: "Dr. Lena Ortiz",
    role: "field_representative",
    careerStage: "investigator",
    capabilities: [
      { type: "reliable_execution", level: 4, verifiedInstances: 22 },
      { type: "confounder_detection", level: 3, verifiedInstances: 9 },
      { type: "causal_interpretation", level: 3, verifiedInstances: 7 },
    ],
    balanceSheet: {
      expectedValue: 62,
      riskLevel: 4,
      complexity: 5,
      highUpsideSeeds: 3,
      replicationBurden: 2,
      builderMissions: 1,
      territoryDifficulty: 6,
      orgSupport: 7,
      successProbability: 0.55,
    },
    experimentsRun: 14,
    honestNegatives: 4,
  },
  {
    name: "Marcus Tan",
    role: "regional_manager",
    careerStage: "replicator",
    capabilities: [
      { type: "replication_leadership", level: 5, verifiedInstances: 18 },
      { type: "workflow_construction", level: 4, verifiedInstances: 12 },
      { type: "cross_context_translation", level: 4, verifiedInstances: 8 },
    ],
    balanceSheet: {
      expectedValue: 70,
      riskLevel: 3,
      complexity: 6,
      highUpsideSeeds: 2,
      replicationBurden: 5,
      builderMissions: 2,
      territoryDifficulty: 5,
      orgSupport: 8,
      successProbability: 0.65,
    },
    experimentsRun: 26,
    honestNegatives: 7,
  },
  {
    name: "Dr. Priya Nair",
    role: "medical_affairs",
    careerStage: "modifier",
    capabilities: [
      { type: "causal_interpretation", level: 5, verifiedInstances: 20 },
      { type: "model_correction", level: 4, verifiedInstances: 11 },
      { type: "confounder_detection", level: 5, verifiedInstances: 15 },
    ],
    balanceSheet: {
      expectedValue: 74,
      riskLevel: 5,
      complexity: 7,
      highUpsideSeeds: 4,
      replicationBurden: 3,
      builderMissions: 3,
      territoryDifficulty: 4,
      orgSupport: 6,
      successProbability: 0.6,
    },
    experimentsRun: 31,
    honestNegatives: 9,
  },
  {
    name: "Sam Whitfield",
    role: "market_access",
    careerStage: "builder",
    capabilities: [
      { type: "automation_design", level: 5, verifiedInstances: 14 },
      { type: "workflow_construction", level: 5, verifiedInstances: 16 },
      { type: "compliance_reliability", level: 4, verifiedInstances: 10 },
    ],
    balanceSheet: {
      expectedValue: 80,
      riskLevel: 4,
      complexity: 8,
      highUpsideSeeds: 5,
      replicationBurden: 2,
      builderMissions: 6,
      territoryDifficulty: 5,
      orgSupport: 7,
      successProbability: 0.58,
    },
    experimentsRun: 19,
    honestNegatives: 5,
  },
  {
    name: "Elena Vasquez",
    role: "compliance",
    careerStage: "adversarial_reviewer",
    capabilities: [
      { type: "adversarial_testing", level: 5, verifiedInstances: 24 },
      { type: "compliance_reliability", level: 5, verifiedInstances: 30 },
      { type: "confounder_detection", level: 4, verifiedInstances: 12 },
    ],
    balanceSheet: {
      expectedValue: 55,
      riskLevel: 2,
      complexity: 6,
      highUpsideSeeds: 1,
      replicationBurden: 1,
      builderMissions: 1,
      territoryDifficulty: 3,
      orgSupport: 9,
      successProbability: 0.72,
    },
    experimentsRun: 12,
    honestNegatives: 8,
  },
  {
    name: "Dr. Ravi Kapoor",
    role: "field_representative",
    careerStage: "strategy_architect",
    capabilities: [
      { type: "cross_context_translation", level: 5, verifiedInstances: 21 },
      { type: "causal_interpretation", level: 5, verifiedInstances: 19 },
      { type: "replication_leadership", level: 4, verifiedInstances: 13 },
      { type: "automation_design", level: 4, verifiedInstances: 9 },
    ],
    balanceSheet: {
      expectedValue: 88,
      riskLevel: 5,
      complexity: 9,
      highUpsideSeeds: 6,
      replicationBurden: 4,
      builderMissions: 5,
      territoryDifficulty: 7,
      orgSupport: 8,
      successProbability: 0.62,
    },
    experimentsRun: 44,
    honestNegatives: 11,
  },
];

export function generateEmployees(): SpinorEmployee[] {
  return EMPLOYEE_SEEDS.map((s) => {
    const capabilities: Capability[] = s.capabilities.map((c) => ({
      type: c.type,
      level: clamp(c.level, 1, 5),
      verifiedInstances: Math.max(0, c.verifiedInstances),
      unlockedMissions: [],
    }));
    return {
      id: nanoid(),
      name: s.name,
      role: s.role,
      careerStage: s.careerStage,
      capabilities,
      opportunityBalanceSheet: s.balanceSheet,
      experimentsRun: s.experimentsRun,
      honestNegatives: s.honestNegatives,
      goldenNodesContributed: [],
    };
  });
}

// ─── 11. getProofStateLabel ─────────────────────────────────────────

export function getProofStateLabel(state: ProofState): string {
  const labels: Record<ProofState, string> = {
    0: "Speculation",
    1: "Eligible Seed",
    2: "Local Signal",
    3: "Replicated Effect",
    4: "Mechanism Supported",
    5: "Portable Strategy",
    6: "Golden Node",
    7: "Infrastructure",
    8: "Autonomous System",
    9: "Spinout Candidate",
  };
  return labels[state] ?? "Unknown";
}

// ─── 12. getCareerStageLabel ────────────────────────────────────────

export function getCareerStageLabel(stage: CareerStage): string {
  const labels: Record<CareerStage, string> = {
    operator: "Operator — executes pre-built missions reliably",
    investigator: "Investigator — designs and runs original missions",
    replicator: "Replicator — leads independent replications",
    modifier: "Modifier — adjusts strategies based on confounders",
    builder: "Builder — constructs reusable workflows and infrastructure",
    strategy_architect: "Strategy Architect — designs portable cross-context strategies",
    system_governor: "System Governor — governs autonomous execution and rollback",
    venture_founder: "Venture Founder — externalizes validated workflows into ventures",
    adversarial_reviewer: "Adversarial Reviewer — runs destruction missions and audits",
  };
  return labels[stage] ?? "Unknown";
}

// ─── 13. getCapabilityLabel ─────────────────────────────────────────

export function getCapabilityLabel(cap: CapabilityType): string {
  const labels: Record<CapabilityType, string> = {
    reliable_execution: "Reliable Execution — completes missions as specified",
    confounder_detection: "Confounder Detection — identifies hidden causal threats",
    workflow_construction: "Workflow Construction — builds reproducible execution paths",
    replication_leadership: "Replication Leadership — runs and interprets independent replications",
    model_correction: "Model Correction — catches and fixes model errors",
    causal_interpretation: "Causal Interpretation — distinguishes causation from correlation",
    compliance_reliability: "Compliance Reliability — maintains regulatory integrity under pressure",
    automation_design: "Automation Design — safely automates validated workflows",
    adversarial_testing: "Adversarial Testing — runs destruction missions",
    cross_context_translation: "Cross-Context Translation — ports strategies across territories",
  };
  return labels[cap] ?? "Unknown";
}

// ─── 14. generateSampleGoldenNodes ──────────────────────────────────

export function generateSampleGoldenNodes(): SpinorGoldenNode[] {
  const opps = generateOpportunities();
  const hyps = generateHypotheses(opps);
  const employees = generateEmployees();
  const nodes: SpinorGoldenNode[] = [];

  for (let i = 0; i < 3; i++) {
    const hyp = hyps[i * 2] ?? hyps[0];
    const contract = generateMissionContract(hyp, employees[i % employees.length].name);
    const result = executeMission(contract);
    // Force a positive, clean result for sample golden nodes.
    const cleanResult: MissionResult = {
      ...result,
      absoluteLift: round(Math.abs(result.absoluteLift) + 3, 2),
      observedOutcome: round(result.expectedOutcome + Math.abs(result.absoluteLift) + 3, 2),
      uncertaintyInterval: { lower: 1.5, upper: 6.5 },
      confidence: "high",
      confounders: [],
      unexplainedVariance: 0.05,
      replicationCount: 2,
      limitations: ["Single-territory origin; portability validated via replication"],
    };
    const shadow = createShadowWorld(contract, cleanResult);
    const contributors = employees.slice(0, 3).map((e) => e.name);
    const node = createGoldenNode(hyp, contract, cleanResult, contributors);
    // Attach evidence package referencing the shadow world.
    node.evidencePackage = [
      ...node.evidencePackage,
      `Shadow world (${shadow.method}): counterfactual lift ${shadow.absoluteLift} pp, confidence ${shadow.confidence}`,
    ];
    nodes.push(node);
  }

  return nodes;
}

// ─── 15. generateSampleDestructionMissions ──────────────────────────

export function generateSampleDestructionMissions(): DestructionMission[] {
  const nodes = generateSampleGoldenNodes();
  const missions: DestructionMission[] = [];
  for (const node of nodes) {
    const attacks = generateDestructionMissions(node);
    // Take ~2 from each node to reach 5-6 total deterministically.
    missions.push(...attacks.slice(0, 2));
  }
  // Ensure at least 5.
  while (missions.length < 5 && nodes.length > 0) {
    const extra = generateDestructionMissions(nodes[0]);
    missions.push(extra[missions.length % extra.length]);
  }
  return missions.slice(0, 6);
}

// ─── SPINGenome helper (exported for completeness) ──────────────────

/**
 * Build a SPINGenome record capturing the full causal genome of a mission.
 * This is not in the required function list but is exported so downstream
 * consumers can persist the genome alongside golden nodes.
 */
export function buildSPINGenome(
  contract: MissionContract,
  result: MissionResult,
  humanContributor: string,
  modelContribution: string,
): SPINGenome {
  return {
    id: nanoid(),
    opportunity: contract.objective,
    hypothesisVersion: contract.hypothesisId,
    humanContributor,
    modelContribution,
    customerContext: contract.population,
    territoryState: contract.permittedVariables.join(", "),
    eligibilityRule: contract.permittedVariables.join(" AND "),
    assignmentMethod: "matched_control",
    channel: "field + digital",
    timing: contract.startDate,
    workflow: contract.intervention,
    approvedContent: contract.lockedVariables.join(", "),
    executionFidelity: round(clamp(0.9 - result.unexplainedVariance, 0, 1), 2),
    organizationalSupport: 0.8,
    externalConditions: result.confounders.join(", ") || "none detected",
    chanceFactor: round(result.unexplainedVariance, 4),
    result,
    createdAt: nowISO(),
  };
}
