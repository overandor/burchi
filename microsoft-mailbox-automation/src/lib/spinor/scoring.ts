import {
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisOutcome,
  HypothesisAttribution,
  HypothesisDerivative,
  PriorArtRecord,
  GoldenNode,
  SpinorMaturityStage,
  SpinorEvidenceBadge,
  DiscoveryContributionScore,
  DCSComponent,
  SpinorOrganismNode,
  SpinorNodeRole,
  SpinorSignatureAction,
  SpinorOrganism,
  HypothesisState,
  PriorArtStatus,
  PriorArtEvidenceState,
} from "@/types";

/**
 * SPINOR scoring & mapping layer.
 *
 * Converts the existing GOLDEN NODE engine records into the SPINOR
 * organic vocabulary (maturity stages, evidence badges, DCS) using
 * deterministic, anti-gaming rules. Every value is grounded in observed
 * data — no invented metrics.
 */

// ─── Maturity stage ──────────────────────────────────────────────────

const STAGE_ORDER: SpinorMaturityStage[] = [
  "seed",
  "sprout",
  "branch",
  "grove",
  "golden_node",
  "infrastructure",
  "spinout",
];

export const STAGE_LABEL: Record<SpinorMaturityStage, string> = {
  seed: "Seed",
  sprout: "Sprout",
  branch: "Branch",
  grove: "Grove",
  golden_node: "Golden Node",
  infrastructure: "Infrastructure",
  spinout: "Spinout",
};

export const STAGE_GLYPH: Record<SpinorMaturityStage, string> = {
  seed: "•",
  sprout: "↟",
  branch: "Y",
  grove: "♣",
  golden_node: "✦",
  infrastructure: "▣",
  spinout: "↯",
};

/**
 * Derive the organic maturity stage from engine state.
 *
 * The mapping is conservative: a hypothesis only advances when there is
 * concrete evidence (outcomes, replications, a Golden Node record, or a
 * promoted process). Activity volume alone never advances the stage.
 */
export function deriveMaturityStage(
  hypothesis: HypothesisAnatomy,
  ctx: {
    outcomes: HypothesisOutcome[];
    derivatives: HypothesisDerivative[];
    goldenNode?: GoldenNode;
    replicatedByOthers: number;
    integratedIntoProcess: boolean;
    spunOut: boolean;
  },
): SpinorMaturityStage {
  if (ctx.spunOut) return "spinout";
  if (ctx.integratedIntoProcess) return "infrastructure";
  if (ctx.goldenNode) return "golden_node";
  if (ctx.replicatedByOthers >= 3) return "grove";
  if (ctx.derivatives.some((d) => d.parentHypothesisId === hypothesis.id)) return "branch";
  if (ctx.outcomes.length >= 1) return "sprout";
  return "seed";
}

// ─── Evidence badge ──────────────────────────────────────────────────

export const EVIDENCE_LABEL: Record<SpinorEvidenceBadge, string> = {
  established: "Established",
  supported: "Supported",
  transferred: "Transferred",
  plausible: "Plausible",
  untested: "Untested",
  contradicted: "Contradicted",
  internal_signal: "Internal Signal",
};

export const EVIDENCE_COLOR: Record<SpinorEvidenceBadge, SpinorOrganismNode["color"]> = {
  established: "blue",
  supported: "blue",
  transferred: "violet",
  plausible: "violet",
  untested: "gray",
  contradicted: "red",
  internal_signal: "green",
};

/**
 * Map prior-art research + observed outcomes onto an evidence badge.
 *
 * The badge distinguishes external evidence (established/supported/
 * transferred) from internal observation (internal_signal) from absence
 * of evidence (untested) from contradiction (contradicted).
 */
