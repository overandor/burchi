/**
 * SPIN — the canonical causal unit of SPINOR OS.
 *
 * A SPIN (Single Provenance-Instrumented Node) binds together every artifact
 * produced during the organizational progression of one causal claim:
 *
 *   evidence + prior-art + hypothesis version + assignment policy +
 *   employee eligibility + human modification + model contribution +
 *   execution protocol + contextual conditions + outcome + attribution +
 *   replication + automation status + compulsory reverse test
 *
 * The SPIN is versioned through a chain of immutable snapshots. Each state
 * transition appends a new snapshot with a SHA-256 content digest linking
 * to its predecessor, providing tamper-evident provenance without an
 * external blockchain.
 *
 * This is the strongest candidate novelty concentration. It is the
 * independently-derived specification — not a copy of W3C PROV-O, which
 * provides a foundation ontology but does not define this organizational
 * lifecycle.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum SPINState {
  DRAFT = "draft",
  PRIOR_ART_CHECKED = "prior_art_checked",
  NOVELTY_QUALIFIED = "novelty_qualified",
  ELIGIBLE = "eligible",
  ASSIGNED = "assigned",
  HUMAN_MODIFIED = "human_modified",
  PREREGISTERED = "preregistered",
  EXECUTING = "executing",
  OBSERVED = "observed",
  ATTRIBUTED = "attributed",
  REPLICATION_PENDING = "replication_pending",
  REPLICATED = "replicated",
  GOLDEN_NODE_CANDIDATE = "golden_node_candidate",
  SYSTEMIZATION_PENDING = "systemization_pending",
  AUTOMATED = "automated",
  CHANNEL_CANDIDATE = "channel_candidate",
  REVERSE_TEST_REQUIRED = "reverse_test_required",
  ADVERSARIAL_EXECUTION = "adversarial_execution",
  REVALIDATED = "revalidated",
  NARROWED = "narrowed",
  ROLLED_BACK = "rolled_back",
  RETIRED = "retired",
  RESEARCH = "research",
}

export enum ContributionRole {
  HYPOTHESIS_AUTHOR = "hypothesis_author",
  MISSION_EXECUTOR = "mission_executor",
  HUMAN_MODIFIER = "human_modifier",
  REPLICATION_EXECUTOR = "replication_executor",
  ADVERSARIAL_TESTER = "adversarial_tester",
  SYSTEM_BUILDER = "system_builder",
  AUTOMATION_ARCHITECT = "automation_architect",
  CHANNEL_FOUNDER = "channel_founder",
  MODEL_ASSIST = "model_assist",
  REVIEWER = "reviewer",
}

export enum AutomationStatus {
  HUMAN_ONLY = "human_only",
  HUMAN_WITH_MODEL_ASSIST = "human_with_model_assist",
  SUPERVISED_AUTOMATION = "supervised_automation",
  FULLY_AUTOMATED = "fully_automated",
  ELIMINATED = "eliminated",
}

export enum EvidenceTier {
  OBSERVED = "observed",
  ASSOCIATED = "associated",
  SUPPORTED = "supported",
  EXPERIMENTALLY_DEMONSTRATED = "experimentally_demonstrated",
  REPLICATED = "replicated",
}

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export interface ContributionEntry {
  entryId: string;
  contributorId: string;
  contributorRole: ContributionRole;
  description: string;
  timestamp: string;
  modelAssisted: boolean;
  modelId?: string;
  modelPromptVersion?: string;
  modificationDelta: Record<string, unknown>;
}

export interface HumanModification {
  modificationId: string;
  modifierId: string;
  modifiedAt: string;
  changedVariables: Record<string, { from: unknown; to: unknown }>;
  rationale: string;
  parentHypothesisId: string;
  derivativeHypothesisId: string;
  modelAssisted: boolean;
  modelContribution?: string;
}

export interface PriorArtState {
  checkedAt: string;
  testedInMarket: boolean;
  testedInAdjacentIndustries: boolean;
  adjacentSupportSummary: string;
  sourceDomains: string[];
  responsibleComponent: string | null;
  requiredConditions: string[];
  risksAndConfounders: string[];
  genuinelyUnknown: string[];
  noveltyDelta: string;
  checkedBy: string;
}

export interface ReverseTestSpec {
  testId: string;
  scheduledAt: string;
  deadline: string;
  testerId: string | null;
  testMissionClass: "saboteur" | "palindrome" | "replication";
  failureConditions: string[];
  successConditions: string[];
  status: "scheduled" | "executing" | "passed" | "failed" | "expired";
  result: boolean | null;
  evidence: Record<string, unknown>;
  completedAt: string | null;
}

export interface SPINSnapshot {
  snapshotId: string;
  spinId: string;
  state: SPINState;
  timestamp: string;
  actorId: string;
  actorRole: string;
  reason: string;
  previousDigest: string;
  contentDigest: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Attribution claim (simplified for the SPIN engine)
// ---------------------------------------------------------------------------

export interface AttributionClaim {
  claimId: string;
  experimentId: string;
  hypothesisId: string;
  outcomeMetric: string;
  outcomeValue: number | null;
  counterfactualEstimate: number | null;
  causalEffect: number | null;
  confidence: number;
  method: "rct" | "diff_in_diff" | "synthetic_control" | "regression_discontinuity" | "instrumental_variable" | "bayesian" | "expert_judgment";
  evidence: string[];
  segments: string[];
  territories: string[];
  testedBy: string[];
  falsificationSurvived: boolean;
  significanceLevel: number;
}

// ---------------------------------------------------------------------------
// SPIN — the central causal unit
// ---------------------------------------------------------------------------

export interface SPIN {
  spinId: string;
  hypothesisId: string;
  employeeOwner: string;
  createdAt: string;
  updatedAt: string;
  state: SPINState;
  priorArt: PriorArtState;
  contributions: ContributionEntry[];
  modifications: HumanModification[];
  experimentIds: string[];
  missionIds: string[];
  claimIds: string[];
  strategyId: string | null;
  goldenNodeId: string | null;
  replicationCount: number;
  requiredReplications: number;
  automationStatus: AutomationStatus;
  automationLayerId: string | null;
  reverseTest: ReverseTestSpec | null;
  snapshots: SPINSnapshot[];
  evidenceTier: EvidenceTier;
  tags: string[];
  // Hypothesis details (embedded for the deployed app)
  claim: string;
  intervention: string;
  control: string;
  population: string;
  primaryUncertainty: string;
  complianceBoundary: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const OS_DEFAULTS = {
  MIN_REPLICATIONS: 3,
  CONFIDENCE_THRESHOLD: 0.85,
  RETEST_INTERVAL_DAYS: 90,
  SIGNIFICANCE_LEVEL: 0.05,
} as const;

function utcNow(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${nanoid(12).toUpperCase()}`;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Snapshot chain
// ---------------------------------------------------------------------------

function computeSnapshotDigest(snap: Omit<SPINSnapshot, "contentDigest">, previousDigest: string): string {
  const data = { ...snap, previousDigest };
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return sha256(canonical);
}

function makeSnapshot(
  spinId: string,
  state: SPINState,
  actorId: string,
  actorRole: string,
  reason: string,
  previousDigest: string,
  metadata?: Record<string, unknown>,
): SPINSnapshot {
  const base: Omit<SPINSnapshot, "contentDigest"> = {
    snapshotId: newId("SNP"),
    spinId,
    state,
    timestamp: utcNow(),
    actorId,
    actorRole,
    reason,
    previousDigest,
    metadata: metadata || {},
  };
  const contentDigest = computeSnapshotDigest(base, previousDigest);
  return { ...base, contentDigest };
}

// ---------------------------------------------------------------------------
// SPIN factory
// ---------------------------------------------------------------------------

export function createSPIN(params: {
  hypothesisId: string;
  employeeOwner: string;
  claim: string;
  intervention: string;
  control: string;
  population: string;
  primaryUncertainty: string;
  complianceBoundary: string;
}): SPIN {
  const spinId = newId("SPIN");
  const now = utcNow();
  const snap = makeSnapshot(spinId, SPINState.DRAFT, params.employeeOwner, "hypothesis_author", "SPIN created", "");

  return {
    spinId,
    hypothesisId: params.hypothesisId,
    employeeOwner: params.employeeOwner,
    createdAt: now,
    updatedAt: now,
    state: SPINState.DRAFT,
    priorArt: {
      checkedAt: now,
      testedInMarket: false,
      testedInAdjacentIndustries: false,
      adjacentSupportSummary: "",
      sourceDomains: [],
      responsibleComponent: null,
      requiredConditions: [],
      risksAndConfounders: [],
      genuinelyUnknown: [],
      noveltyDelta: "",
      checkedBy: "system",
    },
    contributions: [],
    modifications: [],
    experimentIds: [],
    missionIds: [],
    claimIds: [],
    strategyId: null,
    goldenNodeId: null,
    replicationCount: 0,
    requiredReplications: OS_DEFAULTS.MIN_REPLICATIONS,
    automationStatus: AutomationStatus.HUMAN_ONLY,
    automationLayerId: null,
    reverseTest: null,
    snapshots: [snap],
    evidenceTier: EvidenceTier.OBSERVED,
    tags: [],
    claim: params.claim,
    intervention: params.intervention,
    control: params.control,
    population: params.population,
    primaryUncertainty: params.primaryUncertainty,
    complianceBoundary: params.complianceBoundary,
  };
}

// ---------------------------------------------------------------------------
// SPIN operations
// ---------------------------------------------------------------------------

export function getLatestDigest(spin: SPIN): string {
  if (!spin.snapshots.length) return "";
  return spin.snapshots[spin.snapshots.length - 1].contentDigest;
}

export function appendSnapshot(
  spin: SPIN,
  state: SPINState,
  actorId: string,
  actorRole: string,
  reason: string,
  metadata?: Record<string, unknown>,
): SPINSnapshot {
  const prevDigest = getLatestDigest(spin);
  const snap = makeSnapshot(spin.spinId, state, actorId, actorRole, reason, prevDigest, metadata);
  spin.snapshots.push(snap);
  spin.state = state;
  spin.updatedAt = utcNow();
  return snap;
}

export function addContribution(
  spin: SPIN,
  contributorId: string,
  contributorRole: ContributionRole,
  description: string,
  modelAssisted = false,
  modelId?: string,
): ContributionEntry {
  const entry: ContributionEntry = {
    entryId: newId("CTR"),
    contributorId,
    contributorRole,
    description,
    timestamp: utcNow(),
    modelAssisted,
    modelId,
    modificationDelta: {},
  };
  spin.contributions.push(entry);
  return entry;
}

export function recordModification(
  spin: SPIN,
  modifierId: string,
  changedVariables: Record<string, { from: unknown; to: unknown }>,
  rationale: string,
  parentHypothesisId: string,
  derivativeHypothesisId: string,
  modelAssisted = false,
): HumanModification {
  const mod: HumanModification = {
    modificationId: newId("MOD"),
    modifierId,
    modifiedAt: utcNow(),
    changedVariables,
    rationale,
    parentHypothesisId,
    derivativeHypothesisId,
    modelAssisted,
  };
  spin.modifications.push(mod);
  addContribution(
    spin,
    modifierId,
    ContributionRole.HUMAN_MODIFIER,
    `Modified variables: ${Object.keys(changedVariables).join(", ")}. Rationale: ${rationale}`,
    modelAssisted,
  );
  return mod;
}

export function verifyChain(spin: SPIN): boolean {
  let prev = "";
  for (const snap of spin.snapshots) {
    const base: Omit<SPINSnapshot, "contentDigest"> = { ...snap };
    delete (base as any).contentDigest;
    const expected = computeSnapshotDigest(base, prev);
    if (snap.contentDigest !== expected) return false;
    prev = snap.contentDigest;
  }
  return true;
}

export function getContributors(spin: SPIN): string[] {
  return [...new Set(spin.contributions.map((c) => c.contributorId))].sort();
}

export function spinSummary(spin: SPIN): Record<string, unknown> {
  return {
    spinId: spin.spinId,
    hypothesisId: spin.hypothesisId,
    state: spin.state,
    evidenceTier: spin.evidenceTier,
    replicationCount: spin.replicationCount,
    automationStatus: spin.automationStatus,
    contributorCount: getContributors(spin).length,
    modificationCount: spin.modifications.length,
    hasReverseTest: spin.reverseTest !== null,
    snapshotCount: spin.snapshots.length,
    chainIntact: verifyChain(spin),
    claim: spin.claim,
  };
}

// ---------------------------------------------------------------------------
// Evidence tier computation (deterministic)
// ---------------------------------------------------------------------------

export function computeEvidenceTier(
  claims: AttributionClaim[],
  requiredReplications: number = OS_DEFAULTS.MIN_REPLICATIONS,
): { tier: EvidenceTier; significantCount: number; replicatedCount: number; avgConfidence: number; reason: string } {
  if (!claims.length) {
    return { tier: EvidenceTier.OBSERVED, significantCount: 0, replicatedCount: 0, avgConfidence: 0, reason: "no attribution claims exist yet" };
  }

  const isSignificant = (c: AttributionClaim) =>
    c.falsificationSurvived && c.confidence >= OS_DEFAULTS.CONFIDENCE_THRESHOLD && c.causalEffect !== null && Math.abs(c.causalEffect) > 0;

  const significant = claims.filter(isSignificant);
  const sigCount = significant.length;

  if (sigCount === 0) {
    const avgConf = claims.reduce((s, c) => s + c.confidence, 0) / claims.length;
    return { tier: EvidenceTier.ASSOCIATED, significantCount: 0, replicatedCount: 0, avgConfidence: Math.round(avgConf * 10000) / 10000, reason: "claims exist but none are significant" };
  }

  const controlledMethods = new Set(["rct", "diff_in_diff", "synthetic_control", "regression_discontinuity", "instrumental_variable"]);
  const hasControlled = significant.some((c) => controlledMethods.has(c.method));
  const avgConf = significant.reduce((s, c) => s + c.confidence, 0) / sigCount;

  const testers = new Set(significant.flatMap((c) => c.testedBy));
  const segments = new Set(significant.flatMap((c) => c.segments));
  const independentContexts = Math.max(testers.size, segments.size);

  if (sigCount >= requiredReplications && independentContexts >= requiredReplications) {
    return { tier: EvidenceTier.REPLICATED, significantCount: sigCount, replicatedCount: independentContexts, avgConfidence: Math.round(avgConf * 10000) / 10000, reason: `${sigCount} significant claims across ${independentContexts} independent contexts` };
  }

  if (hasControlled) {
    return { tier: EvidenceTier.EXPERIMENTALLY_DEMONSTRATED, significantCount: sigCount, replicatedCount: independentContexts, avgConfidence: Math.round(avgConf * 10000) / 10000, reason: `${sigCount} significant claim(s) using controlled methods, not yet replicated in ${requiredReplications} contexts` };
  }

  return { tier: EvidenceTier.SUPPORTED, significantCount: sigCount, replicatedCount: independentContexts, avgConfidence: Math.round(avgConf * 10000) / 10000, reason: `${sigCount} significant claim(s) but only observational methods` };
}

// ---------------------------------------------------------------------------
// Reverse test helpers
// ---------------------------------------------------------------------------

export function isReverseTestExpired(rt: ReverseTestSpec): boolean {
  if (rt.status !== "scheduled") return false;
  return new Date() > new Date(rt.deadline);
}

export function scheduleReverseTest(spin: SPIN, retestIntervalDays: number = OS_DEFAULTS.RETEST_INTERVAL_DAYS): ReverseTestSpec {
  const now = new Date();
  const deadline = new Date(now.getTime() + retestIntervalDays * 24 * 60 * 60 * 1000);
  const rt: ReverseTestSpec = {
    testId: newId("REV"),
    scheduledAt: now.toISOString(),
    deadline: deadline.toISOString(),
    testerId: null,
    testMissionClass: "saboteur",
    failureConditions: [
      "The effect disappears when tested in a new context",
      "A confounder explains the result",
    ],
    successConditions: [
      "The effect survives replication in an independent context",
      "No confounder explains the result",
    ],
    status: "scheduled",
    result: null,
    evidence: {},
    completedAt: null,
  };
  spin.reverseTest = rt;
  return rt;
}

export function completeReverseTest(spin: SPIN, passed: boolean, evidence?: Record<string, unknown>): void {
  if (!spin.reverseTest) return;
  spin.reverseTest.result = passed;
  spin.reverseTest.status = passed ? "passed" : "failed";
  spin.reverseTest.completedAt = utcNow();
  if (evidence) {
    spin.reverseTest.evidence = { ...spin.reverseTest.evidence, ...evidence };
  }
}

export { OS_DEFAULTS };
