/**
 * SPINOR engine — Scientific Performance & Innovation Network.
 *
 * Builds the Hypothesis Organism: a radial canvas where today's hypothesis
 * sits at the center and surrounding nodes represent prior art, derivatives,
 * replications, risks, expected value, and the path to Golden Node.
 *
 * Computes the Discovery Contribution Score (DCS):
 *   DCS = (I × C × R × V × T) / H
 * Impact × Confidence × Replicability × Novelty × Transferability,
 * divided by a Harm penalty.
 *
 * Tracks organic maturity stages: seed → sprout → branch → grove →
 * golden_node → infrastructure → spinout.
 *
 * Builds participant profiles with contribution roles (Originator, Mutator,
 * Executor, Validator, Replicator, Automator, Channel Architect) rather than
 * raw sales rankings.
 */

import { nanoid } from "nanoid";
import {
  SpinorOrganism,
  SpinorOrganismNode,
  SpinorMaturityStage,
  SpinorEvidenceBadge,
  SpinorNodeRole,
  DiscoveryContributionScore,
  DCSComponent,
  SpinorParticipantProfile,
  SpinorSignatureAction,
  HypothesisAnatomy,
  HypothesisAssignment,
  HypothesisOutcome,
  HypothesisAttribution,
  HypothesisDerivative,
  PriorArtRecord,
  GoldenNode,
} from "@/types";
import {
  loadHypotheses,
  loadHypothesisAssignments,
  loadHypothesisOutcomes,
  loadHypothesisAttributions,
  loadDerivatives,
  loadPriorArt,
  loadGoldenNodes,
  loadSpinorProfiles,
  saveSpinorProfiles,
  loadSpinorOrganisms,
  saveSpinorOrganisms,
} from "@/lib/config";
import { getHypothesisPerformance } from "./outcomes";
import { ensureGoldenSeeded, SEED_EMPLOYEES } from "./seed";

const now = () => new Date().toISOString();

// ─── DCS Calculator ────────────────────────────────────────────────

/**
 * Compute the Discovery Contribution Score.
 *
 *   DCS = (I × C × R × V × T) / H
 *
 * Each component is normalized to [0, 1]. H is a harm penalty where
 * 0 = no harm and 1 = severe harm. The final score is scaled to [0, 100].
 */