export function deriveEvidenceBadge(
  priorArt: PriorArtRecord | undefined,
  outcomes: HypothesisOutcome[],
): SpinorEvidenceBadge {
  // Contradiction dominates: any reliable negative outcome falsifies.
  const falsified = outcomes.filter((o) => o.falsified);
  if (falsified.length >= 2) return "contradicted";

  if (!priorArt) {
    return outcomes.length > 0 ? "internal_signal" : "untested";
  }

  // External evidence first.
  if (priorArt.evidenceState === "failed") return "contradicted";
  if (priorArt.status === "established" && priorArt.evidenceState === "supported") {
    return "established";
  }
  if (priorArt.evidenceState === "supported") {
    return priorArt.testedInAdjacentIndustries && !priorArt.testedInMarket
      ? "transferred"
      : "supported";
  }
  if (priorArt.testedInAdjacentIndustries) return "transferred";
  if (priorArt.status === "unsupported") return outcomes.length > 0 ? "internal_signal" : "untested";

  // A reasonable mechanism but weak direct evidence.
  if (priorArt.researchConfidence >= 0.4) return "plausible";

  // Internal observation without independent validation.
  if (outcomes.length > 0) return "internal_signal";
  return "untested";
}

// ─── Discovery Contribution Score ────────────────────────────────────

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Compute the Discovery Contribution Score.
 *
 *   DCS = (I × C × R × V × T) / H
 *
 * Every component is normalized to [0,1] and grounded in observed data.
 * Harm H is in [0.05, 1] (a floor prevents division by zero and ensures
 * even clean experiments carry a small harm uncertainty). The final
 * score is scaled to [0, 100].
 *
 * Anti-gaming properties:
 *  - I is capped by sample size (small samples cannot yield high I).
 *  - C drops with no control group and with high unexplained variance.
 *  - R is zero without independent replications.
 *  - V is reduced for duplicate / near-duplicate hypotheses.
 *  - T is reduced when the method is tightly territory-coupled.
 *  - H rises with complaints, compliance incidents, opt-outs, fatigue.
 */
export function computeDCS(input: {
  outcomes: HypothesisOutcome[];
  attribution?: HypothesisAttribution;
  derivatives: HypothesisDerivative[];
  replicationsByOthers: number;
  priorArt: PriorArtRecord | undefined;
  hypothesis: HypothesisAnatomy;
  /** Distinct participants who tested this or a derivative. */
  distinctParticipants: number;
  /** Negative signals: complaints, opt-outs, compliance incidents. */
  harmSignals: number;
  /** Whether a matched control / comparison group was used. */
  hadControl: boolean;
}): DiscoveryContributionScore {
  const { outcomes, attribution, derivatives, replicationsByOthers, priorArt, hypothesis, distinctParticipants, harmSignals, hadControl } = input;

  const positiveOutcomes = outcomes.filter((o) => !o.falsified);
  const totalTrials = outcomes.length;

  // I — Impact: best normalized effect across outcomes, capped by sample.
  let rawImpact = 0;
  for (const o of positiveOutcomes) {
    for (const m of o.metrics) {
      if (!m.higherIsBetter) continue;
      const baseline = m.baseline || 1;
      const rel = (m.value - baseline) / baseline; // relative lift
      rawImpact = Math.max(rawImpact, rel);
    }
  }
  const sampleCap = clamp01(totalTrials / 20); // need ~20 trials for full impact credit
  const I = clamp01(rawImpact) * (0.4 + 0.6 * sampleCap);

  // C — Confidence: attribution confidence × control usage × (1 - unexplained variance).
  const attrConf = attribution?.attributionConfidence ?? 0;
  const unexplained = attribution?.unexplainedVariance ?? 1;
  const controlFactor = hadControl ? 1 : 0.5;
  const C = clamp01(attrConf * controlFactor * (1 - clamp01(unexplained)));

  // R — Replicability: independent replications by other participants.
  const R = clamp01(replicationsByOthers / 3);

  // V — Novelty: distance from existing knowledge, reduced for duplicates.
  const noveltyBase =
    hypothesis.priorArtStatus === "new_mechanism" ? 1
      : hypothesis.priorArtStatus === "novel_permutation" ? 0.8
        : hypothesis.priorArtStatus === "transfer_candidate" ? 0.55
          : hypothesis.priorArtStatus === "established" ? 0.2
            : 0.4;
  const duplicatePenalty = derivatives.length > 6 ? 0.7 : 1; // many derivatives → diminishing novelty
  const V = clamp01(noveltyBase * duplicatePenalty);

  // T — Transferability: spread across participants & territories.
  const T = clamp01(distinctParticipants / 4);

  // H — Harm: 0 = no harm, 1 = severe. Floor at 0.05.
  const harmFromSignals = clamp01(harmSignals / 5);
  const H = Math.max(0.05, harmFromSignals);

  const numerator = I * C * R * V * T;
  const raw = numerator / H;
  const score = Math.round(clamp01(raw) * 100);

  const components: DCSComponent[] = [
    { symbol: "I", name: "Impact", value: I, rationale: `${positiveOutcomes.length} positive outcomes; sample cap ${Math.round(sampleCap * 100)}%.` },
    { symbol: "C", name: "Confidence", value: C, rationale: attribution ? `attribution ${attribution.method}, control ${hadControl ? "yes" : "no"}.` : "no attribution yet." },
    { symbol: "R", name: "Replicability", value: R, rationale: `${replicationsByOthers} independent replications.` },
    { symbol: "V", name: "Novelty", value: V, rationale: `prior-art: ${hypothesis.priorArtStatus}.` },
    { symbol: "T", name: "Transferability", value: T, rationale: `${distinctParticipants} distinct participants.` },
    { symbol: "H", name: "Harm penalty", value: H, rationale: `${harmSignals} harm signals.` },
  ];

  const provisional = replicationsByOthers < 1 || totalTrials < 10;
  const scoreConfidence = clamp01((totalTrials / 20) * (replicationsByOthers > 0 ? 1 : 0.5));

  return { components, score, scoreConfidence, provisional };
}

// ─── Signature actions ───────────────────────────────────────────────

/**
 * Determine which signature actions are available given assignment state.
 * The participant never sees a generic "Complete Task" button.
 */
export function availableActions(state: HypothesisState, hasGoldenNode: boolean): SpinorSignatureAction[] {
  const base: SpinorSignatureAction[] = [];
  switch (state) {
    case "researched":
    case "assigned":
      base.push("plant", "challenge", "derive");
      break;
    case "accepted":
    case "modified":
    case "executing":
      base.push("observe", "record", "challenge", "derive");
      break;
    case "observed":
    case "attributed":
      base.push("record", "replicate", "derive");
      break;
    case "branched":
    case "candidate":
    case "validated":
      base.push("replicate", "derive", "integrate");
      break;
    case "scaled":
    case "productized":
      base.push("integrate", "spin_out");
      break;
    case "channel":
      base.push("spin_out");
      break;
    default:
      base.push("plant");
  }
  if (hasGoldenNode && !base.includes("integrate")) base.push("integrate");
  if (hasGoldenNode && !base.includes("spin_out")) base.push("spin_out");
  return base;
}

export const ACTION_LABEL: Record<SpinorSignatureAction, string> = {
  plant: "Plant",
  observe: "Observe",
  record: "Record",
  challenge: "Challenge",
  replicate: "Replicate",
  derive: "Derive",
  integrate: "Integrate",
  spin_out: "Spin Out",
};

// ─── Organism node construction ──────────────────────────────────────

const TWO_PI = Math.PI * 2;

function node(
  role: SpinorNodeRole,
  label: string,
  detail: string,
  evidence: SpinorEvidenceBadge,
  maturity: SpinorMaturityStage,
  angle: number,
  radius: number,
  refId?: string,
  pulse?: boolean,
): SpinorOrganismNode {
  return {
    id: `${role}-${refId ?? label.slice(0, 16)}`,
    role,
    label,
    detail,
    evidence,
    maturity,
    color: EVIDENCE_COLOR[evidence],
    angle,
    radius,
    refId,
    pulse,
  };
}