export function computeDCS(
  impact: number,
  confidence: number,
  replicability: number,
  novelty: number,
  transferability: number,
  harm: number,
  rationale?: Partial<Record<"I" | "C" | "R" | "V" | "T" | "H", string>>
): DiscoveryContributionScore {
  const components: DCSComponent[] = [
    { symbol: "I", name: "Impact", value: clamp01(impact), rationale: rationale?.I || "Observed business lift" },
    { symbol: "C", name: "Confidence", value: clamp01(confidence), rationale: rationale?.C || "Sample size and evidence quality" },
    { symbol: "R", name: "Replicability", value: clamp01(replicability), rationale: rationale?.R || "Reproduced across participants/territories" },
    { symbol: "V", name: "Novelty", value: clamp01(novelty), rationale: rationale?.V || "Genuinely new mechanism or permutation" },
    { symbol: "T", name: "Transferability", value: clamp01(transferability), rationale: rationale?.T || "Portable to other contexts" },
    { symbol: "H", name: "Harm", value: clamp01(harm), rationale: rationale?.H || "Compliance risk and contamination" },
  ];

  // DCS = (I × C × R × V × T) / max(H, 0.01)
  // When H = 0 (no harm), denominator is 0.01 to avoid division by zero.
  // When H = 1 (maximal harm), score is driven to near zero.
  const denominator = Math.max(harm, 0.01);
  const rawScore = (impact * confidence * replicability * novelty * transferability) / denominator;
  const score = Math.round(clamp01(rawScore) * 100);

  // Score confidence: driven by sample size and replication
  const scoreConfidence = clamp01((confidence * 0.5 + replicability * 0.5));
  const provisional = replicability < 0.3;

  return { components, score, scoreConfidence, provisional };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── Maturity Tracker ──────────────────────────────────────────────

/**
 * Determine the organic maturity stage of a hypothesis based on its
 * accumulated evidence.
 */
export function computeMaturity(
  hypothesisId: string
): { stage: SpinorMaturityStage; trialsCompleted: number } {
  const outcomes = loadHypothesisOutcomes().filter((o) => o.hypothesisId === hypothesisId);
  const derivatives = loadDerivatives().filter((d) => d.parentHypothesisId === hypothesisId);
  const attributions = loadHypothesisAttributions().filter((a) => a.hypothesisId === hypothesisId);
  const goldenNodes = loadGoldenNodes().filter((g) => g.hypothesisId === hypothesisId);
  const trialsCompleted = outcomes.length;

  if (goldenNodes.some((g) => g.stage === "independent_channel")) return { stage: "spinout", trialsCompleted };
  if (goldenNodes.some((g) => g.stage === "productized_service" || g.stage === "organizational_capability")) return { stage: "infrastructure", trialsCompleted };
  if (goldenNodes.length > 0) return { stage: "golden_node", trialsCompleted };
  // Grove: replicated by several participants (3+ outcomes from different employees)
  const uniqueEmployees = new Set(outcomes.map((o) => o.employeeId));
  if (uniqueEmployees.size >= 3 && outcomes.filter((o) => !o.falsified).length >= 3) return { stage: "grove", trialsCompleted };
  // Branch: has derivatives being tested
  if (derivatives.filter((d) => d.status === "testing" || d.status === "supported").length > 0) return { stage: "branch", trialsCompleted };
  // Sprout: tested once with an encouraging (non-falsified) result
  if (outcomes.length >= 1 && outcomes.some((o) => !o.falsified)) return { stage: "sprout", trialsCompleted };
  // Seed: plausible but untested
  return { stage: "seed", trialsCompleted };
}

// ─── Evidence Badge ────────────────────────────────────────────────

/**
 * Map a prior-art status to a SPINOR evidence badge.
 */
export function evidenceBadgeFromPriorArt(pa: PriorArtRecord | undefined): SpinorEvidenceBadge {
  if (!pa) return "untested";
  switch (pa.status) {
    case "established": return "established";
    case "transfer_candidate": return "transferred";
    case "novel_permutation": return "plausible";
    case "new_mechanism": return "plausible";
    case "unsupported": return "contradicted";
    default: return "untested";
  }
}

/**
 * Refine evidence badge based on internal outcomes.
 */
export function refineEvidenceBadge(
  base: SpinorEvidenceBadge,
  outcomes: HypothesisOutcome[]
): SpinorEvidenceBadge {
  const supported = outcomes.filter((o) => !o.falsified);
  const falsified = outcomes.filter((o) => o.falsified);
  if (falsified.length > supported.length && falsified.length >= 2) return "contradicted";
  if (supported.length >= 3) return "established";
  if (supported.length >= 1) return "internal_signal";
  return base;
}

// ─── Organism Builder ──────────────────────────────────────────────

/**
 * Build the Hypothesis Organism for a participant's current assignment.
 *
 * The organism is a radial canvas:
 *   - Core (center): today's hypothesis
 *   - Supporting research: prior-art evidence
 *   - Contradicting: evidence that challenges
 *   - Previous attempt: earlier trials
 *   - Derivative: branched hypotheses
 *   - Replication: independent replications
 *   - Risk signal: compliance / harm / confounder
 *   - Expected value: projected business value
 *   - Golden node: validated, glowing junction
 *   - Compost: falsified result that informs future experiments
 */
export function buildOrganism(
  assignment: HypothesisAssignment,
  employeeId: string
): SpinorOrganism {
  const hypothesis = loadHypotheses().find((h) => h.id === assignment.hypothesisId);
  if (!hypothesis) throw new Error(`Hypothesis ${assignment.hypothesisId} not found`);

  const priorArt = loadPriorArt().find((p) => p.id === hypothesis.priorArtId);
  const outcomes = loadHypothesisOutcomes().filter((o) => o.hypothesisId === hypothesis.id);
  const attributions = loadHypothesisAttributions().filter((a) => a.hypothesisId === hypothesis.id);
  const derivatives = loadDerivatives().filter((d) => d.parentHypothesisId === hypothesis.id);
  const goldenNodes = loadGoldenNodes().filter((g) => g.hypothesisId === hypothesis.id);
  const performance = getHypothesisPerformance(hypothesis.id);

  const { stage: maturity, trialsCompleted } = computeMaturity(hypothesis.id);
  const baseEvidence = evidenceBadgeFromPriorArt(priorArt);
  const evidence = refineEvidenceBadge(baseEvidence, outcomes);

  // Compute DCS
  const dcs = computeDCSFromData(hypothesis, outcomes, attributions, derivatives, performance.averageEffect, goldenNodes);

  // Build surrounding nodes
  const nodes: SpinorOrganismNode[] = [];
  let angleSlot = 0;
  const angleStep = (2 * Math.PI) / 10; // distribute around the circle

  function addNode(role: SpinorNodeRole, label: string, detail: string, color: SpinorOrganismNode["color"], evidenceBadge: SpinorEvidenceBadge, maturityBadge: SpinorMaturityStage, refId?: string, pulse = false) {
    nodes.push({
      id: `node_${nanoid(6)}`,
      role,
      label,
      detail,
      evidence: evidenceBadge,
      maturity: maturityBadge,
      color,
      angle: angleSlot * angleStep,
      radius: role === "core" ? 0 : 1 + (angleSlot % 2) * 0.3,
      refId,
      pulse,
    });
    angleSlot++;
  }

  // Prior art → supporting or contradicting
  if (priorArt) {
    const isSupporting = priorArt.status !== "unsupported";
    addNode(
      isSupporting ? "supporting_research" : "contradicting",
      `Prior art: ${priorArt.status.replace(/_/g, " ")}`,
      priorArt.adjacentSupportSummary.slice(0, 200),
      isSupporting ? "blue" : "red",
      evidenceBadgeFromPriorArt(priorArt),
      "seed",
      priorArt.id
    );
  }

  // Previous attempts (outcomes on this hypothesis)
  for (const o of outcomes.slice(0, 3)) {
    addNode(
      "previous_attempt",
      o.falsified ? "Falsified trial" : `Trial: ${o.successKind}`,
      o.outcomeDescription.slice(0, 150),
      o.falsified ? "gray" : "violet",
      o.falsified ? "contradicted" : "internal_signal",
      o.falsified ? "seed" : "sprout",
      o.id
    );
  }

  // Derivatives
  for (const d of derivatives.slice(0, 3)) {
    addNode(
      "derivative",
      `Derivative: ${d.modifiedDimension.replace(/_/g, " ")}`,
      d.claim.slice(0, 150),
      "violet",
      "plausible",
      "branch",
      d.id,
      d.status === "proposed" // pulse proposed derivatives
    );
  }

  // Replications (outcomes from other employees)
  const replicationOutcomes = outcomes.filter((o) => o.employeeId !== employeeId).slice(0, 2);
  for (const r of replicationOutcomes) {
    addNode(
      "replication",
      `Replication by ${r.employeeId}`,
      r.outcomeDescription.slice(0, 150),
      "green",
      "internal_signal",
      "grove",
      r.id
    );
  }

  // Risk signal
  if (hypothesis.complianceBoundary) {
    addNode(
      "risk_signal",
      "Compliance boundary",
      hypothesis.complianceBoundary,
      "red",
      "established",
      "seed"
    );
  }

  // Expected value
  addNode(
    "expected_value",
    "Expected value",
    hypothesis.expectedValue.slice(0, 200),
    "gold",
    "plausible",
    "sprout"
  );

  // Golden node
  if (goldenNodes.length > 0) {
    const gn = goldenNodes[0];
    addNode(
      "golden_node",
      `Golden Node: ${gn.claim.slice(0, 60)}`,
      `Stage: ${gn.stage}. Economic value: $${gn.economicValue.toLocaleString()}`,
      "gold",
      "established",
      "golden_node",
      gn.id,
      true // golden nodes glow
    );
  }

  // Compost (falsified results)
  const falsifiedOutcomes = outcomes.filter((o) => o.falsified);
  if (falsifiedOutcomes.length > 0) {
    addNode(
      "compost",
      `${falsifiedOutcomes.length} falsified result(s)`,
      "Falsified results inform future experiments — they are not waste.",
      "gray",
      "contradicted",
      "seed"
    );
  }

  // Determine available signature actions
  const actions = availableActions(maturity, assignment.state);

  // Required trials for a defensible result
  const requiredTrials = Math.max(3, Math.ceil(8 / (1 + attributions.length * 0.5)));

  return {
    employeeId,
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
    trialsCompleted,
    timeWindowDays: assignment.evaluationPeriodDays,
    complianceBoundary: hypothesis.complianceBoundary,
    falsificationCondition: hypothesis.primaryUncertainty,
    generatedAt: now(),
  };
}

function computeDCSFromData(
  hypothesis: HypothesisAnatomy,
  outcomes: HypothesisOutcome[],
  attributions: HypothesisAttribution[],
  derivatives: HypothesisDerivative[],
  avgEffect: number,
  goldenNodes: GoldenNode[]
): DiscoveryContributionScore {
  // I: Impact — average effect size
  const impact = clamp01(avgEffect);

  // C: Confidence — driven by outcome count and attribution confidence
  const outcomeCount = outcomes.length;
  const avgAttrConfidence = attributions.length > 0
    ? attributions.reduce((s, a) => s + a.attributionConfidence, 0) / attributions.length
    : 0.2;
  const confidence = clamp01(0.3 + outcomeCount * 0.1 + avgAttrConfidence * 0.3);

  // R: Replicability — unique employees with non-falsified outcomes
  const uniqueEmployees = new Set(outcomes.filter((o) => !o.falsified).map((o) => o.employeeId));
  const replicability = clamp01(uniqueEmployees.size * 0.25);

  // V: Novelty — based on hypothesis origin and novel component
  const novelty = hypothesis.novelComponent ? 0.8 : hypothesis.origin === "research" ? 0.4 : 0.6;

  // T: Transferability — based on replication territories and derivatives
  const derivativeCount = derivatives.length;
  const transferability = clamp01(0.3 + derivativeCount * 0.15);

  // H: Harm — compliance risk (inverse of compliance boundary strength)
  const harm = 0.05; // low default — compliance engine already gates

  return computeDCS(impact, confidence, replicability, novelty, transferability, harm, {
    I: `Average effect size: ${avgEffect.toFixed(2)}`,
    C: `${outcomeCount} outcomes, avg attribution confidence: ${(avgAttrConfidence * 100).toFixed(0)}%`,
    R: `${uniqueEmployees.size} unique participants with non-falsified results`,
    V: hypothesis.novelComponent ? `Novel component: ${hypothesis.novelComponent}` : "Standard permutation",
    T: `${derivativeCount} derivatives suggest transferability`,
    H: "Compliance boundary enforced — low harm risk",
  });
}

function availableActions(maturity: SpinorMaturityStage, assignmentState: string): SpinorSignatureAction[] {
  const actions: SpinorSignatureAction[] = [];
  if (assignmentState === "assigned" || assignmentState === "modified") actions.push("plant");
  if (maturity === "sprout" || maturity === "branch") actions.push("observe");
  actions.push("record"); // always can record
  actions.push("challenge"); // always can challenge
  if (maturity === "sprout" || maturity === "branch" || maturity === "grove") actions.push("derive");
  if (maturity === "grove") actions.push("replicate");
  if (maturity === "golden_node") actions.push("integrate");
  if (maturity === "infrastructure") actions.push("spin_out");
  return actions;
}

// ─── Participant Profile ───────────────────────────────────────────

/**
 * Build or update a SPINOR participant profile with contribution roles
 * instead of raw sales rankings.
 */
export function getOrCreateProfile(employeeId: string): SpinorParticipantProfile {
  const profiles = loadSpinorProfiles();
  const existing = profiles.find((p) => p.employeeId === employeeId);
  if (existing) return existing;

  const profile: SpinorParticipantProfile = {
    employeeId,
    dimensions: {
      commercialImpact: 0,
      experimentQuality: 0,
      learningVelocity: 0,
      replicationContribution: 0,
      hypothesisCreativity: 0,
      operationalEfficiency: 0,
      knowledgeSharing: 0,
      customerValue: 0,
      complianceReliability: 1, // start at full compliance
      processBuildingAbility: 0,
    },
    researchStreak: 0,
    allocationMix: { exploitation: 0, capability: 0, exploration: 0, wildcard: 0 },
  };
  profiles.push(profile);
  saveSpinorProfiles(profiles);
  return profile;
}

/**
 * Recompute a participant profile from their accumulated outcomes, attributions,
 * derivatives, and golden nodes.
 */
export function recomputeProfile(employeeId: string): SpinorParticipantProfile {
  const outcomes = loadHypothesisOutcomes().filter((o) => o.employeeId === employeeId);
  const attributions = loadHypothesisAttributions().filter((a) => a.employeeId === employeeId);
  const derivatives = loadDerivatives().filter((d) => d.proposedByEmployeeId === employeeId);
  const goldenNodes = loadGoldenNodes().filter((g) =>
    loadHypothesisAttributions().some((a) => a.hypothesisId === g.hypothesisId && a.employeeId === employeeId)
  );
  const allOutcomes = loadHypothesisOutcomes();
  const replicationOutcomes = allOutcomes.filter((o) =>
    o.employeeId !== employeeId &&
    allOutcomes.some((my) => my.employeeId === employeeId && my.hypothesisId === o.hypothesisId)
  );

  const profile = getOrCreateProfile(employeeId);
  profile.dimensions = {
    commercialImpact: clamp01(outcomes.filter((o) => !o.falsified).length * 0.1 + attributions.reduce((s, a) => s + a.estimatedEffect, 0) * 0.2),
    experimentQuality: clamp01(0.3 + outcomes.length * 0.05 + attributions.filter((a) => a.attributionConfidence > 0.6).length * 0.1),
    learningVelocity: clamp01(outcomes.length * 0.08),
    replicationContribution: clamp01(replicationOutcomes.length * 0.15),
    hypothesisCreativity: clamp01(derivatives.length * 0.15),
    operationalEfficiency: clamp01(outcomes.filter((o) => o.successKind === "efficiency" || o.successKind === "system").length * 0.15),
    knowledgeSharing: clamp01(derivatives.filter((d) => d.origin === "derivative_human").length * 0.1),
    customerValue: clamp01(outcomes.filter((o) => o.successKind === "performance" || o.successKind === "channel").length * 0.1),
    complianceReliability: 1, // maintained at 1 unless violations occur
    processBuildingAbility: clamp01(outcomes.filter((o) => o.successKind === "system").length * 0.2 + goldenNodes.length * 0.15),
  };
  profile.researchStreak = outcomes.filter((o) => !o.falsified).length;

  const profiles = loadSpinorProfiles();
  const idx = profiles.findIndex((p) => p.employeeId === employeeId);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  saveSpinorProfiles(profiles);
  return profile;
}

/**
 * Get contribution roles for a participant.
 * Returns the roles they've earned based on their profile dimensions.
 */
export function getContributionRoles(employeeId: string): string[] {
  const profile = recomputeProfile(employeeId);
  const roles: string[] = [];
  if (profile.dimensions.hypothesisCreativity > 0.3) roles.push("Originator");
  if (profile.dimensions.hypothesisCreativity > 0.5) roles.push("Mutator");
  if (profile.dimensions.experimentQuality > 0.3) roles.push("Executor");
  if (profile.dimensions.experimentQuality > 0.6) roles.push("Validator");
  if (profile.dimensions.replicationContribution > 0.3) roles.push("Replicator");
  if (profile.dimensions.processBuildingAbility > 0.3) roles.push("Automator");
  if (profile.dimensions.processBuildingAbility > 0.6) roles.push("Channel Architect");
  return roles.length > 0 ? roles : ["Participant"];
}

// ─── Leaderboard (human–LLM–hypothesis combination) ────────────────

/**
 * Node score for the leaderboard. Ranks the human–LLM–hypothesis
 * combination, NOT raw sales.
 *
 *   Node score =
 *     causal business lift
 *   + information gained
 *   + successful mutation value
 *   + replication quality
 *   + reusable-system value
 *   − compliance risk
 *   − contamination
 *   − execution cost
 */
export function computeNodeScore(employeeId: string): {
  score: number;
  breakdown: Record<string, number>;
  roles: string[];
} {
  const profile = recomputeProfile(employeeId);
  const outcomes = loadHypothesisOutcomes().filter((o) => o.employeeId === employeeId);
  const attributions = loadHypothesisAttributions().filter((a) => a.employeeId === employeeId);
  const derivatives = loadDerivatives().filter((d) => d.proposedByEmployeeId === employeeId);

  const causalLift = attributions.reduce((s, a) => s + a.estimatedEffect, 0);
  const informationGained = outcomes.length * 0.5 + outcomes.filter((o) => o.falsified).length * 0.3; // falsification is information
  const mutationValue = derivatives.length * 0.8;
  const replicationQuality = profile.dimensions.replicationContribution * 5;
  const reusableSystemValue = profile.dimensions.processBuildingAbility * 5;
  const complianceRisk = (1 - profile.dimensions.complianceReliability) * 10;
  const contamination = attributions.filter((a) => a.unexplainedVariance > 0.4).length * 0.5;
  const executionCost = outcomes.length * 0.1; // marginal cost per experiment

  const score = causalLift + informationGained + mutationValue + replicationQuality + reusableSystemValue - complianceRisk - contamination - executionCost;

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      causalLift: Math.round(causalLift * 100) / 100,
      informationGained: Math.round(informationGained * 100) / 100,
      mutationValue: Math.round(mutationValue * 100) / 100,
      replicationQuality: Math.round(replicationQuality * 100) / 100,
      reusableSystemValue: Math.round(reusableSystemValue * 100) / 100,
      complianceRisk: Math.round(complianceRisk * 100) / 100,
      contamination: Math.round(contamination * 100) / 100,
      executionCost: Math.round(executionCost * 100) / 100,
    },
    roles: getContributionRoles(employeeId),
  };
}