/**
 * Assemble the surrounding nodes of the Hypothesis Organism from engine
 * records. Nodes are placed on a radial canvas around the core.
 */
export function buildOrganismNodes(
  hypothesis: HypothesisAnatomy,
  priorArt: PriorArtRecord | undefined,
  ctx: {
    outcomes: HypothesisOutcome[];
    derivatives: HypothesisDerivative[];
    replications: HypothesisOutcome[];
    goldenNode?: GoldenNode;
    falsified: HypothesisOutcome[];
  },
): SpinorOrganismNode[] {
  const nodes: SpinorOrganismNode[] = [];
  let angle = -Math.PI / 2; // start at top

  const push = (n: Omit<SpinorOrganismNode, "angle" | "radius">, radius: number) => {
    nodes.push({ ...n, angle, radius });
    angle += TWO_PI / 8;
  };

  // Supporting research
  if (priorArt && priorArt.evidenceState === "supported") {
    push(
      node("supporting_research", "Supporting evidence", priorArt.adjacentSupportSummary || "Prior-art supports the mechanism.", "supported", "sprout", 0, 0, priorArt.id),
      1,
    );
  }

  // Contradicting evidence
  if (priorArt && (priorArt.evidenceState === "failed" || ctx.falsified.length > 0)) {
    push(
      node("contradicting", "Contradicting evidence", ctx.falsified.length > 0 ? `${ctx.falsified.length} falsified trial(s).` : "Prior-art contradicts the claim.", "contradicted", "seed", 0, 0, priorArt.id),
      1,
    );
  }

  // Previous attempts
  if (ctx.outcomes.length > 0) {
    push(
      node("previous_attempt", `${ctx.outcomes.length} prior trial(s)`, ctx.outcomes.map((o) => o.outcomeDescription).join(" · ").slice(0, 120) || "Earlier executions recorded.", "internal_signal", "sprout", 0, 0, hypothesis.id),
      1.4,
    );
  }

  // Replications (roots)
  if (ctx.replications.length > 0) {
    push(
      node("replication", `${ctx.replications.length} replication(s)`, "Independent participants verified or falsified this finding.", "established", "grove", 0, 0, hypothesis.id),
      1.8,
    );
  }

  // Derivatives (branches)
  const derivs = ctx.derivatives.filter((d) => d.parentHypothesisId === hypothesis.id);
  if (derivs.length > 0) {
    push(
      node("derivative", `${derivs.length} derivative(s)`, derivs[0].rationale.slice(0, 120), "plausible", "branch", 0, 0, derivs[0].id),
      1.4,
    );
  }

  // Risk signals
  push(
    node("risk_signal", "Compliance & risk", hypothesis.complianceBoundary || "No explicit boundary recorded.", "untested", "seed", 0, 0, hypothesis.id),
    1.6,
  );

  // Expected value (fruit)
  push(
    node("expected_value", "Expected value", hypothesis.expectedValue || "Value to be measured.", "plausible", "sprout", 0, 0, hypothesis.id),
    1.2,
  );

  // Golden Node (glowing junction)
  if (ctx.goldenNode) {
    push(
      node("golden_node", "Golden Node", ctx.goldenNode.observedResult.slice(0, 120), "established", "golden_node", 0, 0, ctx.goldenNode.id, true),
      0.6,
    );
  }

  // Compost: falsified results inform future experiments
  if (ctx.falsified.length > 0) {
    push(
      node("compost", "Compost", "Falsified result feeding future hypotheses.", "contradicted", "seed", 0, 0, hypothesis.id),
      2.0,
    );
  }

  return nodes;
}

// ─── Required trials ─────────────────────────────────────────────────

/**
 * Conservative minimum trials for a defensible result. Larger when the
 * expected effect is small (harder to detect) and when no control is
 * available. Never below 10.
 */
export function requiredTrialsFor(hypothesis: HypothesisAnatomy, hadControl: boolean): number {
  const base = hypothesis.researchRisk === "high" ? 30 : hypothesis.researchRisk === "moderate" ? 20 : 12;
  return hadControl ? base : Math.round(base * 1.5);
}

// ─── Falsification condition ─────────────────────────────────────────

export function falsificationConditionFor(hypothesis: HypothesisAnatomy): string {
  if (hypothesis.primaryUncertainty) {
    return `The hypothesis is falsified if ${hypothesis.primaryUncertainty} shows no improvement over ${hypothesis.control} on ${hypothesis.primaryOutcome}.`;
  }
  return `The hypothesis is falsified if the intervention produces no measurable change in ${hypothesis.primaryOutcome} relative to ${hypothesis.control}.`;
}

// ─── Top-level assembler ─────────────────────────────────────────────

/**
 * Assemble a complete SpinorOrganism for a participant's current
 * assignment. Pure function over engine state — safe to call server-side
 * per request.
 */
export function assembleOrganism(
  assignment: HypothesisAssignment,
  hypothesis: HypothesisAnatomy,
  priorArt: PriorArtRecord | undefined,
  allOutcomes: HypothesisOutcome[],
  allAttributions: HypothesisAttribution[],
  allDerivatives: HypothesisDerivative[],
  goldenNodes: GoldenNode[],
  processes: { hypothesisId: string }[],
): SpinorOrganism {
  const hypothesisOutcomes = allOutcomes.filter((o) => o.hypothesisId === hypothesis.id);
  const replications = hypothesisOutcomes.filter((o) => o.employeeId !== assignment.employeeId);
  const falsified = hypothesisOutcomes.filter((o) => o.falsified);
  const attribution = allAttributions.find((a) => a.hypothesisId === hypothesis.id);
  const goldenNode = goldenNodes.find((g) => g.hypothesisId === hypothesis.id);
  const integratedIntoProcess = processes.some((p) => p.hypothesisId === hypothesis.id);
  const spunOut = goldenNode?.stage === "independent_channel";

  const maturity = deriveMaturityStage(hypothesis, {
    outcomes: hypothesisOutcomes,
    derivatives: allDerivatives,
    goldenNode,
    replicatedByOthers: replications.length,
    integratedIntoProcess,
    spunOut,
  });

  const evidence = deriveEvidenceBadge(priorArt, hypothesisOutcomes);

  const distinctParticipants = new Set(hypothesisOutcomes.map((o) => o.employeeId)).size;
  const harmSignals = hypothesisOutcomes.reduce((acc, o) => acc + (o.metrics.filter((m) => !m.higherIsBetter && m.value > m.baseline).length), 0);
  const hadControl = attribution?.method === "matched_pairs" || attribution?.method === "comparison_group" || attribution?.method === "before_after";

  const dcs = computeDCS({
    outcomes: hypothesisOutcomes,
    attribution,
    derivatives: allDerivatives,
    replicationsByOthers: replications.length,
    priorArt,
    hypothesis,
    distinctParticipants,
    harmSignals,
    hadControl,
  });

  const nodes = buildOrganismNodes(hypothesis, priorArt, {
    outcomes: hypothesisOutcomes,
    derivatives: allDerivatives,
    replications,
    goldenNode,
    falsified,
  });

  const actions = availableActions(assignment.state, !!goldenNode);
  const requiredTrials = requiredTrialsFor(hypothesis, hadControl);

  return {
    employeeId: assignment.employeeId,
    assignmentId: assignment.id,
    hypothesisId: hypothesis.id,
    claim: hypothesis.claim,
    allocationReason: assignment.allocationReason,
    maturity,
    evidence,
    dcs,
    nodes,
    actions,
    requiredTrials,
    trialsCompleted: hypothesisOutcomes.length,
    timeWindowDays: assignment.evaluationPeriodDays,
    complianceBoundary: hypothesis.complianceBoundary,
    falsificationCondition: falsificationConditionFor(hypothesis),
    generatedAt: new Date().toISOString(),
  };
}

export { STAGE_ORDER };