/**
 * Rank all participants by their node score (human–LLM–hypothesis combination).
 */
export function rankParticipants(): {
  employeeId: string;
  score: number;
  breakdown: Record<string, number>;
  roles: string[];
}[] {
  const employees = SEED_EMPLOYEES.map((e) => e.id);
  // Also include any employees that have outcomes
  const allOutcomes = loadHypothesisOutcomes();
  for (const o of allOutcomes) {
    if (!employees.includes(o.employeeId)) employees.push(o.employeeId);
  }

  const rankings = employees.map((id) => {
    const { score, breakdown, roles } = computeNodeScore(id);
    return { employeeId: id, score, breakdown, roles };
  });
  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}

// ─── Organism persistence ──────────────────────────────────────────

export function getOrganismForEmployee(employeeId: string): SpinorOrganism | undefined {
  // Find active assignment and build organism
  const assignments = loadHypothesisAssignments().filter(
    (a) => a.employeeId === employeeId && !["falsified", "validated", "scaled", "productized", "channel", "rejected", "completed"].includes(a.state)
  );
  if (assignments.length === 0) return undefined;
  const organism = buildOrganism(assignments[0], employeeId);
  // Persist for caching
  const all = loadSpinorOrganisms();
  const idx = all.findIndex((o) => o.assignmentId === organism.assignmentId);
  if (idx >= 0) all[idx] = organism;
  else all.push(organism);
  saveSpinorOrganisms(all);
  return organism;
}

export function listOrganisms(): SpinorOrganism[] {
  return loadSpinorOrganisms();
}

// ─── Initialize ────────────────────────────────────────────────────

export function ensureSpinorInitialized(): void {
  ensureGoldenSeeded();
  const profiles = loadSpinorProfiles();
  if (profiles.length === 0) {
    for (const emp of SEED_EMPLOYEES) {
      getOrCreateProfile(emp.id);
    }
  }
}
